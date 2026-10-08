import { isDateOnly } from "../core/dates.js";
import { cleanText } from "../core/text.js";

// What else is on the table besides price.
export const CHIPS = Object.freeze([
  "價格", "品質／交期", "品牌價值", "行銷推廣資源", "附加價值", "同業合作", "合作場景", "ROI 說明",
  "市場占有率", "行業經驗", "售前服務", "售後服務", "同業差異", "客製需求", "技術資源", "人力／訓練資源",
]);
// What a concession can be exchanged for.
export const EXCHANGES = Object.freeze(["提高數量", "簽年約／長約", "縮短票期", "預付或訂金", "轉介紹", "案例授權／共同發表", "優先試用新品", "固定下單頻率"]);
export const DEAL_PURPOSES = Object.freeze(["搶市占", "建立案例", "練技術／進入新產業", "賺毛利", "維繫關係"]);
export const MAX_CONCESSIONS = 3;
export const SAY_NO_TEMPLATE = "這個價格我們做不到；但如果數量提到＿＿，或票期改為＿＿，我可以回去再爭取。";

function money(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : Number.NaN;
}

export function normalizeNegotiation(input = {}, previous = {}) {
  return {
    desiredPrice: money(input.desiredPrice),
    walkAway: money(input.walkAway),
    buyerTarget: money(input.buyerTarget),
    buyerWalkAway: money(input.buyerWalkAway),
    batna: String(input.batna ?? "").trim(),
    buyerBatna: String(input.buyerBatna ?? "").trim(),
    purpose: cleanText(input.purpose),
    chips: [...new Set([].concat(input.chips || []).map(cleanText).filter(Boolean))],
    sayNo: String(input.sayNo ?? "").trim(),
    urgency: String(input.urgency ?? "").trim(),
    concessions: Array.isArray(previous.concessions) ? previous.concessions : [],
  };
}

export function validateNegotiation(values) {
  const errors = {};
  for (const key of ["desiredPrice", "walkAway", "buyerTarget", "buyerWalkAway"]) {
    if (Number.isNaN(values[key]) || (values[key] !== null && values[key] < 0)) errors[key] = "請輸入 0 以上的金額";
  }
  if (!errors.desiredPrice && !errors.walkAway && values.desiredPrice !== null && values.walkAway !== null && values.walkAway > values.desiredPrice) errors.walkAway = "離場點不能高於開價";
  return { ok: !Object.keys(errors).length, errors };
}

export function concessionRoom(negotiation = {}) {
  const { desiredPrice, walkAway } = negotiation;
  return Number.isFinite(desiredPrice) && Number.isFinite(walkAway) ? Math.max(0, desiredPrice - walkAway) : null;
}

// 50% → 30% → 20%: each step smaller, so the buyer feels the floor arriving.
export function plan532(room) {
  if (!Number.isFinite(room) || room <= 0) return [];
  const first = Math.round(room * 0.5);
  const second = Math.round(room * 0.3);
  return [first, second, room - first - second];
}

export function zopa(negotiation = {}) {
  const { walkAway, buyerWalkAway } = negotiation;
  if (!Number.isFinite(walkAway) || !Number.isFinite(buyerWalkAway)) return null;
  return buyerWalkAway >= walkAway ? { exists: true, low: walkAway, high: buyerWalkAway } : { exists: false, gap: walkAway - buyerWalkAway };
}

export function currentOffer(negotiation = {}) {
  if (!Number.isFinite(negotiation.desiredPrice)) return null;
  return negotiation.desiredPrice - (negotiation.concessions || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

export function negotiationWarnings(negotiation = {}, stage = "") {
  const warnings = [];
  const concessions = negotiation.concessions || [];
  if (stage === "議價" && !Number.isFinite(negotiation.walkAway)) warnings.push({ level: "red", text: "還沒寫下離場點", hint: "議價前先和內部對齊底線：低於多少寧可不做" });
  if (stage === "議價" && !negotiation.batna) warnings.push({ level: "warn", text: "還沒有替代方案（BATNA）", hint: "沒有替代方案的人，只能接受條件" });
  if (concessions.length >= MAX_CONCESSIONS) warnings.push({ level: "red", text: `已讓價 ${concessions.length} 次`, hint: "超過三次，客戶會覺得「永遠還有空間」；之後只換條件、不再降價" });
  concessions.forEach((item, index) => {
    if (!item.exchange) warnings.push({ level: "warn", text: `第 ${index + 1} 次讓價沒有換回條件`, hint: "每一次讓步都要交換：數量、票期、年約或轉介紹" });
    if (index > 0 && Number(item.amount) >= Number(concessions[index - 1].amount)) warnings.push({ level: "warn", text: `第 ${index + 1} 次讓價沒有比上次小`, hint: "讓價要遞減，觸底感才會出現" });
  });
  const offer = currentOffer(negotiation);
  if (offer !== null && Number.isFinite(negotiation.walkAway) && offer < negotiation.walkAway) warnings.push({ level: "red", text: "目前報價已低於離場點", hint: "守住底線，否則客戶會覺得你一直保有空間" });
  const region = zopa(negotiation);
  if (region && !region.exists) warnings.push({ level: "warn", text: "雙方可能沒有交集", hint: "先改變決定價格的方式（數量、服務、合約年限），或考慮離場" });
  return warnings;
}

export function validateConcession(input = {}, negotiation = {}) {
  const errors = {};
  const amount = money(input.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0) errors.amount = "請輸入讓價金額";
  if (input.date && !isDateOnly(input.date)) errors.date = "日期格式不正確";
  const room = concessionRoom(negotiation);
  const used = (negotiation.concessions || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  if (!errors.amount && room !== null && used + amount > room) errors.amount = `會超過可讓空間（剩 ${room - used}）`;
  return { ok: !Object.keys(errors).length, errors, amount };
}

export async function saveNegotiation(db, opportunityId, input, requestId) {
  const current = await db.get("opportunity", opportunityId);
  if (!current) return { ok: false, error: "not-found" };
  const values = normalizeNegotiation(input, current.negotiation || {});
  const validation = validateNegotiation(values);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.update("opportunity", opportunityId, { negotiation: values }, requestId);
}

export async function addConcession(db, opportunityId, input, requestId) {
  const current = await db.get("opportunity", opportunityId);
  if (!current) return { ok: false, error: "not-found" };
  const negotiation = current.negotiation || normalizeNegotiation({});
  const validation = validateConcession(input, negotiation);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  const concession = { amount: validation.amount, exchange: cleanText(input.exchange), note: String(input.note ?? "").trim(), date: input.date || "" };
  return db.update("opportunity", opportunityId, { negotiation: { ...negotiation, concessions: [...(negotiation.concessions || []), concession] } }, requestId);
}
