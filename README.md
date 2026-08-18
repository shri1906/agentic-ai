# Shivam AI — Phase 1+2: Chat UI + API Backend + Memory

A ChatGPT-style chat app: React frontend + Node/Express backend that
proxies to your LLM provider, now with persistent memory via SQLite —
conversations survive restarts and are organized into browsable sessions.

## Structure

```
shivam-ai/
├── backend/
│   ├── server.js        # Express API: /api/chat, /api/sessions, /api/facts
│   ├── db.js             # SQLite schema + queries (sessions, messages, facts)
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx       # Chat UI with session sidebar
    │   ├── App.css
    │   ├── index.css
    │   └── main.jsx
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── .env.example
```

## What's new in Phase 2

- **Sessions**: every conversation is a row in SQLite (`backend/shivam-ai.db`,
  created automatically on first run). The sidebar lists them, lets you
  switch between them, and delete ones you don't need.
- **Persistent history**: messages are saved to disk as they're sent —
  restart the backend and your conversations are still there.
- **Long-term facts**: `POST /api/facts` with `{ "key": "...", "value": "..." }`
  stores a fact (e.g. `preferred_name: Shivam`) that gets injected into
  every future conversation's system prompt, regardless of session. Try:
  ```bash
  curl -X POST http://localhost:5000/api/facts \
    -H "Content-Type: application/json" \
    -d '{"key":"preferred_name","value":"Shivam"}'
  ```
  There's no UI for facts yet — that's a good next small addition, or we
  can fold it into Phase 3 alongside document memory (RAG).

## 1. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:
- `LLM_API_KEY` — your provider's API key
- `LLM_API_URL` — the chat-completions endpoint (OpenAI-compatible by default)
- `LLM_MODEL` — the **exact** model string from your provider's current
  docs/dashboard. Don't guess at a model name — check it live, since model
  lineups change often.

Run it:

```bash
npm run dev
```

Backend listens on `http://localhost:5000`. Check `GET /api/health` to
confirm it's configured correctly.

## 2. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Opens on `http://localhost:5173`. It talks to the backend over
`VITE_API_BASE`.

## How it works

- Each browser session tracks an `activeId` (the current chat's session ID).
  Sending a message posts `{ sessionId, message }` to `/api/chat`; the
  backend saves the user turn, loads the full history for that session
  from SQLite, prepends the system prompt (plus any stored facts), calls
  your LLM provider, saves the reply, and returns it.
- The backend uses the OpenAI-compatible request/response shape. If you use
  a provider with a different shape (e.g. Anthropic's Messages API), adjust
  the `fetch` call and response parsing in `backend/server.js`.
- `backend/shivam-ai.db` is created automatically on first run. Delete it
  to wipe all history and start fresh. It's gitignored by default.

## Next phases (from the original roadmap)

- **Phase 3 — RAG**: upload PDFs/Word/Excel, embed and search them before
  answering.
- **Phase 4 — Tools**: let the assistant call functions (SQL queries, log
  reads, report generation) via tool-calling.
- **Phase 5 — Web search**: add a search tool for current information.

Say the word and we'll build the next phase on top of this.

## Deploying behind IIS

Run the backend as a Windows service (e.g. via `pm2` or `node-windows`),
then configure IIS as a reverse proxy (via the URL Rewrite + ARR modules)
to `http://localhost:5000` for `/api/*` and serve the built frontend
(`npm run build` → `frontend/dist`) as static files.