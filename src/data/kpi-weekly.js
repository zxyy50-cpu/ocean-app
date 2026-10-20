import { addDays, daysBetween, isDateOnly, toDateOnly } from "../core/dates.js";
import { isOpen } from "./opportunities.js";
import { readSetting, settingId } from "./settings.js";

// KPI 週報: every week Ocean types the cumulative actual sales of G1/G2/G3, the app keeps the
// history, compares it with the targets and the pace line, adds the open opportunities of each
// goal (amount × probability) for a projected year end, and pins the cases the manager asked about.
// Everything lives in settings (synced as JSON); no sheet columns change.

export const KPI_KEYS = Object.freeze({ plan: "kpiPlan", weeks: "kpiWeeks", snapshots: "kpiOppSnapshots", watch: "kpiWatch", groups: "kpiOppGroups" });
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function defaultPlan(year) {
  return {
    year: Number(year),
    meetingDay: 1,
    goals: [
      { key: "G1", label: "G1 全年業績", weight: 0.5, deadline: `${year}-12-31`, all: true, keywords: [],
        tiers: [{ grade: "A+", amount: 19320000 }, { grade: "A", amount: 18400000 }, { grade: "B", amount: 16560000 }, { grade: "C", amount: 16000000 }] },
      { key: "G2", label: "G2 Thermo 耗材", weight: 0.2, deadline: `${year}-12-27`, all: false, keywords: ["Thermo", "Oxoid", "Remel", "賽默"],
        tiers: [{ grade: "A", amount: 1500000 }] },
      { key: "G3", label: "G3 工作流程（EMP INT、MWE、BMU、Romer）", weight: 0.3, deadline: `${year}-12-27`, all: false, keywords: ["EMP", "MWE", "BMU", "Romer", "工作流程"],
        tiers: [{ grade: "A", amount: 2000000 }] },
    ],
  };
}

