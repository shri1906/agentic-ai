# Friday AI — Phase 1+2+3: Chat UI + Memory + RAG

A ChatGPT-style chat app: React frontend + Node/Express backend that
proxies to your LLM provider, with persistent memory (SQLite) and a
document knowledge base (RAG) — upload PDFs, Word docs, spreadsheets,
or text files, and the assistant searches them before answering.

## Structure

```
Friday-ai/
├── backend/
│   ├── server.js        # Express API: chat, sessions, facts, documents
│   ├── db.js             # SQLite schema + queries
│   ├── rag.js             # Text extraction, chunking, BM25 search
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx       # Chat UI: sessions sidebar + documents panel
    │   ├── App.css
    │   ├── index.css
    │   └── main.jsx
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── .env.example
```

## What's new in Phase 3

- **Upload documents**: PDF, DOCX, XLSX/XLS/CSV, TXT, or MD via the
  sidebar's "+ upload" button (or `POST /api/documents`, multipart field
  `file`). Text is extracted and split into overlapping chunks.
- **Retrieval before answering**: every chat message searches the
  uploaded chunks and, if any are relevant, injects the best matches into
  the system prompt with their source filename. The model is instructed
  to prefer document content over general knowledge when it's there, and
  to say which file it came from.
- **No embedding API required**: search uses a local BM25 lexical ranking
  (`backend/rag.js`) computed entirely in Node — no extra API key or cost,
  works fine offline. It's a good match for a personal knowledge base;
  if you outgrow lexical search (e.g. you need semantic matching across
  paraphrases), the natural upgrade is swapping `searchChunks` for a
  vector-embedding + cosine-similarity search using your LLM provider's
  embeddings endpoint.
- Manage documents from the sidebar, or `GET/DELETE /api/documents/:id`.

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
- `backend/Friday-ai.db` is created automatically on first run. Delete it
  to wipe all history, facts, and documents and start fresh. It's
  gitignored by default. Uploaded files are deleted from disk right after
  their text is extracted — only the extracted chunks are kept in SQLite.

## Next phases (from the original roadmap)

- **Phase 4 — Tools**: let the assistant call functions (SQL queries, log
  reads, report generation) via tool-calling.
- **Phase 5 — Web search**: add a search tool for current information.

Say the word and we'll build the next phase on top of this.

## Deploying behind IIS

Run the backend as a Windows service (e.g. via `pm2` or `node-windows`),
then configure IIS as a reverse proxy (via the URL Rewrite + ARR modules)
to `http://localhost:5000` for `/api/*` and serve the built frontend
(`npm run build` → `frontend/dist`) as static files.
