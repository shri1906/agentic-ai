# friday AI — Phase 1: Chat UI + API Backend

A minimal, working ChatGPT-style chat app: React frontend + Node/Express
backend that proxies to your LLM provider. This is the foundation phase —
memory, RAG, and tools get layered on in later phases.

## Structure

```
friday-ai/
├── backend/
│   ├── server.js        # Express API, /api/chat endpoint
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx       # Chat UI
    │   ├── App.css
    │   ├── index.css
    │   └── main.jsx
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── .env.example
```

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

- The frontend keeps the conversation in React state and sends the full
  message array to the backend on every turn.
- The backend forwards that array to your LLM provider's chat-completions
  endpoint, using the OpenAI-compatible request/response shape. If you use
  a provider with a different shape (e.g. Anthropic's Messages API), adjust
  the `fetch` call and response parsing in `backend/server.js`.
- No conversation persistence yet — refreshing the page clears history.
  That's Phase 2 (long-term memory with a database).

## Next phases (from the original roadmap)

- **Phase 2 — Memory**: persist conversations + facts in Postgres/SQLite,
  retrieve relevant context automatically.
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
