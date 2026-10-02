// تحليلات العمل من دقائق النشاط في الجلسات. كل الحساب محلي وبلا ذكاء اصطناعي.
//
// كيف نحسب "ساعات العمل": كل دقيقة فيها رسالة أو أداة تُعد عملًا، والفجوة بين دقيقتين
// متتاليتين تُعد عملًا متصلًا إذا كانت 30 دقيقة أو أقل. الجلسات المتوازية لا تُحسب مرتين.

import path from "node:path";
import { dayKey } from "./util.mjs";

export const GAP = 30; // دقيقة

const DAY = 86_400_000;

function keyToDate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function shiftKey(k, n) {
  const d = keyToDate(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** يحوّل دقائق متفرقة إلى دقائق عمل متصلة (يملأ الفجوات القصيرة) */
function expand(sorted) {
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (i > 0) {
      const gap = m - sorted[i - 1];
      if (gap > 1 && gap <= GAP) for (let x = sorted[i - 1] + 1; x < m; x++) out.push(x);
    }
    out.push(m);
  }
  return out;
}

/** أطول فترة عمل متصلة (بالدقائق) */
function longestBlock(sorted) {
  let best = 0, start = sorted[0], prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const m = sorted[i];
    if (m === undefined || m - prev > GAP) {
      best = Math.max(best, prev - start + 1);
      start = m;
    }
    prev = m;
  }
  return sorted.length ? best : 0;
}

const uniqSorted = (arr) => [...new Set(arr)].sort((a, b) => a - b);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** اسم مقروء للأداة: mcp__claude-in-chrome__computer ← computer (claude-in-chrome) */
function toolName(n) {
  const m = n.match(/^mcp__(.+?)__(.+)$/);
  if (!m) return n;
  return `${m[2]} · ${m[1].replace(/^claude_ai_/, "").replace(/^plugin_[^_]+_/, "")}`;
}

/**
 * sessions: جلسات الفهرس (فيها act وdays وtools...)، decorate: يضيف الملخص والحالة.
 * range: عدد الأيام (7، 30، 90) أو 0 لكل الفترة.
 */
export function computeAnalytics(sessions, decorate, { range = 30 } = {}) {
  const today = dayKey(Date.now());
  const endMin = Math.floor(keyToDate(shiftKey(today, 1)).getTime() / 60000);
  let firstKey;
  if (range) firstKey = shiftKey(today, -(range - 1));
  else {
    const first = Math.min(...sessions.filter((s) => s.act?.length).map((s) => s.act[0]));
    firstKey = dayKey((Number.isFinite(first) ? first : Date.now() / 60000) * 60000);
  }
  const startMin = Math.floor(keyToDate(firstKey).getTime() / 60000);
  const days = Math.round((endMin - startMin) / 1440);
  const prevStartMin = startMin - days * 1440;

  const cur = period(sessions, decorate, startMin, endMin, firstKey, days);
  const prev = range ? period(sessions, decorate, prevStartMin, startMin, shiftKey(firstKey, -days), days, true) : null;

  return { range, from: firstKey, to: today, days, ...cur, prev: prev && prev.totals, insights: insights(cur, prev, range) };
}

