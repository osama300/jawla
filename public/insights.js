// صفحة "رؤى": أرقام ورسوم بسيطة عن وقت العمل. الرسوم HTML عادية (بلا مكتبات) وتتبع اتجاه اللغة.

import { t, getLang } from "./i18n.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const bold = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

/** 125 دقيقة ← "2.1 ساعة"، و40 ← "40 دقيقة" */
export function dur(min, short = false) {
  if (min < 60) return short ? `${Math.round(min)}${t("ins.m")}` : t("ins.unitM", { n: Math.round(min) });
  const h = min / 60;
  const n = h >= 10 ? Math.round(h) : h.toFixed(1).replace(/\.0$/, "");
  return short ? `${n}${t("ins.h")}` : t("ins.unitH", { n });
}
// نسبة مئوية بالعلامة المناسبة للغة (٪ للعربية)
const pctN = (n) => (getLang() === "ar" ? `${n}٪` : `${n}%`);
const pct = (x) => pctN(Math.round(x * 100));
const num = (n) => new Intl.NumberFormat(getLang() === "ar" ? "ar-u-nu-latn" : "en", { notation: n >= 1e6 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
const hourLabel = (h) => `${String(h).padStart(2, "0")}:00`;

function delta(cur, prev) {
  if (prev == null || !prev) return "";
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.05) return `<span class="delta">= ${t("ins.noChange")}</span>`;
  return `<span class="delta">${d > 0 ? "↑" : "↓"} ${pctN(Math.round(Math.abs(d) * 100))} ${t("ins.vsPrev")}</span>`;
}

function tile(label, value, sub = "", extra = "") {
  return `<div class="stat ins-tile"><div class="stat-label">${label}</div><div class="stat-num">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ""}${extra}</div>`;
}

// ===== الرسوم =====

/** أعمدة الساعات يوميًا/أسبوعيًا */
function columns(series, fmt, avg) {
  const max = Math.max(60, ...series.map((x) => x.minutes));
  const top = Math.ceil(max / 60);
  const step = top <= 4 ? 1 : top <= 8 ? 2 : top <= 16 ? 4 : Math.ceil(top / 4 / 5) * 5;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const scaleMax = ticks[ticks.length - 1] * 60 || 60;
  const many = series.length > 31;
  const labelEvery = series.length <= 8 ? 1 : series.length <= 31 ? 7 : 4;
  return `<div class="cols-wrap">
    <div class="cols-grid">${ticks.map((v) => `<div class="gl" style="bottom:${(v * 60 / scaleMax) * 100}%"><span>${v}${t("ins.h")}</span></div>`).join("")}
      ${avg ? `<div class="gl avg" style="bottom:${(avg / scaleMax) * 100}%"></div>` : ""}</div>
    <div class="cols ${many ? "many" : ""}">${series.map((x, i) => {
      const d = new Date(x.key);
      const label = x.week ? fmt.date.format(d) : `${t("wd." + d.getDay())} ${fmt.date.format(d)}`;
      return `<div class="col" data-tip="${esc(label)} — <b>${esc(dur(x.minutes))}</b>"><div class="bar ${x.minutes ? "" : "zero"}" style="height:${(x.minutes / scaleMax) * 100}%"></div>
        <span class="xl">${i % labelEvery === 0 || i === series.length - 1 ? esc(x.week ? fmt.short.format(d) : fmt.short.format(d)) : ""}</span></div>`;
    }).join("")}</div></div>`;
}

function columnsTable(series, fmt) {
  return `<table class="dtable"><thead><tr><th>${t("ins.day")}</th><th>${t("ins.value")}</th></tr></thead><tbody>${series
    .map((x) => `<tr><td>${esc(fmt.date.format(new Date(x.key)))}</td><td>${(x.minutes / 60).toFixed(1)}</td></tr>`)
    .join("")}</tbody></table>`;
}

/** أشرطة أفقية مرتبة مع القيمة والنسبة */
function hbars(items, { total, color = "var(--accent)", valueFmt = dur, sub } = {}) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return `<div class="hbars">${items
    .map(
      (x) => `<div class="hb" data-tip="${esc(x.label)} — <b>${esc(valueFmt(x.value))}</b>${total ? ` (${pctN(Math.round((x.value / total) * 100))})` : ""}">
      <div class="hb-label" dir="auto">${x.dot ? `<span class="dot" style="background:${x.dot}"></span>` : ""}<span>${esc(x.label)}</span></div>
      <div class="hb-track"><div class="hb-bar" style="width:${Math.max(1.5, (x.value / max) * 100)}%;background:${x.color || color}"></div></div>
      <div class="hb-val">${esc(valueFmt(x.value))}${total ? `<small>${pctN(Math.round((x.value / total) * 100))}</small>` : ""}</div>
    </div>`
    )
    .join("")}${sub || ""}</div>`;
}

