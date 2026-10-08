import { addDays, isDateOnly } from "../core/dates.js";
import { cleanText } from "../core/text.js";
import { createOpportunityIn } from "./opportunities.js";
import { ITEM_CLASSIFICATIONS, ORDER_STATUSES } from "./schema.js";

const { first: FIRST, repeat: REPEAT, review: REVIEW } = ITEM_CLASSIFICATIONS;

export function purchaseKey(customerNo, productCode) {
  const customer = cleanText(customerNo).toUpperCase();
  const product = cleanText(productCode).toUpperCase().replace(/\s+/g, "");
  return customer && product ? `${customer}|${product}` : "";
}

function orderCustomerNo(order, item, customersById) {
  return cleanText(item.customerNo) || cleanText(order?.customerNo) || cleanText(customersById.get(order?.customerId)?.customerNo);
}

// Decides, per item, whether this customer had bought the same product code before.
// Pure: returns the classification and the evidence so the UI can show why.
export function classifyItems(all) {
  const orders = new Map((all.order || []).filter((order) => !order.archivedAt).map((order) => [order.id, order]));
  const customersById = new Map((all.customer || []).map((customer) => [customer.id, customer]));
  const items = (all.orderItem || []).filter((item) => !item.archivedAt && orders.has(item.orderId))
    .map((item) => ({ item, order: orders.get(item.orderId) }))
    .sort((left, right) => String(left.order.orderDate || "").localeCompare(String(right.order.orderDate || "")) || String(left.order.createdAt).localeCompare(String(right.order.createdAt)) || String(left.order.id).localeCompare(String(right.order.id)));
  const history = new Map();
  const historyStart = items[0]?.order.orderDate || "";
  const results = new Map();
  for (const { item, order } of items) {
    const customerNo = orderCustomerNo(order, item, customersById);
    const productCode = cleanText(item.productCode);
    if (!customerNo || !productCode) {
      results.set(item.id, { classification: REVIEW, basis: !customerNo ? "缺少客戶編號，無法比對歷史購買" : "缺少產品代碼，無法比對歷史購買", customerNo });
      continue;
    }
    if (/[；;,，、/]/.test(productCode)) {
      results.set(item.id, { classification: REVIEW, basis: "同一列有多個料號，請拆成單一料號後再比對", customerNo });
      continue;
    }
    const key = purchaseKey(customerNo, productCode);
    const prior = history.get(key);
    if (prior && prior.orderId !== order.id) {
      results.set(item.id, { classification: REPEAT, basis: `客戶 ${customerNo} 於 ${prior.orderDate || "先前"} 已購買 ${productCode}`, customerNo });
    } else if (prior) {
      results.set(item.id, { classification: prior.classification, basis: prior.basis, customerNo });
    } else {
      const basis = `比對 ${historyStart || "最早"} 起的訂單，客戶 ${customerNo} 未曾購買 ${productCode}`;
      results.set(item.id, { classification: FIRST, basis, customerNo });
      history.set(key, { orderId: order.id, orderDate: order.orderDate, classification: FIRST, basis });
    }
  }
  return results;
}

// Applies classifications; only items on or after `signalSince` become reminders, so
// importing years of history does not flood the order center.
export async function refreshClassifications(db, { signalSince, requestId } = {}) {
  const all = db.peekAll();
  const results = classifyItems(all);
  const orders = new Map((all.order || []).map((order) => [order.id, order]));
  const updates = [];
  for (const item of all.orderItem || []) {
    const result = results.get(item.id);
    if (!result) continue;
    const order = orders.get(item.orderId);
    const patch = {};
    if (item.classification !== result.classification) patch.classification = result.classification;
    if (item.basis !== result.basis) patch.basis = result.basis;
    if (!item.customerNo && result.customerNo) patch.customerNo = result.customerNo;
    if (result.classification === FIRST && !item.signalStatus && order?.orderDate >= signalSince) patch.signalStatus = "待處理";
    if (result.classification !== FIRST && item.signalStatus === "待處理") patch.signalStatus = "";
    if (Object.keys(patch).length) updates.push([item.id, patch]);
  }
  if (!updates.length) return { ok: true, value: { updated: 0 } };
  return db.transact(requestId || null, async (tx) => {
    for (const [id, patch] of updates) await tx.update("orderItem", id, patch);
    return { updated: updates.length };
  });
}

export function defaultSignalSince(today) {
  return addDays(today, -30);
}

export function buildOpportunityDraft(order, item, today) {
  return {
    customerId: order.customerId,
    name: `${item.productName || item.productCode} 擴大使用`,
    product: [item.productName, item.productCode].filter(Boolean).join("／"),
    stage: "接觸",
    amount: item.amount ?? "",
    expectedCloseDate: addDays(today, 30),
    notes: `來源：${order.orderDate || ""} ${order.source || ""} 訂單首次購買 ${item.productCode || ""}，數量 ${item.quantity ?? ""}`,
  };
}

