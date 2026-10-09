import { addDays } from "../core/dates.js";
import { cleanText } from "../core/text.js";
import { AREA_PARENTS, areaFamily, canonicalArea, customerInAreas } from "./tags.js";

// 開發計畫: which prospects to develop first, how far each zone has come, and
// 「不開發」 marks so small or unsuitable companies stop coming back.
// Everything lives in existing customer fields, so nothing changes in the Sheet:
//   relationStatus "不開發", nextAction "不開發：<reason>", nextFollowUpDate = when to look again ("" = never).

export const HOLD_STATUS = "不開發";
export const HOLD_REASONS = Object.freeze(["規模太小", "沒有檢驗需求", "已用競品長約", "已歇業／搬遷"]);
export const HOLD_PERIODS = Object.freeze([{ value: 0, label: "永久" }, { value: 6, label: "6 個月後再看" }, { value: 12, label: "1 年後再看" }]);
export const SMALL_TAG = "資本 500萬以下";

const NOT_CONTACTED = new Set(["", "未接觸", "未偵查"]);
const CUSTOMER_STATUSES = new Set(["往來中", "重點培養"]);
const OPEN_STAGES = new Set(["接觸", "提案", "議價"]);

// How much the industry depends on microbiology testing (40 / 25 / 10 points).
const MICRO_HIGH = /乳品|乳製|牛奶|鮮奶|優格|優酪|蛋品|蛋類|雞蛋|液蛋|肉品|屠宰|肉類|禽|水產|海鮮|魚|蝦|冷凍食品|即食|餐盒|便當|中央廚房|團膳|調理食品|豆腐|豆製品|豆花|非酒精飲料|飲料|飲品|包裝水|礦泉水|冰品|保健|益生菌|乳酸菌|化粧|化妝|保養品/u;
const MICRO_MEDIUM = /其他食品|蔬果|烘焙|麵包|糕|餅|調味|醬|罐頭|麵|飼料|飼品|寵物|藥品|製藥|生技|生物科技|生物肥料|食品/u;
const MICRO_LOW = /油脂|穀物|澱粉|碾穀|酒類|製糖|糖廠|茶葉|咖啡/u;

export const CAPITAL_POINTS = Object.freeze({
  "資本 1億以上": 30, "資本 5千萬–1億": 22, "資本 1千萬–5千萬": 15, "資本 500萬–1千萬": 8, [SMALL_TAG]: 3,
});

function addMonths(dateOnly, months) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

export function microTier(customer) {
  const tags = customer.industryTags || [];
  const text = [...tags, customer.name, String(customer.notes || "").slice(0, 300)].join(" ");
  // Name the tag that decided the level (e.g. 乳品製造), not a broad one listed first.
  const why = (pattern) => {
    const tag = tags.find((value) => pattern.test(value));
    if (tag) return `（${tag}）`;
    const word = text.match(pattern)?.[0];
    return word ? `（${word}）` : "";
  };
  if (MICRO_HIGH.test(text)) return { level: "高", points: 40, label: `微生物檢驗需求高${why(MICRO_HIGH)}` };
  if (MICRO_LOW.test(text) && !MICRO_MEDIUM.test(tags.join(" "))) return { level: "低", points: 10, label: `微生物檢驗需求低${why(MICRO_LOW)}` };
  if (MICRO_MEDIUM.test(text)) return { level: "中", points: 25, label: `微生物檢驗需求中${why(MICRO_MEDIUM)}` };
  return { level: "不明", points: 15, label: "產業不明" };
}

export function capitalTag(customer) {
  return (customer.segmentTags || []).find((tag) => tag in CAPITAL_POINTS) || "";
}

function lastOrderDate(model, customer) {
  return (model.ordersByCustomer.get(customer.id) || [])[0]?.orderDate || "";
}

function winback(model, customer, today) {
  if ((customer.segmentTags || []).includes("2025衰退客戶")) return { points: 30, label: "2025 衰退客戶" };
  const last = lastOrderDate(model, customer);
  if (customer.customerNo && last && last < addDays(today, -365)) return { points: 25, label: `舊客戶，最後訂單 ${last.slice(0, 7)}` };
  // The app only holds part of the order history, so a missing order proves nothing; it is still an old account.
  if (customer.customerNo && !last) return { points: 15, label: "舊客戶（有客戶編號）" };
  return null;
}

// null when not marked; otherwise the reason, when to look again, and whether the mark still applies today.
export function holdInfo(customer, today) {
  if (customer?.relationStatus !== HOLD_STATUS) return null;
  const reason = cleanText(String(customer.nextAction || "").replace(/^不開發[：:]?/u, "")) || "未填原因";
  const until = customer.nextFollowUpDate || "";
  return { reason, until, active: !until || until > today };
}

export function wasContacted(model, customer) {
  return !NOT_CONTACTED.has(cleanText(customer.relationStatus)) && customer.relationStatus !== HOLD_STATUS
    || Boolean(customer.lastContactAt) || (model.activitiesByCustomer.get(customer.id) || []).length > 0
    || (model.opportunitiesByCustomer.get(customer.id) || []).length > 0 || (model.ordersByCustomer.get(customer.id) || []).length > 0;
}

function isCurrentCustomer(model, customer, today) {
  const last = lastOrderDate(model, customer);
  return CUSTOMER_STATUSES.has(customer.relationStatus) || Boolean(last && last >= addDays(today, -365));
}

