/** مفتاح اليوم بالتوقيت المحلي، مثل 2026-10-02 */
export function dayKey(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** اقتباس آمن لوسيط في أمر shell */
export const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

/** يختصر النص الملصوق والصور حتى لا تطغى على الطلب نفسه */
export function tidyPrompt(text) {
  return text
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content>/g, (_, inner) => {
      const first = inner.trim().split("\n")[0].slice(0, 80);
      return `〔📋 ${first}…〕`;
    })
    .replace(/\[Image #\d+\]/g, "〔🖼〕")
    .trim();
}

/** هيكل الجلسة الموحّد الذي تعيده كل المصادر */
export function emptySession(source, id, file) {
  return {
    source,
    id,
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
    days: {},
    firstPrompt: null,
    lastPrompt: null,
    lastPromptAt: null,
    model: null,
    files: new Set(),
  };
}

/** يسجّل طلب مستخدم في الجلسة ويحدّث العدادات */
export function addPrompt(s, text, ts, turns) {
  s.prompts++;
  if (ts) {
    const k = dayKey(ts);
    s.days[k] = (s.days[k] || 0) + 1;
  }
  if (!s.firstPrompt) s.firstPrompt = text.slice(0, 300);
  s.lastPrompt = text.slice(0, 300);
  s.lastPromptAt = ts || null;
  if (turns) turns.push({ role: "user", at: ts || null, text: text.slice(0, 4000) });
}

/** يضيف رد المساعد، ويدمج الردود المتتالية في دور واحد */
export function addReply(turns, text, ts) {
  if (!turns || !text) return;
  const prev = turns[turns.length - 1];
  if (prev && prev.role === "assistant") {
    prev.text = (prev.text + "\n\n" + text).slice(-6000);
    prev.at = ts || prev.at;
  } else turns.push({ role: "assistant", at: ts || null, text: text.slice(-6000) });
}

export function touch(s, ts) {
  if (!ts || Number.isNaN(ts)) return;
  if (!s.firstAt || ts < s.firstAt) s.firstAt = ts;
  if (!s.lastAt || ts > s.lastAt) s.lastAt = ts;
}

export function finish(s, turns, full) {
  const out = { ...s, files: [...s.files] };
  if (!full) out.files = out.files.slice(0, 60);
  if (turns) out.turns = turns;
  return out;
}