function period(sessions, decorate, startMin, endMin, firstKey, days, light = false) {
  const inRange = (m) => m >= startMin && m < endMin;
  const all = [];
  const byProject = new Map();
  const byAgent = new Map();
  const sessionLens = [];
  const used = [];
  let prompts = 0;
  const lastKey = shiftKey(firstKey, days - 1);

  for (const s of sessions) {
    const mins = (s.act || []).filter(inRange);
    if (!mins.length) continue;
    used.push(s);
    all.push(...mins);
    const pk = s.cwd || "?";
    if (!byProject.has(pk)) byProject.set(pk, []);
    byProject.get(pk).push(...mins);
    if (!byAgent.has(s.source)) byAgent.set(s.source, []);
    byAgent.get(s.source).push(...mins);
    sessionLens.push(expand(mins).length);
    for (const [k, n] of Object.entries(s.days || {})) if (k >= firstKey && k <= lastKey) prompts += n;
  }

  const sorted = uniqSorted(all);
  const work = expand(sorted);
  const totalMin = work.length;

  // ساعات كل يوم، وخريطة الساعة × اليوم
  const perDay = {};
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  const hourHist = Array(24).fill(0);
  let night = 0;
  for (const m of work) {
    const d = new Date(m * 60000);
    const k = dayKey(d);
    perDay[k] = (perDay[k] || 0) + 1;
    heat[d.getDay()][d.getHours()]++;
    hourHist[d.getHours()]++;
    if (d.getHours() < 5) night++;
  }
  const workDays = Object.keys(perDay).length;

  const totals = { minutes: totalMin, workDays, sessions: used.length, prompts, projects: byProject.size };
  if (light) return { totals };

  // سلسلة الأيام المتتالية حتى اليوم (أو حتى أمس إن لم تعمل اليوم بعد)
  let streak = 0;
  let k = dayKey(Date.now());
  if (!perDay[k]) k = shiftKey(k, -1);
  while (perDay[k] && streak < 1000) {
    streak++;
    k = shiftKey(k, -1);
  }
  let longestStreak = 0, run = 0;
  for (let i = 0; i < days; i++) {
    const k = shiftKey(firstKey, i);
    run = perDay[k] ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }

  // أفضل نافذة ثلاث ساعات
  let peak = { start: 0, minutes: 0 };
  for (let h = 0; h < 24; h++) {
    const v = hourHist[h] + hourHist[(h + 1) % 24] + hourHist[(h + 2) % 24];
    if (v > peak.minutes) peak = { start: h, minutes: v };
  }
  const weekday = heat.map((row) => row.reduce((a, b) => a + b, 0));

  // الأيام للرسم: يوميًا حتى 62 يومًا، وأسبوعيًا بعد ذلك
  const series = [];
  if (days <= 62) {
    for (let i = 0; i < days; i++) {
      const k = shiftKey(firstKey, i);
      series.push({ key: k, minutes: perDay[k] || 0 });
    }
  } else {
    for (let i = 0; i < days; i += 7) {
      const k = shiftKey(firstKey, i);
      let sum = 0;
      for (let j = 0; j < 7 && i + j < days; j++) sum += perDay[shiftKey(firstKey, i + j)] || 0;
      series.push({ key: k, minutes: sum, week: true });
    }
  }

  const projects = [...byProject.entries()]
    .map(([cwd, mins]) => ({ cwd, name: path.basename(cwd), minutes: expand(uniqSorted(mins)).length }))
    .sort((a, b) => b.minutes - a.minutes);
  const projectSum = projects.reduce((a, p) => a + p.minutes, 0);
  const agents = [...byAgent.entries()].map(([name, mins]) => ({ name, minutes: expand(uniqSorted(mins)).length })).sort((a, b) => b.minutes - a.minutes);

  // الأدوات والنماذج والتوكنات (لكل جلسة نشطت في الفترة)
  const tools = {}, models = {};
  const tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
  for (const s of used) {
    for (const [k, v] of Object.entries(s.tools || {})) tools[toolName(k)] = (tools[toolName(k)] || 0) + v;
    for (const [k, v] of Object.entries(s.models || {})) models[k] = (models[k] || 0) + v;
    for (const k of Object.keys(tokens)) tokens[k] += s.tokens?.[k] || 0;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));

  // الإنجاز والعمل المعلّق
  const dec = used.map(decorate);
  const outcome = { done: 0, pending: 0, blocked: 0, unknown: 0 };
  for (const d of dec) {
    const st = d.meta?.status === "done" ? "done" : d.summary?.state || "unknown";
    outcome[st] = (outcome[st] || 0) + 1;
  }
  const now = Date.now();
  const stale = sessions
    .map(decorate)
    .filter((d) => d.meta?.status !== "done" && (["followup", "waiting"].includes(d.meta?.status) || (d.summary && d.summary.state !== "done" && d.summary.pending?.length)))
    .filter((d) => now - d.lastAt > 3 * DAY)
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, 8)
    .map((d) => ({ id: d.id, title: d.title, project: d.project, cwd: d.cwd, daysAgo: Math.floor((now - d.lastAt) / DAY), item: d.summary?.pending?.[0] || d.meta?.note || "" }));

  // التنقل بين المشاريع: متوسط عدد المشاريع في يوم العمل
  const projDays = {};
  for (const s of used) for (const k of Object.keys(s.days || {})) if (k >= firstKey && k <= lastKey) (projDays[k] ||= new Set()).add(s.cwd);
  const switching = Object.values(projDays).length ? Object.values(projDays).reduce((a, x) => a + x.size, 0) / Object.values(projDays).length : 0;

  return {
    totals,
    series,
    heat,
    weekday,
    hourHist,
    peak,
    rhythm: {
      avgPerWorkDay: workDays ? Math.round(totalMin / workDays) : 0,
      longestBlock: longestBlock(sorted),
      medianSession: median(sessionLens),
      nightShare: totalMin ? night / totalMin : 0,
      streak,
      longestStreak,
      parallel: totalMin ? projectSum / totalMin : 1,
      switching,
    },
    projects: projects.slice(0, 10),
    otherProjects: projects.slice(10).reduce((a, p) => a + p.minutes, 0),
    agents,
    tools: top(tools, 8),
    models: top(models, 5),
    tokens,
    outcome,
    stale,
  };
}

