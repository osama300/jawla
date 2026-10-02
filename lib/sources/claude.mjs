// مصدر Claude Code: ملفات ~/.claude/projects/<project>/<session>.jsonl

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { emptySession, addPrompt, addReply, touch, finish, tidyPrompt, shq, markMinute, bump } from "../util.mjs";

export const name = "claude";
export const label = "Claude Code";
export const ROOT = path.join(os.homedir(), ".claude", "projects");

const SKIP_PREFIXES = [
  "<command-",
  "<local-command",
  "<task-notification",
  "<system-reminder",
  "<bash-",
  "This session is being continued",
  "[Request interrupted",
  "Caveat:",
];
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export async function available() {
  return fs.existsSync(ROOT);
}

export async function listFiles() {
  const out = [];
  let dirs = [];
  try {
    dirs = await fsp.readdir(ROOT, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(ROOT, d.name);
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    // مجلد subagents داخل كل مشروع لا يُقرأ لأنه ليس جلسات مستقلة
    for (const n of names) if (n.endsWith(".jsonl")) out.push(path.join(dir, n));
  }
  return out;
}

/** نص طلب المستخدم الفعلي، أو null إذا كانت رسالة نظام أو نتيجة أداة */
export function userText(rec) {
  if (rec.type !== "user" || rec.isMeta || rec.isSidechain) return null;
  const c = rec.message?.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === "tool_result")) return null;
    text = c.filter((b) => b?.type === "text").map((b) => b.text).join(" ");
  }
  text = text.trim();
  if (!text || SKIP_PREFIXES.some((p) => text.startsWith(p))) return null;
  return tidyPrompt(text) || null;
}

export async function parse(file, { full = false } = {}) {
  const s = emptySession(name, path.basename(file, ".jsonl"), file);
  const turns = full ? [] : null;
  const seenMsg = new Set(); // رد واحد يُكتب في عدة سجلات بنفس المعرّف، فنحسب توكناته مرة واحدة
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const t = rec.type;
    if (t === "ai-title" && rec.aiTitle) s.title = rec.aiTitle;
    else if (t === "custom-title" && rec.customTitle) s.customTitle = rec.customTitle;
    if (rec.cwd && !s.cwd) s.cwd = rec.cwd;
    if (rec.gitBranch) s.branch = rec.gitBranch;
    if ((t !== "user" && t !== "assistant") || rec.isSidechain) continue;

    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    touch(s, ts);
    markMinute(s, ts);
    if (t === "user") {
      const c = rec.message?.content;
      if (rec.isCompactSummary || (typeof c === "string" && c.startsWith("This session is being continued"))) s.compactions++;
      const text = userText(rec);
      if (text) addPrompt(s, text, ts || null, turns);
      continue;
    }
    s.replies++;
    const msg = rec.message || {};
    const m = msg.model;
    if (m && !m.startsWith("<")) s.model = m;
    if (!msg.id || !seenMsg.has(msg.id)) {
      if (msg.id) seenMsg.add(msg.id);
      if (m && !m.startsWith("<")) bump(s.models, m);
      const u = msg.usage;
      if (u) {
        s.tokens.in += u.input_tokens || 0;
        s.tokens.out += u.output_tokens || 0;
        s.tokens.cacheRead += u.cache_read_input_tokens || 0;
        s.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
      }
    }
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    const texts = [];
    for (const b of content) {
      if (b?.type === "tool_use") {
        bump(s.tools, b.name);
        if (EDIT_TOOLS.has(b.name)) {
          const fp = b.input?.file_path || b.input?.notebook_path;
          if (fp) s.files.add(fp);
        }
      } else if (b?.type === "text" && b.text) texts.push(b.text);
    }
    if (texts.length) addReply(turns, texts.join("\n").trim(), ts || null);
  }
  return finish(s, turns, full);
}

export function resumeCommand(id) {
  return `claude --resume ${shq(id)}`;
}
export function newCommand() {
  return "claude";
}
