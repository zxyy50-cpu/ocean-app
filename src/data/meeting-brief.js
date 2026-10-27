import { addDays } from "../core/dates.js";
import { caseRedFlags } from "./case-analysis.js";
import { isOpen } from "./opportunities.js";
import { readSetting, settingId } from "./settings.js";
import { weeklyReport } from "./kpi-weekly.js";

// 週會一頁: the weekly report in the order a manager listens to it —
// ① results ② what I did this week ③ where I need help ④ next week.
// Everything is read from what Ocean already records; only the "help needed" sentences are typed.

export const ASKS_KEY = "kpiMeetingAsks";
const ASK_LIMIT = 3;

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const inRange = (date, start, end) => Boolean(date) && date >= start && date <= end;

// Green: on pace. Yellow: behind pace but open cases can still close the gap. Red: neither.
export function goalLight(goal) {
  if (goal.behindPace >= 0) return "green";
  return goal.projected >= goal.target ? "yellow" : "red";
}

function work(model, period) {
  const activities = (model.all.activity || []).filter((activity) => !activity.archivedAt && inRange(activity.activityDate, period.start, period.end));
  const firstContact = new Map();
  for (const activity of model.all.activity || []) {
    if (activity.archivedAt || !activity.customerId || !activity.activityDate) continue;
    const seen = firstContact.get(activity.customerId);
    if (!seen || activity.activityDate < seen) firstContact.set(activity.customerId, activity.activityDate);
  }
  const customers = new Set(activities.map((activity) => activity.customerId).filter(Boolean));
  const newCustomers = [...customers].filter((id) => inRange(firstContact.get(id), period.start, period.end));
  const orders = (model.all.order || []).filter((order) => !order.archivedAt && order.status !== "已取消" && order.source === "LINE" && inRange(order.orderDate, period.start, period.end));
  const orderAmount = orders.reduce((sum, order) => sum + (model.itemsByOrder.get(order.id) || []).reduce((total, item) => total + number(item.amount), 0), 0);
  return {
    activities: activities.length,
    onSite: activities.filter((activity) => activity.channel === "親訪").length,
    calls: activities.filter((activity) => activity.channel === "電話").length,
    others: activities.filter((activity) => !["親訪", "電話"].includes(activity.channel)).length,
    customers: customers.size,
    newCustomers: newCustomers.length,
    orders: orders.length,
    orderAmount,
  };
}

// The cases updated this week (anything in 本週商機更新重點), with their total amount.
function movedCases(report) {
  const rows = report.highlights.rows;
  const won = rows.filter((row) => row.changes.some((change) => change.kind === "won"));
  const lost = rows.filter((row) => row.changes.some((change) => change.kind === "lost"));
  return {
    rows,
    amount: rows.reduce((sum, row) => sum + number(row.opportunity.amount), 0),
    won: { count: won.length, amount: won.reduce((sum, row) => sum + number(row.opportunity.amount), 0) },
    lost: { count: lost.length, amount: lost.reduce((sum, row) => sum + number(row.opportunity.amount), 0) },
  };
}

export function meetingAsks(all, periodDate) {
  const saved = (readSetting(all, ASKS_KEY) || {})[periodDate] || {};
  return { notes: saved.notes || {}, hidden: saved.hidden || [] };
}

// Up to three cases worth asking the manager about: watched with no progress, past the
// expected close date, then late-stage cases with a red flag. Biggest amount first within each.
function blockers(model, report, today, asks) {
  const hidden = new Set(asks.hidden);
  const picked = new Map();
  const add = (opportunity, reason) => {
    if (!opportunity || hidden.has(opportunity.id) || picked.has(opportunity.id) || !isOpen(opportunity)) return;
    picked.set(opportunity.id, { opportunity, reason, ask: asks.notes[opportunity.id] || "" });
  };
  const byAmount = (rows) => [...rows].sort((a, b) => number(b.amount) - number(a.amount));
  report.watched.filter((row) => !row.updated).forEach((row) => add(row.opportunity, "主管關注，本週沒有進度"));
  byAmount(model.openOpportunities.filter((opportunity) => opportunity.expectedCloseDate && opportunity.expectedCloseDate < today))
    .forEach((opportunity) => add(opportunity, `預計 ${opportunity.expectedCloseDate} 結案，已過期`));
  byAmount(model.openOpportunities.filter((opportunity) => ["提案", "議價"].includes(opportunity.stage))).forEach((opportunity) => {
    const flag = caseRedFlags(model, opportunity, today).find((item) => item.level === "red");
    if (flag) add(opportunity, flag.text);
  });
  return { rows: [...picked.values()].slice(0, ASK_LIMIT), more: Math.max(0, picked.size - ASK_LIMIT), hiddenCount: hidden.size };
}

// Next week's planned contacts, and how many of this week's planned ones got done.
function plans(model, period) {
  const nextStart = addDays(period.date, 1);
  const nextEnd = addDays(period.date, 7);
  const reminders = (model.all.reminder || []).filter((reminder) => !reminder.archivedAt);
  const next = reminders.filter((reminder) => reminder.status !== "完成" && inRange(reminder.dueDate, nextStart, nextEnd))
    .map((reminder) => ({ date: reminder.dueDate, customerId: reminder.customerId, text: reminder.title || "聯絡", opportunityId: reminder.opportunityId || "" }));
  const covered = new Set(next.map((row) => row.opportunityId).filter(Boolean));
  for (const opportunity of model.openOpportunities) {
    if (covered.has(opportunity.id) || !inRange(opportunity.reminderDate, nextStart, nextEnd)) continue;
    next.push({ date: opportunity.reminderDate, customerId: opportunity.customerId, text: opportunity.nextAction || `跟進「${opportunity.name}」`, opportunityId: opportunity.id });
  }
  next.sort((a, b) => a.date.localeCompare(b.date));
  const due = reminders.filter((reminder) => inRange(reminder.dueDate, period.start, period.end) || (reminder.status === "完成" && inRange(String(reminder.completedAt || "").slice(0, 10), period.start, period.end) && reminder.dueDate <= period.end));
  return { next, start: nextStart, end: nextEnd, planned: due.length, done: due.filter((reminder) => reminder.status === "完成").length };
}

