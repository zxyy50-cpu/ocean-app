import { addDays } from "../core/dates.js";
import { draftChecks, finishItem, salutationFor } from "./order-intake.js";

// 常購快速下單: what a customer buys again and again, picked by hand instead of read from a message.
// Built from the same reference data (歷年購買紀錄_整理版 + LINE訂單整理) as the LINE order intake.

// One row per product this customer bought, most often bought first, then most recent.
export function customerPurchases(reference, customerNo, { today, recentDays = 365 } = {}) {
  if (!customerNo) return [];
  const byCode = new Map();
  for (const entry of reference.history) {
    if (entry.customerNo !== customerNo || !entry.code) continue;
    const row = byCode.get(entry.code) || { code: entry.code, count: 0, dates: new Set(), last: null };
    // A LINE row and the shipment of the same order on the same day count once.
    if (!row.dates.has(entry.date)) { row.dates.add(entry.date); row.count += 1; }
    if (!row.last || String(entry.date) > String(row.last.date)) row.last = entry;
    byCode.set(entry.code, row);
  }
  const since = today ? addDays(today, -recentDays) : "";
  return [...byCode.values()].map((row) => {
    const product = reference.products.get(row.code);
    return {
      code: row.code, name: product?.name || row.last.name, nameZh: product?.nameZh || "", spec: product?.spec || row.last.spec,
      count: row.count, lastDate: row.last.date, lastQuantity: row.last.quantity, lastPrice: row.last.unitPrice, lastSource: row.last.source,
      recent: !since || String(row.last.date) >= since, inCatalog: Boolean(product),
    };
  }).sort((left, right) => right.count - left.count || String(right.lastDate).localeCompare(String(left.lastDate)));
}

// 「照上次訂單」: every product on the customer's most recent order date, with that order's quantities.
export function lastOrder(reference, customerNo) {
  const entries = reference.history.filter((entry) => entry.customerNo === customerNo && entry.code);
  if (!entries.length) return { date: "", items: [] };
  const date = entries.reduce((latest, entry) => (String(entry.date) > latest ? String(entry.date) : latest), "");
  const items = new Map();
  for (const entry of entries.filter((item) => item.date === date)) {
    if (!items.has(entry.code)) items.set(entry.code, { code: entry.code, quantity: entry.quantity });
  }
  return { date, items: [...items.values()] };
}

// Picked rows → the same draft the message parser produces, so review, texts and sheet writing are shared.
export function draftFromPicks({ customer, picks, reference, today, salutations = {} }) {
  // One contact on file is used; with several, the user picks who is ordering (no guessing who to greet).
  const known = [...(reference.customers.get(customer.customerNo)?.contacts || [])];
  const contact = customer.contact || (known.length === 1 ? known[0] : "");
  const fullCustomer = {
    customerNo: customer.customerNo || "", customerId: customer.customerId || "", company: customer.company || "", contact, contactChoices: known,
    status: "確定", why: "從常購清單選取", candidates: [], mentions: [], phone: "",
    salutation: customer.salutation || salutationFor(contact, salutations),
  };
  const items = picks.map((pick) => finishItem({
    said: reference.products.get(pick.code)?.name || pick.name || pick.code, code: pick.code, codeStatus: "確定", codeWhy: "從購買紀錄選取",
    candidates: [pick.code], quantity: pick.quantity ?? null, spokenUnit: pick.unit || "", specified: null,
    manualPrice: pick.price === undefined || pick.price === null || pick.price === "" ? null : Number(pick.price), contextChecks: [],
  }, { reference, customerNo: fullCustomer.customerNo, today }));
  return {
    date: today, raw: "（常購快速下單）", customer: fullCustomer, items,
    delivery: { value: "寄送", source: "預設" }, taxType: { value: "未稅", source: "預設" },
    shipTime: "", urgent: false, notes: [], checks: draftChecks(fullCustomer, items, []),
  };
}