export function prospectScore(model, customer, today) {
  const micro = microTier(customer);
  const capital = capitalTag(customer);
  const back = winback(model, customer, today);
  const reasons = [micro.label, capital || "資本額不明", back?.label].filter(Boolean);
  return {
    score: micro.points + (capital ? CAPITAL_POINTS[capital] : 10) + (back?.points || 0),
    micro, capital, small: capital === SMALL_TAG, reasons,
  };
}

// The zone a customer belongs to for the plan: its industrial zone if it has one, else its county.
export function planArea(customer) {
  const areas = (customer.areaTags || []).map(canonicalArea);
  return areas.find((area) => AREA_PARENTS[area] && /工業區|園區|加工出口區/.test(area)) || areas.map((area) => areaFamily(area).at(-1))[0] || "未分類";
}

export function countyOf(area) {
  return AREA_PARENTS[area] || area;
}

// Prospects worth developing, best first. Current customers, open cases and active 「不開發」 marks are left out.
export function priorityList(model, { today, areas = [], area = "", tier = "", smallOnly = false, notContactedOnly = true } = {}) {
  const items = [];
  for (const customer of model.customers) {
    const hold = holdInfo(customer, today);
    if (hold?.active) continue;
    if (isCurrentCustomer(model, customer, today)) continue;
    if ((model.opportunitiesByCustomer.get(customer.id) || []).some((opportunity) => OPEN_STAGES.has(opportunity.stage))) continue;
    if (areas.length && !customerInAreas(customer, areas)) continue;
    const zone = planArea(customer);
    if (area && zone !== area && countyOf(zone) !== area) continue;
    const contacted = wasContacted(model, customer);
    if (notContactedOnly && contacted && !hold) continue;
    const scored = prospectScore(model, customer, today);
    if (tier && scored.micro.level !== tier) continue;
    if (smallOnly && !scored.small) continue;
    items.push({ customer, zone, contacted, holdExpired: Boolean(hold), ...scored });
  }
  return items.sort((left, right) => right.score - left.score || left.customer.name.localeCompare(right.customer.name, "zh-Hant"));
}

function emptyRow(area) {
  return { area, total: 0, contacted: 0, withOpportunity: 0, customers: 0, held: 0 };
}

function rates(row) {
  const pct = (value) => (row.total ? Math.round((value / row.total) * 100) : 0);
  return { ...row, contactedRate: pct(row.contacted), opportunityRate: pct(row.withOpportunity), customerRate: pct(row.customers) };
}

// The development funnel per county, with its zones underneath. 「不開發」 companies are counted apart, not in the total.
export function zoneFunnel(model, { today, areas = [] } = {}) {
  const zones = new Map();
  for (const customer of model.customers) {
    if (areas.length && !customerInAreas(customer, areas)) continue;
    const area = planArea(customer);
    if (!zones.has(area)) zones.set(area, emptyRow(area));
    const row = zones.get(area);
    if (holdInfo(customer, today)?.active) { row.held += 1; continue; }
    row.total += 1;
    if (wasContacted(model, customer)) row.contacted += 1;
    if ((model.opportunitiesByCustomer.get(customer.id) || []).length) row.withOpportunity += 1;
    if (isCurrentCustomer(model, customer, today)) row.customers += 1;
  }
  const counties = new Map();
  for (const row of zones.values()) {
    const county = countyOf(row.area);
    if (!counties.has(county)) counties.set(county, { ...emptyRow(county), zones: [] });
    const group = counties.get(county);
    for (const key of ["total", "contacted", "withOpportunity", "customers", "held"]) group[key] += row[key];
    group.zones.push(rates({ ...row, area: row.area === county ? `${county}（不在工業區）` : row.area, filter: row.area }));
  }
  return [...counties.values()]
    .map((group) => ({ ...rates(group), filter: group.area, zones: group.zones.sort((left, right) => right.total - left.total) }))
    .sort((left, right) => right.total - left.total);
}

// Marks customers 「不開發」 in one transaction and returns what they had before, for an exact undo.
export async function holdCustomers(db, customers, { reason, months = 0, today }, requestId) {
  const why = cleanText(reason) || "未填原因";
  const until = months ? addMonths(today, months) : "";
  const previous = customers.map((customer) => ({ id: customer.id, relationStatus: customer.relationStatus || "", nextAction: customer.nextAction || "", nextFollowUpDate: customer.nextFollowUpDate || "" }));
  const result = await db.transact(requestId, async (tx) => {
    for (const customer of customers) await tx.update("customer", customer.id, { relationStatus: HOLD_STATUS, nextAction: `不開發：${why}`, nextFollowUpDate: until });
  });
  return { ...result, previous, until };
}

export async function restoreHolds(db, previous, requestId) {
  return db.transact(requestId, async (tx) => {
    for (const { id, ...values } of previous) await tx.update("customer", id, values);
  });
}

// 「取消不開發」 later on: back to 開發中 if we ever talked to them, otherwise 未接觸.
export async function releaseHold(db, model, customer, requestId) {
  const contacted = Boolean(customer.lastContactAt) || (model.activitiesByCustomer.get(customer.id) || []).length > 0;
  return db.update("customer", customer.id, { relationStatus: contacted ? "開發中" : "未接觸", nextAction: "", nextFollowUpDate: "" }, requestId);
}
