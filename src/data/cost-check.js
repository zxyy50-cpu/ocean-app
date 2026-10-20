import { readSetting, saveSetting } from "./settings.js";

// 檢驗成本健檢: what a customer's monthly testing costs now versus with our products —
// material per test, confirmation tests for positives, hands-on time, and days to a result.
// Competitor reference prices and saved check-ups live in settings (this user's app only).

export const PRICE_KEY = "costCheckPrices";
export const CHECKS_KEY = "costChecks";
export const DEFAULT_WAGE = 200;

// Starting reference prices, taken from Ocean's own visit notes. Times are left empty on
// purpose: fill them in from the customer or the competitor's instructions, never guessed.
export const DEFAULT_PRICES = Object.freeze([
  { id: "ref-3m-plate", brand: "3M／Neogen", item: "一般快檢片（總生菌、大腸桿菌群等）", product: "Petrifilm", perTest: 65, confirm: null, minutes: null, days: null, source: "客戶說每片 60～70 元（勤億蛋品拜訪紀錄）" },
  { id: "ref-3m-salmonella", brand: "3M／Neogen", item: "沙門氏菌（含增菌）", product: "Petrifilm Salmonella", perTest: 127, confirm: 280, minutes: null, days: null, source: "含增菌 127 元，長菌用確認片一片 280 元，客戶說偽陽性多（勤億蛋品）" },
  { id: "ref-vaccigen-antibiotic", brand: "微杏", item: "抗生素殘留快篩", product: "", perTest: 400, confirm: null, minutes: null, days: null, source: "一次約 300～500 元（光泉牧場拜訪紀錄）" },
  { id: "ref-merck-tsb", brand: "Merck", item: "TSB 培養液（每瓶）", product: "TSB", perTest: null, confirm: null, minutes: null, days: null, source: "一瓶 900 元，客戶以此要求降價（高科大）；換算每次檢驗用量後再填單價" },
  { id: "ref-uni-onward", brand: "友和貿易", item: "", product: "", perTest: null, confirm: null, minutes: null, days: null, source: "待補" },
  { id: "ref-xianyong", brand: "台灣現用", item: "", product: "", perTest: null, confirm: null, minutes: null, days: null, source: "待補" },
  { id: "ref-erbangdeng", brand: "爾榜燈", item: "", product: "", perTest: null, confirm: null, minutes: null, days: null, source: "待補" },
]);

export function referencePrices(all) {
  const saved = readSetting(all, PRICE_KEY);
  return Array.isArray(saved) ? saved : DEFAULT_PRICES.map((row) => ({ ...row }));
}

export function savePrices(db, rows, requestId) {
  return saveSetting(db, PRICE_KEY, rows.map(cleanPriceRow), requestId);
}

const num = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[,\s$元]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

function cleanPriceRow(row) {
  return { id: row.id, brand: String(row.brand || "").trim(), item: String(row.item || "").trim(), product: String(row.product || "").trim(), perTest: num(row.perTest), confirm: num(row.confirm), minutes: num(row.minutes), days: num(row.days), source: String(row.source || "").trim(), hidden: Boolean(row.hidden) };
}

// 「25片/包」「10 PC/PKG, 40 PC/BOX」「100 tests」→ how many tests one sales unit holds.
export function testsPerUnit(spec, unit = "") {
  const text = String(spec || "");
  const wanted = String(unit || "").toUpperCase();
  const pairs = [...text.matchAll(/(\d+)\s*(片|PC|PCS|tests?|T|次)\s*[/／]\s*(包|盒|PKG|BOX|KIT|組)/giu)].map((match) => ({ count: Number(match[1]), per: match[3].toUpperCase() }));
  const sameUnit = pairs.find((pair) => (wanted === "BOX" || wanted === "盒" ? ["BOX", "盒"] : wanted === "PKG" || wanted === "包" ? ["PKG", "包"] : [wanted]).includes(pair.per));
  if (sameUnit) return sameUnit.count;
  if (pairs.length) return pairs.at(-1).count;
  const tests = text.match(/(\d+)\s*(tests?|T)\b/iu);
  return tests ? Number(tests[1]) : null;
}

