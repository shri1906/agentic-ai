import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("Friday-ai-theme") || "dark");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logRef = useRef(null);
  const fileInputRef = useRef(null);

  // Apply + persist theme.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("Friday-ai-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  // Load session list + documents on mount.
  useEffect(() => {
    refreshSessions();
    refreshDocuments();
  }, []);

  // Load messages whenever the active session changes.
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    fetch(`${API_BASE}/api/sessions/${activeId}/messages`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []))
      .catch(() => setError("Couldn't load that session's history."));
  }, [activeId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function refreshSessions(selectId) {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      const data = await res.json();
      setSessions(data.sessions || []);
      if (selectId) setActiveId(selectId);
      else if (!activeId && data.sessions?.length) setActiveId(data.sessions[0].id);
    } catch {
      setError("Couldn't reach the backend. Is it running on " + API_BASE + "?");
    }
  }

  async function newSession() {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New chat" }),
    });
    const data = await res.json();
    await refreshSessions(data.session.id);
    setSidebarOpen(false);
  }

  async function removeSession(id, e) {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/sessions/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    refreshSessions();
  }

  async function refreshDocuments() {
    try {
      const res = await fetch(`${API_BASE}/api/documents`);
      const data = await res.json();
      setDocuments(data.documents || []);
    } catch {
      // silent — the sidebar just stays empty; the main error banner
      // already covers "backend unreachable"
    }
  }

  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/api/documents`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      await refreshDocuments();
    } catch (err) {
      setError(err.message || "Couldn't upload that file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeDocument(id, e) {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/documents/${id}`, { method: "DELETE" });
    refreshDocuments();
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    let sessionId = activeId;
    if (!sessionId) {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      const data = await res.json();
      sessionId = data.session.id;
      setActiveId(sessionId);
    }

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, toolCalls: data.toolCalls || [] },
      ]);
      refreshSessions(sessionId); // picks up auto-generated title / reordering
    } catch (err) {
      setError(err.message || "Something went wrong talking to the backend.");
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="app">
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <button className="new-chat" onClick={newSession}>
          + new session
        </button>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item${s.id === activeId ? " active" : ""}`}
              onClick={() => {
                setActiveId(s.id);
                setSidebarOpen(false);
              }}
            >
              <span className="session-title">{s.title}</span>
              <button className="session-delete" onClick={(e) => removeSession(s.id, e)} title="Delete">
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 && <div className="session-empty">no sessions yet</div>}
        </div>

        <div className="docs-panel">
          <div className="docs-header">
            <span>knowledge base</span>
            <button
              className="docs-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Upload a document"
            >
              {uploading ? "..." : "+ upload"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md"
              onChange={uploadFile}
              style={{ display: "none" }}
            />
          </div>
          <div className="docs-list">
            {documents.map((d) => (
              <div key={d.id} className="doc-item" title={`${d.chunk_count} chunk(s)`}>
                <span className="doc-name">{d.filename}</span>
                <button className="session-delete" onClick={(e) => removeDocument(d.id, e)} title="Delete">
                  ×
                </button>
              </div>
            ))}
            {documents.length === 0 && <div className="session-empty">no documents yet</div>}
          </div>
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle sidebar"
            title="Sessions & documents"
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M2.5 5h15M2.5 10h15M2.5 15h15" strokeLinecap="round" />
            </svg>
          </button>
          <span className={`status-dot${busy ? " busy" : ""}`} />
          <span className="topbar-title">Friday Ai</span>
          <span className="topbar-sub">Shivam maurya</span>
          <button
            className="icon-btn theme-btn"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
                <path d="M10 2.5a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2.5zm0 12a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 14.5zm7.5-4.5a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zm-12 0a.75.75 0 01-.75.75H3.25a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zm9.02-5.27a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zm-9.5 9.5a.75.75 0 010 1.06L3.94 15.8a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zm9.5 1.06a.75.75 0 01-1.06 0l-1.06-1.06a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zm-9.5-9.5a.75.75 0 01-1.06 0L3.94 4.24a.75.75 0 111.06-1.06l1.06 1.06a.75.75 0 010 1.06zM10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            )}
          </button>
        </header>

        <main className="log" ref={logRef}>
          {messages.length === 0 && (
            <div className="log-empty">
              <div className="big">Friday AI</div>
              type a message below to start a session.
              <br />
              history now persists across restarts.
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <span className="msg-role">{m.role === "user" ? "you" : "Friday"}</span>
              <div className="msg-bubble">{m.content}</div>
              {m.toolCalls?.length > 0 && (
                <div className="tool-tag">
                  used: {m.toolCalls.map((t) => t.name).join(", ")}
                </div>
              )}
            </div>
          ))}

          {busy && (
            <div className="msg assistant">
              <span className="msg-role">Friday</span>
              <div className="msg-bubble">
                thinking<span className="cursor" />
              </div>
            </div>
          )}

          {error && (
            <div className="msg assistant">
              <span className="msg-role">error</span>
              <div className="msg-bubble error">{error}</div>
            </div>
          )}
        </main>

        <div className="composer">
          <span className="prompt-glyph">&gt;</span>
          <textarea
            rows={1}
            value={input}
            placeholder="Ask Friday AI anything..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={busy}
          />
          <button onClick={send} disabled={busy || !input.trim()}>
            {busy ? "..." : "send"}
          </button>
        </div>
      </div>
    </div>
  );
}