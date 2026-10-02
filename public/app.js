// Dawra — الواجهة. صفحات: اليوم، الجلسات، مساحة العمل (ترمينالات واسأل دورة).

import { t, setLang, getLang } from "./i18n.js";
import { TermManager } from "./term.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ===== حالة التطبيق =====
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem("dawra." + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("dawra." + k, JSON.stringify(v)); } catch {} },
};
const state = {
  sessions: [],
  terminals: [],
  settings: { lang: "ar", theme: "dark" },
  health: null,
  scanning: false,
  progress: null,
  queue: { active: 0, waiting: 0 },
  route: { view: "today", tid: null },
  filters: { range: "today", agent: "all", org: null, project: null, q: "", ...store.get("filters", {}) },
  hits: null, // نتائج البحث في المحتوى: Map id -> hits
  searching: false,
  openId: null,
  detail: null,
  tab: "turns",
  standupDay: null,
  standup: null,
  standupBusy: false,
};
state.filters.q = "";
const byId = (id) => state.sessions.find((s) => s.id === id);

// ===== تنسيق =====
let fmt = {};
function makeFormatters() {
  const L = getLang() === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-GB";
  fmt = {
    weekday: new Intl.DateTimeFormat(L, { weekday: "long" }),
    date: new Intl.DateTimeFormat(L, { day: "numeric", month: "long" }),
    full: new Intl.DateTimeFormat(L, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: new Intl.DateTimeFormat(L, { hour: "2-digit", minute: "2-digit", hour12: false }),
    rel: new Intl.RelativeTimeFormat(L, { numeric: "auto", style: "short" }),
  };
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inline = (s) => esc(s).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
function dayKey(ts) { const d = new Date(ts); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
const keyDate = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const shift = (k, n) => { const d = keyDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
const today = () => dayKey(Date.now());
function dayName(k) {
  if (k === today()) return t("range.today");
  if (k === shift(today(), -1)) return t("range.yesterday");
  return fmt.weekday.format(keyDate(k));
}
function rel(ts) {
  const s = (ts - Date.now()) / 1000, a = Math.abs(s);
  if (a < 60) return t("rel.now");
  if (a < 3600) return fmt.rel.format(Math.round(s / 60), "minute");
  if (a < 86400) return fmt.rel.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return fmt.rel.format(Math.round(s / 86400), "day");
  return fmt.date.format(new Date(ts));
}
function hue(str) { let h = 0; for (const c of str || "") h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const color = (cwd) => `hsl(${hue(cwd)} 68% 62%)`;
const shortPath = (p) => (p || "").replace(/^\/Users\/[^/]+/, "~");
const projectChip = (s) => `<span class="chip"><span class="dot" style="background:${color(s.cwd)}"></span>${esc(s.project)}</span>`;
const agentTag = (src) => (src === "codex" ? `<span class="agent-tag codex">codex</span>` : "");

const ICON = {
  sun: '<path fill="currentColor" d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10ZM11 1h2v3h-2V1Zm0 19h2v3h-2v-3ZM1 11h3v2H1v-2Zm19 0h3v2h-3v-2ZM4.2 2.8l2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4Zm14.9 14.9 2.1 2.1-1.4 1.4-2.1-2.1 1.4-1.4ZM2.8 19.8l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4ZM17.7 4.9l2.1-2.1 1.4 1.4-2.1 2.1-1.4-1.4Z"/>',
  list: '<path fill="currentColor" d="M8 5h13v2H8V5Zm0 6h13v2H8v-2Zm0 6h13v2H8v-2ZM3 4.5h3v3H3v-3Zm0 6h3v3H3v-3Zm0 6h3v3H3v-3Z"/>',
  ask: '<path fill="currentColor" d="M12 2a10 10 0 1 1-4.6 18.9L2 22l1.2-5.1A10 10 0 0 1 12 2Zm0 2a8 8 0 0 0-6.9 12l.3.5-.7 2.8 2.9-.7.5.3A8 8 0 1 0 12 4Zm-1 11h2v2h-2v-2Zm1-8a3.5 3.5 0 0 1 1.9 6.4c-.6.4-.9.8-.9 1.1V14h-2v-.6c0-1.1.6-2 1.6-2.7A1.5 1.5 0 1 0 10.5 9.5h-2A3.5 3.5 0 0 1 12 7Z"/>',
  pin: '<path fill="currentColor" d="m12 17.3-6.2 3.7 1.7-7L2 9.2l7.1-.6L12 2l2.9 6.6 7.1.6-5.5 4.8 1.7 7z"/>',
  flag: '<path fill="currentColor" d="M5 2h2v1h12l-2.5 5L19 13H7v9H5V2Z"/>',
  check: '<path fill="currentColor" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm-1.2 13.6 6.4-6.4-1.4-1.4-5 5-2.6-2.6-1.4 1.4 4 4Z"/>',
  term: '<path fill="currentColor" d="M3 4h18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v12h16V6H4Zm2.3 2.3L9.9 12l-3.6 3.7-1.4-1.4L7 12 4.9 9.7l1.4-1.4ZM11 15h6v2h-6v-2Z"/>',
  spark: '<path fill="currentColor" d="M11 2h2l1.2 4.8L19 8v2l-4.8 1.2L13 16h-2l-1.2-4.8L5 10V8l4.8-1.2L11 2Zm7 12h1.5l.6 2.4 2.4.6v1.5l-2.4.6-.6 2.4H18l-.6-2.4-2.4-.6V17l2.4-.6.6-2.4Z"/>',
  refresh: '<path fill="currentColor" d="M12 4a8 8 0 0 1 7.75 6H17.7A6 6 0 1 0 18 14h2.07A8 8 0 1 1 12 4Zm7-1v6h-6l2.24-2.24L19 3Z"/>',
};
const svg = (n, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">${ICON[n]}</svg>`;

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2600);
}
async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ===== البيانات =====
let loadTimer;
async function load() {
  try {
    const d = await api("/api/sessions");
    state.sessions = d.sessions;
    state.terminals = d.terminals;
    state.scanning = d.scanning;
    state.progress = d.progress;
    state.queue = d.queue;
    terms.sync(new Set(d.terminals.map((x) => x.tid)));
    renderAll();
  } catch (e) {
    console.error(e);
  }
  const busy = state.scanning || state.queue.active || state.queue.waiting || state.sessions.some((s) => s.summarizing);
  clearTimeout(loadTimer);
  loadTimer = setTimeout(load, busy ? 2500 : 15000);
}
function soon() { clearTimeout(loadTimer); loadTimer = setTimeout(load, 1200); }

// ===== التوجيه =====
function parseHash() {
  const h = location.hash.slice(1);
  if (h.startsWith("work/")) return { view: "work", tid: h.slice(5) };
  if (h === "ask") return { view: "ask" };
  if (h === "sessions") return { view: "sessions" };
  return { view: "today" };
}
function go(hash) {
  if (location.hash === "#" + hash) onRoute();
  else location.hash = hash;
}
function onRoute() {
  state.route = parseHash();
  renderAll();
}
window.addEventListener("hashchange", onRoute);

// ===== الفلترة =====
const isFollow = (s) => ["followup", "waiting"].includes(s.meta?.status);
function inRange(s, range) {
  const tk = today();
  if (range === "today") return !!s.days?.[tk];
  if (range === "yesterday") return !!s.days?.[shift(tk, -1)];
  if (range === "week") { for (let i = 0; i < 7; i++) if (s.days?.[shift(tk, -i)]) return true; return false; }
  return true;
}
function rangeDays(range) {
  const tk = today();
  if (range === "today") return new Set([tk]);
  if (range === "yesterday") return new Set([shift(tk, -1)]);
  if (range === "week") return new Set(Array.from({ length: 7 }, (_, i) => shift(tk, -i)));
  return null;
}
function filtered() {
  const f = state.filters;
  let list = state.sessions;
  if (f.agent !== "all") list = list.filter((s) => s.source === f.agent);
  if (f.q && state.hits) return list.filter((s) => state.hits.has(s.id) || matchMeta(s, f.q));
  if (f.q) return list.filter((s) => matchMeta(s, f.q));
  if (f.project) return list.filter((s) => s.cwd === f.project);
  if (f.org === "pinned") return list.filter((s) => s.meta?.pinned);
  if (f.org === "followup") return list.filter(isFollow);
  if (f.org === "done") return list.filter((s) => s.meta?.status === "done");
  return list.filter((s) => inRange(s, f.range));
}
function matchMeta(s, q) {
  const hay = [s.title, s.project, s.cwd, s.branch, s.firstPrompt, s.lastPrompt, s.meta?.note, s.summary?.gist, ...(s.summary?.done || []), ...(s.summary?.pending || [])].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}
/** يجمع الجلسات حسب الأيام. الجلسة الممتدة تظهر في كل يوم نشطت فيه إذا كان العرض بالفترة */
function groupByDay(list, byActiveDays, days) {
  const groups = new Map();
  const add = (k, s, n) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ s, n }); };
  for (const s of list) {
    if (byActiveDays) { for (const [k, n] of Object.entries(s.days || {})) if (!days || days.has(k)) add(k, s, n); }
    else { const k = dayKey(s.lastAt); add(k, s, s.days?.[k] || 0); }
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, items]) => ({
    key,
    items: items.sort((a, b) => (b.s.meta?.pinned ? 1 : 0) - (a.s.meta?.pinned ? 1 : 0) || b.s.lastAt - a.s.lastAt),
  }));
}

