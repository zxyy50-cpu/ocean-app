import { daysBetween } from "../core/dates.js";
import { customerPurchases, lastOrder } from "./reorder.js";

// 30 秒摘要: what to know at the customer's door — what they buy, how long since the last order,
// the open case, and the next step. Purchase history comes from the order reference
// (ERP shipments + LINE orders), which the app holds only partly in its own orders.
export function customerBrief(model, reference, customer, today) {
  const lines = [];
  const purchases = customer.customerNo && reference ? customerPurchases(reference, customer.customerNo, { today }) : [];
  const last = customer.customerNo && reference ? lastOrder(reference, customer.customerNo) : { date: "", items: [] };
  if (last.date) {
    const days = daysBetween(last.date, today);
    const names = last.items.map((item) => reference.products.get(item.code)?.nameZh || reference.products.get(item.code)?.name || item.code).slice(0, 2);
    lines.push({ kind: days !== null && days > 180 ? "warn" : "", label: "上次買", text: `${last.date.replaceAll("-", "/")}（${days} 天前）・${names.join("、")}${last.items.length > 2 ? ` 等 ${last.items.length} 項` : ""}` });
  } else if (customer.customerNo) {
    lines.push({ kind: "", label: "上次買", text: "購買紀錄裡沒有資料" });
  }
  if (purchases.length) lines.push({ kind: "", label: "常買", text: purchases.slice(0, 3).map((row) => `${row.nameZh || row.name}（${row.count} 次）`).join("、") });
  const open = (model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => !opportunity.archivedAt && ["接觸", "提案", "議價"].includes(opportunity.stage))
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  if (open.length) {
    const top = open[0];
    lines.push({ kind: "", label: "進行中", text: `${open.length} 件・最大：${top.name || top.product || "商機"}（${top.stage}${top.amount ? `・${Math.round(top.amount / 10000)} 萬` : ""}）`, href: `#/case/${encodeURIComponent(top.id)}` });
  }
  const activity = [...(model.activitiesByCustomer.get(customer.id) || [])].filter((item) => !item.archivedAt).sort((a, b) => String(b.activityDate).localeCompare(String(a.activityDate)))[0];
  const next = customer.nextAction || activity?.nextAction || open[0]?.nextAction || "";
  if (next) lines.push({ kind: "", label: "下一步", text: `${next}${customer.nextFollowUpDate ? `（${customer.nextFollowUpDate.replaceAll("-", "/")}）` : ""}` });
  if (activity) lines.push({ kind: "", label: "上次聯絡", text: `${activity.activityDate.replaceAll("-", "/")}・${activity.channel || ""}${activity.summary ? `・${activity.summary}` : ""}`.replace(/・$/, "") });
  return lines;
}

// Google Maps: one place, or a route through several (the first leg starts where you are).
export function mapsPlaceUrl(customer) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address || customer.name)}`;
}

export function mapsRouteUrl(customers) {
  const stops = customers.map((customer) => customer.address || `${customer.name} ${(customer.areaTags || [])[0] || ""}`.trim());
  return `https://www.google.com/maps/dir//${stops.map((stop) => encodeURIComponent(stop)).join("/")}`;
}

// Counties roughly north to south along the west coast, then the east.
const COUNTY_ORDER = ["基隆市", "台北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "台中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "台南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣", "澎湖縣", "金門縣", "連江縣"];

// A rough driving order without a map service: group by county (north to south), township, road, then number.
export function routeOrder(customers) {
  const key = (customer) => {
    const address = String(customer.address || "").normalize("NFKC").replace(/臺/g, "台").replace(/^\s*\d{3,6}\s*/u, "");
    const county = COUNTY_ORDER.findIndex((name) => address.startsWith(name));
    const town = address.match(/(?:縣|市)(.{1,4}?(?:鄉|鎮|市|區))/u)?.[1] || "";
    const road = address.match(/([^鄉鎮市區村里]{1,8}(?:路|街|大道))/u)?.[1] || "";
    const number = Number(address.match(/(\d+)(?:之\d+)?號/u)?.[1] || 0);
    return { county: county < 0 ? COUNTY_ORDER.length : county, town, road, number };
  };
  return [...customers].sort((a, b) => {
    const ka = key(a); const kb = key(b);
    return ka.county - kb.county || ka.town.localeCompare(kb.town, "zh-Hant") || ka.road.localeCompare(kb.road, "zh-Hant") || ka.number - kb.number;
  });
}