// Monthly cost of one method for one test item.
export function methodCost(method, volume, wage) {
  const tests = Number(volume) || 0;
  const perTest = num(method.perTest);
  const confirmShare = (num(method.confirmRate) ?? 0) / 100;
  const material = perTest === null ? null : perTest * tests;
  const confirm = num(method.confirm) === null ? 0 : num(method.confirm) * tests * confirmShare;
  const labor = num(method.minutes) === null ? null : (num(method.minutes) / 60) * tests * (Number(wage) || 0);
  const known = [material, labor].filter((value) => value !== null);
  return {
    material, confirm, labor, days: num(method.days),
    total: material === null ? null : Math.round(material + confirm + (labor ?? 0)),
    hours: num(method.minutes) === null ? null : Math.round((num(method.minutes) / 60) * tests * 10) / 10,
    complete: known.length === 2,
  };
}

export function lineResult(line, wage) {
  const now = methodCost(line.current || {}, line.volume, wage);
  const ours = methodCost(line.ours || {}, line.volume, wage);
  const saving = now.total !== null && ours.total !== null ? now.total - ours.total : null;
  return { now, ours, saving, hoursSaved: now.hours !== null && ours.hours !== null ? Math.round((now.hours - ours.hours) * 10) / 10 : null, daysFaster: now.days !== null && ours.days !== null ? now.days - ours.days : null };
}

export function checkSummary(check) {
  const wage = num(check.wage) ?? DEFAULT_WAGE;
  const lines = (check.lines || []).map((line) => ({ line, ...lineResult(line, wage) }));
  const sum = (pick) => lines.reduce((total, row) => total + (pick(row) ?? 0), 0);
  const nowTotal = sum((row) => row.now.total);
  const oursTotal = sum((row) => row.ours.total);
  return {
    wage, lines,
    monthly: { now: nowTotal, ours: oursTotal, saving: nowTotal - oursTotal },
    yearly: { now: nowTotal * 12, ours: oursTotal * 12, saving: (nowTotal - oursTotal) * 12 },
    hoursSaved: Math.round(sum((row) => row.hoursSaved) * 10) / 10,
    incomplete: lines.filter((row) => row.now.total === null || row.ours.total === null).map((row) => row.line.item || "（未命名）"),
  };
}

const money = (value) => `${Math.round(Number(value) || 0).toLocaleString("en-US")} 元`;

// Plain text for LINE.
export function checkText(check, { customerName = "", seller = "" } = {}) {
  const summary = checkSummary(check);
  const out = [`【檢驗成本健檢】${customerName}`.trim(), `以每月檢驗量估算（未稅）：`, ""];
  for (const row of summary.lines) {
    const { line } = row;
    out.push(`■ ${line.item}・每月 ${Number(line.volume) || 0} 件`);
    out.push(`　現在：${row.now.total === null ? "價格待確認" : money(row.now.total)}${row.now.days !== null ? `・約 ${row.now.days} 天出結果` : ""}`);
    out.push(`　改用 ${line.ours?.product || "我們的方案"}：${row.ours.total === null ? "價格待確認" : money(row.ours.total)}${row.ours.days !== null ? `・約 ${row.ours.days} 天出結果` : ""}`);
    if (row.saving !== null) out.push(`　${row.saving >= 0 ? "每月省" : "每月多"} ${money(Math.abs(row.saving))}${row.hoursSaved ? `、省 ${row.hoursSaved} 小時人工` : ""}${row.daysFaster ? `、快 ${row.daysFaster} 天` : ""}`);
    out.push("");
  }
  out.push(`合計：每月 ${money(summary.monthly.now)} → ${money(summary.monthly.ours)}`);
  out.push(`${summary.yearly.saving >= 0 ? "一年約可省" : "一年約多"} ${money(Math.abs(summary.yearly.saving))}${summary.hoursSaved > 0 ? `，每月省 ${summary.hoursSaved} 小時人工（以時薪 ${summary.wage} 元計）` : ""}`);
  if (summary.incomplete.length) out.push(`（${summary.incomplete.join("、")} 還有價格待確認，未計入）`);
  out.push("", "數字依您提供的用量與目前報價估算，實際以正式報價為準。", seller ? `如需詳細比較，歡迎與我聯絡：${seller}` : "");
  return out.filter((line, index, list) => !(line === "" && list[index - 1] === "")).join("\n").trim();
}

// Saved check-ups, newest first.
export function savedChecks(all, customerId = "") {
  const list = readSetting(all, CHECKS_KEY) || [];
  return list.filter((check) => !customerId || check.customerId === customerId).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function saveCheck(db, all, check, requestId) {
  const list = (readSetting(all, CHECKS_KEY) || []).filter((item) => item.id !== check.id);
  return saveSetting(db, CHECKS_KEY, [...list, check].slice(-200), requestId);
}
