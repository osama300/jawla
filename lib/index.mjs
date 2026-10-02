// فهرس موحّد لكل المصادر مع تخزين مؤقت حسب الحجم ووقت التعديل.

import fs from "node:fs";
import fsp from "node:fs/promises";
import * as claude from "./sources/claude.mjs";
import * as codex from "./sources/codex.mjs";

export const SOURCES = { claude, codex };

export class Index {
  constructor(cacheFile, { exclude = () => false } = {}) {
    this.cacheFile = cacheFile;
    this.exclude = exclude; // دالة تستبعد جلسات معيّنة، مثل جلسات المساعد المركزي
    this.entries = {}; // file -> { source, size, mtimeMs, session }
    this.scanning = null;
    this.lastScanAt = 0;
    this.progress = { done: 0, total: 0 };
    this.byId = new Map();
    try {
      this.entries = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    } catch {
      this.entries = {};
    }
    // فهرس من نسخة سابقة بلا بيانات التحليلات: نعيد تحليله
    for (const [f, e] of Object.entries(this.entries)) if (!e.session?.act) delete this.entries[f];
    this.rebuild();
  }

  rebuild() {
    this.byId = new Map();
    for (const e of Object.values(this.entries)) if (e.session) this.byId.set(e.session.id, e.session);
  }

  scan() {
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      const files = [];
      for (const src of Object.values(SOURCES)) {
        if (!(await src.available())) continue;
        for (const f of await src.listFiles()) files.push([src, f]);
      }
      const seen = new Set(files.map(([, f]) => f));
      const todo = [];
      for (const [src, f] of files) {
        let st;
        try {
          st = await fsp.stat(f);
        } catch {
          continue;
        }
        const e = this.entries[f];
        if (!e || e.size !== st.size || e.mtimeMs !== st.mtimeMs) todo.push([src, f, st]);
      }
      this.progress = { done: 0, total: todo.length };
      // الأحدث أولًا حتى تظهر جلسات اليوم بسرعة في أول فحص
      todo.sort((a, b) => b[2].mtimeMs - a[2].mtimeMs);
      const worker = async () => {
        while (todo.length) {
          const [src, f, st] = todo.shift();
          try {
            const session = await src.parse(f);
            this.entries[f] = { source: src.name, size: st.size, mtimeMs: st.mtimeMs, session };
          } catch (err) {
            console.error("parse failed", f, err.message);
          }
          this.progress.done++;
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));
      for (const f of Object.keys(this.entries)) if (!seen.has(f)) delete this.entries[f];
      this.rebuild();
      await fsp.writeFile(this.cacheFile, JSON.stringify(this.entries));
      this.lastScanAt = Date.now();
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  sessions() {
    const out = [];
    for (const s of this.byId.values()) {
      if (s.prompts > 0 && s.lastAt && !this.exclude(s)) out.push(s);
    }
    return out;
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  source(s) {
    return SOURCES[s.source] || claude;
  }

  /** يحلل الجلسة كاملة مع كل الرسائل */
  full(s) {
    return this.source(s).parse(s.file, { full: true });
  }

  liveTitle(s) {
    return this.source(s).titleFor?.(s.id) || null;
  }
}

/** كل ملفات الجلسات من كل المصادر المتاحة */
export async function listAll() {
  const out = [];
  for (const src of Object.values(SOURCES)) if (await src.available()) out.push(...(await src.listFiles()));
  return out;
}
