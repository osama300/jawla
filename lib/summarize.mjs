// توليد ملخص لجلسة عبر أمر claude المحلي (بلا مفتاح API).
// --no-session-persistence يمنع إنشاء جلسة جديدة تظهر في القائمة.

import { spawn } from "node:child_process";
import os from "node:os";

const MODEL = process.env.SUMMARY_MODEL || "haiku";
const MAX_CHARS = 40000;

function condense(session) {
  // نحتفظ بكل طلبات المستخدم (مختصرة) وآخر رد من Claude في كل دور، ونفضّل نهاية الجلسة عند الضغط
  const parts = session.turns.map((t) => {
    const who = t.role === "user" ? "المستخدم" : "Claude";
    const limit = t.role === "user" ? 700 : 900;
    const text = t.text.length > limit ? t.text.slice(0, limit / 2) + " … " + t.text.slice(-limit / 2) : t.text;
    return `### ${who}\n${text}`;
  });
  let out = parts.join("\n\n");
  if (out.length > MAX_CHARS) out = "…(بداية الجلسة محذوفة للاختصار)…\n\n" + out.slice(-MAX_CHARS);
  return out;
}

function buildPrompt(session) {
  const files = session.files.slice(0, 40).join("\n");
  return `أنت تلخّص جلسة عمل بين مطوّر وبين Claude Code حتى يراجعها المطوّر صباح الغد بسرعة.
المشروع: ${session.cwd}
الفرع: ${session.branch || "-"}
الملفات المعدّلة:
${files || "-"}

نص الجلسة (مختصر):
${condense(session)}

أعد JSON فقط بلا أي نص آخر وبلا علامات markdown، بهذا الشكل:
{"title": "عنوان قصير وواضح بالعربية (6 كلمات كحد أقصى)",
 "gist": "جملة واحدة: ما هدف الجلسة",
 "done": ["ما أُنجز فعلًا، نقاط قصيرة، 5 كحد أقصى"],
 "pending": ["ما بقي معلقًا أو لم يُختبر أو ينتظر قرارًا، 4 كحد أقصى، أو قائمة فارغة"],
 "next": "الخطوة التالية المقترحة في جملة واحدة، أو نص فارغ إذا انتهى العمل",
 "state": "done أو pending أو blocked"}
اكتب بالعربية الواضحة، وأبقِ أسماء الملفات والأوامر والتقنيات كما هي. لا تخترع شيئًا غير موجود في النص.`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["-p", "--model", MODEL, "--no-session-persistence", "--tools", "", "--output-format", "json"],
      { cwd: os.tmpdir(), env: process.env }
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("انتهت مهلة التلخيص"));
    }, 180_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || out.trim() || `claude خرج بالرمز ${code}`));
      resolve(out);
    });
    child.stdin.end(prompt);
  });
}

export async function summarize(session) {
  const raw = await runClaude(buildPrompt(session));
  let text = raw;
  try {
    const env = JSON.parse(raw);
    if (env.is_error) throw new Error(env.result || "خطأ من claude");
    text = env.result ?? raw;
  } catch (e) {
    if (e.message && !e.message.startsWith("Unexpected")) throw e;
  }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("لم يرجع claude ملخصًا صالحًا");
  const json = JSON.parse(m[0]);
  return {
    title: String(json.title || "").slice(0, 120),
    gist: String(json.gist || ""),
    done: Array.isArray(json.done) ? json.done.map(String) : [],
    pending: Array.isArray(json.pending) ? json.pending.map(String) : [],
    next: String(json.next || ""),
    state: ["done", "pending", "blocked"].includes(json.state) ? json.state : "pending",
    model: MODEL,
  };
}
