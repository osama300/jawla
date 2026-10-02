// المساعد المركزي: مجلد عمل فيه تعليمات وفهرس محدّث لكل الجلسات.
// claude (أو codex) يعمل داخل هذا المجلد فيستطيع الإجابة عن أي سؤال حول جلساتك.

import fs from "node:fs";
import path from "node:path";
import { APP, HUB_DIR } from "./config.mjs";
import { dayKey } from "./util.mjs";

const INSTRUCTIONS = (port) => `# ${APP.name} — central assistant

You are the user's central assistant for ALL their AI coding sessions (Claude Code and Codex).
You are not working on a codebase here. Your job: answer questions about past and current sessions,
find things, summarize across projects, and help the user plan and organize their day.

Always reply in the user's language (usually Arabic). Be concise and concrete: name the project,
the date, and the session title. When you mention a session, include its short id (first 8 chars).

## Data you can read
- \`SESSIONS.md\` — a digest of every session, newest first, grouped by day: project, time, title,
  prompt count, status, user notes, and AI summary (done / pending / next). **Start here.**
- \`sessions.json\` — the same data as JSON (fields: id, source, cwd, project, title, firstAt, lastAt,
  days {date: prompts}, prompts, status, pinned, note, summary {gist, done, pending, next, state}, file).
  Use it with \`jq\` or a short script for counting, filtering, or date-range questions.
- Raw transcripts (only when the digest is not enough; they are large — grep, don't read whole files):
  - Claude Code: \`~/.claude/projects/<encoded-path>/<session-id>.jsonl\`
  - Codex: \`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl\`
  The \`file\` field in sessions.json gives the exact path.

These files are regenerated automatically. Never edit them, and never modify the raw transcripts.

## Actions (through the local app API at http://localhost:${port})
You can organize sessions for the user. Only do this when they ask.
- Set status: \`curl -s -X POST localhost:${port}/api/sessions/<id>/meta -H 'content-type: application/json' -d '{"status":"followup"}'\`
  (status: followup | waiting | done | null)
- Pin / unpin: same endpoint with \`{"pinned": true}\`
- Add a note: same endpoint with \`{"note": "..."}\` (replaces the existing note; read it first and append)
- Summarize a session: \`curl -s -X POST localhost:${port}/api/sessions/<id>/summarize\`
- Open a session for the user in the app: \`curl -s -X POST localhost:${port}/api/terminals -H 'content-type: application/json' -d '{"sessionId":"<id>"}'\`
Use the full session id from sessions.json, not the short one.

## Good answers look like
- "What's pending across my projects?" → group by project, list pending items with session id and date.
- "What did I do yesterday?" → one line per session, then the open items.
- "Plan my day" → prioritized list from pending items, followups, and pinned sessions; suggest which session to resume first.
`;

let timer = null;

/** يكتب ملفات المساعد المركزي (بتأخير بسيط حتى لا تُكتب مع كل تغيير صغير) */
export function writeHubFiles(sessions, { port }) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      writeNow(sessions, port);
    } catch (e) {
      console.error("hub write failed", e.message);
    }
  }, 400);
}

function writeNow(sessions, port) {
  const text = INSTRUCTIONS(port);
  for (const f of ["CLAUDE.md", "AGENTS.md"]) {
    const p = path.join(HUB_DIR, f);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== text) fs.writeFileSync(p, text);
  }

  const sorted = [...sessions].sort((a, b) => b.lastAt - a.lastAt);
  fs.writeFileSync(path.join(HUB_DIR, "sessions.json"), JSON.stringify(sorted, null, 1));

  const byDay = new Map();
  for (const s of sorted) {
    const k = dayKey(s.lastAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const hm = (t) => new Date(t).toTimeString().slice(0, 5);
  let md = `# Sessions digest\n\nGenerated ${new Date().toISOString()} · ${sorted.length} sessions · grouped by day of LAST activity.\nA session that spans several days lists them under "active days".\n`;
  for (const [day, list] of byDay) {
    md += `\n## ${day}\n`;
    for (const s of list) {
      const days = Object.keys(s.days || {}).sort();
      md += `\n### ${s.title || "(untitled)"}\n`;
      md += `- id: ${s.id} · ${s.source} · project: ${s.project} (${s.cwd})\n`;
      md += `- last active ${hm(s.lastAt)} · ${s.prompts} prompts${days.length > 1 ? ` · active days: ${days.join(", ")}` : ""}${s.branch ? ` · branch ${s.branch}` : ""}\n`;
      if (s.status || s.pinned) md += `- user status: ${s.status || "-"}${s.pinned ? " · pinned" : ""}\n`;
      if (s.note) md += `- user note: ${s.note.replace(/\n/g, " ")}\n`;
      const sum = s.summary;
      if (sum) {
        if (sum.gist) md += `- gist: ${sum.gist}\n`;
        if (sum.done?.length) md += `- done: ${sum.done.join(" | ")}\n`;
        if (sum.pending?.length) md += `- pending: ${sum.pending.join(" | ")}\n`;
        if (sum.next) md += `- next: ${sum.next}\n`;
      } else {
        md += `- first prompt: ${(s.firstPrompt || "").replace(/\n/g, " ").slice(0, 200)}\n`;
        if (s.lastPrompt && s.lastPrompt !== s.firstPrompt) md += `- last prompt: ${s.lastPrompt.replace(/\n/g, " ").slice(0, 200)}\n`;
      }
    }
  }
  fs.writeFileSync(path.join(HUB_DIR, "SESSIONS.md"), md);
}

/** هل الجلسة من جلسات المساعد المركزي نفسه؟ (تُخفى من القائمة) */
export function isHubSession(s) {
  return s.cwd === HUB_DIR || s.cwd?.startsWith(HUB_DIR + path.sep);
}
