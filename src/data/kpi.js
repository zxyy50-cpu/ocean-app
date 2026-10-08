import { addDays } from "../core/dates.js";
import { customerInAreas } from "./tags.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Rows from the KPI workbook's 02_業績總覽 sheet (G1/G2/G3) as read-only targets.
export function overviewTargets(kpis = []) {
  return kpis.map((kpi) => {
    const label = String(kpi.raw?.["業績目標"] || "").trim();
    if (!/^G[123](?:\s|：|:)/i.test(label)) return null;
    const target = number(kpi.raw?.["A   ≧1840萬"]);
    if (!target) return null;
    return {
      id: kpi.id, label, target, actual: number(kpi.raw?.["B    ≧ 1656萬"]),
      progressPercent: Math.round(number(kpi.raw?.["C   ≧ 1600萬"]) * 1000) / 10,
      grade: String(kpi.raw?.["D  未達C標"] || ""), gapToC: number(kpi.raw?.["第一季目標"]),
    };
  }).filter(Boolean);
}

export function periodRange(period, today) {
  const [year, month] = today.split("-").map(Number);
  if (period === "month") return { start: `${today.slice(0, 7)}-01`, end: today, label: `${month} 月` };
  if (period === "quarter") {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return { start: `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`, end: today, label: `第 ${Math.floor((month - 1) / 3) + 1} 季` };
  }
  return { start: `${year}-01-01`, end: today, label: `${year} 年` };
}

export function buildKpi(model, { period = "month", today, myAreas = [], mineOnly = false } = {}) {
  const range = periodRange(period, today);
  const inRange = (date) => date && date >= range.start && date <= range.end;
  const customerOk = (id) => {
    const customer = model.customersById.get(id);
    return customer && !customer.archivedAt && (!mineOnly || customerInAreas(customer, myAreas));
  };
  const live = (type) => (model.all[type] || []).filter((record) => !record.archivedAt);
  const activities = live("activity").filter((activity) => customerOk(activity.customerId) && inRange(activity.activityDate));
  const opportunities = live("opportunity").filter((opportunity) => customerOk(opportunity.customerId));
  const open = opportunities.filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
  const won = opportunities.filter((opportunity) => opportunity.stage === "成交" && inRange(String(opportunity.closedAt || "").slice(0, 10)));
  const created = opportunities.filter((opportunity) => inRange(String(opportunity.createdAt || "").slice(0, 10)) && opportunity.source !== "匯入");
  const contacted = new Set(activities.map((activity) => activity.customerId));
  const funnel = ["接觸", "提案", "議價", "成交", "失敗"].map((stage) => {
    const items = opportunities.filter((opportunity) => opportunity.stage === stage);
    return { stage, count: items.length, amount: items.reduce((sum, opportunity) => sum + number(opportunity.amount), 0) };
  });
  const year = today.slice(0, 4);
  const monthly = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, amount: 0 }));
  for (const order of live("order")) {
    if (!customerOk(order.customerId) || !String(order.orderDate || "").startsWith(year) || order.status === "已取消") continue;
    const amount = (model.itemsByOrder.get(order.id) || []).reduce((sum, item) => sum + number(item.amount), 0);
    monthly[Number(order.orderDate.slice(5, 7)) - 1].amount += amount;
  }
  const signals = live("orderItem").filter((item) => item.handledAt && inRange(String(item.handledAt).slice(0, 10)));
  return {
    range,
    activity: {
      visits: activities.length,
      onSite: activities.filter((activity) => activity.channel === "親訪").length,
      customersContacted: contacted.size,
      opportunitiesCreated: created.length,
      wonAmount: won.reduce((sum, opportunity) => sum + number(opportunity.amount), 0),
      wonCount: won.length,
      weightedPipeline: Math.round(open.reduce((sum, opportunity) => sum + number(opportunity.amount) * number(opportunity.probability) / 100, 0)),
      overdue: open.filter((opportunity) => (opportunity.expectedCloseDate && opportunity.expectedCloseDate < today) || (opportunity.reminderDate && opportunity.reminderDate < today)).length,
      signalsHandled: signals.length,
      idleImportant: model.customers.filter((customer) => customer.important && (!mineOnly || customerInAreas(customer, myAreas)) && (!customer.lastContactAt || customer.lastContactAt < addDays(today, -60))).length,
    },
    funnel,
    monthly,
  };
}
