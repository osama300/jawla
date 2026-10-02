// واجهة "جلساتي": قائمة الجلسات مجمّعة حسب اليوم، وفلترة حسب المشروع والحالة، ولوحة تفاصيل.

const $ = (s, el = document) => el.querySelector(s);
const LOCALE = "ar-u-ca-gregory-nu-latn";
const fmtDay = new Intl.DateTimeFormat(LOCALE, { weekday: "long" });
const fmtDate = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long" });
const fmtFull = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtTime = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false });
const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" });

const STATUS = {
  followup: { label: "تحتاج متابعة", cls: "follow" },
  waiting: { label: "بانتظار رد", cls: "wait" },
  done: { label: "مكتملة", cls: "done" },
};
const AI_STATE = { done: "منتهية", pending: "فيها معلّق", blocked: "متوقفة" };

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  sessions: [],
  view: store.get("view", "today"),
  project: null,
  query: "",
  openId: null,
  detail: null,
  tab: "turns",
  selIndex: -1,
  scanning: false,
  progress: null,
};

// ===== أدوات =====
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function dayKey(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function keyToDate(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function shiftDay(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
const today = () => dayKey(Date.now());
function dayName(k) {
  if (k === today()) return "اليوم";
  if (k === shiftDay(today(), -1)) return "أمس";
  return fmtDay.format(keyToDate(k));
}
function relTime(t) {
  const diff = (t - Date.now()) / 1000;
  const a = Math.abs(diff);
  if (a < 60) return "الآن";
  if (a < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (a < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return fmtDate.format(new Date(t));
}
function hue(str) { let h = 0; for (const c of str || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const projColor = (cwd) => `hsl(${hue(cwd)} 70% 62%)`;
function shortPath(p) { return (p || "").replace(/^\/Users\/[^/]+/, "~").replace(/^\/Volumes\/Work\/?/, "Work/"); }
function inline(text) {
  return esc(text).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2400);
}
async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ===== البيانات =====
async function load() {
  try {
    const data = await api("/api/sessions");
    state.sessions = data.sessions;
    state.scanning = data.scanning;
    state.progress = data.progress;
    render();
    if (state.openId) refreshDrawerHead();
  } catch (e) {
    $("#list").innerHTML = `<div class="empty"><b>تعذّر الاتصال بالخادم</b>${esc(e.message)}</div>`;
  }
  const busy = state.scanning || state.sessions.some((s) => s.summarizing);
  clearTimeout(load.timer);
  load.timer = setTimeout(load, busy ? 2500 : 20000);
}

function statusOf(s) {
  if (s.meta?.status && STATUS[s.meta.status]) return s.meta.status;
  return null;
}
function matches(s, q) {
  const hay = [s.title, s.aiTitle, s.project, s.cwd, s.branch, s.firstPrompt, s.lastPrompt, s.meta?.note, s.summary?.gist, ...(s.summary?.done || []), ...(s.summary?.pending || [])]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

const VIEWS = [
  { id: "today", label: "اليوم", icon: "sun", days: 1 },
  { id: "yesterday", label: "أمس", icon: "moon" },
  { id: "week", label: "آخر 7 أيام", icon: "cal", days: 7 },
  { id: "all", label: "كل الجلسات", icon: "list" },
  { group: "تنظيم" },
  { id: "pinned", label: "المثبّتة", icon: "pin" },
  { id: "followup", label: "تحتاج متابعة", icon: "flag" },
  { id: "done", label: "مكتملة", icon: "check" },
];
const ICONS = {
  sun: '<path fill="currentColor" d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4Zm14.9 14.9 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4ZM2.8 19.8l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4ZM17.7 4.9l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4Z"/>',
  moon: '<path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.4 5.4 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8C12.92 3.04 12.46 3 12 3Z"/>',
  cal: '<path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2Zm12 8H5v9h14v-9Z"/>',
  list: '<path fill="currentColor" d="M8 5h13v2H8V5Zm0 6h13v2H8v-2Zm0 6h13v2H8v-2ZM3 4.5h3v3H3v-3Zm0 6h3v3H3v-3Zm0 6h3v3H3v-3Z"/>',
  pin: '<path fill="currentColor" d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z"/>',
  flag: '<path fill="currentColor" d="M5 2h2v1h12l-2.5 5L19 13H7v9H5V2Z"/>',
  check: '<path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.2 13.6 6.4-6.4-1.4-1.4-5 5-2.6-2.6-1.4 1.4 4 4Z"/>',
};
const svg = (name, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;

/** يعيد مجموعات أيام: [{ key, items: [{ s, dayPrompts }] }] */
function computeGroups() {
  const all = state.sessions;
  const q = state.query.trim().toLowerCase();
  const t = today();
  let list = all;
  let byActiveDays = false;
  let dayFilter = null;

  if (q) list = all.filter((s) => matches(s, q));
  else if (state.project) { list = all.filter((s) => s.cwd === state.project); byActiveDays = true; }
  else {
    switch (state.view) {
      case "today": dayFilter = new Set([t]); byActiveDays = true; break;
      case "yesterday": dayFilter = new Set([shiftDay(t, -1)]); byActiveDays = true; break;
      case "week": dayFilter = new Set(Array.from({ length: 7 }, (_, i) => shiftDay(t, -i))); byActiveDays = true; break;
      case "pinned": list = all.filter((s) => s.meta?.pinned); break;
      case "followup": list = all.filter((s) => ["followup", "waiting"].includes(s.meta?.status)); break;
      case "done": list = all.filter((s) => s.meta?.status === "done"); break;
    }
  }

  const groups = new Map();
  const add = (k, s, n) => {
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ s, dayPrompts: n });
  };
  for (const s of list) {
    if (byActiveDays) {
      for (const [k, n] of Object.entries(s.days || {})) if (!dayFilter || dayFilter.has(k)) add(k, s, n);
    } else add(dayKey(s.lastAt), s, s.days?.[dayKey(s.lastAt)] || 0);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      key,
      items: items.sort((a, b) => (b.s.meta?.pinned ? 1 : 0) - (a.s.meta?.pinned ? 1 : 0) || b.s.lastAt - a.s.lastAt),
    }));
}

// ===== الرسم =====
function render() {
  renderNav();
  renderProjects();
  const groups = computeGroups();
  renderHeader(groups);
  renderList(groups);
}

function viewCount(id) {
  const t = today();
  const S = state.sessions;
  switch (id) {
    case "today": return S.filter((s) => s.days?.[t]).length;
    case "yesterday": return S.filter((s) => s.days?.[shiftDay(t, -1)]).length;
    case "week": { const ks = Array.from({ length: 7 }, (_, i) => shiftDay(t, -i)); return S.filter((s) => ks.some((k) => s.days?.[k])).length; }
    case "all": return S.length;
    case "pinned": return S.filter((s) => s.meta?.pinned).length;
    case "followup": return S.filter((s) => ["followup", "waiting"].includes(s.meta?.status)).length;
    case "done": return S.filter((s) => s.meta?.status === "done").length;
  }
  return 0;
}

function renderNav() {
  $("#nav").innerHTML = VIEWS.map((v) =>
    v.group
      ? `<div class="nav-group">${v.group}</div>`
      : `<button class="nav-item ${!state.project && !state.query && state.view === v.id ? "on" : ""}" data-view="${v.id}">
          <span class="nav-ico">${svg(v.icon)}</span><span>${v.label}</span><span class="count">${viewCount(v.id)}</span>
        </button>`
  ).join("");
}

function renderProjects() {
  const map = new Map();
  for (const s of state.sessions) {
    const p = map.get(s.cwd) || { cwd: s.cwd, name: s.project, n: 0, last: 0 };
    p.n++;
    p.last = Math.max(p.last, s.lastAt);
    map.set(s.cwd, p);
  }
  const projs = [...map.values()].sort((a, b) => b.last - a.last);
  $("#projCount").textContent = projs.length;
  const fresh = Date.now() - 86400000 * 2;
  $("#projects").innerHTML = projs.map((p) => `
    <button class="proj ${state.project === p.cwd ? "on" : ""} ${p.last > fresh ? "fresh" : ""}" data-proj="${esc(p.cwd)}" title="${esc(p.cwd)}">
      <span class="dot" style="background:${projColor(p.cwd)}"></span>
      <span class="proj-name">${esc(p.name)}</span>
      <span class="proj-when">${relTime(p.last)}</span>
    </button>`).join("");
}

function renderHeader(groups) {
  const h = new Date().getHours();
  $("#greet").textContent = `${h < 12 ? "صباح الخير" : "مساء الخير"} · ${fmtFull.format(new Date())}`;
  let title = VIEWS.find((v) => v.id === state.view)?.label || "";
  if (state.query) title = `نتائج البحث عن «${state.query}»`;
  else if (state.project) title = state.sessions.find((s) => s.cwd === state.project)?.project || "مشروع";
  $("#viewTitle").textContent = title;

  const items = groups.flatMap((g) => g.items);
  const uniq = new Map(items.map((i) => [i.s.id, i.s]));
  const prompts = items.reduce((a, i) => a + i.dayPrompts, 0);
  const projects = new Set([...uniq.values()].map((s) => s.cwd)).size;
  const follow = [...uniq.values()].filter((s) => ["followup", "waiting"].includes(s.meta?.status) || (!s.meta?.status && s.summary && s.summary.state !== "done")).length;
  $("#stats").innerHTML = [
    { n: uniq.size, l: "جلسة", cls: "hl" },
    { n: prompts, l: "طلب منك" },
    { n: projects, l: "مشروع" },
    { n: follow, l: "فيها عمل معلّق", cls: follow ? "warn" : "" },
  ].map((x) => `<div class="stat ${x.cls || ""}"><div class="stat-num">${x.n}</div><div class="stat-label">${x.l}</div></div>`).join("");

  const bar = $("#scanBar");
  bar.hidden = !state.scanning;
  if (state.scanning && state.progress?.total) bar.firstElementChild.style.width = `${Math.round((state.progress.done / state.progress.total) * 100)}%`;
}

function cardHTML({ s, dayPrompts }, dayK) {
  const st = statusOf(s);
  const sameDay = dayKey(s.lastAt) === dayK;
  const time = sameDay ? fmtTime.format(new Date(s.lastAt)) : `حتى ${fmtDate.format(new Date(s.lastAt))}`;
  const snippet = s.summary?.next
    ? `<span class="lbl">التالي:</span>${esc(s.summary.next)}`
    : s.summary?.gist
      ? esc(s.summary.gist)
      : `<span class="lbl">آخر طلب:</span>${esc(s.lastPrompt)}`;
  const pills = [];
  if (st) pills.push(`<span class="pill ${STATUS[st].cls}">${STATUS[st].label}</span>`);
  else if (s.summary) pills.push(`<span class="pill ai ${s.summary.state === "done" ? "done" : "follow"}" title="حسب الملخص الآلي">${AI_STATE[s.summary.state]}</span>`);
  pills.push(`<span class="pill">${dayPrompts} طلب${s.prompts !== dayPrompts ? ` · ${s.prompts} إجمالًا` : ""}</span>`);
  if (s.filesCount) pills.push(`<span class="pill">${s.filesCount} ملف معدّل</span>`);
  if (s.summarizing) pills.push(`<span class="pill"><span class="spinner"></span> يلخّص…</span>`);
  else if (s.summary?.stale) pills.push(`<span class="pill" title="الجلسة تغيّرت بعد التلخيص">ملخص قديم</span>`);
  if (s.meta?.note) pills.push(`<span class="pill" title="${esc(s.meta.note)}">📝 ملاحظة</span>`);

  return `
  <div class="card ${state.openId === s.id ? "sel" : ""}" data-id="${s.id}" tabindex="0" role="button">
    <div class="card-top">
      ${s.meta?.pinned ? `<span class="pin">${svg("pin", 14)}</span>` : ""}
      <span class="chip"><span class="dot" style="background:${projColor(s.cwd)}"></span>${esc(s.project)}</span>
      ${s.branch && s.branch !== "HEAD" ? `<span class="branch">${esc(s.branch)}</span>` : ""}
    </div>
    <div class="card-side"><span class="card-time">${time}</span></div>
    <div class="card-title">${esc(s.title)}</div>
    <div class="card-snippet">${snippet}</div>
    <div class="card-foot">
      ${pills.join("")}
      <span class="card-actions">
        <button class="btn sm" data-act="resume" data-id="${s.id}">استئناف ↗</button>
      </span>
    </div>
  </div>`;
}

function renderList(groups) {
  const el = $("#list");
  if (!groups.length) {
    const msg = state.scanning
      ? ["جارٍ قراءة الجلسات…", "أول تشغيل يحتاج ثواني قليلة."]
      : state.query
        ? ["لا نتائج", "جرّب كلمة أخرى."]
        : ["لا جلسات هنا", state.view === "today" ? "لم تبدأ أي جلسة اليوم بعد." : "غيّر العرض من القائمة الجانبية."];
    el.innerHTML = `<div class="empty"><b>${msg[0]}</b>${msg[1]}</div>`;
    return;
  }
  el.innerHTML = groups.map((g) => {
    const n = g.items.reduce((a, i) => a + i.dayPrompts, 0);
    return `<section class="day">
      <div class="day-head">
        <span class="day-name">${dayName(g.key)}</span>
        <span class="day-date">${fmtDate.format(keyToDate(g.key))}</span>
        <span class="day-meta">${g.items.length} جلسة · ${n} طلب</span>
      </div>
      <div class="cards">${g.items.map((i) => cardHTML(i, g.key)).join("")}</div>
    </section>`;
  }).join("");
}

// ===== لوحة التفاصيل =====
async function openDrawer(id) {
  state.openId = id;
  state.detail = null;
  state.tab = "turns";
  const d = $("#drawer");
  d.classList.add("open");
  d.setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
  document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
  document.querySelector(`.card[data-id="${id}"]`)?.classList.add("sel");
  renderDrawer();
  try {
    state.detail = await api(`/api/sessions/${id}`);
    if (state.openId === id) renderDrawer();
  } catch (e) {
    toast(e.message);
  }
}
function closeDrawer() {
  state.openId = null;
  const d = $("#drawer");
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
  document.querySelectorAll(".card.sel").forEach((c) => c.classList.remove("sel"));
}
const current = () => state.sessions.find((s) => s.id === state.openId);

function refreshDrawerHead() {
  const s = current();
  if (!s) return;
  const head = $("#dHead");
  const sum = $("#dSummary");
  if (head) head.outerHTML = drawerHead(s);
  if (sum) sum.outerHTML = summaryBox(s);
}

function drawerHead(s) {
  const st = s.meta?.status || "";
  const span = s.firstAt && s.lastAt ? `${fmtDate.format(new Date(s.firstAt))} ← ${fmtDate.format(new Date(s.lastAt))}، ${fmtTime.format(new Date(s.lastAt))}` : "";
  return `<div class="d-head" id="dHead">
    <div class="d-top">
      <span class="chip"><span class="dot" style="background:${projColor(s.cwd)}"></span>${esc(s.project)}</span>
      ${s.branch && s.branch !== "HEAD" ? `<span class="branch">${esc(s.branch)}</span>` : ""}
      <button class="icon-btn" data-act="close" aria-label="إغلاق">✕</button>
    </div>
    <h2 class="d-title">${esc(s.title)}</h2>
    <div class="d-meta">
      <span>${span}</span>
      <span>${s.prompts} طلب · ${s.replies} رد</span>
      ${s.compactions ? `<span>ضُغطت ${s.compactions} مرة</span>` : ""}
      <span class="mono" title="${esc(s.cwd)}">${esc(shortPath(s.cwd))}</span>
    </div>
    <div class="d-actions">
      <button class="btn primary sm" data-act="resume" data-id="${s.id}">استئناف في Terminal ↗</button>
      <button class="btn sm" data-act="copy" data-id="${s.id}">نسخ أمر الاستئناف</button>
      <button class="btn sm" data-act="pin" data-id="${s.id}">${s.meta?.pinned ? "إلغاء التثبيت" : "تثبيت"}</button>
    </div>
    <div class="d-actions">
      <div class="seg" role="radiogroup" aria-label="الحالة">
        ${[["", "بلا حالة"], ["followup", "تحتاج متابعة"], ["waiting", "بانتظار رد"], ["done", "مكتملة"]]
          .map(([v, l]) => `<button data-act="status" data-v="${v}" class="${st === v ? "on" : ""}" role="radio" aria-checked="${st === v}">${l}</button>`).join("")}
      </div>
    </div>
  </div>`;
}

function summaryBox(s) {
  const sum = s.summary;
  let body;
  if (s.summarizing) body = `<p class="muted"><span class="spinner"></span> Claude يقرأ الجلسة ويلخّصها…</p>`;
  else if (!sum) body = `<p class="muted" style="margin:0 0 10px">لا يوجد ملخص بعد. يقرأ Claude الجلسة ويستخرج ما أُنجز وما بقي معلّقًا والخطوة التالية.</p>
      ${s.summaryError ? `<p style="color:var(--danger);font-size:13px">آخر محاولة فشلت: ${esc(s.summaryError)}</p>` : ""}
      <button class="btn sm primary" data-act="summarize" data-id="${s.id}">لخّص الجلسة</button>`;
  else body = `
      ${sum.gist ? `<p class="gist">${esc(sum.gist)}</p>` : ""}
      <div class="sum-grid">
        ${sum.done.length ? `<div class="sum-sec done"><h4>أُنجز</h4><ul>${sum.done.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></div>` : ""}
        ${sum.pending.length ? `<div class="sum-sec pending"><h4>معلّق</h4><ul>${sum.pending.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></div>` : ""}
        ${sum.next ? `<div class="next"><b>الخطوة التالية</b>${inline(sum.next)}</div>` : ""}
      </div>
      ${sum.stale ? `<div class="stale-note">الجلسة تغيّرت بعد هذا الملخص.</div>` : ""}`;
  return `<div class="box" id="dSummary">
    <div class="box-title">✦ الملخص ${sum ? `<span class="muted">${relTime(sum.at)} · <button class="more" data-act="summarize" data-id="${s.id}">إعادة التلخيص</button></span>` : ""}</div>
    ${body}
  </div>`;
}

function turnsHTML(d) {
  if (!d.turns?.length) return `<p class="muted">لا توجد رسائل.</p>`;
  return `<div class="turns">${d.turns.map((t, i) => {
    const who = t.role === "user" ? "أنت" : "Claude";
    const long = t.role === "assistant" && t.text.length > 360;
    return `<div class="turn ${t.role} ${long ? "clamped" : ""}" data-i="${i}">
      <div class="turn-head"><b>${who}</b>${t.at ? `<span>${fmtDate.format(new Date(t.at))} ${fmtTime.format(new Date(t.at))}</span>` : ""}</div>
      <div class="turn-text">${inline(t.text)}</div>
      ${long ? `<button class="more" data-act="expand">عرض المزيد</button>` : ""}
    </div>`;
  }).join("")}</div>`;
}

function filesHTML(d) {
  if (!d.files?.length) return `<p class="muted">لم تُعدَّل ملفات في هذه الجلسة.</p>`;
  return `<div class="files">${d.files.map((f) => {
    const rel = d.cwd && f.startsWith(d.cwd + "/") ? f.slice(d.cwd.length + 1) : shortPath(f);
    const i = rel.lastIndexOf("/");
    return `<div class="file" title="${esc(f)}"><span class="dir">${esc(rel.slice(0, i + 1))}</span>${esc(rel.slice(i + 1))}</div>`;
  }).join("")}</div>`;
}

function renderDrawer() {
  const s = current();
  const d = $("#drawer");
  if (!s) { closeDrawer(); return; }
  const det = state.detail;
  d.innerHTML = `
    ${drawerHead(s)}
    <div class="d-body">
      ${summaryBox(s)}
      <div class="box">
        <div class="box-title">ملاحظاتك</div>
        <textarea class="note" id="note" placeholder="أفكار، قرارات، ما تريد تذكّره لاحقًا…">${esc(s.meta?.note || "")}</textarea>
      </div>
      <div>
        <div class="tabs">
          <button data-act="tab" data-v="turns" class="${state.tab === "turns" ? "on" : ""}">المحادثة</button>
          <button data-act="tab" data-v="files" class="${state.tab === "files" ? "on" : ""}">الملفات المعدّلة${det ? ` (${det.files.length})` : ""}</button>
        </div>
        <div style="padding-top:14px">
          ${!det ? `<p class="muted"><span class="spinner"></span> تحميل…</p>` : state.tab === "turns" ? turnsHTML(det) : filesHTML(det)}
        </div>
      </div>
    </div>`;
}

// ===== الإجراءات =====
async function setMeta(id, patch) {
  const s = state.sessions.find((x) => x.id === id);
  const m = await api(`/api/sessions/${id}/meta`, { method: "POST", body: patch });
  if (s) s.meta = m;
  render();
  if (state.openId === id) refreshDrawerHead();
}
async function summarizeOne(id) {
  const s = state.sessions.find((x) => x.id === id);
  await api(`/api/sessions/${id}/summarize`, { method: "POST" });
  if (s) { s.summarizing = "queued"; s.summaryError = null; }
  render();
  if (state.openId === id) refreshDrawerHead();
  clearTimeout(load.timer);
  load.timer = setTimeout(load, 2500);
}
async function resume(id) {
  try {
    await api(`/api/sessions/${id}/resume`, { method: "POST" });
    toast("فُتحت الجلسة في نافذة Terminal جديدة");
  } catch (e) {
    toast("تعذّر فتح Terminal: " + e.message);
  }
}

document.addEventListener("click", async (e) => {
  const act = e.target.closest("[data-act]");
  if (act) {
    e.stopPropagation();
    const id = act.dataset.id || state.openId;
    const s = state.sessions.find((x) => x.id === id);
    switch (act.dataset.act) {
      case "resume": return resume(id);
      case "copy": {
        const cmd = `cd '${s.cwd}' && claude --resume ${id}`;
        try { await navigator.clipboard.writeText(cmd); toast("نُسخ الأمر"); } catch { toast(cmd); }
        return;
      }
      case "pin": return setMeta(id, { pinned: !s.meta?.pinned });
      case "status": return setMeta(id, { status: act.dataset.v || null });
      case "summarize": return summarizeOne(id);
      case "close": return closeDrawer();
      case "tab": state.tab = act.dataset.v; return renderDrawer();
      case "expand": {
        const t = act.closest(".turn");
        t.classList.toggle("clamped");
        act.textContent = t.classList.contains("clamped") ? "عرض المزيد" : "عرض أقل";
        return;
      }
    }
  }
  const nav = e.target.closest("[data-view]");
  if (nav) {
    state.view = nav.dataset.view;
    state.project = null;
    state.query = "";
    $("#search").value = "";
    store.set("view", state.view);
    $("#main").scrollTop = 0;
    return render();
  }
  const proj = e.target.closest("[data-proj]");
  if (proj) {
    state.project = state.project === proj.dataset.proj ? null : proj.dataset.proj;
    state.query = "";
    $("#search").value = "";
    $("#main").scrollTop = 0;
    return render();
  }
  const card = e.target.closest(".card");
  if (card) return openDrawer(card.dataset.id);
});

$("#scrim").addEventListener("click", closeDrawer);

let noteTimer;
document.addEventListener("input", (e) => {
  if (e.target.id === "note") {
    const id = state.openId;
    const v = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      const s = state.sessions.find((x) => x.id === id);
      const m = await api(`/api/sessions/${id}/meta`, { method: "POST", body: { note: v } });
      if (s) s.meta = m;
      renderList(computeGroups());
    }, 600);
  }
  if (e.target.id === "search") {
    state.query = e.target.value;
    render();
  }
});

$("#refreshBtn").addEventListener("click", async () => {
  const b = $("#refreshBtn");
  b.disabled = true;
  try { await api("/api/rescan", { method: "POST" }); await load(); toast("تم التحديث"); }
  finally { b.disabled = false; }
});

$("#sumAllBtn").addEventListener("click", async () => {
  const ids = [...new Set(computeGroups().flatMap((g) => g.items.map((i) => i.s)))]
    .filter((s) => !s.summarizing && (!s.summary || s.summary.stale))
    .slice(0, 20)
    .map((s) => s.id);
  if (!ids.length) return toast("كل الجلسات المعروضة ملخّصة");
  await api("/api/summarize-batch", { method: "POST", body: { ids } });
  toast(`بدأ تلخيص ${ids.length} جلسة`);
  load();
});

// تبديل الوضع
const root = document.documentElement;
root.dataset.theme = store.get("theme", "dark");
$("#themeBtn").addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  store.set("theme", root.dataset.theme);
});

// لوحة المفاتيح: / للبحث، j/k للتنقل، Enter للفتح، Esc للإغلاق
document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (e.key === "Escape") {
    if (state.openId) return closeDrawer();
    if (typing) document.activeElement.blur();
    return;
  }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); $("#search").focus(); return; }
  const cards = [...document.querySelectorAll(".card")];
  if (e.key === "j" || e.key === "k") {
    state.selIndex = Math.max(0, Math.min(cards.length - 1, state.selIndex + (e.key === "j" ? 1 : -1)));
    cards[state.selIndex]?.focus();
    cards[state.selIndex]?.scrollIntoView({ block: "nearest" });
  }
  if (e.key === "Enter" && document.activeElement?.classList.contains("card")) openDrawer(document.activeElement.dataset.id);
});

load();