// ===== الرسم =====
function renderAll() {
  renderSidebar();
  const v = state.route.view;
  $$(".view").forEach((el) => el.classList.remove("on"));
  if (v === "today") { $("#view-today").classList.add("on"); renderToday(); }
  else if (v === "sessions") { $("#view-sessions").classList.add("on"); renderSessions(); }
  else { $("#view-work").classList.add("on"); renderWork(); }
  if (state.openId) refreshDrawer();
  const q = state.queue.active + state.queue.waiting;
  $("#queueInd").hidden = !q;
  $("#queueInd span:last-child").textContent = q ? `${q}` : "";
  $("#queueInd").title = t("card.summarizing");
}

function renderSidebar() {
  const r = state.route.view;
  const tk = today();
  const todayCount = state.sessions.filter((s) => s.days?.[tk]).length;
  $("#mainNav").innerHTML = [
    ["today", "sun", t("nav.today"), todayCount, r === "today"],
    ["sessions", "list", t("nav.sessions"), state.sessions.length, r === "sessions" && !state.filters.org && !state.filters.project],
    ["ask", "ask", t("nav.ask"), "", r === "ask" || (r === "work" && state.terminals.find((x) => x.tid === state.route.tid)?.kind === "hub")],
  ].map(([h, ic, label, n, on]) => `<button class="nav-item ${on ? "on" : ""}" data-go="${h}"><span class="nav-ico">${svg(ic)}</span><span>${label}</span>${n !== "" ? `<span class="count">${n}</span>` : ""}</button>`).join("");

  const f = state.filters;
  $("#orgNav").innerHTML = [
    ["pinned", "pin", t("nav.pinned"), state.sessions.filter((s) => s.meta?.pinned).length],
    ["followup", "flag", t("nav.followup"), state.sessions.filter(isFollow).length],
    ["done", "check", t("nav.done"), state.sessions.filter((s) => s.meta?.status === "done").length],
  ].map(([k, ic, label, n]) => `<button class="nav-item ${r === "sessions" && f.org === k ? "on" : ""}" data-org="${k}"><span class="nav-ico">${svg(ic)}</span><span>${label}</span><span class="count">${n}</span></button>`).join("");

  const open = state.terminals.filter((x) => x.kind !== "hub");
  $("#openCount").textContent = open.length || "";
  $("#openList").innerHTML = open.length
    ? open.map((x) => `<button class="open-item ${r === "work" && state.route.tid === x.tid ? "on" : ""}" data-go="work/${x.tid}" title="${esc(x.cwd)}"><span class="live-dot ${x.alive ? "" : "off"}"></span><span class="t">${esc(x.title || x.cwd)}</span></button>`).join("")
    : `<div class="side-empty">${t("nav.noOpen")}</div>`;

  const map = new Map();
  for (const s of state.sessions) {
    const p = map.get(s.cwd) || { cwd: s.cwd, name: s.project, n: 0, last: 0 };
    p.n++; p.last = Math.max(p.last, s.lastAt); map.set(s.cwd, p);
  }
  const projs = [...map.values()].sort((a, b) => b.last - a.last);
  $("#projCount").textContent = projs.length;
  const fresh = Date.now() - 2 * 86400000;
  $("#projects").innerHTML = projs.map((p) => `<button class="proj ${r === "sessions" && f.project === p.cwd ? "on" : ""} ${p.last > fresh ? "fresh" : ""}" data-proj="${esc(p.cwd)}" title="${esc(p.cwd)}"><span class="dot" style="background:${color(p.cwd)}"></span><span class="proj-name">${esc(p.name)}</span><span class="proj-when">${rel(p.last)}</span></button>`).join("");
}

