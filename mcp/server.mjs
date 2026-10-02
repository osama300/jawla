#!/usr/bin/env node
// خادم MCP صغير (stdio، بلا مكتبات) يتيح لأي جلسة Claude Code سؤال Dawra عن جلساتك.
// يتواصل مع خادم Dawra المحلي، ويشغّله إن لم يكن يعمل.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4477);
const BASE = `http://127.0.0.1:${PORT}`;

async function up() {
  try {
    return (await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}
async function ensure() {
  if (await up()) return;
  const data = process.env.DAWRA_HOME || path.join(os.homedir(), ".dawra");
  fs.mkdirSync(data, { recursive: true });
  const log = fs.openSync(path.join(data, "server.log"), "a");
  spawn(process.execPath, [path.join(ROOT, "server.mjs")], { cwd: ROOT, detached: true, stdio: ["ignore", log, log] }).unref();
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
}
async function api(p, opts = {}) {
  await ensure();
  const r = await fetch(BASE + p, { ...opts, headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

const day = (t) => new Date(t).toISOString().slice(0, 10);
function brief(s) {
  const sum = s.summary;
  return {
    id: s.id,
    agent: s.source,
    project: s.project,
    path: s.cwd,
    title: s.title,
    first: s.firstAt && new Date(s.firstAt).toISOString(),
    last: s.lastAt && new Date(s.lastAt).toISOString(),
    prompts: s.prompts,
    status: s.meta?.status || null,
    pinned: !!s.meta?.pinned,
    note: s.meta?.note || undefined,
    summary: sum ? { gist: sum.gist, done: sum.done, pending: sum.pending, next: sum.next, state: sum.state } : undefined,
    lastPrompt: sum ? undefined : s.lastPrompt,
  };
}

const TOOLS = [
  {
    name: "dawra_sessions",
    description: "List the user's Claude Code and Codex sessions across ALL projects, newest first, with AI summaries (done / pending / next), status, pins and notes. Use for questions like 'what did I work on yesterday', 'what is pending', 'sessions in project X'.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Only sessions active in the last N days (default 7, 0 = all)" },
        project: { type: "string", description: "Filter by project folder name or path substring" },
        query: { type: "string", description: "Filter by words in title, prompts, summary or notes" },
        status: { type: "string", enum: ["followup", "waiting", "done", "pending"], description: "'pending' = sessions whose summary has open items" },
        limit: { type: "number", description: "Max results (default 30)" },
      },
    },
  },
  {
    name: "dawra_search",
    description: "Full-text search inside the conversations of all sessions (not just titles). Returns matching sessions with message snippets.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "dawra_session",
    description: "Get one session in detail: summary, the user's prompts with timestamps, the last assistant reply and edited files.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Session id (full or first 8 chars)" } }, required: ["id"] },
  },
  {
    name: "dawra_open",
    description: "Open (resume) a session for the user in the Dawra app's embedded terminal.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

async function resolveId(id) {
  const { sessions } = await api("/api/sessions");
  const s = sessions.find((x) => x.id === id || x.id.startsWith(id));
  if (!s) throw new Error(`no session ${id}`);
  return s;
}

async function call(name, a = {}) {
  if (name === "dawra_sessions") {
    const { sessions } = await api("/api/sessions");
    const days = a.days ?? 7;
    const since = days ? Date.now() - days * 86400000 : 0;
    let list = sessions.filter((s) => s.lastAt >= since);
    if (a.project) list = list.filter((s) => (s.cwd || "").toLowerCase().includes(a.project.toLowerCase()));
    if (a.status === "pending") list = list.filter((s) => s.summary?.pending?.length || ["followup", "waiting"].includes(s.meta?.status));
    else if (a.status) list = list.filter((s) => s.meta?.status === a.status);
    if (a.query) {
      const q = a.query.toLowerCase();
      list = list.filter((s) => [s.title, s.firstPrompt, s.lastPrompt, s.meta?.note, s.summary?.gist, ...(s.summary?.pending || []), ...(s.summary?.done || [])].join(" ").toLowerCase().includes(q));
    }
    list.sort((x, y) => y.lastAt - x.lastAt);
    return { count: list.length, sessions: list.slice(0, a.limit || 30).map(brief) };
  }
  if (name === "dawra_search") {
    const [{ results }, { sessions }] = await Promise.all([api(`/api/search?q=${encodeURIComponent(a.query)}`), api("/api/sessions")]);
    const by = new Map(sessions.map((s) => [s.id, s]));
    return results.slice(0, 25).map((r) => {
      const s = by.get(r.id);
      return { id: r.id, project: s?.project, title: s?.title, last: s && day(s.lastAt), snippets: r.hits.map((h) => `${h.role}: ${h.before}${h.match}${h.after}`) };
    });
  }
  if (name === "dawra_session") {
    const s = await resolveId(a.id);
    const d = await api(`/api/sessions/${s.id}`);
    const prompts = d.turns.filter((x) => x.role === "user").map((x) => `[${x.at || ""}] ${x.text.slice(0, 600)}`);
    const lastReply = [...d.turns].reverse().find((x) => x.role === "assistant")?.text.slice(-2000);
    return { ...brief(d), branch: d.branch, files: d.files.slice(0, 50), prompts: prompts.slice(-40), lastReply };
  }
  if (name === "dawra_open") {
    const s = await resolveId(a.id);
    const { tid } = await api("/api/terminals", { method: "POST", body: { sessionId: s.id } });
    return { opened: true, url: `${BASE}/#work/${tid}` };
  }
  throw new Error(`unknown tool ${name}`);
}

// ===== JSON-RPC عبر stdio (رسالة JSON في كل سطر) =====
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(JSON.parse(line)).catch(() => {});
  }
});

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // إشعار
  try {
    let result;
    if (method === "initialize") {
      result = { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dawra", version: "1.0.0" } };
    } else if (method === "ping") result = {};
    else if (method === "tools/list") result = { tools: TOOLS };
    else if (method === "tools/call") {
      try {
        const out = await call(params.name, params.arguments);
        result = { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] };
      } catch (e) {
        result = { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    } else return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
    send({ jsonrpc: "2.0", id, result });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}
