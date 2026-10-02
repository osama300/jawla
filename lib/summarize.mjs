// التلخيص عبر أمر claude المحلي (بلا مفتاح API).
// --no-session-persistence يمنع إنشاء جلسة جديدة تظهر في القائمة، و--tools "" يجعله يقرأ فقط.

import { spawn } from "node:child_process";
import os from "node:os";

const MAX_CHARS = 40000;
const LANG_NAME = { ar: "Arabic", en: "English" };

export function runClaude(prompt, { model = "haiku", timeoutMs = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", model, "--no-session-persistence", "--tools", "", "--output-format", "json"], {
      cwd: os.tmpdir(),
      env: { ...process.env, DAWRA_INTERNAL: "1" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error("claude CLI not found in PATH") : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let env;
      try {
        env = JSON.parse(out);
      } catch {}
      if (env?.is_error || code !== 0) return reject(new Error(env?.result || err.trim() || out.trim() || `claude exited ${code}`));
      resolve(env?.result ?? out);
    });
    child.stdin.end(prompt);
  });
}

function parseJSON(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in model output");
  return JSON.parse(m[0]);
}

function condense(turns) {
  // كل طلبات المستخدم مختصرة، وردود المساعد مختصرة من الطرفين، ونفضّل نهاية الجلسة عند الضغط
  const parts = turns.map((t) => {
    const limit = t.role === "user" ? 700 : 900;
    const text = t.text.length > limit ? t.text.slice(0, limit / 2) + " … " + t.text.slice(-limit / 2) : t.text;
    return `### ${t.role === "user" ? "USER" : "ASSISTANT"}\n${text}`;
  });
  let out = parts.join("\n\n");
  if (out.length > MAX_CHARS) out = "…(start of session trimmed)…\n\n" + out.slice(-MAX_CHARS);
  return out;
}

export async function summarize(session, { model, lang = "ar" } = {}) {
  const prompt = `You summarize a work session between a developer and an AI coding agent (${session.source === "codex" ? "Codex" : "Claude Code"}) so the developer can review it quickly tomorrow morning.
Project: ${session.cwd}
Branch: ${session.branch || "-"}
Files edited:
${session.files.slice(0, 40).join("\n") || "-"}

Transcript (condensed):
${condense(session.turns)}

Return ONLY a JSON object, no markdown fences, in exactly this shape:
{"title": "short clear title, max 6 words",
 "gist": "one sentence: what this session was about",
 "done": ["what was actually completed, short bullets, max 5"],
 "pending": ["what is unfinished, untested, or waiting on a decision, max 4, or empty list"],
 "next": "the suggested next step in one sentence, or empty string if the work is finished",
 "state": "done | pending | blocked"}
Write all text values in ${LANG_NAME[lang] || "Arabic"}. Keep file names, commands and tech names as-is. Do not invent anything not in the transcript.`;
  const json = parseJSON(await runClaude(prompt, { model }));
  return {
    title: String(json.title || "").slice(0, 120),
    gist: String(json.gist || ""),
    done: Array.isArray(json.done) ? json.done.map(String) : [],
    pending: Array.isArray(json.pending) ? json.pending.map(String) : [],
    next: String(json.next || ""),
    state: ["done", "pending", "blocked"].includes(json.state) ? json.state : "pending",
    model,
    lang,
  };
}

/** ملخص يومي (standup) من ملخصات جلسات يوم معيّن */
export async function standup(items, { model, lang = "ar", day }) {
  const lines = items
    .map((s) => {
      const sum = s.summary;
      return `- [${s.project}] ${s.title} (${s.dayPrompts} prompts that day, id ${s.id.slice(0, 8)})
  status: ${s.status || sum?.state || "-"}${s.note ? `\n  note: ${s.note}` : ""}
  ${sum ? `done: ${sum.done.join(" | ")}\n  pending: ${sum.pending.join(" | ")}\n  next: ${sum.next}` : `first prompt: ${s.firstPrompt}\n  last prompt: ${s.lastPrompt}`}`;
    })
    .join("\n");
  const prompt = `Write a short daily standup for a developer from their AI coding sessions on ${day}.
Sessions:
${lines}

Return ONLY JSON, no fences:
{"headline": "one sentence overview of the day",
 "done": ["key accomplishments across projects, prefixed with [project], max 8"],
 "pending": ["open items / blockers, prefixed with [project], max 8"],
 "focus": ["suggested priorities for the next work day, most important first, max 4"]}
Write all text in ${LANG_NAME[lang] || "Arabic"}. Be specific and concise. Do not invent anything.`;
  const json = parseJSON(await runClaude(prompt, { model, timeoutMs: 240_000 }));
  return {
    headline: String(json.headline || ""),
    done: Array.isArray(json.done) ? json.done.map(String) : [],
    pending: Array.isArray(json.pending) ? json.pending.map(String) : [],
    focus: Array.isArray(json.focus) ? json.focus.map(String) : [],
  };
}

/** تقرير فترة بلغة بسيطة: من أرقام التحليلات وملخصات الجلسات */
export async function periodReport(analyticsMd, sessionLines, { model, lang = "ar", days }) {
  const prompt = `You write a short, plain report about a developer's last ${days} days of work with AI coding agents.
Use ONLY the data below. Simple, direct language — like a helpful colleague, not a consultant. No jargon, no buzzwords, no motivational filler.

Numbers:
${analyticsMd}

Sessions in this period (title, project, outcome):
${sessionLines}

Return ONLY JSON, no fences:
{"headline": "one sentence that captures the period",
 "time": ["2-3 short facts about where the time went, with numbers"],
 "done": ["up to 5 most important things finished, prefixed with [project]"],
 "open": ["up to 4 important things still open or slipping, prefixed with [project]"],
 "pattern": "one observation about HOW they work (rhythm, focus, switching, late nights) based on the numbers",
 "tip": "one concrete, small suggestion for the next period"}
Write all text in ${lang === "en" ? "English" : "Arabic"}. Keep every item under 20 words.`;
  const json = parseJSON(await runClaude(prompt, { model, timeoutMs: 240_000 }));
  const arr = (x) => (Array.isArray(x) ? x.map(String) : []);
  return { headline: String(json.headline || ""), time: arr(json.time), done: arr(json.done), open: arr(json.open), pattern: String(json.pattern || ""), tip: String(json.tip || "") };
}
