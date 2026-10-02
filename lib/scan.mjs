// قراءة ملفات جلسات Claude Code من ~/.claude/projects وبناء فهرس مختصر لها.
// الفهرس يُخزَّن في data/index.json ولا يُعاد تحليل الملف إلا إذا تغيّر حجمه أو وقت تعديله.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

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

/** مفتاح اليوم بالتوقيت المحلي، مثل 2026-10-02 */
export function dayKey(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** يستخرج نص رسالة المستخدم الفعلي، أو null إذا كانت رسالة نظام أو نتيجة أداة */
export function userText(rec) {
  if (rec.type !== "user" || rec.isMeta || rec.isSidechain) return null;
  const c = rec.message?.content;
  let text = "";
  if (typeof c === "string") text = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b?.type === "tool_result")) return null;
    text = c
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join(" ");
  }
  text = text.trim();
  if (!text || SKIP_PREFIXES.some((p) => text.startsWith(p))) return null;
  // النص الملصوق يُختصر إلى وسم حتى لا يطغى على الطلب نفسه
  text = text.replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>/g, (_, inner) => {
    const first = inner.trim().split("\n")[0].slice(0, 80);
    return `〔نص ملصوق: ${first}…〕`;
  });
  text = text.replace(/\[Image #\d+\]/g, "〔صورة〕");
  return text.trim() || null;
}

function assistantText(rec) {
  const c = rec.message?.content;
  if (!Array.isArray(c)) return "";
  return c
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * يحلل ملف جلسة كاملًا.
 * full=false يعيد ملخصًا للفهرس، وfull=true يضيف كل الطلبات وردود Claude والملفات المعدّلة.
 */
export async function parseSession(file, { full = false } = {}) {
  const s = {
    id: path.basename(file, ".jsonl"),
    file,
    cwd: null,
    branch: null,
    title: null,
    customTitle: null,
    firstAt: null,
    lastAt: null,
    prompts: 0,
    replies: 0,
    compactions: 0,
    days: {}, // dayKey -> عدد طلبات المستخدم في ذلك اليوم
    firstPrompt: null,
    lastPrompt: null,
    lastPromptAt: null,
    model: null,
    files: new Set(),
  };
  const turns = full ? [] : null;

  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

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
    if (t !== "user" && t !== "assistant") continue;
    if (rec.isSidechain) continue;
    if (rec.isCompactSummary || (t === "user" && typeof rec.message?.content === "string" && rec.message.content.startsWith("This session is being continued"))) {
      s.compactions++;
    }
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (!s.firstAt || ts < s.firstAt) s.firstAt = ts;
      if (!s.lastAt || ts > s.lastAt) s.lastAt = ts;
    }

    if (t === "user") {
      const text = userText(rec);
      if (!text) continue;
      s.prompts++;
      if (!Number.isNaN(ts)) {
        const k = dayKey(ts);
        s.days[k] = (s.days[k] || 0) + 1;
      }
      if (!s.firstPrompt) s.firstPrompt = text.slice(0, 300);
      s.lastPrompt = text.slice(0, 300);
      s.lastPromptAt = ts || null;
      if (turns) turns.push({ role: "user", at: ts || null, text: text.slice(0, 4000) });
    } else {
      s.replies++;
      if (rec.message?.model && !rec.message.model.startsWith("<")) s.model = rec.message.model;
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "tool_use" && EDIT_TOOLS.has(b.name)) {
            const fp = b.input?.file_path || b.input?.notebook_path;
            if (fp) s.files.add(fp);
          }
        }
      }
      if (turns) {
        const text = assistantText(rec);
        if (text) {
          const prev = turns[turns.length - 1];
          // ردود Claude المتتالية في نفس الدور تُدمج في عنصر واحد
          if (prev && prev.role === "assistant") {
            prev.text = (prev.text + "\n\n" + text).slice(-6000);
            prev.at = ts || prev.at;
          } else turns.push({ role: "assistant", at: ts || null, text: text.slice(-6000) });
        }
      }
    }
  }

  const out = { ...s, files: [...s.files] };
  if (!full) out.files = out.files.slice(0, 60);
  if (turns) out.turns = turns;
  return out;
}

/** فهرس كل الجلسات مع تخزين مؤقت حسب الحجم ووقت التعديل */
export class Index {
  constructor(cacheFile) {
    this.cacheFile = cacheFile;
    this.entries = {}; // file -> { size, mtimeMs, session }
    this.scanning = null;
    this.lastScanAt = 0;
    this.progress = { done: 0, total: 0 };
    try {
      this.entries = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      this.entries = {};
    }
  }

  async listFiles() {
    const dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
    const files = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(PROJECTS_DIR, d.name);
      let names;
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const n of names) if (n.endsWith(".jsonl")) files.push(path.join(dir, n));
    }
    return files;
  }

  /** يعيد فحص الملفات المتغيرة فقط. الاستدعاءات المتزامنة تشترك في نفس الفحص */
  scan() {
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      const files = await this.listFiles();
      const seen = new Set(files);
      const todo = [];
      for (const f of files) {
        let st;
        try {
          st = await fsp.stat(f);
        } catch {
          continue;
        }
        const e = this.entries[f];
        if (!e || e.size !== st.size || e.mtimeMs !== st.mtimeMs) todo.push([f, st]);
      }
      this.progress = { done: 0, total: todo.length };
      // الملفات الأحدث أولًا حتى تظهر جلسات اليوم بسرعة في الفحص الأول
      todo.sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
      const worker = async () => {
        while (todo.length) {
          const [f, st] = todo.shift();
          try {
            const session = await parseSession(f);
            this.entries[f] = { size: st.size, mtimeMs: st.mtimeMs, session };
          } catch (err) {
            console.error("تعذّر تحليل", f, err.message);
          }
          this.progress.done++;
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      for (const f of Object.keys(this.entries)) if (!seen.has(f)) delete this.entries[f];
      await fsp.writeFile(this.cacheFile, JSON.stringify(this.entries));
      this.lastScanAt = Date.now();
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  sessions() {
    return Object.values(this.entries)
      .map((e) => e.session)
      .filter((s) => s.prompts > 0 && s.lastAt);
  }

  get(id) {
    return this.sessions().find((s) => s.id === id) || null;
  }
}
