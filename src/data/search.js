import { comparisonKey } from "../core/text.js";
import { searchCustomers } from "./customers.js";

// A short piece of text around the first place the query appears (falls back to the start).
export function snippet(text, query, width = 60) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const needle = String(query || "").trim();
  const at = needle ? value.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (at < 0) return value.length > width ? `${value.slice(0, width)}…` : value;
  const start = Math.max(0, at - Math.floor(width / 3));
  const piece = value.slice(start, start + width);
  return `${start > 0 ? "…" : ""}${piece}${start + width < value.length ? "…" : ""}`;
}

const matches = (query) => {
  const key = comparisonKey(query);
  return (...values) => values.some((value) => comparisonKey(value).includes(key));
};

// One box finds everything: customers (incl. contacts and phone digits), what was said
// in visits, opportunities and ordered products. Each group is capped; totals are kept.
export function globalSearch(model, query, { myAreas = [], today, limit = 8 } = {}) {
  const empty = { query: "", customers: [], activities: [], opportunities: [], items: [], totals: { customers: 0, activities: 0, opportunities: 0, items: 0 } };
  if (!comparisonKey(query)) return empty;
  const hit = matches(query);
  const customers = searchCustomers(model, { query, myAreas, today, limit });
  const live = (customerId) => model.customersById.get(customerId) && !model.customersById.get(customerId).archivedAt;
  const activities = (model.all.activity || [])
    .filter((activity) => !activity.archivedAt && live(activity.customerId) && hit(activity.detailedNote, activity.summary, activity.nextAction))
    .sort((left, right) => String(right.activityDate || "").localeCompare(String(left.activityDate || "")));
  const opportunities = (model.all.opportunity || [])
    .filter((opportunity) => !opportunity.archivedAt && live(opportunity.customerId) && hit(opportunity.name, opportunity.product, opportunity.nextAction, opportunity.notes))
    .sort((left, right) => Number(["接觸", "提案", "議價"].includes(right.stage)) - Number(["接觸", "提案", "議價"].includes(left.stage)) || String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  const items = (model.all.orderItem || [])
    .filter((item) => !item.archivedAt && hit(item.productName, item.productCode))
    .map((item) => ({ item, order: model.ordersById.get(item.orderId) }))
    .filter(({ order }) => order && !order.archivedAt)
    .sort((left, right) => String(right.order.orderDate || "").localeCompare(String(left.order.orderDate || "")));
  return {
    query,
    customers: customers.items,
    activities: activities.slice(0, limit).map((activity) => ({ activity, text: snippet(activity.detailedNote || activity.summary, query) })),
    opportunities: opportunities.slice(0, limit),
    items: items.slice(0, limit),
    totals: { customers: customers.total, activities: activities.length, opportunities: opportunities.length, items: items.length },
  };
}
