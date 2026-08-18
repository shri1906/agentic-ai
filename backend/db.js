import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "friday-ai.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// --- Schema ---------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Long-term facts/preferences, independent of any single session.
  -- e.g. key="preferred_name", value="Shivam"
  CREATE TABLE IF NOT EXISTS facts (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Uploaded knowledge-base documents (Phase 3: RAG)
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
`);

// --- Sessions ---------------------------------------------------------------
export function createSession(id, title = "New chat") {
  db.prepare("INSERT INTO sessions (id, title) VALUES (?, ?)").run(id, title);
  return getSession(id);
}

export function getSession(id) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
}

export function listSessions() {
  return db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
}

export function touchSession(id) {
  db.prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?").run(id);
}

export function renameSession(id, title) {
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, id);
}

export function deleteSession(id) {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

// --- Messages ---------------------------------------------------------------
export function addMessage(sessionId, role, content) {
  db.prepare("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)").run(
    sessionId,
    role,
    content
  );
  touchSession(sessionId);
}

export function getMessages(sessionId) {
  return db
    .prepare("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC")
    .all(sessionId);
}

// --- Facts (long-term memory) -----------------------------------------------
export function setFact(key, value) {
  db.prepare(
    `INSERT INTO facts (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

export function getFacts() {
  return db.prepare("SELECT key, value FROM facts ORDER BY key ASC").all();
}

export function deleteFact(key) {
  db.prepare("DELETE FROM facts WHERE key = ?").run(key);
}

// --- Documents & chunks (Phase 3: RAG) --------------------------------------
export function addDocument(id, filename) {
  db.prepare("INSERT INTO documents (id, filename) VALUES (?, ?)").run(id, filename);
}

export function listDocuments() {
  return db
    .prepare(
      `SELECT d.id, d.filename, d.uploaded_at, COUNT(c.id) AS chunk_count
       FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
       GROUP BY d.id ORDER BY d.uploaded_at DESC`
    )
    .all();
}

export function deleteDocument(id) {
  db.prepare("DELETE FROM documents WHERE id = ?").run(id); // cascades to chunks
}

export function addChunks(documentId, chunkTexts) {
  const insert = db.prepare("INSERT INTO chunks (document_id, content) VALUES (?, ?)");
  const insertMany = db.transaction((texts) => {
    for (const text of texts) insert.run(documentId, text);
  });
  insertMany(chunkTexts);
}

// Returns every chunk plus its parent document's filename, for search.
export function getAllChunksWithSource() {
  return db
    .prepare(
      `SELECT c.id, c.content, d.filename
       FROM chunks c JOIN documents d ON d.id = c.document_id`
    )
    .all();
}