export function meetingBrief(model, all, today) {
  const report = weeklyReport(model, all, today);
  const asks = meetingAsks(all, report.period.date);
  return {
    report,
    period: report.period,
    goals: report.goals.map((goal) => ({ ...goal, light: goalLight(goal) })),
    filled: Boolean(report.latest),
    work: work(model, report.period),
    cases: movedCases(report),
    blockers: blockers(model, report, today, asks),
    plans: plans(model, report.period),
  };
}

async function putAsks(db, all, periodDate, change, requestId) {
  const every = readSetting(all, ASKS_KEY) || {};
  const current = meetingAsks(all, periodDate);
  // Only the last few meetings are kept.
  const value = Object.fromEntries(Object.entries({ ...every, [periodDate]: change(current) }).sort(([a], [b]) => a.localeCompare(b)).slice(-8));
  const id = settingId(ASKS_KEY);
  return db.transact(requestId, async (tx) => {
    const existing = await tx.get("setting", id);
    if (existing) await tx.update("setting", id, { value });
    else await tx.create("setting", { key: ASKS_KEY, value }, { id });
    return { ok: true };
  });
}

export function saveAsk(db, all, periodDate, opportunityId, text, requestId) {
  return putAsks(db, all, periodDate, (current) => ({ ...current, notes: { ...current.notes, [opportunityId]: String(text || "").trim() } }), requestId);
}

export function hideBlocker(db, all, periodDate, opportunityId, requestId) {
  return putAsks(db, all, periodDate, (current) => ({ ...current, hidden: [...new Set([...current.hidden, opportunityId])] }), requestId);
}

export function showHiddenBlockers(db, all, periodDate, requestId) {
  return putAsks(db, all, periodDate, (current) => ({ ...current, hidden: [] }), requestId);
}

function wan(amount) {
  return `${((Number(amount) || 0) / 10000).toLocaleString("zh-TW", { maximumFractionDigits: 1 })} 萬`;
}

const LIGHT_TEXT = { green: "🟢", yellow: "🟡", red: "🔴" };
const shortDay = (date) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : "");

// The same four sections as plain text, for the Teams chat or LINE.
export function briefText(brief, customerName = () => "") {
  const { period, work: w, cases, blockers: ask, plans: plan } = brief;
  const named = (opportunity) => `${opportunity.name || ""}${customerName(opportunity.customerId) ? `（${customerName(opportunity.customerId)}）` : ""}`;
  const lines = [`Ocean 週會報告（${period.label}）`, "", "① 結果"];
  for (const goal of brief.goals) {
    lines.push(brief.filled
      ? `${LIGHT_TEXT[goal.light]} ${goal.label}：累計 ${wan(goal.actual)}・達成 ${goal.percent}%${goal.weekGain === null ? "" : `・本週 ${goal.weekGain >= 0 ? "+" : "−"}${wan(Math.abs(goal.weekGain))}`}・${goal.behindPace >= 0 ? "超前" : "落後"}進度 ${wan(Math.abs(goal.behindPace))}`
      : `${goal.label}：本週金額未填`);
    if (goal.notes.gap) lines.push(`　差異原因：${goal.notes.gap}`);
  }
  lines.push("", "② 這週做了什麼");
  lines.push(`・聯絡 ${w.activities} 次（親訪 ${w.onSite}、電話 ${w.calls}${w.others ? `、其他 ${w.others}` : ""}），${w.customers} 家客戶${w.newCustomers ? `，其中新客 ${w.newCustomers} 家` : ""}`);
  if (w.orders) lines.push(`・LINE 訂單 ${w.orders} 張，${wan(w.orderAmount)}`);
  lines.push(`・更新案子 ${cases.rows.length} 件，合計 ${wan(cases.amount)}${cases.won.count ? `；成交 ${cases.won.count} 件 ${wan(cases.won.amount)}` : ""}${cases.lost.count ? `；未成交 ${cases.lost.count} 件` : ""}`);
  for (const row of cases.rows.slice(0, 10)) lines.push(`　- ${named(row.opportunity)}：${row.changes.map((change) => change.text).join("、")}・${wan(row.opportunity.amount)}`);
  if (cases.rows.length > 10) lines.push(`　- 另有 ${cases.rows.length - 10} 件`);
  lines.push("", "③ 需要協助");
  if (!ask.rows.length) lines.push("・目前沒有");
  for (const row of ask.rows) lines.push(`・${named(row.opportunity)}：${row.reason}${row.ask ? `→ ${row.ask}` : ""}`);
  lines.push("", `④ 下週計畫（${shortDay(plan.start)}–${shortDay(plan.end)}）`);
  if (plan.planned) lines.push(`・本週排定 ${plan.planned} 件，完成 ${plan.done} 件`);
  if (!plan.next.length) lines.push("・還沒有排定");
  for (const row of plan.next.slice(0, 10)) lines.push(`・${shortDay(row.date)} ${customerName(row.customerId)}：${row.text}`);
  if (plan.next.length > 10) lines.push(`・另有 ${plan.next.length - 10} 件`);
  for (const goal of brief.goals) if (goal.notes.next) lines.push(`・${goal.label.split(" ")[0]}：${goal.notes.next}`);
  return lines.join("\n");
}
