import express from "express";
import cors from "cors";
import dotenv from "dotenv";

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

// --- Chat endpoint ---------------------------------------------------
// Expects: { messages: [{ role: "user" | "assistant" | "system", content: string }, ...] }
// Returns: { reply: string }
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Request body must include a non-empty 'messages' array." });
  }

  if (missing.length) {
    return res.status(500).json({
      error: `Server is missing configuration: ${missing.join(", ")}. See backend/.env.example.`,
    });
  }

  try {
    const upstream = await fetch(process.env.LLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL,
        messages,
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

    return res.json({ reply });
  } catch (err) {
    console.error("[friday-ai] /api/chat failed:", err);
    return res.status(500).json({ error: "Internal server error while contacting the model provider." });
  }
});

app.listen(PORT, () => {
  console.log(`[friday-ai] Backend listening on http://localhost:${PORT}`);
});
