import { evaluate } from "mathjs";
import mysql from "mysql2/promise";
import { setFact, getFacts } from "./db.js";
import { searchChunks } from "./rag.js";

// ---------------------------------------------------------------------------
// Design note: tools here are intentionally bounded and read-mostly. There is
// deliberately NO generic "run a shell command" or "restart a service" tool —
// handing an LLM agent unrestricted command execution is a real security risk
// (especially given prompt injection from tool outputs or documents), not
// just a "nice to have" you can bolt on safely. If you need that kind of
// automation, build a narrow, explicitly-whitelisted tool per action instead
// (e.g. "restart_web_service" that shells out to one fixed, audited command),
// never a free-form executor.
// ---------------------------------------------------------------------------

let dbPool = null;
function getDbPool() {
  if (!process.env.DB_HOST) return null;
  if (!dbPool) {
    dbPool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionLimit: 5,
    });
  }
  return dbPool;
}

function isDbConfigured() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

function isWebSearchConfigured() {
  return Boolean(process.env.TAVILY_API_KEY);
}

// --- Tool schemas (OpenAI-compatible function-calling format) --------------
export function getToolDefinitions() {
  const tools = [
    {
      type: "function",
      function: {
        name: "calculate",
        description: "Evaluate a mathematical expression. Use for arithmetic, percentages, unit conversions, etc.",
        parameters: {
          type: "object",
          properties: {
            expression: { type: "string", description: "e.g. '(120 * 1.18) / 4' or '15% of 240'" },
          },
          required: ["expression"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_current_datetime",
        description: "Get the current server date and time.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "remember_fact",
        description:
          "Save a durable fact or preference about the user for future conversations (e.g. their name, timezone, a standing instruction).",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "Short identifier, e.g. 'preferred_name'" },
            value: { type: "string" },
          },
          required: ["key", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_documents",
        description:
          "Search the user's uploaded knowledge-base documents for a specific query. The most relevant excerpts are already provided automatically each turn, but call this again with a more targeted query if you need something more specific.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    },
  ];

  if (isDbConfigured()) {
    tools.push({
      type: "function",
      function: {
        name: "query_database",
        description:
          "Run a READ-ONLY SQL SELECT query against the connected MySQL database to answer questions about the user's data. Only SELECT statements are permitted.",
        parameters: {
          type: "object",
          properties: {
            sql: { type: "string", description: "A single SELECT statement." },
          },
          required: ["sql"],
        },
      },
    });
  }

  if (isWebSearchConfigured()) {
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the live web for current information — news, prices, recent events, anything that could have changed since your training data or that you're unsure about. Use this instead of guessing when the user asks about something time-sensitive or current.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "A short, specific search query, e.g. 'current USD to INR exchange rate'." },
          },
          required: ["query"],
        },
      },
    });
  }

  return tools;
}

// --- Execution ---------------------------------------------------------
export async function executeTool(name, args) {
  switch (name) {
    case "calculate": {
      try {
        const result = evaluate(args.expression);
        return { result: String(result) };
      } catch (err) {
        return { error: `Couldn't evaluate that expression: ${err.message}` };
      }
    }

    case "get_current_datetime": {
      return { datetime: new Date().toISOString() };
    }

    case "remember_fact": {
      setFact(args.key, String(args.value));
      return { saved: true, facts: getFacts() };
    }

    case "search_documents": {
      const results = searchChunks(args.query, 4);
      if (results.length === 0) return { results: [], note: "No matching content found." };
      return {
        results: results.map((r) => ({ filename: r.filename, excerpt: r.content })),
      };
    }

    case "query_database": {
      if (!isDbConfigured()) {
        return { error: "No database is configured. Set DB_HOST/DB_USER/DB_PASSWORD/DB_NAME in backend/.env." };
      }
      const sql = String(args.sql || "").trim();
      if (!/^select\b/i.test(sql)) {
        return { error: "Only SELECT statements are permitted through this tool." };
      }
      if (sql.includes(";") && sql.trim().indexOf(";") !== sql.trim().length - 1) {
        return { error: "Multiple statements are not permitted." };
      }
      const boundedSql = /\blimit\s+\d+/i.test(sql) ? sql : `${sql.replace(/;\s*$/, "")} LIMIT 200`;
      try {
        const pool = getDbPool();
        const [rows] = await pool.query(boundedSql);
        return { rows };
      } catch (err) {
        return { error: `Query failed: ${err.message}` };
      }
    }

    case "web_search": {
      if (!isWebSearchConfigured()) {
        return { error: "Web search isn't configured. Set TAVILY_API_KEY in backend/.env." };
      }
      const query = String(args.query || "").trim();
      if (!query) return { error: "A search query is required." };

      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query,
            max_results: 5,
            include_answer: true,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return { error: `Search provider returned an error: ${res.status} ${errText}` };
        }

        const data = await res.json();
        return {
          answer: data.answer || null,
          results: (data.results || []).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
          })),
        };
      } catch (err) {
        return { error: `Web search failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}