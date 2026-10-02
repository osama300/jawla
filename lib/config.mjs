// اسم الأداة ومساراتها وإعداداتها في مكان واحد.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const APP = {
  id: "dawra", // يُستخدم في أسماء الملفات والمجلدات
  name: "Dawra",
  nameAr: "دورة",
  port: Number(process.env.PORT || 4477),
};

export const DATA_DIR = process.env.DAWRA_HOME || path.join(os.homedir(), `.${APP.id}`);
export const HUB_DIR = path.join(DATA_DIR, "hub"); // مجلد عمل المساعد المركزي
export const EXPORT_DIR = path.join(DATA_DIR, "exports");
fs.mkdirSync(HUB_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const DEFAULTS = {
  lang: "ar",
  theme: "dark",
  summaryModel: "haiku",
  autoSummarize: true, // تلخيص الجلسات الخاملة تلقائيًا
  autoSummarizeIdleMin: 20, // بعد كم دقيقة من آخر نشاط تُعتبر الجلسة خاملة
  autoSummarizeDays: 3, // لا نلخّص تلقائيًا ما هو أقدم من ذلك
  hubAgent: "claude", // من يشغّل المساعد المركزي: claude أو codex
};

/** ملف JSON صغير يُحفظ عند كل تعديل */
export function jsonStore(name, defaults = {}) {
  const file = path.join(DATA_DIR, name);
  let data = { ...defaults };
  try {
    data = { ...defaults, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {}
  let timer = null;
  return {
    file,
    data,
    save() {
      clearTimeout(timer);
      timer = setTimeout(() => fs.writeFileSync(file, JSON.stringify(data, null, 2)), 50);
    },
  };
}

export const settings = jsonStore("settings.json", DEFAULTS);