/** خريطة حرارية: الأيام × الساعات */
function heatmap(heat) {
  const max = Math.max(1, ...heat.flat());
  // نبدأ الأسبوع بالسبت كما هو شائع عربيًا، وبالاثنين في الإنجليزية
  const order = getLang() === "ar" ? [6, 0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 0];
  const level = (v) => (v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5)));
  return `<div class="heat">
    <div class="heat-grid">
      ${order
        .map(
          (d) => `<div class="hrow"><span class="hday">${t("wd." + d)}</span>${heat[d]
            .map((v, h) => `<span class="cell l${level(v)}" data-tip="${t("wd." + d)} ${hourLabel(h)} — <b>${esc(dur(v))}</b>"></span>`)
            .join("")}</div>`
        )
        .join("")}
      <div class="hrow hours"><span class="hday"></span>${Array.from({ length: 24 }, (_, h) => `<span class="hl">${h % 3 === 0 ? h : ""}</span>`).join("")}</div>
    </div>
    <div class="heat-legend"><span>${t("ins.less")}</span>${[0, 1, 2, 3, 4, 5].map((l) => `<span class="cell l${l}"></span>`).join("")}<span>${t("ins.moreLbl")}</span></div>
  </div>`;
}

/** شريط واحد مقسّم (للنسب) مع مفتاح ألوان */
function stack(parts) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const shown = parts.filter((p) => p.value > 0);
  return `<div class="stack">${shown
    .map((p) => `<div class="seg-part" style="flex:${p.value};background:${p.color}" data-tip="${esc(p.label)} — <b>${esc(p.fmt ? p.fmt(p.value) : p.value)}</b> (${pctN(Math.round((p.value / total) * 100))})"></div>`)
    .join("")}</div>
    <div class="legend">${shown
      .map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${esc(p.fmt ? p.fmt(p.value) : p.value)}</b> <small>${pctN(Math.round((p.value / total) * 100))}</small></span>`)
      .join("")}</div>`;
}

// ألوان الفئات (مُتحقق منها لعمى الألوان والتباين في الوضعين)
const CAT = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
const agentName = (n) => (n === "codex" ? "Codex" : "Claude Code");
const modelName = (m) => m.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-(\d+)$/, " $1").replace(/-/g, " ");

// ===== الصفحة =====
export function renderInsights(el, st, fmt) {
  const a = st.data;
  const range = st.range;
  const seg = `<div class="seg">${[7, 30, 90, 0].map((r) => `<button data-irange="${r}" class="${range === r ? "on" : ""}">${t("ins.r" + r)}</button>`).join("")}</div>`;
  const head = `<header class="hero"><div><div class="greet">${t("ins.sub")}</div><h1>${t("ins.title")}</h1></div>
    <div class="hero-actions">${seg}<button class="btn" data-act="askNumbers">${t("ins.ask")}</button></div></header>`;

  if (!a) {
    el.innerHTML = head + `<div class="inline-empty"><span class="spinner"></span> ${t("ins.loading")}</div>`;
    return;
  }
  if (!a.totals.minutes) {
    el.innerHTML = head + `<div class="empty"><b>${t("ins.empty")}</b></div>`;
    return;
  }
  const T = a.totals, P = a.prev, R = a.rhythm;

  // 1) الأرقام الأساسية
  const tiles = `<section class="stats ins-tiles">
    ${tile(t("ins.hours"), dur(T.minutes), t("ins.hoursSub", { h: (R.avgPerWorkDay / 60).toFixed(1) }), delta(T.minutes, P?.minutes))}
    ${tile(t("ins.workDays"), t("ins.workDaysV", { a: T.workDays, b: a.days }), "", delta(T.workDays, P?.workDays))}
    ${tile(t("ins.sessions"), T.sessions, "", delta(T.sessions, P?.sessions))}
    ${tile(t("ins.projects"), T.projects, "", delta(T.projects, P?.projects))}
    ${tile(t("ins.focus"), dur(R.longestBlock))}
  </section>`;

  // 2) باختصار
  const brief = `<div class="box"><div class="box-title">${t("ins.brief")}</div><ul class="brief">${a.insights
    .map((x) => {
      const v = { ...x.v };
      if (x.k === "in.peak") { v.a = hourLabel(v.a); v.b = hourLabel(v.b); }
      if (x.k === "in.bestDay") v.d = t("wd." + v.d);
      return `<li>${bold(t(x.k, v))}</li>`;
    })
    .join("")}</ul></div>`;

  // 3) تقرير الفترة (ذكاء اصطناعي، عند الطلب)
  const rep = a.report;
  let repBody;
  if (st.reportBusy) repBody = `<p class="muted"><span class="spinner"></span> ${t("ins.reportWorking")}</p>`;
  else if (!rep) repBody = `<p class="muted" style="margin:0 0 12px">${t("ins.reportHint")}</p><button class="btn primary sm" data-act="insReport">✦ ${t("ins.reportGen")}</button>`;
  else repBody = `<p class="headline" dir="auto">${bold(rep.headline)}</p>
    <div class="rep-grid">
      ${rep.time.length ? `<div class="su-sec"><h4>${t("ins.rTime")}</h4><ul class="plain" dir="auto">${rep.time.map((x) => `<li>${bold(x)}</li>`).join("")}</ul></div>` : ""}
      ${rep.done.length ? `<div class="su-sec done"><h4>${t("ins.rDone")}</h4><ul dir="auto">${rep.done.map((x) => `<li>${bold(x)}</li>`).join("")}</ul></div>` : ""}
      ${rep.open.length ? `<div class="su-sec pending"><h4>${t("ins.rOpen")}</h4><ul dir="auto">${rep.open.map((x) => `<li>${bold(x)}</li>`).join("")}</ul></div>` : ""}
    </div>
    ${rep.pattern ? `<p class="rep-note" dir="auto"><b>${t("ins.rPattern")}:</b> ${bold(rep.pattern)}</p>` : ""}
    ${rep.tip ? `<div class="next" dir="auto"><b>${t("ins.rTip")}</b>${bold(rep.tip)}</div>` : ""}`;
  const report = `<div class="box"><div class="box-title">✦ ${t("ins.report")}${rep && !st.reportBusy ? `<span class="end"><button class="link" data-act="insReport">${t("standup.regen")}</button></span>` : ""}</div>${repBody}</div>`;

  // 4) الساعات يوميًا
  const weekly = a.series[0]?.week;
  const daily = `<div class="box"><div class="box-title">${weekly ? t("ins.weekly") : t("ins.daily")}<span class="end">${t("ins.avgLine", { h: (R.avgPerWorkDay / 60).toFixed(1) })} · <button class="link" data-act="insTable">${st.table ? t("ins.chart") : t("ins.table")}</button></span></div>
    ${st.table ? columnsTable(a.series, fmt) : columns(a.series, fmt, weekly ? null : R.avgPerWorkDay)}</div>`;

  // 5) المشاريع + متى تعمل
  const projTotal = a.projects.reduce((s, p) => s + p.minutes, 0) + a.otherProjects;
  const projItems = a.projects.map((p) => ({ label: p.name, value: p.minutes, dot: `hsl(${hue(p.cwd)} 68% 62%)`, cwd: p.cwd }));
  if (a.otherProjects) projItems.push({ label: t("ins.others"), value: a.otherProjects, color: "var(--muted)" });
  const projects = `<div class="box"><div class="box-title">${t("ins.whereTime")}</div>${hbars(projItems, { total: projTotal })}</div>`;
  const when = `<div class="box"><div class="box-title">${t("ins.whenWork")}<span class="end">${t("ins.peakLbl", { a: hourLabel(a.peak.start), b: hourLabel((a.peak.start + 3) % 24) })}</span></div>${heatmap(a.heat)}</div>`;

  // 6) الإيقاع
  const fact = (label, value) => `<div class="fact"><div class="fact-v">${value}</div><div class="fact-l">${label}</div></div>`;
  const rhythm = `<div class="box"><div class="box-title">${t("ins.rhythm")}</div><div class="facts">
    ${fact(t("ins.medSession"), dur(R.medianSession))}
    ${fact(t("ins.longest"), dur(R.longestBlock))}
    ${fact(t("ins.night"), pct(R.nightShare))}
    ${fact(t("ins.streak"), R.streak)}
    ${fact(t("ins.perDay"), R.switching.toFixed(1))}
    ${fact(t("ins.parallel"), "×" + R.parallel.toFixed(1))}
  </div></div>`;

  // 7) العمل مع الذكاء
  const tok = a.tokens;
  const cacheShare = tok.cacheRead / Math.max(1, tok.cacheRead + tok.in + tok.cacheWrite);
  const ai = `<h2 class="ins-h2">${t("ins.ai")}</h2>
    <div class="ins-grid">
      <div class="box"><div class="box-title">${t("ins.agents")}</div>${stack(a.agents.map((x, i) => ({ label: agentName(x.name), value: x.minutes, color: CAT[i], fmt: (v) => dur(v) })))}
        <div class="box-title" style="margin-top:18px">${t("ins.models")}</div>${stack(a.models.map((x, i) => ({ label: modelName(x.name), value: x.count, color: CAT[i], fmt: num })))}</div>
      <div class="box"><div class="box-title">${t("ins.tools")}</div>${hbars(a.tools.map((x) => ({ label: x.name, value: x.count })), { valueFmt: num, color: "var(--c1)" })}</div>
      <div class="box"><div class="box-title">${t("ins.tokens")}</div><div class="facts two">
        ${fact(t("ins.tokOut"), num(tok.out))}
        ${fact(t("ins.tokCache"), pct(cacheShare))}
      </div></div>
    </div>`;

  // 8) الإنجاز
  const o = a.outcome;
  const outcome = `<h2 class="ins-h2">${t("ins.outcome")}</h2>
    <div class="ins-grid two">
      <div class="box"><div class="box-title">${t("ins.outcome")}<span class="end">${t("ins.outcomeHint")}</span></div>${stack([
        { label: "✓ " + t("ins.oDone"), value: o.done, color: "var(--accent)" },
        { label: "◦ " + t("ins.oPending"), value: o.pending, color: "var(--warn)" },
        { label: "■ " + t("ins.oBlocked"), value: o.blocked, color: "var(--danger)" },
        { label: t("ins.oUnknown"), value: o.unknown, color: "var(--line)" },
      ])}</div>
      <div class="box"><div class="box-title">${t("ins.stale")}</div>${a.stale.length
        ? a.stale.map((x) => `<div class="mini" data-id="${x.id}"><span class="dot" style="background:hsl(${hue(x.cwd)} 68% 62%)"></span><div class="mt"><b dir="auto">${esc(x.title)}</b><span dir="auto">${esc(x.project)} · ${t("ins.daysAgo", { n: x.daysAgo })}${x.item ? " · " + esc(x.item) : ""}</span></div><button class="btn sm" data-act="open" data-id="${x.id}">${t("card.open")}</button></div>`).join("")
        : `<div class="inline-empty">${t("ins.noStale")}</div>`}</div>
    </div>`;

  const how = `<details class="how"><summary>${t("ins.how")}</summary><p>${t("ins.howText")}</p></details>`;

  el.innerHTML = `${head}${tiles}
    <div class="ins-grid two">${brief}${report}</div>
    ${daily}
    <div class="ins-grid two">${projects}${when}</div>
    ${rhythm}
    ${ai}
    ${outcome}
    ${how}`;
}

function hue(str) {
  let h = 0;
  for (const c of str || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

// تلميح عائم لكل عنصر فيه data-tip
export function installTooltip() {
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  document.body.appendChild(tip);
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return (tip.hidden = true);
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener("mousemove", (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY - h - 12;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.transform = `translate(${x}px, ${y}px)`;
  });
  document.addEventListener("mouseleave", () => (tip.hidden = true));
}
