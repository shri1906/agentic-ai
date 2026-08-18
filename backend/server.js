import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import {
  createSession,
  getSession,
  listSessions,
  renameSession,
  deleteSession,
  addMessage,
  getMessages,
  setFact,
  getFacts,
  deleteFact,
} from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "2mb" }));

// --- Config sanity check -----------------------------------------------
const REQUIRED_ENV = ["LLM_API_KEY", "LLM_API_URL", "LLM_MODEL"];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(
    `[friday-ai] Missing env vars: ${missing.join(", ")}. ` +
      "Copy .env.example to .env and fill them in before calling /api/chat."
  );
}

// --- Health check --------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", configured: missing.length === 0 });
});

// --- Sessions (conversation history) --------------------------------------
app.get("/api/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

app.post("/api/sessions", (req, res) => {
  const id = randomUUID();
  const title = (req.body?.title || "New chat").slice(0, 80);
  const session = createSession(id, title);
  res.status(201).json({ session });
});

app.get("/api/sessions/:id/messages", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  res.json({ messages: getMessages(req.params.id) });
});

app.patch("/api/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found." });
  if (req.body?.title) renameSession(req.params.id, req.body.title.slice(0, 80));
  res.json({ session: getSession(req.params.id) });
});

app.delete("/api/sessions/:id", (req, res) => {
  deleteSession(req.params.id);
  res.status(204).end();
});

// --- Facts (long-term memory, independent of any one session) --------------
app.get("/api/facts", (_req, res) => {
  res.json({ facts: getFacts() });
});

app.post("/api/facts", (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof value === "undefined") {
    return res.status(400).json({ error: "Request body must include 'key' and 'value'." });
  }
  setFact(key, String(value));
  res.status(201).json({ facts: getFacts() });
});

app.delete("/api/facts/:key", (req, res) => {
  deleteFact(req.params.key);
  res.status(204).end();
});

// --- Chat endpoint ---------------------------------------------------
// Expects: { sessionId: string, message: string }
// Persists both the user message and the assistant reply, and grounds
// the model in the full session history plus any stored long-term facts.
// Returns: { reply: string }
app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body || {};

  if (!sessionId || !getSession(sessionId)) {
    return res.status(400).json({ error: "Request must include a valid 'sessionId'. Create one via POST /api/sessions." });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Request body must include a non-empty 'message'." });
  }

  if (missing.length) {
    return res.status(500).json({
      error: `Server is missing configuration: ${missing.join(", ")}. See backend/.env.example.`,
    });
  }

  // Persist the user's turn first so history is never lost even if the
  // upstream call below fails.
  addMessage(sessionId, "user", message);

  const facts = getFacts();
  const factsBlock = facts.length
    ? `Known long-term facts about the user:\n${facts.map((f) => `- ${f.key}: ${f.value}`).join("\n")}`
    : "";

  const systemPrompt = {
    role: "system",
    content: ["You are Friday AI, a helpful, concise personal assistant.", factsBlock]
      .filter(Boolean)
      .join("\n\n"),
  };

  const history = getMessages(sessionId); // includes the message just added

  try {
    const upstream = await fetch(process.env.LLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages: [systemPrompt, ...history],
        temperature: 0.7,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("[friday-ai] Upstream LLM error:", upstream.status, errText);
      return res.status(502).json({ error: "Upstream model provider returned an error.", detail: errText });
    }

    const data = await upstream.json();

    // OpenAI-compatible response shape. Adjust here if you switch providers.
    const reply = data?.choices?.[0]?.message?.content ?? "";

    addMessage(sessionId, "assistant", reply);

    // Auto-title fresh sessions from the first exchange.
    const session = getSession(sessionId);
    if (session.title === "New chat") {
      renameSession(sessionId, message.slice(0, 60));
    }

    return res.json({ reply });
  } catch (err) {
    console.error("[friday-ai] /api/chat failed:", err);
    return res.status(500).json({ error: "Internal server error while contacting the model provider." });
  }
});

app.listen(PORT, () => {
  console.log(`[friday-ai] Backend listening on http://localhost:${PORT}`);
});