export async function createOpportunityFromSignal(db, itemId, input, requestId) {
  return db.transact(requestId, async (tx) => {
    const item = await tx.get("orderItem", itemId);
    if (!item) tx.fail("not-found");
    const existing = (await tx.list("opportunity", { includeArchived: true })).find((opportunity) => opportunity.sourceOrderItemId === itemId);
    if (existing || item.linkedOpportunityId) {
      return { opportunity: existing || (await tx.get("opportunity", item.linkedOpportunityId)), duplicate: true };
    }
    const opportunity = await createOpportunityIn(tx, input, { source: "訂單首購", sourceOrderItemId: itemId });
    await tx.update("orderItem", itemId, { signalStatus: "已建商機", linkedOpportunityId: opportunity.id, handledAt: tx.now(), handledBy: tx.actor });
    return { opportunity, duplicate: false };
  });
}

export async function dismissSignal(db, itemId, note, requestId) {
  return db.transact(requestId, async (tx) => {
    const item = await tx.get("orderItem", itemId);
    if (!item) tx.fail("not-found");
    return tx.update("orderItem", itemId, { signalStatus: "不處理", signalNote: cleanText(note) || "業務判斷不需跟進", handledAt: tx.now(), handledBy: tx.actor });
  });
}

export async function reopenSignal(db, itemId, requestId) {
  return db.transact(requestId, async (tx) => {
    const item = await tx.get("orderItem", itemId);
    if (!item || item.signalStatus !== "不處理") tx.fail("not-dismissed");
    return tx.update("orderItem", itemId, { signalStatus: "待處理", signalNote: "", handledAt: null, handledBy: "" });
  });
}

export async function updateOrderStatus(db, orderId, status, requestId) {
  if (!ORDER_STATUSES.includes(status)) return { ok: false, error: "validation", errors: { status: "訂單狀態不正確" } };
  return db.update("order", orderId, { status }, requestId);
}

export function validateOrder(input = {}) {
  const errors = {};
  if (!cleanText(input.customerId)) errors.customerId = "請選擇客戶";
  if (!isDateOnly(input.orderDate)) errors.orderDate = "請選擇訂單日期";
  if (input.status && !ORDER_STATUSES.includes(input.status)) errors.status = "訂單狀態不正確";
  const items = (input.items || []).filter((item) => Object.values(item).some((value) => String(value ?? "").trim()));
  if (!items.length) errors.items = "至少需要一個品項";
  items.forEach((item, index) => {
    if (!cleanText(item.productCode) && !cleanText(item.productName)) errors[`items.${index}.productName`] = `第 ${index + 1} 項缺少品名或料號`;
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) errors[`items.${index}.quantity`] = `第 ${index + 1} 項數量需大於 0`;
    if (String(item.unitPrice ?? "").trim() && !Number.isFinite(Number(item.unitPrice))) errors[`items.${index}.unitPrice`] = `第 ${index + 1} 項單價不正確`;
  });
  return { ok: !Object.keys(errors).length, errors, items };
}

export async function createOrder(db, input, requestId) {
  const validation = validateOrder(input);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, async (tx) => {
    const customer = await tx.get("customer", input.customerId);
    if (!customer || customer.archivedAt) tx.fail("validation", { errors: { customerId: "客戶不存在或已封存" } });
    const order = await tx.create("order", {
      orderNo: cleanText(input.orderNo), customerId: customer.id, customerNo: customer.customerNo || "", customerName: customer.name,
      orderDate: input.orderDate, status: input.status || "待確認", source: cleanText(input.source) || "手動", deliveryMethod: cleanText(input.deliveryMethod),
      taxType: cleanText(input.taxType), notes: String(input.notes ?? "").trim(), rawMessage: String(input.rawMessage ?? "").trim(),
    });
    for (const item of validation.items) {
      const quantity = Number(item.quantity);
      const unitPrice = String(item.unitPrice ?? "").trim() ? Number(item.unitPrice) : null;
      await tx.create("orderItem", {
        orderId: order.id, customerNo: customer.customerNo || "", productCode: cleanText(item.productCode), productName: cleanText(item.productName), spec: cleanText(item.spec),
        quantity, unit: cleanText(item.unit), unitPrice, amount: unitPrice === null ? null : quantity * unitPrice,
        classification: "", basis: "", signalStatus: "", signalNote: "", handledAt: null, handledBy: "", linkedOpportunityId: "",
      });
    }
    return order;
  });
}

export function orderTotal(items = []) {
  return items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}
