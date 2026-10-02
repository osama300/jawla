// بحث في محتوى كل المحادثات باستخدام ripgrep (أو بحث Node أبطأ إن لم يكن rg مثبتًا).

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

let RG = null;
try {
  RG = execFileSync("/bin/sh", ["-lc", "command -v rg"], { encoding: "utf8" }).trim() || null;
} catch {}

/** يستخرج نص الرسالة من سطر JSON في Claude Code أو Codex */
function lineText(line) {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    return null;
  }
  if (rec.isSidechain || rec.isMeta) return null;
  // Claude Code
  if (rec.type === "user" || rec.type === "assistant") {
    const c = rec.message?.content;
    let text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join(" ") : "";
    if (!text || text.startsWith("<")) return null;
    return { role: rec.type, text, at: rec.timestamp };
  }
  // Codex
  if (rec.type === "response_item" && rec.payload?.type === "message") {
    const p = rec.payload;
    if (p.role !== "user" && p.role !== "assistant") return null;
    const text = (p.content || []).map((c) => c?.text || "").join(" ");
    if (!text || text.startsWith("<") || text.startsWith("# AGENTS.md")) return null;
    return { role: p.role, text, at: rec.timestamp };
  }
  return null;
}

function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - 70);
  const end = Math.min(text.length, i + q.length + 110);
  return { before: (start > 0 ? "…" : "") + text.slice(start, i), match: text.slice(i, i + q.length), after: text.slice(i + q.length, end) + (end < text.length ? "…" : "") };
}

/** يعيد [{file, hits:[{role, at, before, match, after}]}] */
export function searchContent(q, roots, { maxFiles = 80, perFile = 3 } = {}) {
  q = q.trim();
  if (q.length < 2) return Promise.resolve([]);
  return RG ? searchRg(q, roots, maxFiles, perFile) : searchNode(q, roots, maxFiles, perFile);
}

function searchRg(q, roots, maxFiles, perFile) {
  return new Promise((resolve) => {
    const args = ["--json", "-i", "-F", "--max-count", String(perFile * 4), "--glob", "*.jsonl", "--glob", "!**/subagents/**", "--max-columns", "200000", "--", q, ...roots.filter((r) => fs.existsSync(r))];
    const child = spawn(RG, args);
    const results = new Map();
    let buf = "";
    const done = () => resolve([...results.entries()].map(([file, hits]) => ({ file, hits })));
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let ev;
        try {
          ev = JSON.parse(raw);
        } catch {
          continue;
        }
        if (ev.type !== "match") continue;
        const file = ev.data.path.text;
        const hits = results.get(file) || [];
        if (hits.length >= perFile) continue;
        const msg = lineText(ev.data.lines.text || "");
        const sn = msg && snippet(msg.text, q);
        if (!sn) continue; // التطابق كان في نتيجة أداة أو بيانات وصفية، وليس في رسالة
        hits.push({ role: msg.role, at: msg.at, ...sn });
        results.set(file, hits);
        if (results.size >= maxFiles && [...results.values()].every((h) => h.length >= 1)) {
          child.kill();
        }
      }
    });
    child.on("close", done);
    child.on("error", done);
    setTimeout(() => child.kill(), 15000);
  });
}

async function searchNode(q, roots, maxFiles, perFile) {
  const { listAll } = await import("./index.mjs");
  const out = [];
  const ql = q.toLowerCase();
  for (const file of await listAll()) {
    if (out.length >= maxFiles) break;
    const hits = [];
    const rl = readline.createInterface({ input: fs.createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.toLowerCase().includes(ql)) continue;
      const msg = lineText(line);
      const sn = msg && snippet(msg.text, q);
      if (sn) hits.push({ role: msg.role, at: msg.at, ...sn });
      if (hits.length >= perFile) {
        rl.close();
        break;
      }
    }
    if (hits.length) out.push({ file, hits });
  }
  return out;
}
