// مشاركة جلسة: تصدير HTML مستقل أو Markdown، مع إخفاء ما يشبه الأسرار، ورفع اختياري كـ Gist سري.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { APP, EXPORT_DIR } from "./config.mjs";

// أنماط شائعة للمفاتيح والرموز السرية. الهدف تقليل التسريب العرضي، وليس ضمانًا كاملًا.
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)["']?[^\s"']{6,}/gi,
];

export function redact(text) {
  let n = 0;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, prefix) => {
      n++;
      return typeof prefix === "string" && m.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]";
    });
  }
  return { text: out, count: n };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (t) => (t ? new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

function slug(s) {
  return (s || "session").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 50) || "session";
}

/** يبني نص الجلسة بعد إخفاء الأسرار، مع خيار الاكتفاء بطلبات المستخدم والردود النهائية */
function prepare(full, { includeAssistant = true } = {}) {
  let redacted = 0;
  const turns = full.turns
    .filter((t) => includeAssistant || t.role === "user")
    .map((t) => {
      const r = redact(t.text);
      redacted += r.count;
      return { ...t, text: r.text };
    });
  return { turns, redacted };
}

export function toMarkdown(full, meta, opts) {
  const { turns, redacted } = prepare(full, opts);
  const sum = meta.summary;
  let md = `# ${meta.title}\n\n`;
  md += `- **Project:** \`${full.cwd}\`\n- **Agent:** ${full.source === "codex" ? "Codex" : "Claude Code"}\n- **Dates:** ${fmt(full.firstAt)} → ${fmt(full.lastAt)}\n- **Prompts:** ${full.prompts}\n`;
  if (sum) {
    md += `\n## Summary\n\n${sum.gist || ""}\n`;
    if (sum.done?.length) md += `\n**Done**\n${sum.done.map((x) => `- ${x}`).join("\n")}\n`;
    if (sum.pending?.length) md += `\n**Pending**\n${sum.pending.map((x) => `- ${x}`).join("\n")}\n`;
    if (sum.next) md += `\n**Next:** ${sum.next}\n`;
  }
  md += `\n## Conversation\n`;
  for (const t of turns) md += `\n### ${t.role === "user" ? "🧑 User" : "🤖 Assistant"} · ${fmt(t.at)}\n\n${t.text}\n`;
  md += `\n---\nExported with ${APP.name}${redacted ? ` · ${redacted} secret-like values redacted` : ""}\n`;
  return { content: md, redacted };
}

export function toHTML(full, meta, opts) {
  const { turns, redacted } = prepare(full, opts);
  const sum = meta.summary;
  const body = turns
    .map(
      (t) => `<article class="turn ${t.role}"><header>${t.role === "user" ? "User" : "Assistant"}<time>${esc(fmt(t.at))}</time></header><div dir="auto" class="txt">${esc(t.text)}</div></article>`
    )
    .join("\n");
  const summary = sum
    ? `<section class="sum"><h2>Summary</h2>${sum.gist ? `<p dir="auto">${esc(sum.gist)}</p>` : ""}
      ${sum.done?.length ? `<h3>Done</h3><ul dir="auto">${sum.done.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${sum.pending?.length ? `<h3>Pending</h3><ul dir="auto">${sum.pending.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${sum.next ? `<p class="next" dir="auto"><b>Next:</b> ${esc(sum.next)}</p>` : ""}</section>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)}</title>
<style>
:root{--bg:#fbfbfc;--card:#fff;--line:#e6e8ec;--text:#14171c;--muted:#6b7280;--accent:#0fa678;--user:#f1f8f5}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c0f;--card:#14171c;--line:#252932;--text:#eceef2;--muted:#8b90a0;--accent:#34e3a6;--user:#122019}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 "IBM Plex Sans Arabic",system-ui,-apple-system,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 16px 80px}
h1{font-size:28px;line-height:1.3;margin:0 0 8px}dl{display:flex;flex-wrap:wrap;gap:4px 20px;color:var(--muted);font-size:13px;margin:0 0 24px}dt{display:none}
code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:13px}
.sum{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:28px}.sum h2{margin:0 0 8px;font-size:16px}.sum h3{font-size:13px;color:var(--muted);margin:14px 0 4px}.sum ul{margin:0;padding-inline-start:20px}
.next{background:rgba(52,227,166,.12);border-radius:10px;padding:8px 12px}
.turn{margin:0 0 12px;border-radius:12px;padding:10px 14px}.turn.user{background:var(--user);border:1px solid var(--line)}.turn.assistant{border-inline-start:2px solid var(--line);border-radius:0}
.turn header{font-size:12px;color:var(--muted);display:flex;gap:10px;margin-bottom:2px}.turn.user header{color:var(--accent);font-weight:600}
.txt{white-space:pre-wrap;word-break:break-word}footer{color:var(--muted);font-size:12px;margin-top:40px;text-align:center}
</style></head><body><main>
<h1 dir="auto">${esc(meta.title)}</h1>
<dl><dt>Project</dt><dd class="mono">${esc(full.cwd)}</dd><dt>Agent</dt><dd>${full.source === "codex" ? "Codex" : "Claude Code"}</dd><dt>Dates</dt><dd>${esc(fmt(full.firstAt))} → ${esc(fmt(full.lastAt))}</dd><dt>Prompts</dt><dd>${full.prompts} prompts</dd></dl>
${summary}
${body}
<footer>Exported with ${esc(APP.name)}${redacted ? ` · ${redacted} secret-like values redacted` : ""}</footer>
</main></body></html>`;
  return { content: html, redacted };
}

/** يحفظ ملف التصدير ويعيد مساره */
export function exportFile(full, meta, { format = "html", includeAssistant = true } = {}) {
  const fn = format === "md" ? toMarkdown : toHTML;
  const { content, redacted } = fn(full, meta, { includeAssistant });
  const file = path.join(EXPORT_DIR, `${slug(meta.title)}-${full.id.slice(0, 8)}.${format === "md" ? "md" : "html"}`);
  fs.writeFileSync(file, content);
  return { file, redacted };
}

/** يرفع الملف كـ Gist سري عبر gh (يتطلب تسجيل الدخول في gh). يعيد الرابط */
export function createGist(file, description) {
  return new Promise((resolve, reject) => {
    execFile("gh", ["gist", "create", file, "--desc", description], { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim()));
      const url = stdout.trim().split("\n").pop();
      resolve(url);
    });
  });
}
