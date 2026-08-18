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
  const logRef = useRef(null);

  // Load session list on mount.
  useEffect(() => {
    refreshSessions();
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
  }

  async function removeSession(id, e) {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/sessions/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    refreshSessions();
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

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
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
      <aside className="sidebar">
        <button className="new-chat" onClick={newSession}>
          + new session
        </button>
        <div className="session-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item${s.id === activeId ? " active" : ""}`}
              onClick={() => setActiveId(s.id)}
            >
              <span className="session-title">{s.title}</span>
              <button className="session-delete" onClick={(e) => removeSession(s.id, e)} title="Delete">
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 && <div className="session-empty">no sessions yet</div>}
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <span className={`status-dot${busy ? " busy" : ""}`} />
          <span className="topbar-title">friday@ai:~</span>
          <span className="topbar-sub">phase 2 · memory</span>
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
              <span className="msg-role">{m.role === "user" ? "you" : "friday"}</span>
              <div className="msg-bubble">{m.content}</div>
            </div>
          ))}

          {busy && (
            <div className="msg assistant">
              <span className="msg-role">friday</span>
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
            placeholder="Ask friday AI anything..."
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