function statsHTML(items) {
  const uniq = new Map(items.map((i) => [i.s.id, i.s]));
  const prompts = items.reduce((a, i) => a + i.n, 0);
  const projects = new Set([...uniq.values()].map((s) => s.cwd)).size;
  const pending = [...uniq.values()].filter((s) => isFollow(s) || (!s.meta?.status && s.summary && s.summary.state !== "done")).length;
  return `<section class="stats">${[
    [uniq.size, t("stat.sessions"), "hl"], [prompts, t("stat.prompts"), ""], [projects, t("stat.projects"), ""], [pending, t("stat.pending"), pending ? "warn" : ""],
  ].map(([n, l, c]) => `<div class="stat ${c}"><div class="stat-num">${n}</div><div class="stat-label">${l}</div></div>`).join("")}</section>
  <div class="scan-bar" ${state.scanning ? "" : "hidden"}><span style="width:${state.progress?.total ? Math.round((state.progress.done / state.progress.total) * 100) : 5}%"></span></div>`;
}

function cardHTML({ s, n }, dk) {
  const same = dayKey(s.lastAt) === dk;
  const time = same ? fmt.time.format(new Date(s.lastAt)) : t("card.until", { d: fmt.date.format(new Date(s.lastAt)) });
  const snippet = s.summary?.next ? `<span class="lbl">${t("card.next")}</span>${esc(s.summary.next)}` : s.summary?.gist ? esc(s.summary.gist) : `<span class="lbl">${t("card.last")}</span>${esc(s.lastPrompt)}`;
  const pills = [];
  if (s.live === "open") pills.push(`<span class="pill live"><span class="live-dot"></span>${t("card.live")}</span>`);
  else if (s.live === "recent") pills.push(`<span class="pill live">${t("card.recent")}</span>`);
  const st = s.meta?.status;
  if (st) pills.push(`<span class="pill ${{ followup: "follow", waiting: "wait", done: "done" }[st]}">${t("status." + st)}</span>`);
  else if (s.summary) pills.push(`<span class="pill ai ${s.summary.state === "done" ? "done" : "follow"}">${t("ai." + s.summary.state)}</span>`);
  pills.push(`<span class="pill">${t("list.promptsN", { n })}${s.prompts !== n ? ` · ${t("card.total", { n: s.prompts })}` : ""}</span>`);
  if (s.filesCount) pills.push(`<span class="pill">${t("card.files", { n: s.filesCount })}</span>`);
  if (s.summarizing) pills.push(`<span class="pill"><span class="spinner"></span>${t("card.summarizing")}</span>`);
  else if (s.summary?.stale) pills.push(`<span class="pill">${t("card.stale")}</span>`);
  if (s.meta?.note) pills.push(`<span class="pill" title="${esc(s.meta.note)}">📝 ${t("card.note")}</span>`);
  const hits = state.filters.q && state.hits?.get(s.id);
  return `<div class="card ${state.openId === s.id ? "sel" : ""}" data-id="${s.id}" tabindex="0" role="button">
    <div class="card-top">${s.meta?.pinned ? `<span class="pin">${svg("pin", 13)}</span>` : ""}${projectChip(s)}${agentTag(s.source)}${s.branch ? `<span class="branch">${esc(s.branch)}</span>` : ""}</div>
    <div class="card-side"><span class="card-time">${time}</span></div>
    <div class="card-title" dir="auto">${esc(s.title)}</div>
    <div class="card-snippet" dir="auto">${snippet}</div>
    ${hits ? `<div class="hits">${hits.map((h) => `<div class="hit" dir="auto"><span class="who">${h.role === "user" ? t("d.you") : "AI"}</span>${esc(h.before)}<mark>${esc(h.match)}</mark>${esc(h.after)}</div>`).join("")}</div>` : ""}
    <div class="card-foot">${pills.join("")}<span class="card-actions"><button class="btn sm" data-act="open" data-id="${s.id}">${svg("term", 14)} ${t("card.open")}</button></span></div>
  </div>`;
}

function listHTML(groups) {
  return groups.map((g) => `<section class="day">
    <div class="day-head"><span class="day-name">${dayName(g.key)}</span><span class="day-date">${fmt.date.format(keyDate(g.key))}</span>
    <span class="day-meta">${t("list.sessionsN", { n: g.items.length })} · ${t("list.promptsN", { n: g.items.reduce((a, i) => a + i.n, 0) })}</span></div>
    <div class="cards">${g.items.map((i) => cardHTML(i, g.key)).join("")}</div></section>`).join("");
}

function heroHTML(title, actions = "") {
  const h = new Date().getHours();
  return `<header class="hero"><div><div class="greet">${h < 12 ? t("greet.morning") : t("greet.evening")} · ${fmt.full.format(new Date())}</div><h1>${title}</h1></div>
  <div class="hero-actions"><button class="btn ghost" data-act="refresh">${svg("refresh")} ${t("btn.refresh")}</button>${actions}</div></header>`;
}

// ----- اليوم -----
function renderToday() {
  const tk = today();
  const items = state.sessions.filter((s) => s.days?.[tk]).map((s) => ({ s, n: s.days[tk] }));
  const groups = groupByDay(items.map((i) => i.s), true, new Set([tk]));
  const follow = state.sessions.filter(isFollow).sort((a, b) => b.lastAt - a.lastAt).slice(0, 6);
  const cont = state.sessions
    .filter((s) => !s.days?.[tk] && s.meta?.status !== "done" && (s.summary ? s.summary.state !== "done" : true))
    .sort((a, b) => b.lastAt - a.lastAt).slice(0, 5);
  const mini = (s) => `<div class="mini" data-id="${s.id}"><span class="dot" style="background:${color(s.cwd)}"></span><div class="mt"><b dir="auto">${esc(s.title)}</b><span dir="auto">${esc(s.project)} · ${rel(s.lastAt)}${s.summary?.next ? " · " + esc(s.summary.next) : ""}</span></div><button class="btn sm" data-act="open" data-id="${s.id}">${t("card.open")}</button></div>`;

  $("#view-today").innerHTML = `
    ${heroHTML(t("nav.today"), `<button class="btn primary" data-act="sumShown" data-scope="today">${svg("spark")} ${t("btn.summarizeShown")}</button>`)}
    ${statsHTML(items)}
    <div class="today-grid">
      <div>${standupHTML()}</div>
      <div class="side-col">
        ${follow.length ? `<div class="box"><div class="box-title">${svg("flag")} ${t("today.followups")}</div>${follow.map(mini).join("")}</div>` : ""}
        <div class="box"><div class="box-title">${svg("term")} ${t("today.continue")}</div>${cont.length ? cont.map(mini).join("") : `<div class="inline-empty">—</div>`}</div>
      </div>
    </div>
    <h2 style="font-size:17px;margin:28px 0 4px">${t("today.sessions")}</h2>
    ${groups.length ? listHTML(groups) : `<div class="inline-empty">${state.scanning ? t("list.scanning") : t("today.noSessions")}</div>`}`;
  if (!state.standup && !state.standupBusy) loadStandup();
}