/** جمل قصيرة واضحة (مفاتيح ترجمة + قيم) تُعرض في "باختصار" */
function insights(cur, prev, range) {
  const out = [];
  const t = cur.totals;
  if (!t.minutes) return out;
  if (prev && prev.totals.minutes) {
    const change = (t.minutes - prev.totals.minutes) / prev.totals.minutes;
    if (Math.abs(change) >= 0.1) out.push({ k: change > 0 ? "in.more" : "in.less", v: { h: hours(t.minutes), pct: Math.round(Math.abs(change) * 100) } });
    else out.push({ k: "in.same", v: { h: hours(t.minutes) } });
  } else out.push({ k: "in.total", v: { h: hours(t.minutes), d: t.workDays } });
  if (cur.projects[0]) out.push({ k: "in.topProject", v: { p: cur.projects[0].name, pct: Math.round((cur.projects[0].minutes / cur.projects.reduce((a, p) => a + p.minutes, cur.otherProjects)) * 100) } });
  out.push({ k: "in.peak", v: { a: cur.peak.start, b: (cur.peak.start + 3) % 24 } });
  const bestDay = cur.weekday.indexOf(Math.max(...cur.weekday));
  if (range !== 7 || t.workDays >= 4) out.push({ k: "in.bestDay", v: { d: bestDay } });
  if (cur.rhythm.nightShare >= 0.15) out.push({ k: "in.night", v: { pct: Math.round(cur.rhythm.nightShare * 100) } });
  if (cur.rhythm.parallel >= 1.3) out.push({ k: "in.parallel", v: { x: cur.rhythm.parallel.toFixed(1) } });
  if (cur.rhythm.switching >= 3) out.push({ k: "in.switching", v: { n: cur.rhythm.switching.toFixed(1) } });
  if (cur.stale.length) out.push({ k: "in.stale", v: { n: cur.stale.length } });
  if (cur.rhythm.streak >= 3) out.push({ k: "in.streak", v: { n: cur.rhythm.streak } });
  return out;
}

const hours = (m) => (m / 60).toFixed(m >= 600 ? 0 : 1);

/** نص Markdown مختصر للمساعد المركزي */
export function analyticsMarkdown(a) {
  const h = (m) => `${(m / 60).toFixed(1)}h`;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let md = `## Last ${a.range || "all"} days (${a.from} → ${a.to})\n`;
  md += `- Work time: ${h(a.totals.minutes)} over ${a.totals.workDays} work days (avg ${h(a.rhythm.avgPerWorkDay)}/work day)${a.prev ? `; previous period ${h(a.prev.minutes)}` : ""}\n`;
  md += `- Sessions: ${a.totals.sessions} · prompts: ${a.totals.prompts} · projects: ${a.totals.projects}\n`;
  md += `- Peak window: ${a.peak.start}:00–${(a.peak.start + 3) % 24}:00 · busiest weekday: ${wd[a.weekday.indexOf(Math.max(...a.weekday))]}\n`;
  md += `- Longest focus block: ${h(a.rhythm.longestBlock)} · median session: ${Math.round(a.rhythm.medianSession)} min · after-midnight share: ${Math.round(a.rhythm.nightShare * 100)}%\n`;
  md += `- Parallel sessions factor: ×${a.rhythm.parallel.toFixed(2)} · projects per work day: ${a.rhythm.switching.toFixed(1)} · current streak: ${a.rhythm.streak} days\n`;
  md += `- Time by project: ${a.projects.map((p) => `${p.name} ${h(p.minutes)}`).join(", ")}\n`;
  md += `- Agents: ${a.agents.map((x) => `${x.name} ${h(x.minutes)}`).join(", ")} · models: ${a.models.map((x) => `${x.name} ${x.count}`).join(", ")}\n`;
  md += `- Top tools: ${a.tools.map((x) => `${x.name} ${x.count}`).join(", ")}\n`;
  md += `- Outcomes (by summary/status): done ${a.outcome.done}, pending ${a.outcome.pending}, blocked ${a.outcome.blocked}, not summarized ${a.outcome.unknown}\n`;
  md += `- Daily minutes: ${a.series.map((x) => `${x.key}:${x.minutes}`).join(" ")}\n`;
  if (a.stale.length) md += `- Stale open work (>3 days): ${a.stale.map((x) => `${x.project}/"${x.title}" ${x.daysAgo}d (${x.id.slice(0, 8)})`).join("; ")}\n`;
  return md;
}
