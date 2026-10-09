// Jawla — خادم محلي: واجهة الجلسات، والملخصات، والترمينالات المدمجة، والمساعد المركزي.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { APP, DATA_DIR, HUB_DIR, EXPORT_DIR, settings, jsonStore } from "./lib/config.mjs";
import { Index, SOURCES } from "./lib/index.mjs";
import { summarize, standup, periodReport } from "./lib/summarize.mjs";
import { computeAnalytics, analyticsMarkdown } from "./lib/analytics.mjs";
import { Terminals } from "./lib/terminals.mjs";
import { writeHubFiles, isHubSession } from "./lib/hub.mjs";
import { exportFile, createGist } from "./lib/share.mjs";
import { searchContent } from "./lib/search.mjs";
import { dayKey, shq } from "./lib/util.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = APP.port;
const HOST = "127.0.0.1";

const index = new Index(path.join(DATA_DIR, "index.json"), { exclude: isHubSession });
const meta = jsonStore("meta.json"); // id -> { status, pinned, note, title }
const summaries = jsonStore("summaries.json"); // id -> { ...summary, forLastAt, at }
const standups = jsonStore("standups.json"); // day -> { ...standup, at, forKey }
const reports = jsonStore("reports.json"); // "<range>:<to>" -> { ...report, at, lang }
const terms = new Terminals();

// ===== طابور التلخيص =====
const queue = [];
const jobs = new Map(); // id -> "queued" | "running"
const failures = {};
let active = 0;

function enqueue(id, front = false) {
  if (jobs.has(id)) return;
  jobs.set(id, "queued");
  delete failures[id];
  front ? queue.unshift(id) : queue.push(id);
  pump();
}
function pump() {
  while (active < 2 && queue.length) {
    const id = queue.shift();
    active++;
    jobs.set(id, "running");
    (async () => {
      const s = index.get(id);
      if (!s) throw new Error("session not found");
      const full = await index.full(s);
      const sum = await summarize(full, { model: settings.data.summaryModel, lang: settings.data.lang });
      summaries.data[id] = { ...sum, forLastAt: s.lastAt, at: Date.now() };
      summaries.save();
    })()
      .catch((e) => {
        failures[id] = e.message;
        console.error("summary failed", id.slice(0, 8), e.message);
      })
      .finally(() => {
        active--;
        jobs.delete(id);
        refreshHub();
        pump();
      });
  }
}

// تلخيص تلقائي للجلسات التي توقفت منذ فترة ولم تُلخَّص أو تغيّرت بعد التلخيص
function autoSummarize() {
  const st = settings.data;
  if (!st.autoSummarize) return;
  const now = Date.now();
  const idle = st.autoSummarizeIdleMin * 60_000;
  const oldest = now - st.autoSummarizeDays * 86_400_000;
  const live = new Set(terms.list().filter((t) => t.alive).map((t) => t.sessionId));
  const due = index
    .sessions()
    .filter((s) => s.lastAt > oldest && now - s.lastAt > idle && !live.has(s.id) && !jobs.has(s.id) && !failures[s.id])
    .filter((s) => {
      const sum = summaries.data[s.id];
      return !sum || sum.forLastAt !== s.lastAt;
    })
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, 3);
  due.forEach((s) => enqueue(s.id));
}

// ===== تحويل الجلسة لشكل الواجهة =====
function decorate(s) {
  const sum = summaries.data[s.id];
  const m = meta.data[s.id] || {};
  const liveTitle = index.liveTitle(s);
  const term = terms.list().find((t) => t.sessionId === s.id && t.alive);
  return {
    id: s.id,
    source: s.source,
    cwd: s.cwd,
    project: s.cwd ? path.basename(s.cwd) : "?",
    branch: s.branch && s.branch !== "HEAD" ? s.branch : null,
    title: m.title || s.customTitle || liveTitle || s.title || sum?.title || s.firstPrompt?.slice(0, 80),
    firstAt: s.firstAt,
    lastAt: s.lastAt,
    prompts: s.prompts,
    replies: s.replies,
    compactions: s.compactions,
    days: s.days,
    firstPrompt: s.firstPrompt,
    lastPrompt: s.lastPrompt,
    model: s.model,
    filesCount: s.files.length,
    file: s.file,
    meta: m,
    summary: sum ? { ...sum, stale: sum.forLastAt !== s.lastAt } : null,
    summarizing: jobs.get(s.id) || null,
    summaryError: failures[s.id] || null,
    // نشطة: مفتوحة في ترمينال داخل Jawla، أو تغيّر ملفها خلال آخر دقيقتين
    live: term ? "open" : Date.now() - s.lastAt < 120_000 ? "recent" : null,
    tid: term?.tid || null,
  };
}

