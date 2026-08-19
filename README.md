# Shivam AI — Phase 1+2+3+4: Chat, Memory, RAG, and Tools

A ChatGPT-style chat app: React frontend + Node/Express backend that
proxies to your LLM provider, with persistent memory (SQLite), a document
knowledge base (RAG), and now tool-calling — the assistant can do math,
check the date, save facts about you, search your documents, and (if you
configure it) run read-only SQL queries against your own database.

## Structure

```
shivam-ai/
├── backend/
│   ├── server.js        # Express API: chat (with tool loop), sessions, facts, documents
│   ├── db.js             # SQLite schema + queries
│   ├── rag.js             # Text extraction, chunking, BM25 search
│   ├── tools.js           # Tool definitions + execution (Phase 4)
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx       # Chat UI: sessions sidebar + documents panel + tool tags
    │   ├── App.css
    │   ├── index.css
    │   └── main.jsx
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── .env.example
```

## What's new in Phase 4

The assistant becomes an agent: it can decide mid-conversation to call a
function, get the result back, and use it to answer. This uses standard
OpenAI-compatible function-calling (`tools` + `tool_choice: "auto"` in the
chat-completions request) — your provider's model needs to support it.
Groq's `llama-3.3-70b-versatile` (the default in `.env.example`) does.

**Built-in tools** (`backend/tools.js`):
- `calculate` — arithmetic via `mathjs`'s expression evaluator (no `eval`,
  so it's safe against code injection)
- `get_current_datetime`
- `remember_fact` — same long-term memory store as `/api/facts`, but the
  model can write to it itself mid-conversation (e.g. "call me Raj from
  now on")
- `search_documents` — an explicit, targeted version of the automatic RAG
  search from Phase 3
- `query_database` — **only appears if you configure `DB_HOST` / `DB_USER`
  / `DB_PASSWORD` / `DB_NAME`** in `.env` (see the commented block at the
  bottom of `.env.example`). It's hard-restricted to single `SELECT`
  statements, auto-capped at `LIMIT 200`, and rejects anything with a
  second statement.

Each assistant message that used a tool shows a small `used: calculate`
tag under it in the UI so you can see what actually happened.

### A deliberate omission: no shell/command-execution tool

There's no generic "run a shell command", "restart a service", or
"execute PowerShell" tool here, even though the original roadmap
mentioned that kind of automation. Handing an LLM agent unrestricted
command execution is a genuine security risk — a malicious or just
poorly-worded instruction hidden in a document you upload, or in the
conversation itself, could get it to run something destructive. If you
want that kind of capability:
- Build **one narrow, explicitly-whitelisted tool per action** (e.g.
  `restart_web_service` that always runs one fixed, audited command with
  no user-controlled arguments), never a free-form executor.
- Log every invocation.
- Consider requiring a human confirmation step before anything with
  side effects actually runs.

## How the tool loop works

1. `/api/chat` sends the conversation to your LLM along with the tool
   definitions.
2. If the model responds with `tool_calls` instead of a plain answer, the
   backend executes each one locally via `executeTool()`, appends the
   results as `role: "tool"` messages, and calls the model again.
3. This repeats (capped at 5 rounds) until the model returns a normal
   text answer, which is what gets saved to the conversation and shown
   to you. The intermediate tool-calling exchange itself isn't persisted
   to SQLite — only the user's message and the final answer are, to keep
   the stored history clean and provider-agnostic.

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
  to wipe all history, facts, and documents and start fresh. It's
  gitignored by default. Uploaded files are deleted from disk right after
  their text is extracted — only the extracted chunks are kept in SQLite.

## Next phase (from the original roadmap)

- **Phase 5 — Web search**: add a search tool for current information.
  This slots in as one more entry in `getToolDefinitions()` /
  `executeTool()` — same pattern as everything in Phase 4.

Say the word and we'll build it.

## Deploying behind IIS

Run the backend as a Windows service (e.g. via `pm2` or `node-windows`),
then configure IIS as a reverse proxy (via the URL Rewrite + ARR modules)
to `http://localhost:5000` for `/api/*` and serve the built frontend
(`npm run build` → `frontend/dist`) as static files.