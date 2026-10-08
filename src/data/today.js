import { addDays, daysBetween } from "../core/dates.js";
import { customerInAreas } from "./tags.js";

function weekStart(today) {
  const date = new Date(`${today}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  return addDays(today, 1 - weekday);
}

export function isOpportunityOverdue(opportunity, today) {
  if (!["接觸", "提案", "議價"].includes(opportunity.stage)) return false;
  return Boolean((opportunity.expectedCloseDate && opportunity.expectedCloseDate < today) || (opportunity.reminderDate && opportunity.reminderDate < today));
}

export function opportunityAttention(opportunity, today) {
  if (!isOpportunityOverdue(opportunity, today)) return null;
  if (opportunity.expectedCloseDate && opportunity.expectedCloseDate < today) return { kind: "close", days: daysBetween(opportunity.expectedCloseDate, today), label: `預計結案日已過 ${daysBetween(opportunity.expectedCloseDate, today)} 天` };
  return { kind: "reminder", days: daysBetween(opportunity.reminderDate, today), label: `提醒日已過 ${daysBetween(opportunity.reminderDate, today)} 天` };
}

// Everything the home screen needs, as plain data so it is easy to test.
export function signalInMyAreas(model, item, myAreas = []) {
  const customer = model.customersById.get(model.ordersById.get(item.orderId)?.customerId);
  return !customer || !(customer.areaTags || []).length || customerInAreas(customer, myAreas);
}

export function buildToday(model, { today, myAreas = [] } = {}) {
  const liveCustomer = (id) => { const customer = model.customersById.get(id); return Boolean(customer && !customer.archivedAt); };
  const reminders = (model.all.reminder || []).filter((reminder) => !reminder.archivedAt && liveCustomer(reminder.customerId));
  const open = reminders.filter((reminder) => reminder.status !== "完成");
  const customerFollowUps = model.customers.filter((customer) => customer.nextFollowUpDate && customer.nextFollowUpDate <= today);
  // Any open reminder owns the customer's follow-up, so postponing it doesn't
  // resurface the older date stored on the customer record.
  const coveredByReminder = new Set(open.filter((reminder) => reminder.dueDate).map((reminder) => reminder.customerId));

  const followUps = [
    ...open.filter((reminder) => reminder.dueDate === today && reminder.kind !== "拜訪").map((reminder) => ({ kind: "reminder", id: reminder.id, customerId: reminder.customerId, title: reminder.title, dueDate: reminder.dueDate })),
    ...customerFollowUps.filter((customer) => !coveredByReminder.has(customer.id)).map((customer) => ({ kind: "customer", id: customer.id, customerId: customer.id, title: customer.nextAction || "追蹤客戶", dueDate: customer.nextFollowUpDate })),
    ...model.openOpportunities.filter((opportunity) => opportunity.reminderDate === today && liveCustomer(opportunity.customerId) && !open.some((reminder) => reminder.opportunityId === opportunity.id && reminder.dueDate === today))
      .map((opportunity) => ({ kind: "opportunity", id: opportunity.id, customerId: opportunity.customerId, title: `商機「${opportunity.name}」：${opportunity.nextAction || "跟進"}`, dueDate: today })),
  ].sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));

  const overdueReminders = open.filter((reminder) => reminder.dueDate && reminder.dueDate < today)
    .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));
  const plannedVisits = open.filter((reminder) => reminder.kind === "拜訪" && reminder.dueDate === today);
  const upcoming = open.filter((reminder) => reminder.dueDate > today && reminder.dueDate <= addDays(today, 7))
    .sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate)));
  const overdueOpportunities = model.openOpportunities.filter((opportunity) => liveCustomer(opportunity.customerId) && isOpportunityOverdue(opportunity, today))
    .map((opportunity) => ({ ...opportunity, attention: opportunityAttention(opportunity, today) }))
    // Most recently overdue first: those are still actionable, very old ones are usually stale.
    .sort((left, right) => (left.attention?.days || 0) - (right.attention?.days || 0));
  // New-purchase leads from my areas only; customers without an area (or not matched yet) still show.
  const newOrderSignals = (model.all.orderItem || []).filter((item) => !item.archivedAt && item.signalStatus === "待處理" && signalInMyAreas(model, item, myAreas));

  const activities = (model.all.activity || []).filter((activity) => !activity.archivedAt);
  const start = weekStart(today);
  const visitsThisWeek = activities.filter((activity) => activity.activityDate >= start && activity.activityDate <= today).length;
  const doneToday = activities.filter((activity) => activity.activityDate === today).length
    + reminders.filter((reminder) => reminder.status === "完成" && String(reminder.completedAt || "").slice(0, 10) === today).length;
  const dueToday = followUps.length + plannedVisits.length + overdueReminders.length;
  const pipeline = model.openOpportunities.reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0) * ((Number(opportunity.probability) || 0) / 100), 0);
  const monthPrefix = today.slice(0, 7);
  const wonThisMonth = (model.all.opportunity || []).filter((opportunity) => !opportunity.archivedAt && opportunity.stage === "成交" && String(opportunity.closedAt || "").startsWith(monthPrefix))
    .reduce((sum, opportunity) => sum + (Number(opportunity.amount) || 0), 0);

  const mine = model.customers.filter((customer) => customer.important && customerInAreas(customer, myAreas));
  const since = addDays(today, -90);
  const touched = mine.filter((customer) => customer.lastContactAt && customer.lastContactAt >= since).length;

  return {
    today,
    followUps,
    overdueReminders,
    plannedVisits,
    upcoming,
    overdueOpportunities,
    newOrderSignals,
    progress: { done: doneToday, total: Math.max(doneToday + dueToday, doneToday) },
    exploration: { touched, total: mine.length, percent: mine.length ? Math.round((touched / mine.length) * 100) : 0 },
    kpi: { visitsThisWeek, weightedPipeline: Math.round(pipeline), wonThisMonth, openOpportunities: model.openOpportunities.length },
  };
}
