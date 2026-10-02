// خادم محلي صغير بلا مكتبات خارجية: يقدّم الواجهة ويعرض واجهة برمجية للجلسات.

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Index, parseSession } from "./lib/scan.mjs";
import { summarize } from "./lib/summarize.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4477);
const HOST = "127.0.0.1";

fs.mkdirSync(DATA, { recursive: true });
const index = new Index(path.join(DATA, "index.json"));

// ملفات JSON صغيرة: حالة كل جلسة وملاحظاتك، والملخصات
function jsonStore(name) {
  const file = path.join(DATA, name);
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  return {
    data,
    async save() {
      await fsp.writeFile(file, JSON.stringify(data, null, 2));
    },
  };
}
const meta = jsonStore("meta.json"); // id -> { status, pinned, note }
const summaries = jsonStore("summaries.json"); // id -> { ...summary, forLastAt, at }

// طابور التلخيص: جلستان معًا كحد أقصى
const queue = [];
const running = new Map(); // id -> "queued" | "running"
const failures = {}; // id -> رسالة الخطأ الأخيرة
let active = 0;
function enqueue(id) {
  if (running.has(id)) return;
  running.set(id, "queued");
  delete failures[id];
  queue.push(id);
  pump();
}
function pump() {
  while (active < 2 && queue.length) {
    const id = queue.shift();
    active++;
    running.set(id, "running");
    (async () => {
      const s = index.get(id);
      if (!s) throw new Error("الجلسة غير موجودة");
      const full = await parseSession(s.file, { full: true });
      const sum = await summarize(full);
      summaries.data[id] = { ...sum, forLastAt: s.lastAt, at: Date.now() };
      await summaries.save();
    })()
      .catch((e) => {
        failures[id] = e.message;
        console.error("فشل التلخيص", id, e.message);
      })
      .finally(() => {
        active--;
        running.delete(id);
        pump();
      });
  }
}

function decorate(s) {
  const sum = summaries.data[s.id];
  return {
    id: s.id,
    cwd: s.cwd,
    project: s.cwd ? path.basename(s.cwd) : "؟",
    branch: s.branch,
    title: s.customTitle || sum?.title || s.title || s.firstPrompt?.slice(0, 80),
    aiTitle: s.title,
    firstAt: s.firstAt,
    lastAt: s.lastAt,
    prompts: s.prompts,
    replies: s.replies,
    compactions: s.compactions,
    days: s.days,
    firstPrompt: s.firstPrompt,
    lastPrompt: s.lastPrompt,
    lastPromptAt: s.lastPromptAt,
    model: s.model,
    filesCount: s.files.length,
    meta: meta.data[s.id] || {},
    summary: sum ? { ...sum, stale: sum.forLastAt !== s.lastAt } : null,
    summarizing: running.get(s.id) || null,
    summaryError: failures[s.id] || null,
  };
}

async function freshIndex() {
  // فحص سريع إذا مر أكثر من 15 ثانية، والملفات غير المتغيرة لا يعاد تحليلها
  if (Date.now() - index.lastScanAt > 15_000) await index.scan();
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = "";
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

function openInTerminal(cwd, id) {
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const q = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
  const cmd = `cd ${q(dir)} && claude --resume ${id}`;
  const script = `tell application "Terminal"
  activate
  do script ${JSON.stringify(cmd)}
end tell`;
  return new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script], (err) => (err ? reject(err) : resolve(cmd)))
  );
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === "/api/sessions" && req.method === "GET") {
      // أول تشغيل: نعيد ما هو جاهز مع نسبة التقدم بدل الانتظار
      if (!index.lastScanAt) index.scan();
      else await freshIndex();
      return send(res, 200, {
        now: Date.now(),
        scanning: !!index.scanning,
        progress: index.progress,
        sessions: index.sessions().map(decorate),
      });
    }

    let m = p.match(/^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/);
    if (m) {
      const [, id, action] = m;
      const s = index.get(id);
      if (!s) return send(res, 404, { error: "الجلسة غير موجودة" });

      if (!action && req.method === "GET") {
        const full = await parseSession(s.file, { full: true });
        return send(res, 200, { ...decorate(s), turns: full.turns, files: full.files });
      }
      if (action === "summarize" && req.method === "POST") {
        enqueue(id);
        return send(res, 202, { queued: true });
      }
      if (action === "resume" && req.method === "POST") {
        const cmd = await openInTerminal(s.cwd, id);
        return send(res, 200, { ok: true, cmd });
      }
      if (action === "meta" && req.method === "POST") {
        const body = await readBody(req);
        const cur = meta.data[id] || {};
        for (const k of ["status", "pinned", "note"]) if (k in body) cur[k] = body[k];
        meta.data[id] = cur;
        await meta.save();
        return send(res, 200, cur);
      }
    }

    if (p === "/api/summarize-batch" && req.method === "POST") {
      const { ids = [] } = await readBody(req);
      ids.forEach(enqueue);
      return send(res, 202, { queued: ids.length });
    }

    if (p === "/api/rescan" && req.method === "POST") {
      await index.scan();
      return send(res, 200, { ok: true });
    }

    // الملفات الثابتة
    const rel = p === "/" ? "index.html" : p.slice(1);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "ممنوع", "text/plain; charset=utf-8");
    const buf = await fsp.readFile(file);
    return send(res, 200, buf, MIME[path.extname(file)] || "application/octet-stream");
  } catch (e) {
    if (e.code === "ENOENT") return send(res, 404, "غير موجود", "text/plain; charset=utf-8");
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`جلساتي تعمل على http://localhost:${PORT}`);
  index.scan().then(() => console.log(`تم فهرسة ${index.sessions().length} جلسة`));
});