function refreshHub() {
  const list = index.sessions().map((s) => {
    const d = decorate(s);
    return {
      id: d.id,
      source: d.source,
      cwd: d.cwd,
      project: d.project,
      branch: d.branch,
      title: d.title,
      firstAt: d.firstAt,
      lastAt: d.lastAt,
      days: d.days,
      prompts: d.prompts,
      status: d.meta.status || null,
      pinned: !!d.meta.pinned,
      note: d.meta.note || "",
      summary: d.summary ? { gist: d.summary.gist, done: d.summary.done, pending: d.summary.pending, next: d.summary.next, state: d.summary.state } : null,
      firstPrompt: d.firstPrompt,
      lastPrompt: d.lastPrompt,
      file: d.file,
    };
  });
  const analytics = [7, 30, 0].map((range) => analyticsMarkdown(computeAnalytics(index.sessions(), decorate, { range })));
  writeHubFiles(list, { port: PORT, analytics: analytics.join("\n") });
}

async function freshIndex() {
  if (Date.now() - index.lastScanAt > 15_000) {
    await index.scan();
    refreshHub();
  }
}

// ===== أدوات HTTP =====
function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function readBody(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 1e6) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

// حماية: الخادم يشغّل أوامر على جهازك، لذا نرفض أي طلب لا يأتي من الواجهة نفسها
// (يمنع DNS rebinding وطلبات المواقع الأخرى عبر المتصفح)
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
function trusted(req) {
  if (!ALLOWED_HOSTS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ""))) return false;
  return true;
}

function osa(script) {
  return new Promise((resolve, reject) => execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve())));
}

function openTerminalFor(s, { fork = false } = {}) {
  const src = index.source(s);
  // النسخة المتفرعة تبدأ من نفس السياق لكن بمعرّف جديد، فلا تتعارض مع نافذة أخرى تعمل على الجلسة
  const command = fork && s.source === "claude" ? `${src.resumeCommand(s.id)} --fork-session` : src.resumeCommand(s.id);
  return terms.open({
    kind: "resume",
    title: decorate(s).title,
    cwd: s.cwd,
    command,
    sessionId: fork ? null : s.id,
    source: s.source,
  });
}

function openHub() {
  const existing = terms.list().find((t) => t.kind === "hub" && t.alive);
  if (existing) return terms.items.get(existing.tid);
  refreshHub();
  const agent = settings.data.hubAgent === "codex" ? "codex" : "claude";
  // نكمل آخر محادثة مع المساعد إن وُجدت، حتى يتذكر ما سألته سابقًا
  const hasPrev = agent === "claude" && [...index.byId.values()].some((s) => s.source === "claude" && isHubSession(s));
  const command = agent === "codex" ? "codex" : hasPrev ? "claude --continue" : "claude";
  return terms.open({ kind: "hub", title: "Jawla", cwd: HUB_DIR, command, source: agent });
}

