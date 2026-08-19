import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
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
  addDocument,
  listDocuments,
  deleteDocument,
  addChunks,
} from "./db.js";
import { extractText, chunkText, searchChunks } from "./rag.js";
import { getToolDefinitions, executeTool } from "./tools.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "uploads");
await fs.mkdir(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

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

// --- Documents (Phase 3: RAG knowledge base) --------------------------------
app.get("/api/documents", (_req, res) => {
  res.json({ documents: listDocuments() });
});

app.post("/api/documents", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded. Send it as multipart form field 'file'." });
  }

  try {
    const text = await extractText(req.file.path, req.file.originalname);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      return res.status(422).json({ error: "Couldn't extract any usable text from that file." });
    }

    const id = randomUUID();
    addDocument(id, req.file.originalname);
    addChunks(id, chunks);

    res.status(201).json({
      document: { id, filename: req.file.originalname, chunk_count: chunks.length },
    });
  } catch (err) {
    console.error("[friday-ai] Document processing failed:", err);
    res.status(500).json({ error: err.message || "Failed to process the uploaded document." });
  } finally {
    // We only ever keep extracted text/chunks in the DB, not the raw file.
    fs.unlink(req.file.path).catch(() => {});
  }
});

app.delete("/api/documents/:id", (req, res) => {
  deleteDocument(req.params.id);
  res.status(204).end();
});


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

  const relevantChunks = searchChunks(message, 4);
  const docsBlock = relevantChunks.length
    ? "Relevant excerpts from the user's uploaded documents (cite the filename when you use one):\n\n" +
      relevantChunks
        .map((c) => `[${c.filename}]\n${c.content}`)
        .join("\n\n---\n\n")
    : "";

  const systemPrompt = {
    role: "system",
    content: [
      "You are friday AI, a helpful, concise personal assistant.",
      "You have tools available — use them when they'd give a more accurate answer than your own knowledge (math, current date/time, saving a fact, searching documents, querying the database). Don't narrate that you're using a tool, just use it and answer.",
      "If the user's uploaded documents contain the answer, prefer that over general knowledge and say which file it came from. If they don't, answer normally and say so.",
      factsBlock,
      docsBlock,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };

  const history = getMessages(sessionId); // includes the message just added
  let workingMessages = [systemPrompt, ...history];
  const tools = getToolDefinitions();

  try {
    let reply = "";
    const toolLog = [];
    const MAX_TOOL_ROUNDS = 5;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const upstream = await fetch(process.env.LLM_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL,
          messages: workingMessages,
          tools,
          tool_choice: "auto",
          temperature: 0.7,
        }),
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        console.error("[friday-ai] Upstream LLM error:", upstream.status, errText);
        return res.status(502).json({ error: "Upstream model provider returned an error.", detail: errText });
      }

      const data = await upstream.json();
      const assistantMsg = data?.choices?.[0]?.message;

      if (!assistantMsg) {
        return res.status(502).json({ error: "Upstream model provider returned an unexpected response shape." });
      }

      const toolCalls = assistantMsg.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        // No more tool use — this is the final answer.
        reply = assistantMsg.content ?? "";
        break;
      }

      // Model wants to call one or more tools. Run them locally, feed the
      // results back, and loop so it can respond (or call more tools).
      workingMessages = [...workingMessages, assistantMsg];

      for (const call of toolCalls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          // malformed args from the model — pass an error back instead of crashing
        }

        console.log(`[friday-ai] Tool call: ${call.function.name}(${call.function.arguments})`);
        const result = await executeTool(call.function.name, args);
        toolLog.push({ name: call.function.name, args });

        workingMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }

      if (round === MAX_TOOL_ROUNDS - 1) {
        reply = "I made several tool calls but couldn't reach a final answer in time — try rephrasing or breaking the request into smaller steps.";
      }
    }

    addMessage(sessionId, "assistant", reply);

    // Auto-title fresh sessions from the first exchange.
    const session = getSession(sessionId);
    if (session.title === "New chat") {
      renameSession(sessionId, message.slice(0, 60));
    }

    return res.json({ reply, toolCalls: toolLog });
  } catch (err) {
    console.error("[friday-ai] /api/chat failed:", err);
    return res.status(500).json({ error: "Internal server error while contacting the model provider." });
  }
});

app.listen(PORT, () => {
  console.log(`[friday-ai] Backend listening on http://localhost:${PORT}`);
});