function standupHTML() {
  const day = state.standupDay || today();
  const su = state.standup;
  const isToday = day === today();
  let body;
  if (state.standupBusy) body = `<p class="muted"><span class="spinner"></span> ${t("standup.working")}</p>`;
  else if (su?.empty) body = `<div class="inline-empty">${t("standup.empty")}</div>`;
  else if (su && !su.none) body = `
      ${su.headline ? `<p class="headline" dir="auto">${inline(su.headline)}</p>` : ""}
      <div class="su-cols">
        ${su.done?.length ? `<div class="su-sec done"><h4>${t("standup.done")}</h4><ul dir="auto">${su.done.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></div>` : ""}
        ${su.pending?.length ? `<div class="su-sec pending"><h4>${t("standup.pending")}</h4><ul dir="auto">${su.pending.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></div>` : ""}
        ${su.focus?.length ? `<div class="su-sec focus"><h4>${t("standup.focus")}</h4><ol dir="auto">${su.focus.map((x) => `<li>${inline(x)}</li>`).join("")}</ol></div>` : ""}
      </div>`;
  else body = `<p class="muted" style="margin:0 0 12px">${t("standup.hint")}</p><button class="btn primary sm" data-act="standup">${svg("spark", 14)} ${t("standup.generate")}</button>`;
  const title = isToday ? t("standup.title") : `${t("standup.title")} · ${dayName(day)} ${fmt.date.format(keyDate(day))}`;
  return `<div class="box standup"><div class="box-title">${svg("spark")} ${title}
    <span class="end">
      ${su && !su.none && !su.empty && !state.standupBusy ? `<button class="link" data-act="standupCopy">${t("standup.copy")}</button> · <button class="link" data-act="standup" data-force="1">${t("standup.regen")}</button>` : ""}
      <span class="day-nav"><button data-act="suDay" data-d="-1" title="${t("standup.prevDay")}">${getLang() === "ar" ? "›" : "‹"}</button><button data-act="suDay" data-d="1" ${isToday ? "disabled" : ""} title="${t("standup.nextDay")}">${getLang() === "ar" ? "‹" : "›"}</button></span>
    </span></div>${body}</div>`;
}
async function loadStandup() {
  const day = state.standupDay || today();
  try {
    state.standup = await api(`/api/standup?day=${day}`);
    if (state.route.view === "today") renderToday();
  } catch {}
}
async function genStandup(force) {
  state.standupBusy = true;
  renderToday();
  try { state.standup = await api("/api/standup", { method: "POST", body: { day: state.standupDay || today(), force } }); }
  catch (e) { toast(e.message); }
  state.standupBusy = false;
  renderToday();
}
function standupText() {
  const su = state.standup; if (!su) return "";
  const day = state.standupDay || today();
  return [`${t("standup.title")} — ${fmt.full.format(keyDate(day))}`, su.headline, "", `${t("standup.done")}:`, ...(su.done || []).map((x) => `- ${x}`), "", `${t("standup.pending")}:`, ...(su.pending || []).map((x) => `- ${x}`), "", `${t("standup.focus")}:`, ...(su.focus || []).map((x, i) => `${i + 1}. ${x}`)].join("\n");
}

// ----- الجلسات -----
function renderSessions() {
  const f = state.filters;
  const list = filtered();
  const byActive = !f.q && !f.org && (f.project || f.range !== "all");
  const groups = groupByDay(list, byActive, f.project || f.q || f.org ? null : rangeDays(f.range));
  let title = t("nav.sessions");
  if (f.q) title = `«${esc(f.q)}»`;
  else if (f.project) title = esc(state.sessions.find((s) => s.cwd === f.project)?.project || "");
  else if (f.org) title = t("nav." + f.org);
  const hasCodex = state.sessions.some((s) => s.source === "codex");

  const view = $("#view-sessions");
  const hadFocus = document.activeElement?.id === "q";
  const caret = hadFocus ? document.activeElement.selectionStart : null;
  view.innerHTML = `
    ${heroHTML(title, `${f.project ? `<button class="btn" data-act="newIn" data-cwd="${esc(f.project)}">${svg("term")} ${t("d.newHere")}</button>` : ""}<button class="btn primary" data-act="sumShown">${svg("spark")} ${t("btn.summarizeShown")}</button>`)}
    <div class="filters">
      <label class="search-in">${svg("list", 15)}<input id="q" type="search" value="${esc(f.q)}" placeholder="${t("pal.ph")}" dir="auto" autocomplete="off" />${state.searching ? `<span class="spinner"></span>` : ""}</label>
      ${!f.q && !f.org && !f.project ? `<div class="seg">${["today", "yesterday", "week", "all"].map((r) => `<button data-range="${r}" class="${f.range === r ? "on" : ""}">${t("range." + r)}</button>`).join("")}</div>` : `<button class="btn sm ghost" data-act="clearFilter">✕</button>`}
      ${hasCodex ? `<div class="seg">${[["all", t("agent.all")], ["claude", "Claude"], ["codex", "Codex"]].map(([k, l]) => `<button data-agent="${k}" class="${f.agent === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    </div>
    ${statsHTML(groups.flatMap((g) => g.items))}
    ${groups.length ? listHTML(groups) : `<div class="empty"><b>${state.scanning ? t("list.scanning") : f.q ? (state.searching ? t("list.searching") : t("list.noResults")) : t("list.empty")}</b>${state.scanning ? t("list.scanningHint") : t("list.emptyHint")}</div>`}`;
  if (hadFocus) { const q = $("#q"); q.focus(); q.setSelectionRange(caret, caret); }
}

let searchTimer, searchSeq = 0;
function onSearch(q) {
  state.filters.q = q;
  state.hits = null;
  clearTimeout(searchTimer);
  renderSessions();
  if (q.trim().length < 2) return;
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    state.searching = true; renderSessions();
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q.trim())}`);
      if (seq !== searchSeq) return;
      state.hits = new Map(r.results.map((x) => [x.id, x.hits]));
    } catch {}
    state.searching = false;
    if (state.route.view === "sessions") renderSessions();
  }, 350);
}

// ----- مساحة العمل -----
const terms = new TermManager($("#termStage"));
function renderWork() {
  const r = state.route;
  const hub = state.terminals.find((x) => x.kind === "hub");
  let tid = r.view === "ask" ? hub?.tid : r.tid;
  const cur = state.terminals.find((x) => x.tid === tid);
  if (r.view === "work" && !cur) {
    // ترمينال غير موجود (أُغلق مثلًا): نعرض أحدث مفتوح أو نعود لليوم
    const any = state.terminals[state.terminals.length - 1];
    if (any) return go("work/" + any.tid);
    return go("today");
  }
  const tabs = [...state.terminals].sort((a, b) => (a.kind === "hub" ? -1 : b.kind === "hub" ? 1 : a.createdAt - b.createdAt));
  const isAsk = r.view === "ask" || cur?.kind === "hub";
  $("#workTabs").innerHTML = tabs.map((x) => `<button class="wtab ${x.tid === tid ? "on" : ""}" data-go="work/${x.tid}" title="${esc(x.cwd)}">
      ${x.kind === "hub" ? svg("ask", 14) : `<span class="live-dot ${x.alive ? "" : "off"}"></span>`}
      <span class="t">${x.kind === "hub" ? t("nav.ask") : esc(x.title || x.cwd)}</span>
      <span class="x" data-act="closeTerm" data-tid="${x.tid}" title="${t("term.close")}">✕</span></button>`).join("") +
    `<div class="wtab-tools">${cur?.sessionId ? `<button class="btn sm ghost" data-act="details" data-id="${cur.sessionId}">${t("term.details")}</button>` : ""}<span class="muted" style="font-size:12px">${t("term.hint")}</span></div>`;

  const intro = $("#askIntro");
  if (isAsk && !cur) {
    intro.hidden = false;
    $("#termStage").hidden = true;
    $("#composer").hidden = true;
    intro.innerHTML = `<div class="ask-card"><div class="brand-mark"></div><h2>${t("ask.title")}</h2><p>${t("ask.desc")}</p>
      <button class="btn primary" data-act="startHub">${svg("ask")} ${t("ask.start")}</button>
      <div class="chips">${askChips()}</div></div>`;
    return;
  }
  intro.hidden = true;
  $("#termStage").hidden = false;
  $("#composer").hidden = false;
  $("#askChips").innerHTML = isAsk ? askChips() : "";
  $("#composerInput").placeholder = t("term.composerPh");
  if (terms.active?.tid !== tid) terms.show(tid);
  else terms.fitActive();
}
const askChips = () => ["ask.s1", "ask.s2", "ask.s3", "ask.s4"].map((k) => `<button type="button" data-act="askChip" data-k="${k}">${esc(t(k))}</button>`).join("");

async function openTerminal(body) {
  try {
    const { tid } = await api("/api/terminals", { method: "POST", body });
    const d = await api("/api/sessions");
    state.terminals = d.terminals;
    state.sessions = d.sessions;
    closeDrawer();
    go("work/" + tid);
    return tid;
  } catch (e) { toast(e.message); }
}
async function startHub(text) {
  const tid = await openTerminal({ hub: true });
  // ننتظر قليلًا حتى يجهز claude قبل إرسال السؤال
  if (tid && text) setTimeout(() => terms.paste(tid, text, !text.endsWith(": ")), 2500);
}

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const ta = $("#composerInput");
  const text = ta.value.trim();
  if (!text || !terms.active) return;
  terms.paste(terms.active.tid, text);
  ta.value = "";
  ta.style.height = "";
});
$("#composerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); }
});
$("#composerInput").addEventListener("input", (e) => { e.target.style.height = ""; e.target.style.height = Math.min(160, e.target.scrollHeight) + "px"; });

// ===== لوحة التفاصيل =====
async function openDrawer(id) {
  state.openId = id; state.detail = null; state.tab = "turns";
  $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false"); $("#scrim").hidden = false;
  $$(".card.sel").forEach((c) => c.classList.remove("sel"));
  $(`.card[data-id="${id}"]`)?.classList.add("sel");
  renderDrawer();
  try { state.detail = await api(`/api/sessions/${id}`); if (state.openId === id) renderDrawer(); } catch (e) { toast(e.message); }
}
function closeDrawer() {
  state.openId = null;
  $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); $("#scrim").hidden = true;
  $$(".card.sel").forEach((c) => c.classList.remove("sel"));
}
function refreshDrawer() {
  const s = byId(state.openId); if (!s) return;
  const h = $("#dHead"), sm = $("#dSummary");
  if (h) h.outerHTML = drawerHead(s);
  if (sm) sm.outerHTML = summaryBox(s);
}
function drawerHead(s) {
  const st = s.meta?.status || "";
  return `<div class="d-head" id="dHead">
    <div class="d-top">${projectChip(s)}${agentTag(s.source)}${s.branch ? `<span class="branch">${esc(s.branch)}</span>` : ""}<button class="icon-btn" data-act="closeDrawer">✕</button></div>
    <h2 class="d-title" dir="auto">${esc(s.title)}</h2>
    <div class="d-meta"><span>${fmt.date.format(new Date(s.firstAt))} → ${fmt.date.format(new Date(s.lastAt))} ${fmt.time.format(new Date(s.lastAt))}</span>
      <span>${t("list.promptsN", { n: s.prompts })}</span>${s.compactions ? `<span>${t("d.compacted", { n: s.compactions })}</span>` : ""}
      <span class="mono" title="${esc(s.cwd)}">${esc(shortPath(s.cwd))}</span></div>
    <div class="d-actions">
      <button class="btn primary sm" data-act="open" data-id="${s.id}">${svg("term", 14)} ${s.live === "open" ? t("card.live") : t("d.resume")}</button>
      <button class="btn sm" data-act="external" data-id="${s.id}">${t("d.external")} ↗</button>
      <button class="btn sm" data-act="share" data-id="${s.id}">${t("d.share")}</button>
      <button class="btn sm" data-act="pin" data-id="${s.id}">${s.meta?.pinned ? t("d.unpin") : t("d.pin")}</button>
      <button class="btn sm ghost" data-act="rename" data-id="${s.id}">${t("d.rename")}</button>
      <button class="btn sm ghost" data-act="copyCmd" data-id="${s.id}">${t("d.copy")}</button>
    </div>
    <div class="d-actions"><div class="seg" role="radiogroup">${[["", "none"], ["followup", "followup"], ["waiting", "waiting"], ["done", "done"]].map(([v, k]) => `<button data-act="status" data-v="${v}" class="${st === v ? "on" : ""}" role="radio" aria-checked="${st === v}">${t("status." + k)}</button>`).join("")}</div></div>
  </div>`;
}
function summaryBox(s) {
  const sum = s.summary;
  let body;
  if (s.summarizing) body = `<p class="muted"><span class="spinner"></span> ${t("d.summarizing")}</p>`;
  else if (!sum) body = `<p class="muted" style="margin:0 0 10px">${t("d.noSummary")}</p>${s.summaryError ? `<p style="color:var(--danger);font-size:13px">${t("d.failed")} ${esc(s.summaryError)}</p>` : ""}<button class="btn sm primary" data-act="summarize" data-id="${s.id}">${svg("spark", 14)} ${t("d.summarize")}</button>`;
  else body = `${sum.gist ? `<p class="gist" dir="auto">${inline(sum.gist)}</p>` : ""}<div class="sum-grid">
      ${sum.done.length ? `<div class="sum-sec done"><h4>${t("d.doneH")}</h4><ul dir="auto">${sum.done.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></div>` : ""}
      ${sum.pending.length ? `<div class="sum-sec pending"><h4>${t("d.pendingH")}</h4><ul dir="auto">${sum.pending.map((x) => `<li>${inline(x)}</li>`).join("")}</ul></div>` : ""}
      ${sum.next ? `<div class="next" dir="auto"><b>${t("d.nextH")}</b>${inline(sum.next)}</div>` : ""}</div>
      ${sum.stale ? `<div class="stale-note">${t("d.staleNote")}</div>` : ""}`;
  return `<div class="box" id="dSummary"><div class="box-title">${svg("spark")} ${t("d.summary")}${sum ? `<span class="end">${rel(sum.at)} · <button class="link" data-act="summarize" data-id="${s.id}">${t("d.resummarize")}</button></span>` : ""}</div>${body}</div>`;
}
function renderDrawer() {
  const s = byId(state.openId);
  if (!s) return closeDrawer();
  const det = state.detail;
  let tabBody = `<p class="muted"><span class="spinner"></span> ${t("d.loading")}</p>`;
  if (det && state.tab === "turns") tabBody = det.turns.length ? `<div class="turns">${det.turns.map((x) => {
    const long = x.role === "assistant" && x.text.length > 360;
    return `<div class="turn ${x.role} ${long ? "clamped" : ""}"><div class="turn-head"><b>${x.role === "user" ? t("d.you") : s.source === "codex" ? "Codex" : "Claude"}</b>${x.at ? `<span>${fmt.date.format(new Date(x.at))} ${fmt.time.format(new Date(x.at))}</span>` : ""}</div><div class="turn-text" dir="auto">${inline(x.text)}</div>${long ? `<button class="link" data-act="expand">${t("d.more")}</button>` : ""}</div>`;
  }).join("")}</div>` : "";
  if (det && state.tab === "files") tabBody = det.files.length ? `<div class="files">${det.files.map((f) => {
    const relp = det.cwd && f.startsWith(det.cwd + "/") ? f.slice(det.cwd.length + 1) : shortPath(f);
    const i = relp.lastIndexOf("/");
    return `<div class="file" title="${esc(f)}"><span class="dir">${esc(relp.slice(0, i + 1))}</span>${esc(relp.slice(i + 1))}</div>`;
  }).join("")}</div>` : `<p class="muted">${t("d.noFiles")}</p>`;
  $("#drawer").innerHTML = `${drawerHead(s)}<div class="d-body">${summaryBox(s)}
    <div class="box"><div class="box-title">${t("d.notes")}</div><textarea class="note" id="note" dir="auto" placeholder="${t("d.notesPh")}">${esc(s.meta?.note || "")}</textarea></div>
    <div><div class="tabs"><button data-act="tab" data-v="turns" class="${state.tab === "turns" ? "on" : ""}">${t("d.conversation")}</button><button data-act="tab" data-v="files" class="${state.tab === "files" ? "on" : ""}">${t("d.files")}${det ? ` (${det.files.length})` : ""}</button></div>
    <div style="padding-top:14px">${tabBody}</div></div></div>`;
}

// ===== الإجراءات =====
async function setMeta(id, patch) {
  const s = byId(id);
  const m = await api(`/api/sessions/${id}/meta`, { method: "POST", body: patch });
  if (s) s.meta = m;
  renderAll();
}
async function summarizeIds(ids) {
  if (!ids.length) return toast(t("toast.allSummarized"));
  await api("/api/summarize-batch", { method: "POST", body: { ids } });
  ids.forEach((id) => { const s = byId(id); if (s) s.summarizing = "queued"; });
  toast(t("toast.queued", { n: ids.length }));
  renderAll(); soon();
}
function shownSessions(scope) {
  if (scope === "today") return state.sessions.filter((s) => s.days?.[today()]);
  return filtered();
}

function shareModal(id) {
  const s = byId(id);
  modal(`<h3>${t("share.title")}</h3><p class="desc">${t("share.desc")}</p>
    <label class="check"><input type="checkbox" id="onlyUser" /> ${t("share.onlyUser")}</label>
    <button class="opt" data-act="doExport" data-fmt="html" data-id="${id}"><span class="ico">🌐</span><span><b>${t("share.html")}</b><span>${t("share.htmlD")}</span></span></button>
    <button class="opt" data-act="doExport" data-fmt="md" data-id="${id}"><span class="ico">📝</span><span><b>${t("share.md")}</b><span>${t("share.mdD")}</span></span></button>
    ${state.health?.gh ? `<button class="opt" data-act="doExport" data-fmt="gist" data-id="${id}"><span class="ico">🔗</span><span><b>${t("share.gist")}</b><span>${t("share.gistD")}</span></span></button>` : ""}
    <div id="shareResult"></div>
    <div class="modal-foot"><button class="btn" data-act="closeModal">${t("set.close")}</button></div>`);
  void s;
}
async function doExport(id, kind) {
  if (kind === "gist" && !confirm(t("share.confirmGist"))) return;
  const box = $("#shareResult");
  box.innerHTML = `<div class="result"><span><span class="spinner"></span></span></div>`;
  try {
    const r = await api(`/api/sessions/${id}/export`, { method: "POST", body: { format: kind === "md" ? "md" : "html", gist: kind === "gist", includeAssistant: !$("#onlyUser").checked } });
    box.innerHTML = `<div class="result"><b>${r.url ? esc(r.url) : t("share.saved") + ": " + esc(r.name)}</b>${r.redacted ? `<span>${t("share.redacted", { n: r.redacted })}</span>` : ""}
      <div class="row">${r.url ? `<button class="btn sm primary" data-act="copyText" data-text="${esc(r.url)}">${t("share.copyLink")}</button>` : ""}
      <a class="btn sm" href="/exports/${encodeURIComponent(r.name)}">${t("share.download")}</a>
      <button class="btn sm" data-act="reveal" data-file="${esc(r.file)}">${t("share.reveal")}</button></div></div>`;
  } catch (e) { box.innerHTML = `<div class="result" style="background:var(--warn-soft)">${esc(e.message)}</div>`; }
}

async function settingsModal() {
  try { state.health = await api("/api/health"); } catch {}
  const s = state.settings, h = state.health || {};
  const sel = (k, opts) => `<select data-set="${k}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[k]) === String(v) ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  modal(`<h3>${t("set.title")}</h3>
    <div class="field"><label>${t("set.lang")}</label>${sel("lang", [["ar", "العربية"], ["en", "English"]])}</div>
    <div class="field"><label>${t("set.theme")}</label>${sel("theme", [["dark", t("set.dark")], ["light", t("set.light")]])}</div>
    <div class="field"><label>${t("set.model")}</label>${sel("summaryModel", [["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]])}<span class="hint">${t("set.modelD")}</span></div>
    <div class="field"><label class="switch"><input type="checkbox" data-set="autoSummarize" ${s.autoSummarize ? "checked" : ""}/> ${t("set.auto")}</label><span class="hint">${t("set.autoD", { n: s.autoSummarizeIdleMin })}</span></div>
    ${h.codex ? `<div class="field"><label>${t("set.hub")}</label>${sel("hubAgent", [["claude", "Claude Code"], ["codex", "Codex"]])}</div>` : ""}
    <div class="field">${h.cleanupPeriodDays != null && h.cleanupPeriodDays < 365 ? `<div class="warn-box">${t("set.retentionWarn", { n: h.cleanupPeriodDays })}</div>` : `<div class="ok-box">✓ ${t("set.retentionOk", { n: h.cleanupPeriodDays ?? "?" })}</div>`}</div>
    <div class="field"><label>${t("set.data")}</label><span class="mono">~/.dawra</span></div>
    <div class="modal-foot"><button class="btn primary" data-act="closeModal">${t("set.close")}</button></div>`);
}
async function saveSetting(k, v) {
  state.settings = await api("/api/settings", { method: "POST", body: { [k]: v } });
  applySettings();
  renderAll();
}
function applySettings() {
  setLang(state.settings.lang);
  makeFormatters();
  document.documentElement.dataset.theme = state.settings.theme;
  terms.setTheme(state.settings.theme);
  $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$("[data-i18n-title]").forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  $("#langBtn").textContent = getLang() === "ar" ? "EN" : "ع";
  $("meta[name=theme-color]").content = state.settings.theme === "light" ? "#f4f5f7" : "#0a0b0e";
}

function modal(html) {
  const w = $("#modal");
  $(".modal", w).innerHTML = html;
  w.hidden = false;
}
const closeModal = () => ($("#modal").hidden = true);

// ===== لوحة الأوامر =====
let palIndex = 0, palItems = [];
function openPalette() {
  $("#palette").hidden = false;
  const i = $("#palInput");
  i.placeholder = t("pal.ph");
  i.value = "";
  renderPalette("");
  i.focus();
}
const closePalette = () => ($("#palette").hidden = true);
function renderPalette(q) {
  const ql = q.trim().toLowerCase();
  const m = (txt) => !ql || ql.split(/\s+/).every((w) => txt.toLowerCase().includes(w));
  const actions = [
    [t("pal.today"), () => go("today")],
    [t("pal.ask"), () => go("ask")],
    [t("pal.summarizeToday"), () => summarizeIds(shownSessions("today").filter((s) => !s.summary || s.summary.stale).map((s) => s.id))],
    [t("pal.theme"), () => saveSetting("theme", state.settings.theme === "dark" ? "light" : "dark")],
    [t("pal.lang"), () => saveSetting("lang", getLang() === "ar" ? "en" : "ar")],
    [t("pal.settings"), settingsModal],
  ].filter(([l]) => m(l)).map(([l, fn]) => ({ g: "a", label: l, sub: "", fn }));
  const sessions = state.sessions.filter((s) => m(`${s.title} ${s.project} ${s.summary?.gist || ""}`)).sort((a, b) => b.lastAt - a.lastAt).slice(0, 8)
    .map((s) => ({ g: "s", label: s.title, sub: `${s.project} · ${rel(s.lastAt)}`, fn: () => openDrawer(s.id) }));
  const projs = [...new Map(state.sessions.sort((a, b) => b.lastAt - a.lastAt).map((s) => [s.cwd, s])).values()].filter((s) => m(`${s.project} ${s.cwd}`)).slice(0, 5)
    .map((s) => ({ g: "p", label: s.project, sub: shortPath(s.cwd), fn: () => openTerminal({ cwd: s.cwd, agent: "claude" }) }));
  palItems = [...actions, ...sessions, ...projs];
  palIndex = 0;
  const heads = { a: t("pal.actions"), s: t("pal.sessions"), p: t("pal.projects") };
  let last = null;
  $("#palList").innerHTML = palItems.map((it, i) => {
    const head = it.g !== last ? `<div class="pal-group">${heads[it.g]}</div>` : "";
    last = it.g;
    return `${head}<button class="pal-item ${i === 0 ? "on" : ""}" data-pal="${i}"><span class="t" dir="auto">${esc(it.label)}</span><span class="s">${esc(it.sub)}</span></button>`;
  }).join("");
}
function palMove(d) {
  if (!palItems.length) return;
  palIndex = (palIndex + d + palItems.length) % palItems.length;
  $$(".pal-item").forEach((el, i) => el.classList.toggle("on", i === palIndex));
  $(`.pal-item[data-pal="${palIndex}"]`)?.scrollIntoView({ block: "nearest" });
}
function palRun(i) { const it = palItems[i]; if (!it) return; closePalette(); it.fn(); }
$("#palInput").addEventListener("input", (e) => renderPalette(e.target.value));
$("#palInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); palMove(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); palMove(-1); }
  else if (e.key === "Enter") { e.preventDefault(); palRun(palIndex); }
  else if (e.key === "Escape") closePalette();
});
$("#palette").addEventListener("click", (e) => { const b = e.target.closest("[data-pal]"); if (b) palRun(+b.dataset.pal); else if (e.target.id === "palette") closePalette(); });

// ===== الأحداث =====
document.addEventListener("click", async (e) => {
  const a = e.target.closest("[data-act]");
  if (a) {
    e.stopPropagation();
    const id = a.dataset.id || state.openId;
    const s = byId(id);
    switch (a.dataset.act) {
      case "open": {
        if (s?.tid) { closeDrawer(); return go("work/" + s.tid); }
        // الجلسة تتغير الآن خارج دورة (نافذة Terminal أخرى مثلًا): فتح الأصل قد يتعارض معها
        if (s?.live === "recent") {
          if (s.source === "claude") return confirm(t("open.busyFork")) && openTerminal({ sessionId: id, fork: true });
          if (!confirm(t("open.busy"))) return;
        }
        return openTerminal({ sessionId: id });
      }
      case "external": await api(`/api/sessions/${id}/external`, { method: "POST" }).then(() => toast(t("toast.opened"))).catch((er) => toast(er.message)); return;
      case "copyCmd": { const cmd = `cd '${s.cwd}' && ${s.source === "codex" ? "codex resume" : "claude --resume"} ${id}`; navigator.clipboard.writeText(cmd).then(() => toast(t("toast.copied"))); return; }
      case "copyText": navigator.clipboard.writeText(a.dataset.text).then(() => toast(t("toast.copied"))); return;
      case "pin": return setMeta(id, { pinned: !s.meta?.pinned });
      case "status": return setMeta(id, { status: a.dataset.v || null });
      case "rename": { const v = prompt(t("d.renamePrompt"), s.title); if (v != null) setMeta(id, { title: v.trim() || null }); return; }
      case "summarize": await api(`/api/sessions/${id}/summarize`, { method: "POST" }); if (s) { s.summarizing = "queued"; s.summaryError = null; } renderAll(); soon(); return;
      case "share": return shareModal(id);
      case "doExport": return doExport(id, a.dataset.fmt);
      case "reveal": api("/api/reveal", { method: "POST", body: { file: a.dataset.file } }); return;
      case "closeModal": return closeModal();
      case "closeDrawer": return closeDrawer();
      case "details": return openDrawer(id);
      case "tab": state.tab = a.dataset.v; return renderDrawer();
      case "expand": { const tn = a.closest(".turn"); tn.classList.toggle("clamped"); a.textContent = tn.classList.contains("clamped") ? t("d.more") : t("d.less"); return; }
      case "refresh": a.disabled = true; await api("/api/rescan", { method: "POST" }).catch(() => {}); await load(); toast(t("toast.refreshed")); return;
      case "sumShown": return summarizeIds(shownSessions(a.dataset.scope).filter((x) => !x.summarizing && (!x.summary || x.summary.stale)).slice(0, 25).map((x) => x.id));
      case "standup": return genStandup(!!a.dataset.force);
      case "standupCopy": navigator.clipboard.writeText(standupText()).then(() => toast(t("toast.copied"))); return;
      case "suDay": { const d = shift(state.standupDay || today(), +a.dataset.d); if (d > today()) return; state.standupDay = d; state.standup = null; return renderToday(); }
      case "newIn": return openTerminal({ cwd: a.dataset.cwd, agent: "claude" });
      case "clearFilter": Object.assign(state.filters, { q: "", org: null, project: null }); state.hits = null; return renderAll();
      case "closeTerm": {
        const x = state.terminals.find((y) => y.tid === a.dataset.tid);
        if (x?.alive && !confirm(t("term.closeConfirm"))) return;
        await api(`/api/terminals/${a.dataset.tid}`, { method: "DELETE" });
        terms.dispose(a.dataset.tid);
        state.terminals = state.terminals.filter((y) => y.tid !== a.dataset.tid);
        if (state.route.tid === a.dataset.tid || x?.kind === "hub") { const next = state.terminals.find((y) => y.kind !== "hub") || state.terminals[0]; go(next ? "work/" + next.tid : x?.kind === "hub" ? "ask" : "today"); }
        else renderAll();
        return;
      }
      case "startHub": return startHub();
      case "askChip": {
        const text = t(a.dataset.k);
        const hub = state.terminals.find((y) => y.kind === "hub");
        if (!hub) return startHub(text);
        if (text.endsWith(": ")) { $("#composerInput").value = text; $("#composerInput").focus(); return; }
        return terms.paste(hub.tid, text);
      }
    }
    return;
  }
  const g = e.target.closest("[data-go]");
  if (g) { if (g.dataset.go === "sessions") Object.assign(state.filters, { org: null, project: null, q: "" }); return go(g.dataset.go); }
  const o = e.target.closest("[data-org]");
  if (o) { Object.assign(state.filters, { org: o.dataset.org, project: null, q: "" }); return go("sessions"); }
  const p = e.target.closest("[data-proj]");
  if (p) { Object.assign(state.filters, { project: p.dataset.proj, org: null, q: "" }); return go("sessions"); }
  const r = e.target.closest("[data-range]");
  if (r) { state.filters.range = r.dataset.range; store.set("filters", { range: state.filters.range, agent: state.filters.agent }); return renderSessions(); }
  const ag = e.target.closest("[data-agent]");
  if (ag) { state.filters.agent = ag.dataset.agent; store.set("filters", { range: state.filters.range, agent: state.filters.agent }); return renderSessions(); }
  const c = e.target.closest(".card, .mini");
  if (c) return openDrawer(c.dataset.id);
  if (e.target.id === "modal") closeModal();
});

document.addEventListener("change", (e) => {
  const k = e.target.dataset?.set;
  if (!k) return;
  saveSetting(k, e.target.type === "checkbox" ? e.target.checked : e.target.value);
});

let noteTimer;
document.addEventListener("input", (e) => {
  if (e.target.id === "q") return onSearch(e.target.value);
  if (e.target.id === "note") {
    const id = state.openId, v = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => { const s = byId(id); const m = await api(`/api/sessions/${id}/meta`, { method: "POST", body: { note: v } }); if (s) s.meta = m; }, 600);
  }
});

$("#scrim").addEventListener("click", closeDrawer);
$("#paletteBtn").addEventListener("click", openPalette);
$("#settingsBtn").addEventListener("click", settingsModal);
$("#themeBtn").addEventListener("click", () => saveSetting("theme", state.settings.theme === "dark" ? "light" : "dark"));
$("#langBtn").addEventListener("click", () => saveSetting("lang", getLang() === "ar" ? "en" : "ar"));

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); return $("#palette").hidden ? openPalette() : closePalette(); }
  if (e.key === "Escape") {
    if (!$("#palette").hidden) return closePalette();
    if (!$("#modal").hidden) return closeModal();
    if (state.openId) return closeDrawer();
  }
  const inTerm = document.activeElement?.closest?.(".xterm");
  const typing = inTerm || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); if (state.route.view !== "sessions") go("sessions"); setTimeout(() => $("#q")?.focus(), 30); }
  if (e.key === "j" || e.key === "k") {
    const cards = $$(".view.on .card");
    const i = cards.indexOf(document.activeElement);
    const n = cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === "j" ? 1 : -1)))];
    n?.focus(); n?.scrollIntoView({ block: "nearest" });
  }
  if (e.key === "Enter" && document.activeElement?.classList.contains("card")) openDrawer(document.activeElement.dataset.id);
  if (e.key === "o" && document.activeElement?.classList.contains("card")) document.activeElement.querySelector('[data-act="open"]')?.click();
});

// ===== البدء =====
(async () => {
  try { state.settings = await api("/api/settings"); } catch {}
  applySettings();
  state.route = parseHash();
  api("/api/health").then((h) => (state.health = h)).catch(() => {});
  load();
})();