function healthInfo() {
  let cleanup = 30;
  for (const f of ["settings.json", "settings.local.json"]) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", f), "utf8"));
      if (j.cleanupPeriodDays != null) cleanup = j.cleanupPeriodDays;
    } catch {}
  }
  const has = (bin) => {
    try {
      return !!require_which(bin);
    } catch {
      return false;
    }
  };
  return {
    cleanupPeriodDays: cleanup,
    claude: has("claude"),
    codex: has("codex"),
    gh: has("gh"),
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, fs.existsSync(s.ROOT)])),
  };
}
function require_which(bin) {
  for (const dir of (process.env.PATH || "").split(":")) {
    const p = path.join(dir, bin);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const VENDOR = {
  "/vendor/xterm.js": "node_modules/@xterm/xterm/lib/xterm.js",
  "/vendor/xterm.css": "node_modules/@xterm/xterm/css/xterm.css",
  "/vendor/addon-fit.js": "node_modules/@xterm/addon-fit/lib/addon-fit.js",
  "/vendor/addon-web-links.js": "node_modules/@xterm/addon-web-links/lib/addon-web-links.js",
};

// ===== المسارات =====
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const M = req.method;

  if ((p.startsWith("/api/") || p.startsWith("/exports/")) && !trusted(req)) return send(res, 403, { error: "forbidden" });

  if (p === "/api/sessions" && M === "GET") {
    if (!index.lastScanAt) index.scan().then(refreshHub);
    else await freshIndex();
    return send(res, 200, {
      now: Date.now(),
      scanning: !!index.scanning,
      progress: index.progress,
      sessions: index.sessions().map(decorate),
      terminals: terms.list(),
      queue: { active, waiting: queue.length },
    });
  }

  if (p === "/api/settings") {
    if (M === "POST") {
      const body = await readBody(req);
      for (const k of Object.keys(settings.data)) if (k in body) settings.data[k] = body[k];
      settings.save();
    }
    return send(res, 200, settings.data);
  }

  if (p === "/api/health" && M === "GET") return send(res, 200, healthInfo());

  if (p === "/api/insights" && M === "GET") {
    await freshIndex();
    const range = Number(url.searchParams.get("range") ?? 30);
    const a = computeAnalytics(index.sessions(), decorate, { range });
    const cached = reports.data[`${range}:${a.to}`];
    return send(res, 200, { ...a, report: cached && cached.lang === settings.data.lang ? cached : null });
  }

  if (p === "/api/report" && M === "POST") {
    const { range = 7 } = await readBody(req);
    const a = computeAnalytics(index.sessions(), decorate, { range });
    if (!a.totals.sessions) return send(res, 200, { empty: true });
    const fromMin = new Date(a.from).getTime();
    const lines = index
      .sessions()
      .filter((s) => s.lastAt >= fromMin)
      .map(decorate)
      .sort((x, y) => y.lastAt - x.lastAt)
      .slice(0, 60)
      .map((d) => `- [${d.project}] ${d.title} — ${d.meta.status || d.summary?.state || "?"}${d.summary?.pending?.length ? ` · open: ${d.summary.pending.slice(0, 2).join(" | ")}` : ""}`)
      .join("\n");
    const r = await periodReport(analyticsMarkdown(a), lines, { model: settings.data.summaryModel === "haiku" ? "sonnet" : settings.data.summaryModel, lang: settings.data.lang, days: range || a.days });
    reports.data[`${range}:${a.to}`] = { ...r, at: Date.now(), lang: settings.data.lang };
    reports.save();
    return send(res, 200, reports.data[`${range}:${a.to}`]);
  }

  if (p === "/api/search" && M === "GET") {
    const q = url.searchParams.get("q") || "";
    const roots = Object.values(SOURCES).map((s) => s.ROOT);
    const found = await searchContent(q, roots);
    const byFile = new Map(index.sessions().map((s) => [s.file, s]));
    const results = found
      .filter((r) => byFile.has(r.file))
      .map((r) => ({ id: byFile.get(r.file).id, hits: r.hits }));
    return send(res, 200, { q, results });
  }

  let m = p.match(/^\/api\/sessions\/([\w-]+)(?:\/([\w-]+))?$/);
  if (m) {
    const [, id, action] = m;
    const s = index.get(id);
    if (!s) return send(res, 404, { error: "not found" });

    if (!action && M === "GET") {
      const full = await index.full(s);
      return send(res, 200, { ...decorate(s), turns: full.turns, files: full.files });
    }
    if (action === "summarize" && M === "POST") {
      enqueue(id, true);
      return send(res, 202, { queued: true });
    }
    if (action === "meta" && M === "POST") {
      const body = await readBody(req);
      const cur = meta.data[id] || {};
      for (const k of ["status", "pinned", "note", "title"]) if (k in body) cur[k] = body[k];
      meta.data[id] = cur;
      meta.save();
      refreshHub();
      return send(res, 200, cur);
    }
    if (action === "external" && M === "POST") {
      // استئناف في تطبيق Terminal الخاص بالنظام
      const dir = s.cwd && fs.existsSync(s.cwd) ? s.cwd : os.homedir();
      const cmd = `cd ${shq(dir)} && ${index.source(s).resumeCommand(s.id)}`;
      await osa(`tell application "Terminal"\n activate\n do script ${JSON.stringify(cmd)}\nend tell`);
      return send(res, 200, { ok: true });
    }
    if (action === "export" && M === "POST") {
      const body = await readBody(req);
      const full = await index.full(s);
      const d = decorate(s);
      const out = exportFile(full, { title: d.title, summary: d.summary }, { format: body.format, includeAssistant: body.includeAssistant !== false });
      let url = null;
      if (body.gist) url = await createGist(out.file, `${d.title} — exported with Jawla`);
      return send(res, 200, { file: out.file, name: path.basename(out.file), redacted: out.redacted, url });
    }
  }

  if (p === "/api/summarize-batch" && M === "POST") {
    const { ids = [] } = await readBody(req);
    ids.forEach((id) => enqueue(id));
    return send(res, 202, { queued: ids.length });
  }

  if (p === "/api/standup" && M === "POST") {
    const { day = dayKey(Date.now()), force = false } = await readBody(req);
    const items = index
      .sessions()
      .filter((s) => s.days?.[day])
      .map((s) => {
        const d = decorate(s);
        return { ...d, status: d.meta.status, note: d.meta.note, dayPrompts: s.days[day] };
      });
    if (!items.length) return send(res, 200, { day, empty: true });
    const key = items.map((i) => i.id + ":" + i.lastAt + ":" + (i.summary?.at || 0)).join("|");
    const cached = standups.data[day];
    if (cached && !force && cached.forKey === key && cached.lang === settings.data.lang) return send(res, 200, { day, ...cached });
    const result = await standup(items, { model: settings.data.summaryModel === "haiku" ? "sonnet" : settings.data.summaryModel, lang: settings.data.lang, day });
    standups.data[day] = { ...result, at: Date.now(), forKey: key, lang: settings.data.lang, count: items.length };
    standups.save();
    return send(res, 200, { day, ...standups.data[day] });
  }
  if (p === "/api/standup" && M === "GET") {
    const day = url.searchParams.get("day") || dayKey(Date.now());
    return send(res, 200, { day, ...(standups.data[day] || { none: true }) });
  }

  // الترمينالات
  if (p === "/api/terminals" && M === "GET") return send(res, 200, terms.list());
  if (p === "/api/terminals" && M === "POST") {
    const body = await readBody(req);
    let t;
    if (body.hub) t = openHub();
    else if (body.sessionId) {
      const s = index.get(body.sessionId);
      if (!s) return send(res, 404, { error: "not found" });
      t = openTerminalFor(s, { fork: !!body.fork });
    } else if (body.cwd) {
      const agent = body.agent === "codex" ? "codex" : body.agent === "shell" ? null : "claude";
      t = terms.open({ kind: agent ? "new" : "shell", title: path.basename(body.cwd), cwd: body.cwd, command: agent, source: agent });
    } else return send(res, 400, { error: "missing target" });
    return send(res, 200, { tid: t.tid });
  }
  m = p.match(/^\/api\/terminals\/(\w+)$/);
  if (m && M === "DELETE") return send(res, 200, { ok: terms.close(m[1]) });

  if (p === "/api/reveal" && M === "POST") {
    const { file } = await readBody(req);
    const f = path.resolve(String(file || ""));
    if (!f.startsWith(EXPORT_DIR + path.sep) && !f.startsWith(HUB_DIR)) return send(res, 403, { error: "forbidden" });
    execFile("open", ["-R", f]);
    return send(res, 200, { ok: true });
  }

  if (p === "/api/rescan" && M === "POST") {
    await index.scan();
    refreshHub();
    return send(res, 200, { ok: true });
  }

  // تنزيل ملف مُصدَّر
  m = p.match(/^\/exports\/([^/]+)$/);
  if (m && M === "GET") {
    const f = path.join(EXPORT_DIR, path.basename(decodeURIComponent(m[1])));
    const buf = await fsp.readFile(f);
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "text/markdown; charset=utf-8", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` });
    return res.end(buf);
  }

  // الملفات الثابتة
  if (VENDOR[p]) return send(res, 200, await fsp.readFile(path.join(ROOT, VENDOR[p])), MIME[path.extname(p)]);
  const rel = p === "/" ? "index.html" : p.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden", "text/plain");
  return send(res, 200, await fsp.readFile(file), MIME[path.extname(file)] || "application/octet-stream");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e.code === "ENOENT") return send(res, 404, { error: "not found" });
    console.error(e);
    send(res, 500, { error: e.message });
  });
});

// WebSocket للترمينالات: /ws/terminals/<tid>
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const m = req.url.match(/^\/ws\/terminals\/(\w+)$/);
  if (!m || !trusted(req)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => terms.attach(m[1], ws));
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is busy — Jawla is probably already running: http://localhost:${PORT}`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  console.log(`Jawla running on http://localhost:${PORT}  (data: ${DATA_DIR})`);
  index.scan().then(() => {
    refreshHub();
    console.log(`indexed ${index.sessions().length} sessions`);
  });
  setInterval(() => freshIndex().then(autoSummarize).catch(() => {}), 120_000);
  setTimeout(autoSummarize, 20_000);
  if (process.env.JAWLA_OPEN_ON_START === "1") openAppWindowOnce();
});

// عند التشغيل التلقائي مع الجهاز نفتح النافذة مرة واحدة، لا عند كل إعادة تشغيل للخادم
function openAppWindowOnce() {
  const mark = path.join(DATA_DIR, ".last-open");
  try {
    if (Date.now() - fs.statSync(mark).mtimeMs < 30 * 60_000) return;
  } catch {}
  fs.writeFileSync(mark, "");
  const url = `http://localhost:${PORT}/#today`;
  const chrome = ["Google Chrome", "Microsoft Edge", "Brave Browser"].find((b) => fs.existsSync(`/Applications/${b}.app`));
  if (chrome) execFile("open", ["-na", chrome, "--args", `--app=${url}`, "--window-size=1440,920"]);
  else execFile("open", [url]);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    terms.closeAll();
    process.exit(0);
  });
}
