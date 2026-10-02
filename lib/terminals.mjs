// ترمينالات حقيقية داخل المتصفح عبر node-pty.
// الترمينال يبقى حيًا في الخادم عند إغلاق التبويب أو إعادة تحميل الصفحة،
// ويُعاد عرض آخر مخرجاته عند الاتصال من جديد.

import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import pty from "node-pty";

const MAX_BUFFER = 256 * 1024;

// متغيرات بيئة تجعل claude يظن أنه يعمل داخل جلسة أخرى، فتُحذف من الترمينالات الجديدة
const STRIP_ENV = /^(CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_SSE_PORT|CLAUDE_AGENT_SDK|ANTHROPIC_.*_SESSION|VSCODE_.*|TERM_PROGRAM.*)$/;

function cleanEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!STRIP_ENV.test(k) && v != null) env[k] = v;
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: env.LANG || "en_US.UTF-8",
    ...extra,
  };
}

export class Terminals {
  constructor() {
    this.items = new Map(); // tid -> terminal
    this.listeners = new Set(); // يُبلَّغون عند فتح أو إغلاق ترمينال
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    for (const fn of this.listeners) fn();
  }

  /**
   * يفتح ترمينالًا يشغّل command داخل shell المستخدم.
   * بعد خروج الأمر يبقى shell مفتوحًا حتى لا تختفي المخرجات.
   */
  open({ kind, title, cwd, command, sessionId = null, source = null }) {
    // جلسة مفتوحة بالفعل؟ نعيد نفس الترمينال بدل تشغيل نسخة ثانية تتعارض معها
    if (sessionId) {
      for (const t of this.items.values()) if (t.sessionId === sessionId && t.alive) return t;
    }
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const shell = process.env.SHELL || "/bin/zsh";
    const script = command ? `${command}; exec ${shell} -l` : `exec ${shell} -l`;
    const proc = pty.spawn(shell, ["-l", "-c", script], {
      name: "xterm-256color",
      cols: 120,
      rows: 34,
      cwd: dir,
      env: cleanEnv(),
    });
    const t = {
      tid: crypto.randomUUID().slice(0, 8),
      kind, // resume | new | hub | shell
      title,
      cwd: dir,
      command,
      sessionId,
      source,
      createdAt: Date.now(),
      lastOutputAt: Date.now(),
      alive: true,
      exitCode: null,
      buffer: "",
      clients: new Set(),
      proc,
    };
    proc.onData((data) => {
      t.buffer += data;
      if (t.buffer.length > MAX_BUFFER) t.buffer = t.buffer.slice(-MAX_BUFFER);
      t.lastOutputAt = Date.now();
      for (const ws of t.clients) if (ws.readyState === 1) ws.send(JSON.stringify({ t: "o", d: data }));
    });
    proc.onExit(({ exitCode }) => {
      t.alive = false;
      t.exitCode = exitCode;
      for (const ws of t.clients) if (ws.readyState === 1) ws.send(JSON.stringify({ t: "exit", code: exitCode }));
      this.emit();
    });
    this.items.set(t.tid, t);
    this.emit();
    return t;
  }

  /** يربط اتصال WebSocket بالترمينال ويعيد عرض المخرجات السابقة */
  attach(tid, ws) {
    const t = this.items.get(tid);
    if (!t) {
      ws.send(JSON.stringify({ t: "gone" }));
      ws.close();
      return;
    }
    t.clients.add(ws);
    ws.send(JSON.stringify({ t: "o", d: t.buffer }));
    if (!t.alive) ws.send(JSON.stringify({ t: "exit", code: t.exitCode }));
    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (!t.alive) return;
      if (m.t === "i" && typeof m.d === "string") t.proc.write(m.d);
      else if (m.t === "r" && m.cols > 0 && m.rows > 0) {
        try {
          t.proc.resize(Math.min(500, m.cols | 0), Math.min(200, m.rows | 0));
        } catch {}
      }
    });
    ws.on("close", () => t.clients.delete(ws));
  }

  close(tid) {
    const t = this.items.get(tid);
    if (!t) return false;
    if (t.alive) {
      try {
        t.proc.kill();
      } catch {}
    }
    for (const ws of t.clients) ws.close();
    this.items.delete(tid);
    this.emit();
    return true;
  }

  list() {
    return [...this.items.values()].map((t) => ({
      tid: t.tid,
      kind: t.kind,
      title: t.title,
      cwd: t.cwd,
      sessionId: t.sessionId,
      source: t.source,
      alive: t.alive,
      exitCode: t.exitCode,
      createdAt: t.createdAt,
      lastOutputAt: t.lastOutputAt,
    }));
  }

  closeAll() {
    for (const tid of [...this.items.keys()]) this.close(tid);
  }
}
