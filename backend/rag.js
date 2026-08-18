import fs from "fs/promises";
import path from "path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { getAllChunksWithSource } from "./db.js";

// --- Text extraction ---------------------------------------------------
// Supports: .pdf, .docx, .xlsx/.xls/.csv, .txt/.md
export async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  if (ext === ".pdf") {
    const buf = await fs.readFile(filePath);
    const data = await PDFParse(buf);
    return data.text;
  }

  if (ext === ".docx") {
    const buf = await fs.readFile(filePath);
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return value;
  }

  if ([".xlsx", ".xls", ".csv"].includes(ext)) {
    const buf = await fs.readFile(filePath);
    const wb = XLSX.read(buf, { type: "buffer" });
    return wb.SheetNames.map((name) => {
      const sheet = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      return `--- Sheet: ${name} ---\n${csv}`;
    }).join("\n\n");
  }

  if ([".txt", ".md"].includes(ext)) {
    return fs.readFile(filePath, "utf-8");
  }

  throw new Error(`Unsupported file type: ${ext || "(no extension)"}`);
}

// --- Chunking ---------------------------------------------------------
// Splits on paragraph boundaries, packing to ~targetSize chars with a
// small overlap so context isn't lost at chunk edges.
export function chunkText(text, targetSize = 900, overlap = 150) {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > targetSize && current) {
      chunks.push(current.trim());
      // carry the tail of the previous chunk forward for continuity
      current = current.slice(-overlap) + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Guard against a single giant "paragraph" (e.g. no blank lines at all)
  return chunks.flatMap((c) =>
    c.length <= targetSize * 1.5
      ? [c]
      : (c.match(new RegExp(`.{1,${targetSize}}`, "gs")) || [c])
  );
}

// --- Local BM25 lexical search (no embedding API required) --------------
const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","is","are","was",
  "were","be","been","this","that","it","as","at","by","with","from","which",
]);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => !STOPWORDS.has(t));
}

export function searchChunks(query, topK = 4) {
  const rows = getAllChunksWithSource();
  if (rows.length === 0) return [];

  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const docs = rows.map((r) => ({ ...r, terms: tokenize(r.content) }));
  const N = docs.length;
  const avgLen = docs.reduce((sum, d) => sum + d.terms.length, 0) / N;
  const k1 = 1.5;
  const b = 0.75;

  // document frequency per query term
  const df = {};
  for (const term of queryTerms) {
    df[term] = docs.filter((d) => d.terms.includes(term)).length;
  }

  const scored = docs.map((d) => {
    const len = d.terms.length || 1;
    let score = 0;
    for (const term of queryTerms) {
      const tf = d.terms.filter((t) => t === term).length;
      if (tf === 0) continue;
      const idf = Math.log(1 + (N - df[term] + 0.5) / (df[term] + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / avgLen)));
    }
    return { ...d, score };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, topK);
}
