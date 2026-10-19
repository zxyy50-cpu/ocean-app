import { uuid } from "../core/ids.js";
import { cleanText, comparisonKey } from "../core/text.js";
import { aliasKey, lineOrderRows, LINE_ORDER_STATUSES, withTax } from "./order-intake.js";
import { emptyReference, normalizeReference, tablesToRecords } from "./order-reference.js";
import { readSetting, saveSetting } from "./settings.js";

// Storage and Google Sheets side of LINE orders.
// The reference tables are cached on the device (meta "orderReference") so the page works offline;
// an order is saved in the app first, then written to LINE訂單整理. 「已給秘書」/「已更新購買紀錄」 are
// only set after the user confirms, in the sheet first and then in the app.

export const LINE_SHEETS = Object.freeze({ live: "LINE訂單整理", test: "LINE訂單整理_測試" });
const REFERENCE_META = "orderReference";
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
let cached = { key: "", reference: null };

export async function loadReference(db) {
  const stored = await db.getMeta(REFERENCE_META, null);
  if (!stored) return { reference: emptyReference(), loadedAt: "", stale: true };
  if (cached.key !== stored.loadedAt) cached = { key: stored.loadedAt, reference: normalizeReference(stored) };
  return { reference: cached.reference, loadedAt: stored.loadedAt, stale: Date.now() - Date.parse(stored.loadedAt || 0) > REFRESH_AFTER_MS };
}

export async function refreshReference(db, transport) {
  if (!transport) return { ok: false, message: "還沒連上 Google 試算表（設定 → 同步）" };
  try {
    const payload = await transport.call("orderReference");
    const tables = tablesToRecords(payload);
    await db.setMeta(REFERENCE_META, tables);
    cached = { key: "", reference: null };
    return { ok: true, counts: { customers: tables.customers.length, products: tables.products.length, history: tables.history.length, lineOrders: tables.lineOrders.length } };
  } catch (error) {
    return { ok: false, message: explainServerError(error) };
  }
}

// Turns what the Apps Script answers into something the user can act on.
export function explainServerError(error) {
  const message = String(error?.message || error || "");
  if (/Unknown action/i.test(message)) return "Apps Script 還是舊版本，沒有訂單功能：請更新並重新部署 Apps Script（同步中心 →「測試連線」可看細節）";
  if (/OCEAN_COMPANY_SPREADSHEET_ID/.test(message)) return "Apps Script 還沒設定公司試算表：請在指令碼屬性加上 OCEAN_COMPANY_SPREADSHEET_ID";
  if (/找不到分頁/.test(message)) return message;
  if (error?.auth) return `Google 登入問題：${message}`;
  return message || "讀取失敗";
}

// 「測試連線」: each step in order, stopping at the first one that cannot work, with the reason in words.
export async function testConnection(ctx) {
  const steps = [];
  const add = (name, ok, detail) => { steps.push({ name, ok, detail }); return ok; };
  const config = await ctx.db.getMeta("syncConfig", null);
  if (!add("這台裝置的同步設定", Boolean(config), config ? "已設定 Web App 網址與 Google 用戶端 ID" : "這個瀏覽器還沒設定同步（每個瀏覽器、每個網址各自要設定一次）")) return steps;
  if (!add("同步程式", Boolean(ctx.transport), ctx.transport ? "已啟動" : "還沒啟動，請按「儲存並連線」")) return steps;
  try {
    const ping = await ctx.transport.call("ping");
    add("Google 登入與存取權限", true, ping.email ? "已登入，帳號在允許名單內" : "已連線");
    if ((ping.version || 1) < 2) {
      add("Apps Script 版本", false, "Apps Script 還是舊版本：同步可以用，但沒有 LINE 訂單需要的功能，請更新並重新部署");
      return steps;
    }
    add("Apps Script 版本", true, `第 ${ping.version} 版`);
  } catch (error) {
    add("Google 登入與存取權限", false, error.auth ? `${error.message}（到設定 → 同步連線重新登入）` : `連不到 Apps Script：${error.message}`);
    return steps;
  }
  try {
    const report = await ctx.transport.call("diagnose");
    for (const check of report.checks || []) if (check.name !== "登入與權限") add(check.name, check.ok, check.detail);
  } catch (error) {
    add("試算表檢查", false, explainServerError(error));
  }
  return steps;
}

export function orderAliases(all) {
  return readSetting(all, "orderAliases") || {};
}

export function savedSalutations(all) {
  return readSetting(all, "orderSalutations") || {};
}

// 「羊血」 is CMP0400950: remembered for this customer, and for everyone if nobody said otherwise.
export async function learnAlias(db, all, { said, code, customerNo }, requestId) {
  const key = aliasKey(said);
  if (!key || !code) return { ok: true };
  const aliases = { ...orderAliases(all) };
  if (customerNo) aliases[`${customerNo}|${key}`] = code;
  if (!aliases[key]) aliases[key] = code;
  return saveSetting(db, "orderAliases", aliases, requestId);
}

export async function saveSalutation(db, all, contact, salutation, requestId) {
  const key = comparisonKey(contact);
  if (!key || !cleanText(salutation)) return { ok: true };
  return saveSetting(db, "orderSalutations", { ...savedSalutations(all), [key]: cleanText(salutation) }, requestId);
}

function itemNote(item) {
  return [item.priceSource ? `價格來源：${item.priceSource}` : "", ...item.checks.map((check) => `${check.soft ? "" : "待確認："}${check.text}`)].filter(Boolean).join("；");
}

