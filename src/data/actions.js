import { daysBetween } from "../core/dates.js";
import { caseRedFlags } from "./case-analysis.js";
import { lastActivity, primaryContact } from "./model.js";
import { opportunityTitle } from "./products.js";
import { buildToday } from "./today.js";

export const NOW_LIMIT = 7;

const VERBS = { 報價: "報價給", 送樣: "送樣給", 會後信: "寄會後信給", 拜訪: "拜訪", 經營: "關心", 行動: "跟進" };

function lastSaid(model, customerId) {
  const last = lastActivity(model, customerId);
  if (!last) return "";
  const text = String(last.summary || last.detailedNote || "").split("\n")[0].trim();
  return `${last.activityDate} ${last.channel || ""}：${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`.trim();
}

function action(model, item, today, extra = {}) {
  const customer = model.customersById.get(item.customerId);
  const contact = primaryContact(model, item.customerId);
  const opportunity = item.opportunityId ? model.opportunitiesById.get(item.opportunityId) : null;
  const verb = VERBS[item.reminderKind] || "聯絡";
  const late = item.dueDate && item.dueDate < today ? daysBetween(item.dueDate, today) : 0;
  return {
    key: `${item.kind}:${item.id}`,
    kind: item.kind,
    id: item.id,
    customerId: item.customerId,
    contact,
    title: `${verb} ${customer?.name || "（未知客戶）"}${contact ? `・${contact.name}` : ""}`,
    why: [item.title, opportunity ? `商機「${opportunityTitle(opportunity, 24)}」${opportunity.stage}` : null].filter(Boolean).join("・"),
    last: lastSaid(model, item.customerId),
    dueDate: item.dueDate,
    late,
    opportunityId: item.opportunityId || (item.kind === "opportunity" ? item.id : ""),
    ...extra,
  };
}

// The home screen: a short list of things to do now, today's visits, new-purchase
// leads, and one line for everything overdue. Nothing here grows without bound.
export function buildActions(model, { today, myAreas = [] } = {}) {
  const base = buildToday(model, { today, myAreas });
  const reminderById = new Map((model.all.reminder || []).map((reminder) => [reminder.id, reminder]));
  const asItem = (reminder) => ({ kind: "reminder", id: reminder.id, customerId: reminder.customerId, title: reminder.title, dueDate: reminder.dueDate, opportunityId: reminder.opportunityId, reminderKind: reminder.kind });

  const now = base.followUps.map((item) => action(model, item.kind === "reminder" ? asItem(reminderById.get(item.id)) : item, today));
  // Free slots go to the most recently overdue reminders (still actionable); older ones
  // wait in the clean-up list so "do now" never grows past the limit.
  const recentFirst = [...base.overdueReminders].sort((left, right) => String(right.dueDate).localeCompare(String(left.dueDate)));
  for (const reminder of recentFirst) {
    if (now.length >= NOW_LIMIT) break;
    now.push(action(model, asItem(reminder), today));
  }
  // Then the most recently overdue opportunities (buildToday already sorts them that way).
  for (const opportunity of base.overdueOpportunities) {
    if (now.length >= NOW_LIMIT) break;
    now.push(action(model, { kind: "opportunity", id: opportunity.id, customerId: opportunity.customerId, title: opportunity.attention?.label || "需要更新", dueDate: opportunity.reminderDate || opportunity.expectedCloseDate, opportunityId: opportunity.id, reminderKind: "行動" }, today));
  }
  const shown = new Set(now.map((item) => item.key));
  const overdueReminders = base.overdueReminders.filter((reminder) => !shown.has(`reminder:${reminder.id}`));
  const overdueOpportunities = base.overdueOpportunities.filter((opportunity) => !shown.has(`opportunity:${opportunity.id}`));
  const redCases = model.openOpportunities.filter((opportunity) => ["提案", "議價"].includes(opportunity.stage)
    && caseRedFlags(model, opportunity, today).some((flag) => flag.level === "red")).length;

  return {
    today,
    now: now.slice(0, NOW_LIMIT),
    moreNow: Math.max(0, now.length - NOW_LIMIT),
    schedule: base.plannedVisits.map((reminder) => action(model, asItem(reminder), today)),
    signals: base.newOrderSignals.slice(0, 3),
    signalCount: base.newOrderSignals.length,
    // `count` is what is not already on screen; the clean-up page lists everything overdue.
    overdue: { reminders: overdueReminders, opportunities: overdueOpportunities, count: overdueReminders.length + overdueOpportunities.length, allReminders: base.overdueReminders, allOpportunities: base.overdueOpportunities },
    redCases,
    progress: base.progress,
    kpi: base.kpi,
  };
}
