// مصدر Codex CLI: ملفات ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// العناوين تأتي من ~/.codex/session_index.jsonl (thread_name)

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { emptySession, addPrompt, addReply, touch, finish, tidyPrompt, shq } from "../util.mjs";

export const name = "codex";
export const label = "Codex";
const HOME = path.join(os.homedir(), ".codex");
export const ROOT = path.join(HOME, "sessions");

// رسائل يحقنها Codex نفسه في دور المستخدم وليست طلبات فعلية
const INJECTED = ["# AGENTS.md", "<environment_context", "<user_instructions", "<turn_aborted", "<user_shell_command", "<permissions"];

export async function available() {
  return fs.existsSync(ROOT);
}

export async function listFiles() {
  const out = [];
  async function walk(dir, depth) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  }
  await walk(ROOT, 0);
  return out;
}

let titles = null;
let titlesMtime = 0;
/** خريطة id -> thread_name، تُعاد قراءتها فقط إذا تغيّر الملف */
function threadNames() {
  const f = path.join(HOME, "session_index.jsonl");
  try {
    const st = fs.statSync(f);
    if (titles && st.mtimeMs === titlesMtime) return titles;
    titles = new Map();
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      try {
        const r = JSON.parse(line);
        if (r.id && r.thread_name) titles.set(r.id, r.thread_name);
      } catch {}
    }
    titlesMtime = st.mtimeMs;
  } catch {
    titles = titles || new Map();
  }
  return titles;
}

/** مسارات الملفات من نص apply_patch */
function patchFiles(text, set) {
  for (const m of String(text).matchAll(/\*\*\* (?:Update|Add) File: ([^\n"\\]+)/g)) set.add(m[1].trim());
}

export async function parse(file, { full = false } = {}) {
  const base = path.basename(file, ".jsonl");
  const idGuess = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)?.[1] || base;
  const s = emptySession(name, idGuess, file);
  const turns = full ? [] : null;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const p = rec.payload || {};
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;

    if (rec.type === "session_meta") {
      if (p.id) s.id = p.id;
      if (p.cwd) s.cwd = p.cwd;
      if (p.git?.branch) s.branch = p.git.branch;
      continue;
    }
    if (rec.type === "turn_context") {
      if (p.model) s.model = p.model;
      if (p.cwd && !s.cwd) s.cwd = p.cwd;
      continue;
    }
    if (rec.type === "event_msg" && p.type === "context_compacted") s.compactions++;
    if (rec.type !== "response_item") continue;

    if (p.type === "message") {
      const text = (p.content || [])
        .map((c) => (typeof c?.text === "string" ? c.text : ""))
        .join(" ")
        .trim();
      if (!text) continue;
      if (p.role === "user") {
        // أي رسالة تبدأ بوسم XML هي سياق يحقنه Codex وليست طلبًا كتبه المستخدم
        if (INJECTED.some((x) => text.startsWith(x)) || /^<[a-z_-]+[\s>]/i.test(text)) continue;
        touch(s, ts);
        addPrompt(s, tidyPrompt(text), ts || null, turns);
      } else if (p.role === "assistant") {
        touch(s, ts);
        s.replies++;
        addReply(turns, text, ts || null);
      }
    } else if (p.type === "function_call" || p.type === "custom_tool_call") {
      touch(s, ts);
      patchFiles(p.arguments ?? p.input ?? "", s.files);
    }
  }
  s.title = threadNames().get(s.id) || null;
  return finish(s, turns, full);
}

export function resumeCommand(id) {
  return `codex resume ${shq(id)}`;
}
export function newCommand() {
  return "codex";
}

/** العنوان الحالي من فهرس Codex (قد يتغيّر دون أن يتغير ملف الجلسة) */
export function titleFor(id) {
  return threadNames().get(id) || null;
}