// Saves the order in the app (status 待確認). Each item gets an APP編號 used to find its sheet row later.
export async function saveLineOrder(db, draft, requestId) {
  const orderKey = uuid().slice(0, 8).toUpperCase();
  const appIds = draft.items.map((_, index) => `L${draft.date.replaceAll("-", "").slice(2)}-${orderKey}-${index + 1}`);
  const result = await db.transact(requestId, async (tx) => {
    const order = await tx.create("order", {
      orderNo: `LINE-${orderKey}`, customerId: draft.customer.customerId || "", customerNo: draft.customer.customerNo || "", customerName: [draft.customer.company, draft.customer.contact].filter(Boolean).join(" "),
      orderDate: draft.date, status: "待確認", source: "LINE", deliveryMethod: draft.delivery.value, taxType: draft.taxType.value,
      notes: [...draft.notes, draft.shipTime].filter(Boolean).join("；"), rawMessage: draft.raw, sourceRef: "line-sheet:pending",
    });
    for (const [index, item] of draft.items.entries()) {
      await tx.create("orderItem", {
        orderId: order.id, customerNo: draft.customer.customerNo || "", productCode: item.codeStatus === "確定" ? item.code : "", productName: item.name || item.said, spec: item.spec,
        quantity: item.quantity, unit: item.unit, unitPrice: item.unitPrice, amount: item.unitPrice !== null && item.quantity ? Math.round(item.unitPrice * item.quantity * 100) / 100 : null,
        classification: "", basis: itemNote(item), signalStatus: "", signalNote: "", handledAt: null, handledBy: "", linkedOpportunityId: "", sourceRef: `line:${appIds[index]}`,
      });
    }
    return order;
  });
  return result.ok ? { ok: true, order: result.value, appIds } : result;
}

export function draftRows(draft, appIds) {
  return lineOrderRows(draft, { appIds, status: "待確認" });
}

// The same rows rebuilt from a saved order, for writing later (e.g. it was saved while offline).
export function savedOrderRows(model, order) {
  return (model.itemsByOrder.get(order.id) || []).map((item) => ({
    日期: String(order.orderDate || "").replaceAll("-", "/"), 客戶姓名: order.customerName || "待確認", 客戶編號: order.customerNo || "待確認",
    產品編號: item.productCode || "待確認", 訂購品項: item.productName, 規格: item.spec || "待確認", 數量: item.quantity ?? "待確認",
    價格: item.unitPrice === null || item.unitPrice === undefined ? "待確認" : order.taxType === "含稅" ? withTax(item.unitPrice) : item.unitPrice, 配送方式: order.deliveryMethod, 稅額: order.taxType, 原始訊息: order.rawMessage,
    備註: [order.notes, String(item.basis || "").split("；").filter((text) => text.startsWith("待確認")).join("；")].filter(Boolean).join("；"),
    狀態: "待確認", APP編號: String(item.sourceRef || "").replace(/^line:/, ""),
  }));
}

export function appIdsOf(model, orderId) {
  return (model.itemsByOrder.get(orderId) || []).map((item) => String(item.sourceRef || "").replace(/^line:/, "")).filter((id) => /^L\d{6}-/.test(id));
}

export function sheetState(order) {
  const match = String(order?.sourceRef || "").match(/^line-sheet:(pending|written)(?::(.+))?$/);
  return match ? { written: match[1] === "written", sheet: match[2] || "" } : null;
}

// Writes the saved order to LINE訂單整理 (or the test copy). Safe to repeat: rows already there are skipped.
export async function writeOrderToSheet(db, transport, { order, rows, sheet }, requestId) {
  if (!transport) return { ok: false, message: "還沒連上 Google 試算表，訂單已存在 App，連線後可再寫入" };
  try {
    const response = await transport.call("appendLineOrders", { sheet, rows });
    await db.update("order", order.id, { sourceRef: `line-sheet:written:${sheet}` }, requestId);
    return { ok: true, written: response.written, duplicates: response.duplicates };
  } catch (error) {
    return { ok: false, message: error.message || "寫入失敗" };
  }
}

// Only after the user confirmed: the sheet first, so the app never claims a status the sheet does not have.
export async function setLineOrderStatus(db, transport, model, order, status, requestId) {
  if (!LINE_ORDER_STATUSES.includes(status)) return { ok: false, message: "狀態不正確" };
  const state = sheetState(order);
  if (state?.written) {
    if (!transport) return { ok: false, message: "還沒連上 Google 試算表，狀態沒有改" };
    try {
      const response = await transport.call("updateLineOrderStatus", { sheet: state.sheet, appIds: appIdsOf(model, order.id), status });
      if (response.missing?.length) return { ok: false, message: `試算表找不到 ${response.missing.length} 列（APP編號 ${response.missing.join("、")}），狀態沒有改` };
    } catch (error) {
      return { ok: false, message: error.message || "更新失敗" };
    }
  }
  const result = await db.update("order", order.id, { status }, requestId);
  return result.ok ? { ok: true } : { ok: false, message: "App 內狀態更新失敗" };
}

// Screenshot → text through the Apps Script (Google Drive OCR).
export async function recognizeImage(transport, file) {
  if (!transport) return { ok: false, message: "截圖辨識需要先連上 Google（設定 → 同步）" };
  if (file.size > 6 * 1024 * 1024) return { ok: false, message: "圖片太大，請裁切後再試（上限約 6MB）" };
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    const response = await transport.call("ocr", { imageBase64: base64, mimeType: file.type || "image/png" });
    return { ok: true, text: String(response.text || "").trim() };
  } catch (error) {
    return { ok: false, message: error.message || "辨識失敗" };
  }
}
