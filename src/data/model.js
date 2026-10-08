import { companyKey } from "../core/text.js";
import { OPEN_OPPORTUNITY_STAGES } from "./schema.js";

function groupBy(records, field) {
  const map = new Map();
  for (const record of records) {
    const key = record[field];
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

const byDateDesc = (field) => (left, right) => String(right[field] || "").localeCompare(String(left[field] || ""));

// Read-side indexes rebuilt from the database snapshot after each change.
export function buildModel(all) {
  const active = (type) => (all[type] || []).filter((record) => !record.archivedAt);
  const customers = active("customer");
  const model = {
    all,
    customers,
    customersById: new Map((all.customer || []).map((customer) => [customer.id, customer])),
    contactsByCustomer: groupBy(active("contact"), "customerId"),
    activitiesByCustomer: groupBy(active("activity").sort(byDateDesc("activityDate")), "customerId"),
    opportunitiesByCustomer: groupBy(active("opportunity"), "customerId"),
    remindersByCustomer: groupBy(active("reminder"), "customerId"),
    ordersByCustomer: groupBy(active("order").sort(byDateDesc("orderDate")), "customerId"),
    itemsByOrder: groupBy(active("orderItem"), "orderId"),
    stakeholdersByOpportunity: groupBy(active("stakeholder"), "opportunityId"),
    remindersByOpportunity: groupBy(active("reminder"), "opportunityId"),
    ordersById: new Map((all.order || []).map((order) => [order.id, order])),
    opportunitiesById: new Map((all.opportunity || []).map((opportunity) => [opportunity.id, opportunity])),
  };
  model.customerName = (id) => model.customersById.get(id)?.name || "（未知客戶）";
  // How many other active customers share this company name (used to tell twins apart).
  const nameCounts = new Map();
  customers.forEach((customer) => { const key = companyKey(customer.name); if (key) nameCounts.set(key, (nameCounts.get(key) || 0) + 1); });
  model.sameNameCount = (customer) => Math.max(0, (nameCounts.get(companyKey(customer?.name)) || 1) - 1);
  model.openOpportunities = active("opportunity").filter((opportunity) => OPEN_OPPORTUNITY_STAGES.includes(opportunity.stage));
  return model;
}

// Spreadsheet error values (#N/A, #REF! …) came in as contact names during import.
const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NULL!|NUM!)$/i;

export function primaryContact(model, customerId) {
  const contacts = (model.contactsByCustomer.get(customerId) || []).filter((contact) => !SHEET_ERROR.test(String(contact.name || "").trim()));
  return contacts.find((contact) => contact.isPrimary) || contacts[0] || null;
}

export function lastActivity(model, customerId) {
  return (model.activitiesByCustomer.get(customerId) || [])[0] || null;
}

// A short "which one is this" line: number, main contact, area, last contact and activity.
export function customerIdentity(model, customer) {
  if (!customer) return "";
  const contact = primaryContact(model, customer.id);
  const open = (model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => OPEN_OPPORTUNITY_STAGES.includes(opportunity.stage)).length;
  const visits = (model.activitiesByCustomer.get(customer.id) || []).length;
  return [
    customer.customerNo ? `#${customer.customerNo}` : "無客戶編號",
    contact?.name,
    (customer.areaTags || [])[0],
    customer.lastContactAt ? `最近聯絡 ${customer.lastContactAt}` : "尚未聯絡",
    visits ? `拜訪 ${visits}` : null,
    open ? `商機 ${open}` : null,
  ].filter(Boolean).join("・");
}