export function kpiPlan(all, today) {
  const year = Number(String(today).slice(0, 4));
  const saved = readSetting(all, KPI_KEYS.plan);
  return saved && Number(saved.year) === year ? saved : { ...defaultPlan(year), ...(saved ? { meetingDay: saved.meetingDay ?? 1 } : {}) };
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function targetOf(goal) {
  return (goal.tiers.find((tier) => tier.grade === "A") || goal.tiers[0] || { amount: 0 }).amount;
}

// Highest tier the amount reaches, e.g. 1,700 萬 → B.
export function gradeOf(goal, amount) {
  const reached = [...goal.tiers].sort((a, b) => b.amount - a.amount).find((tier) => amount >= tier.amount);
  if (reached) return reached.grade;
  const lowest = [...goal.tiers].sort((a, b) => a.amount - b.amount)[0];
  return lowest ? `未達 ${lowest.grade}` : "";
}

// The weekly meeting this update is for: the next meeting day on or after today.
export function reportPeriod(today, meetingDay = 1) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const date = addDays(today, (Number(meetingDay) - weekday + 7) % 7);
  return { date, start: addDays(date, -6), end: date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${WEEKDAYS[Number(meetingDay)]}）週會` };
}

export function kpiWeeks(all) {
  return [...(readSetting(all, KPI_KEYS.weeks) || [])].sort((a, b) => a.date.localeCompare(b.date));
}

export function watchList(all) {
  return readSetting(all, KPI_KEYS.watch) || {};
}

export function groupOverrides(all) {
  return readSetting(all, KPI_KEYS.groups) || {};
}

// English brand words must stand alone, so 「Tempo」 is not 「EMP」.
function mentions(text, word) {
  const escaped = String(word).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return /^[\x20-\x7e]+$/.test(word) ? new RegExp(`(^|[^a-z])${escaped}(?![a-z])`, "i").test(text) : text.includes(word);
}

// Which goals an opportunity counts toward. G1 takes everything; the others go by brand keywords
// in the name, product or notes (imported cases keep the brand in 重點摘要), unless Ocean picked the goal by hand.
export function goalsOf(opportunity, plan, overrides = {}) {
  const text = `${opportunity.name || ""} ${opportunity.product || ""} ${opportunity.notes || ""}`;
  const manual = overrides[opportunity.id];
  return plan.goals.filter((goal) => {
    if (goal.all) return true;
    if (manual) return manual === goal.key;
    return goal.keywords.some((word) => word && mentions(text, word));
  }).map((goal) => goal.key);
}

function dayOf(value) {
  return toDateOnly(value) || "";
}

function liveOpportunities(model) {
  return (model.all.opportunity || []).filter((opportunity) => {
    if (opportunity.archivedAt) return false;
    const customer = model.customersById.get(opportunity.customerId);
    return customer && !customer.archivedAt;
  });
}

// Open cases expected to close this year (or with no close date yet, or already overdue).
export function openThisYear(model, year) {
  return liveOpportunities(model).filter((opportunity) => isOpen(opportunity) && (!opportunity.expectedCloseDate || opportunity.expectedCloseDate <= `${year}-12-31`));
}

function weighted(opportunity) {
  return Math.round(number(opportunity.amount) * number(opportunity.probability) / 100);
}

function snapshotOf(opportunity) {
  return { stage: opportunity.stage || "", amount: number(opportunity.amount), probability: number(opportunity.probability), expectedCloseDate: opportunity.expectedCloseDate || "" };
}

function activitiesByOpportunity(model, start, end) {
  const map = new Map();
  for (const activity of model.all.activity || []) {
    if (activity.archivedAt || !activity.opportunityId || !activity.activityDate) continue;
    if (activity.activityDate < start || activity.activityDate > end) continue;
    map.set(activity.opportunityId, [...(map.get(activity.opportunityId) || []), activity]);
  }
  return map;
}

// 「本周商機更新重點」: what moved since the last report, newest and biggest first.
export function weeklyHighlights(model, all, period) {
  const snapshots = readSetting(all, KPI_KEYS.snapshots) || [];
  const base = [...snapshots].filter((snapshot) => snapshot.date < period.date).sort((a, b) => b.date.localeCompare(a.date))[0];
  const visits = activitiesByOpportunity(model, period.start, period.end);
  const rows = [];
  for (const opportunity of liveOpportunities(model)) {
    const changes = [];
    const before = base?.items?.[opportunity.id];
    const created = dayOf(opportunity.createdAt);
    const closed = dayOf(opportunity.closedAt);
    const current = snapshotOf(opportunity);
    if (created >= period.start && created <= period.end && !before) changes.push({ kind: "new", text: "本週新增" });
    if (opportunity.stage === "成交" && closed >= period.start && closed <= period.end) changes.push({ kind: "won", text: "本週成交" });
    else if (opportunity.stage === "失敗" && closed >= period.start && closed <= period.end) changes.push({ kind: "lost", text: `本週未成交${opportunity.lostReason ? `（${opportunity.lostReason}）` : ""}` });
    else if (before && before.stage !== current.stage) changes.push({ kind: "stage", text: `階段 ${before.stage || "—"} → ${current.stage}` });
    if (before && before.amount !== current.amount) changes.push({ kind: "amount", text: `金額 ${before.amount.toLocaleString("zh-TW")} → ${current.amount.toLocaleString("zh-TW")}` });
    if (before && before.probability !== current.probability && before.stage === current.stage) changes.push({ kind: "probability", text: `機率 ${before.probability}% → ${current.probability}%` });
    if (before && before.expectedCloseDate !== current.expectedCloseDate && current.expectedCloseDate) changes.push({ kind: "close", text: `預計結案 ${before.expectedCloseDate || "未填"} → ${current.expectedCloseDate}` });
    const seen = visits.get(opportunity.id) || [];
    if (seen.length) changes.push({ kind: "visit", text: `拜訪 ${seen.length} 次`, detail: seen.sort((a, b) => b.activityDate.localeCompare(a.activityDate))[0].summary || "" });
    const updated = dayOf(opportunity.updatedAt);
    if (!changes.length && !base && isOpen(opportunity) && updated >= period.start && updated <= period.end) changes.push({ kind: "updated", text: "本週有更新" });
    if (changes.length) rows.push({ opportunity, changes });
  }
  const order = { won: 0, new: 1, stage: 2, lost: 3, amount: 4, close: 5, probability: 6, visit: 7, updated: 8 };
  rows.sort((a, b) => Math.min(...a.changes.map((change) => order[change.kind])) - Math.min(...b.changes.map((change) => order[change.kind])) || number(b.opportunity.amount) - number(a.opportunity.amount));
  return { since: base?.date || "", rows };
}

// Was the opportunity touched during this report period (edited or visited)?
export function updatedInPeriod(model, opportunity, period) {
  const updated = dayOf(opportunity.updatedAt);
  if (updated >= period.start && updated <= period.end) return true;
  return (model.all.activity || []).some((activity) => !activity.archivedAt && activity.opportunityId === opportunity.id && activity.activityDate >= period.start && activity.activityDate <= period.end);
}

export function weeklyReport(model, all, today) {
  const plan = kpiPlan(all, today);
  const period = reportPeriod(today, plan.meetingDay);
  const weeks = kpiWeeks(all).filter((week) => week.date.startsWith(String(plan.year)));
  const current = weeks.find((week) => week.date === period.date) || null;
  const previous = [...weeks].reverse().find((week) => week.date < period.date) || null;
  const latest = current || previous;
  const overrides = groupOverrides(all);
  const open = openThisYear(model, plan.year).map((opportunity) => ({ opportunity, goals: goalsOf(opportunity, plan, overrides), weighted: weighted(opportunity), manual: overrides[opportunity.id] || "" }));
  const yearStart = `${plan.year}-01-01`;
  const goals = plan.goals.map((goal) => {
    const target = targetOf(goal);
    const actual = number(latest?.actuals?.[goal.key]);
    const beforeWeek = current ? previous : weeks.filter((week) => week.date < (latest?.date || "")).at(-1);
    const mine = open.filter((row) => row.goals.includes(goal.key));
    const weightedSum = mine.reduce((sum, row) => sum + row.weighted, 0);
    const total = Math.max(1, daysBetween(yearStart, goal.deadline) || 365);
    const elapsed = Math.min(total, Math.max(0, daysBetween(yearStart, latest?.date || period.date) || 0));
    const paceAmount = Math.round(target * elapsed / total);
    const projected = actual + weightedSum;
    return {
      ...goal, target, actual, weekGain: latest && beforeWeek ? actual - number(beforeWeek.actuals?.[goal.key]) : null, percent: target ? Math.round(actual / target * 1000) / 10 : 0,
      paceAmount, pacePercent: Math.round(elapsed / total * 1000) / 10, behindPace: actual - paceAmount, gap: target - actual,
      open: { count: mine.length, amount: mine.reduce((sum, row) => sum + number(row.opportunity.amount), 0), weighted: weightedSum, noCloseDate: mine.filter((row) => !row.opportunity.expectedCloseDate).length },
      projected, projectedPercent: target ? Math.round(projected / target * 1000) / 10 : 0, projectedGrade: gradeOf(goal, projected), grade: gradeOf(goal, actual),
      notes: latest?.notes?.[goal.key] || { gap: "", next: "" },
    };
  });
  const watch = watchList(all);
  const watched = Object.entries(watch).map(([id, flag]) => {
    const opportunity = model.opportunitiesById?.get?.(id) || (model.all.opportunity || []).find((item) => item.id === id);
    if (!opportunity || opportunity.archivedAt) return null;
    return { opportunity, flag, updated: updatedInPeriod(model, opportunity, period), now: snapshotOf(opportunity), weighted: weighted(opportunity) };
  }).filter(Boolean).sort((a, b) => Number(a.updated) - Number(b.updated) || String(a.flag.since).localeCompare(String(b.flag.since)));
  return { plan, period, weeks, current, previous, latest, goals, open, watched, highlights: weeklyHighlights(model, all, period) };
}

// One transaction for several settings, so a weekly save is all-or-nothing.
async function putSettings(tx, entries) {
  for (const [key, value] of entries) {
    const id = settingId(key);
    const existing = await tx.get("setting", id);
    if (existing) await tx.update("setting", id, { value });
    else await tx.create("setting", { key, value }, { id });
  }
  return { ok: true };
}

export function validateWeek(input = {}, plan) {
  const errors = {};
  const date = String(input.date || "").trim();
  if (!isDateOnly(date)) errors.date = "請選擇週會日期";
  else if (!date.startsWith(String(plan.year))) errors.date = `日期要在 ${plan.year} 年內`;
  const actuals = {};
  for (const goal of plan.goals) {
    const raw = String(input.actuals?.[goal.key] ?? "").replace(/[,\s]/g, "");
    if (raw === "") { errors[`actual-${goal.key}`] = "請輸入累計實際業績（沒有就填 0）"; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) errors[`actual-${goal.key}`] = "請輸入 0 以上的數字";
    else actuals[goal.key] = Math.round(value);
  }
  const notes = Object.fromEntries(plan.goals.map((goal) => [goal.key, { gap: String(input.notes?.[goal.key]?.gap || "").trim(), next: String(input.notes?.[goal.key]?.next || "").trim() }]));
  return { ok: !Object.keys(errors).length, errors, value: { date, actuals, notes } };
}

// Saves (or replaces) the week and keeps a copy of where every opportunity stood, so next
// week's report can tell what moved. Only the last few copies are kept.
export async function saveWeek(db, model, all, input, today, requestId) {
  const plan = kpiPlan(all, today);
  const validation = validateWeek(input, plan);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  const week = { ...validation.value, savedAt: new Date().toISOString() };
  const weeks = [...kpiWeeks(all).filter((item) => item.date !== week.date), week].sort((a, b) => a.date.localeCompare(b.date));
  const items = Object.fromEntries(liveOpportunities(model).map((opportunity) => [opportunity.id, snapshotOf(opportunity)]));
  const snapshots = [...(readSetting(all, KPI_KEYS.snapshots) || []).filter((item) => item.date !== week.date), { date: week.date, items }].sort((a, b) => a.date.localeCompare(b.date)).slice(-3);
  return db.transact(requestId, (tx) => putSettings(tx, [[KPI_KEYS.weeks, weeks], [KPI_KEYS.snapshots, snapshots]]));
}

export function validatePlan(input = {}, base) {
  const errors = {};
  const meetingDay = Number(input.meetingDay);
  if (!(meetingDay >= 0 && meetingDay <= 6)) errors.meetingDay = "請選擇週會是星期幾";
  const goals = base.goals.map((goal) => {
    const tiers = goal.tiers.map((tier) => {
      const raw = String(input.tiers?.[goal.key]?.[tier.grade] ?? tier.amount).replace(/[,\s]/g, "");
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) errors[`tier-${goal.key}-${tier.grade}`] = "請輸入大於 0 的金額";
      return { grade: tier.grade, amount: Math.round(value) };
    });
    const keywords = input.keywords?.[goal.key] === undefined ? goal.keywords : String(input.keywords[goal.key]).split(/[、,，\n]/).map((word) => word.trim()).filter(Boolean);
    if (!goal.all && !keywords.length) errors[`keywords-${goal.key}`] = "至少一個品牌關鍵字";
    return { ...goal, tiers, keywords };
  });
  return { ok: !Object.keys(errors).length, errors, value: { ...base, meetingDay, goals } };
}

export async function savePlan(db, all, input, today, requestId) {
  const validation = validatePlan(input, kpiPlan(all, today));
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, (tx) => putSettings(tx, [[KPI_KEYS.plan, validation.value]]));
}

export function setWatch(db, all, opportunity, note, today, requestId) {
  const watch = { ...watchList(all), [opportunity.id]: { note: String(note || "").trim(), since: today, base: snapshotOf(opportunity) } };
  return db.transact(requestId, (tx) => putSettings(tx, [[KPI_KEYS.watch, watch]]));
}

export function clearWatch(db, all, opportunityId, requestId) {
  const { [opportunityId]: _removed, ...rest } = watchList(all);
  return db.transact(requestId, (tx) => putSettings(tx, [[KPI_KEYS.watch, rest]]));
}

export function setGoalOverride(db, all, opportunityId, goalKey, requestId) {
  const overrides = { ...groupOverrides(all) };
  if (goalKey) overrides[opportunityId] = goalKey;
  else delete overrides[opportunityId];
  return db.transact(requestId, (tx) => putSettings(tx, [[KPI_KEYS.groups, overrides]]));
}

// The day before the meeting and the meeting day itself: is the week typed in, and has every
// opportunity the manager asked about been touched since the last meeting?
export function meetingReminders(model, all, today) {
  const plan = kpiPlan(all, today);
  const period = reportPeriod(today, plan.meetingDay);
  const daysLeft = daysBetween(today, period.date);
  if (daysLeft > 1) return null;
  const report = weeklyReport(model, all, today);
  const stale = report.watched.filter((row) => !row.updated && isOpen(row.opportunity));
  if (report.current && !stale.length) return null;
  return { period, daysLeft, missingWeek: !report.current, stale };
}

function wan(amount) {
  const value = Number(amount) || 0;
  return `${(value / 10000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`;
}

function shortDay(date) {
  return date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "";
}

// Plain text of the report, to paste into LINE before or after the meeting.
export function reportText(report, customerName = () => "") {
  const lines = [`Ocean KPI 週報（${report.period.label}${report.latest ? `，金額更新到 ${shortDay(report.latest.date)}` : "，本週金額未填"}）`];
  for (const goal of report.goals) {
    lines.push("", `${goal.label}`);
    lines.push(`・累計 ${wan(goal.actual)}（達成 ${goal.percent}%，目標 ${wan(goal.target)}）${goal.weekGain === null ? "" : `，本週 ${goal.weekGain >= 0 ? "+" : "−"}${wan(Math.abs(goal.weekGain))}`}`);
    lines.push(`・${goal.behindPace >= 0 ? "超前" : "落後"}應有進度 ${wan(Math.abs(goal.behindPace))}；預估全年 ${wan(goal.projected)}（${goal.projectedPercent}%・${goal.projectedGrade}）`);
    lines.push(`・未結商機 ${goal.open.count} 件，金額 ${wan(goal.open.amount)}，加權 ${wan(goal.open.weighted)}`);
    if (goal.notes.gap) lines.push(`・差異原因：${goal.notes.gap}`);
    if (goal.notes.next) lines.push(`・接下來：${goal.notes.next}`);
  }
  if (report.watched.length) {
    lines.push("", "★ 主管關注");
    for (const row of report.watched) lines.push(`・${row.opportunity.name || ""}${customerName(row.opportunity.customerId) ? `（${customerName(row.opportunity.customerId)}）` : ""}：${row.now.stage}・${wan(row.now.amount)}・${row.now.probability}%${row.updated ? "" : "（本週未更新）"}`);
  }
  if (report.highlights.rows.length) {
    lines.push("", "本週商機更新重點");
    for (const row of report.highlights.rows.slice(0, 10)) lines.push(`・${row.opportunity.name || ""}${customerName(row.opportunity.customerId) ? `（${customerName(row.opportunity.customerId)}）` : ""}：${row.changes.map((change) => change.text).join("、")}`);
  }
  return lines.join("\n");
}

// The 1–N 月 actuals already in the KPI workbook snapshot, as a starting value for G1.
export function sheetActualHint(kpis = []) {
  const months = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
  let amount = 0;
  let last = 0;
  for (const kpi of kpis) {
    const raw = kpi.raw || {};
    const month = months.indexOf(String(raw["業績目標"] || "").trim());
    if (month < 0) continue;
    const key = Object.keys(raw).find((name) => /^A\s*≧/.test(name));
    const value = number(raw[key]);
    if (value > 0) { amount += value; last = Math.max(last, month + 1); }
  }
  return last ? { amount, months: last } : null;
}
