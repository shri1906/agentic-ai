import { useEffect, useRef, useState } from "react";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

const SYSTEM_PROMPT = {
  role: "system",
  content: "You are friday AI, a helpful, concise personal assistant.",
};

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [SYSTEM_PROMPT, ...nextMessages] }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Request failed.");
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
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
    <div className="shell">
      <header className="topbar">
        <span className={`status-dot${busy ? " busy" : ""}`} />
        <span className="topbar-title">friday@ai:~</span>
        <span className="topbar-sub">phase 1 · chat</span>
      </header>

      <main className="log" ref={logRef}>
        {messages.length === 0 && (
          <div className="log-empty">
            <div className="big">Friday AI</div>
            type a message below to start a session.
            <br />
            no memory yet &mdash; that lands in phase 2.
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
  );
}
