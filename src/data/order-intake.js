import { addDays, formatShortDate } from "../core/dates.js";
import { cleanText, comparisonKey, companyKey } from "../core/text.js";
import { customerCodes, customerHistory, normalizeCode, normalizeCustomerNo, priceStory } from "./order-reference.js";

// LINE order intake: turns a pasted LINE message into a draft order, looks up the customer,
// products and their last prices, and writes the secretary / customer texts.
// Rule-based and on-device. It never invents a product code, price or customer number:
// anything not certain is filled in as a suggestion and marked 待確認 with the reason.

export const TAX_RATE = 0.05;
export const LINE_ORDER_STATUSES = Object.freeze(["待確認", "已給秘書", "已更新購買紀錄"]);

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const NUM = "\\d+(?:\\.\\d+)?|[一二兩三四五六七八九十百]+";
// Chinese units can touch the product name (「1罐PDA」); latin units must end at a word boundary.
const UNITS = "小包|大盒|盒|罐|瓶|包|箱|支|片|組|個|管|條|袋|桶|批|套|捲|劑|(?:BOX|BOT|PKG|PK|PCS|PC|EA|CTN|CS|BX|PAC|KIT|SET|VL|Each)(?![A-Za-z])";
const HEAD = /(?:要再訂|要訂購|要訂|要購買|要買|確認訂購|追加訂購|改訂單|改訂|加訂|訂購|訂單|需求|請購|要詢價|詢價|要詢問|想詢問|詢問|想請您報價)\s*[:：]?|[:：]/u;
// Pack sizes such as 「250片/盒」「10 PKG/BOX」 describe the product, they are never the quantity ordered.
const SPEC = /\d+(?:\.\d+)?\s*(?:g|mg|kg|ml|mL|L|mm|cm|μg|µg|ug|μl|µl|ul|tests?|T|plates?|well)(?![A-Za-z])|\d+\s*(?:片|入|支|瓶|包|個|PCS?|EA|PKG|test)\s*\/\s*(?:盒|箱|包|袋|BOX|CTN|PKG|BOT|小盒)/giu;
const NOTE_WORDS = /發票|統編|效期|寄|送至|送到|地址|收件|扣款|扣寄|COA|估價|報價單|低溫|冷藏|急用|到貨|出貨日|今天|明天|後天|下週|下星期|月底|前到|謝謝|感謝|麻煩您|您好|你好|請問|請購單|用途|請購日期|請購單位|教學|示範|拜訪|過來|來一趟|順便來|安裝|維修|保養/u;
// 「請問…還是跟您叫貨嗎？」 asks about the product; without a quantity it is context, not an item.
const QUESTION = /請問|嗎|呢|[？?]/u;
// The customer asking the sales rep to come by (teaching, installing, a demo) is a visit, not a product.
const VISIT_REQUEST = /(?:來|過來|到場|上門|順便)[^，。；,;]{0,12}?(?:教學|示範|安裝|講解|教育訓練|說明|維修|保養)|(?:教學|示範|安裝)一下/u;
const PRODUCTISH = /[A-Za-z]|培養|試劑|試紙|血|液|菌|片|膜|杯|袋|管|包|盤|套組|抗|素|鹽|糖|酶|脢|漿|劑|油|甘油/u;
const NEGATION = /先不用|不用了|不用|不要|不訂|取消/u;
const FILLERS = ["訂購以下", "如下", "以下", "我這邊", "這邊", "想再和您訂購", "想和您訂", "想跟您訂", "我還需要訂", "我還需要", "還需要", "我需要", "需要訂購", "需要", "要訂購", "訂購", "要訂", "要買", "購買", "再訂", "追加訂購", "追加", "加訂", "加購", "想要", "想訂", "麻煩再訂", "麻煩訂", "麻煩", "幫我出", "幫我", "請幫我", "可以", "我要", "我想", "然後要", "還要", "也要", "要", "訂", "買", "再", "請", "一下", "這次", "另外", "還有", "然後", "也", "改訂", "確認", "共", "您好", "你好", "謝謝", "感謝", "的", "了", "喔", "嗎", "呢", "～", "~"];
const SPOKEN_TO_SALES = { 盒: ["BOX", "PKG", "PK", "BX", "KIT"], 小包: ["PKG", "PAC", "BAG"], 大盒: ["BOX"], 罐: ["BOT", "JAR"], 瓶: ["BOT", "VL"], 箱: ["CTN", "CS", "BOX"], 包: ["PKG", "PAC", "BAG", "PK"], 片: ["PC", "EA", "PCS"], 組: ["KIT", "SET"], 支: ["EA", "PC"], 管: ["EA", "VL", "TUBE"] };

export function chineseNumber(text) {
  const value = cleanText(text);
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (!value) return null;
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char in CN_DIGITS) current = CN_DIGITS[char];
    else if (char === "十") { total += (current || 1) * 10; current = 0; }
    else if (char === "百") { total += (current || 1) * 100; current = 0; }
    else return null;
  }
  return total + current;
}

const round = (value, places = 0) => Math.round(value * 10 ** places) / 10 ** places;
export const withTax = (price) => round(price * (1 + TAX_RATE), 4);
export const withoutTax = (price) => round(price / (1 + TAX_RATE), 4);
const normalize = (text) => String(text || "").normalize("NFKC").replace(/[＊]/g, "*").replace(/　/g, " ");

// ---- customers -------------------------------------------------------------------------

function nameIndex(model, reference) {
  const entries = [];
  const add = (name, customerNo, kind, extra = {}) => {
    const key = kind === "contact" ? comparisonKey(name) : companyKey(name);
    if (key.length >= 2) entries.push({ key, name: cleanText(name), customerNo: normalizeCustomerNo(customerNo), kind, ...extra });
  };
  for (const customer of reference.customers.values()) {
    customer.names.forEach((name) => add(name, customer.customerNo, "company"));
    customer.contacts.forEach((name) => add(name, customer.customerNo, "contact"));
  }
  for (const customer of model?.customers || []) {
    add(customer.name, customer.customerNo, "company", { customerId: customer.id });
    (customer.aliases || []).forEach((alias) => add(alias, customer.customerNo, "company", { customerId: customer.id }));
    (model.contactsByCustomer.get(customer.id) || []).forEach((contact) => add(contact.name, customer.customerNo, "contact", { customerId: customer.id }));
  }
  return entries;
}

function appCustomerFor(model, customerNo, names = []) {
  if (!model) return null;
  if (customerNo) {
    const found = model.customers.find((customer) => normalizeCustomerNo(customer.customerNo) === customerNo);
    if (found) return found;
  }
  const keys = new Set(names.map(companyKey).filter(Boolean));
  return model.customers.find((customer) => keys.has(companyKey(customer.name))) || null;
}

export function salutationFor(contact, saved = {}) {
  if (saved[comparisonKey(contact)]) return saved[comparisonKey(contact)];
  // 「Joyce（莊翔傑lab）」: the lab in brackets is not part of how we greet her.
  // 「丁橋瀚(主任)」 → 丁主任: a title in brackets is how we greet.
  const bracketTitle = String(contact || "").match(/^([一-鿿])[一-鿿]{1,3}\s*[（(](主任|經理|課長|副課長|組長|老師|教授|技師|博士|處長|廠長|協理)[)）]/u);
  if (bracketTitle) return `${bracketTitle[1]}${bracketTitle[2]}`;
  const name = cleanText(String(contact || "").replace(/[（(][^）)]*[）)]/gu, ""));
  if (!name) return "";
  const titled = name.match(/^([一-鿿])[一-鿿]{0,2}?(老師|教授|組長|課長|副課長|經理|主任|博士|技師)$/u);
  if (titled) return `${titled[1]}${titled[2]}`;
  if (/^[一-鿿]{3}$/u.test(name)) return name.slice(1);
  if (/^[一-鿿]{4}$/u.test(name)) return name.slice(2);
  if (/^[一-鿿]{2}$/u.test(name)) return name;
  if (/^[A-Za-z][A-Za-z .'-]{1,20}$/.test(name)) return name;
  return "";
}

export function identifyCustomer(text, { model, reference, salutations = {} } = {}) {
  const plain = normalize(text);
  const key = comparisonKey(plain);
  const entries = nameIndex(model, reference);
  const knownNo = (no) => reference.customers.has(no) || model?.customers.some((customer) => normalizeCustomerNo(customer.customerNo) === no);
  // A number written as 客戶編號 counts even if it is new to us; a bare 8-digit number only if we know it.
  const labelled = [...plain.matchAll(/客戶編號\s*[:：]?\s*(\d{6,8})|[（(]\s*(\d{8})\s*[)）]|(?<=[一-鿿]\s?)(1\d{7})(?=\s*(?:訂購|要|[，,]))/gu)].map((match) => match[1] || match[2] || match[3]);
  const explicitNos = [...new Set([...labelled, ...[...plain.matchAll(/(?<!\d)([12]\d{7})(?!\d)/g)].map((match) => match[1]).filter(knownNo)])];
  const scores = new Map();
  const matched = entries.filter((entry) => key.includes(entry.key));
  // How many different customers a matched name points to: 「屏科大」 alone fits dozens of labs.
  // 「屏科大」 also starts 「屏科大邱明堂」, a different lab: count every customer the name could lead to.
  const owners = new Map();
  for (const entry of matched) {
    if (owners.has(entry.key)) continue;
    const family = entries.filter((other) => other.kind === entry.kind && other.key.startsWith(entry.key));
    owners.set(entry.key, new Set(family.map((other) => other.customerNo || other.customerId)));
  }
  for (const entry of matched) {
    if (!entry.customerNo && !entry.customerId) continue;
    const id = entry.customerNo || `app:${entry.customerId}`;
    const score = scores.get(id) || { id, customerNo: entry.customerNo, customerId: entry.customerId || "", company: "", contact: "", score: 0 };
    if (entry.kind === "company" && entry.key.length > companyKey(score.company).length) score.company = entry.name;
    if (entry.kind === "contact" && entry.key.length > comparisonKey(score.contact).length) score.contact = entry.name;
    if (entry.customerId) score.customerId = entry.customerId;
    if (owners.get(entry.key).size === 1) score.unique = true;
    scores.set(id, score);
  }
  for (const no of explicitNos) if (!scores.has(no)) scores.set(no, { id: no, customerNo: no, customerId: "", company: "", contact: "", unique: true, score: 0 });
  for (const score of scores.values()) score.score = companyKey(score.company).length * 2 + comparisonKey(score.contact).length * 3 + (score.unique ? 5 : 0) + (explicitNos.includes(score.customerNo) ? 100 : 0);
  const ranked = [...scores.values()].sort((left, right) => right.score - left.score);
  const top = ranked[0];
  const tied = top ? ranked.filter((item) => item.score === top.score) : [];
  const result = { customerNo: "", customerId: "", company: "", contact: "", status: "待確認", why: "", candidates: ranked.slice(0, 6) };
  if (top && tied.length === 1) {
    const certain = explicitNos.includes(top.customerNo) || top.unique;
    Object.assign(result, { customerNo: top.customerNo, customerId: top.customerId, company: top.company, contact: top.contact, status: certain ? "確定" : "待確認" });
    result.why = explicitNos.includes(top.customerNo) ? `訊息有客戶編號 ${top.customerNo}${knownNo(top.customerNo) ? "" : "（系統還沒有這個編號的資料）"}`
      : certain ? `依名稱「${[top.company, top.contact].filter(Boolean).join(" ")}」對應` : `「${top.company}」有多個客戶編號，最可能是 ${top.customerNo}，請確認`;
    if (!result.company) result.company = [...(reference.customers.get(top.customerNo)?.names || [])][0] || "";
  } else if (tied.length > 1) {
    result.why = `有 ${tied.length} 個可能的客戶，請選一個`;
  } else {
    result.why = "找不到對應的客戶，請選擇或新增";
  }
  // A contact named in the message but not on file, e.g. 「張于婷 0958006223」 or 「立高 趙郁婷：」.
  if (!result.contact) {
    // 「張于婷 0958006223」, 「立高 趙郁婷：」 or 「台灣農畜 丁橋瀚(主任)：」 (the title stays with the name).
    const named = plain.match(/([一-鿿]{2,4})\s*(?:\(|（)?\s*09\d{2}-?\d{3}-?\d{3}/u)
      || plain.match(/(?:^|\s)([一-鿿]{2,4}\s*[（(](?:主任|經理|課長|副課長|組長|老師|教授|技師|博士|處長|廠長|協理)[)）])\s*[：:]?/u)
      || plain.match(/^[^：:\n]{0,24}?\s([一-鿿]{2,4})\s*[：:]/u);
    if (named) result.contact = named[1].replace(/\s+/g, "");
  }
  const app = appCustomerFor(model, result.customerNo, [result.company]);
  if (app) { result.customerId = app.id; result.company ||= app.name; }
  const phone = plain.match(/09\d{2}-?\d{3}-?\d{3}/);
  result.phone = phone ? phone[0] : "";
  // Names that belong to the likely customers, so they are not mistaken for products.
  const likely = new Set(ranked.slice(0, 3).map((item) => item.id));
  result.mentions = [...new Set([...matched.filter((entry) => likely.has(entry.customerNo || `app:${entry.customerId}`)).map((entry) => entry.name), result.contact, result.phone, ...explicitNos].filter(Boolean))];
  result.salutation = salutationFor(result.contact, salutations);
  return result;
}

// ---- splitting the message into items ----------------------------------------------------

// Product codes and full catalog names are swapped for placeholders first, so a comma inside
// "LB Agar, Miller" or a number inside a code never confuses the splitting below.
function protect(text, reference) {
  const tokens = [];
  let out = text;
  const codes = [...out.matchAll(/[A-Za-z]{2,}[A-Za-z0-9-]*\d[A-Za-z0-9-]*/g)].map((match) => match[0]);
  for (const raw of [...new Set(codes)].sort((left, right) => right.length - left.length)) {
    const code = normalizeCode(raw);
    if (!reference.products.has(code) && !reference.history.some((entry) => entry.code === code)) continue;
    tokens.push({ kind: "code", code, text: raw });
    out = out.split(raw).join(`⟦${tokens.length - 1}⟧`);
  }
  const lower = out.toLowerCase();
  const names = new Map();
  for (const product of reference.productList) {
    for (const value of [product.name, product.nameZh]) {
      const name = value.toLowerCase();
      if (name.length < (/[一-鿿]/u.test(name) ? 4 : 8) || !lower.includes(name)) continue;
      names.set(name, [...new Set([...(names.get(name) || []), product.code])]);
    }
  }
  const brands = reference.brands || (reference.brands = new Set(["bd", "bbl", "difco", "oxoid", "cmp", "merck", "himedia", "3m", ...reference.productList.map((product) => product.brand.toLowerCase()).filter(Boolean)]));
  // Whole names only: "Dextrose Broth" inside "Potato Dextrose Broth" is a different product.
  const standsAlone = (text, at, length) => {
    const before = text.slice(0, at).match(/([A-Za-z][A-Za-z.]*)\s*$/);
    const after = text.slice(at + length).match(/^\s*[A-Za-z]/);
    return (!before || brands.has(before[1].toLowerCase())) && !after;
  };
  for (const [name, codesForName] of [...names.entries()].sort((left, right) => right[0].length - left[0].length)) {
    const at = out.toLowerCase().indexOf(name);
    if (at < 0 || (/[a-z]/.test(name) && !standsAlone(out, at, name.length))) continue;
    tokens.push({ kind: "name", codes: codesForName, text: out.slice(at, at + name.length), chinese: !/[a-z]/.test(name) });
    out = `${out.slice(0, at)}⟦${tokens.length - 1}⟧${out.slice(at + name.length)}`;
  }
  return { text: out, tokens };
}

const QTY_PATTERNS = [
  new RegExp(`數量\\s*[:：]?\\s*各\\s*(${NUM})\\s*(${UNITS})?`, "iu"),
  new RegExp(`(?:數量|共)\\s*[:：]?\\s*(${NUM})\\s*(${UNITS})?`, "iu"),
  new RegExp(`各\\s*(?:買|訂|要)?\\s*(${NUM})\\s*(${UNITS})?`, "iu"),
  new RegExp(`[x×*]\\s*(\\d+)\\s*(${UNITS})?`, "iu"),
  new RegExp(`(${NUM})\\s*(${UNITS})`, "iu"),
  // 「TSA 3」: a bare number after the name, separated by a space, at the end of the item.
  /(?<=[A-Za-z一-鿿)）]\s+)(\d{1,4})\s*$/u,
  // 「羊血1」: a small number right after a Chinese name (screenshots lose the space).
  /(?<=[一-鿿])(\d{1,3})\s*$/u,
];

function findQuantity(fragment) {
  for (const pattern of QTY_PATTERNS) {
    const match = fragment.match(pattern);
    if (!match) continue;
    const value = chineseNumber(match[1]);
    if (value === null || value <= 0) continue;
    return { value, unit: /^[一-鿿A-Za-z]/u.test(match[2] || "") ? match[2] : "", each: /各/.test(match[0]) || /各/.test(fragment.slice(Math.max(0, match.index - 2), match.index)), text: match[0], index: match.index };
  }
  return null;
}

const PRICE_PATTERNS = [
  /(?:\$|NT\$?)\s*(\d[\d,]*(?:\.\d+)?)/iu,
  /(?:報價單價|單價|價格|售價|報價)(?:為|是|確認為|調整為)?\s*[:：]?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/u,
  new RegExp(`(?:一|每)(?:${UNITS})\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, "iu"),
  /(\d[\d,]*(?:\.\d+)?)\s*元/u,
  /(\d[\d,]{2,}(?:\.\d+)?)\s*(?:未稅|含稅)/u,
];

function findPrice(fragment) {
  if (/總額|總價|總金額|合計|估價單/u.test(fragment) && !/單價|每/u.test(fragment)) return null;
  for (const pattern of PRICE_PATTERNS) {
    const match = fragment.match(pattern);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    const after = fragment.slice(match.index, match.index + match[0].length + 8);
    return { value, tax: /含稅/u.test(after) ? "含稅" : /未稅/u.test(after) ? "未稅" : "", text: match[0] };
  }
  return null;
}

// 「MRS 1罐 Agar 2罐」 or 「1罐PDA 1罐LBA」: one fragment, several quantities → one piece per quantity.
const QTY_GLOBAL = new RegExp(`(?:${NUM})\\s*(?:${UNITS})|[x×*]\\s*\\d+`, "giu");
function splitByQuantities(part) {
  const spans = [...part.replace(SPEC, (match) => " ".repeat(match.length)).matchAll(QTY_GLOBAL)];
  if (spans.length < 2) return [part];
  const leading = spans[0].index <= 1;
  const cuts = leading ? spans.slice(1).map((span) => span.index) : spans.slice(0, -1).map((span) => span.index + span[0].length);
  const pieces = [];
  let from = 0;
  for (const cut of cuts) { pieces.push(part.slice(from, cut)); from = cut; }
  pieces.push(part.slice(from));
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

function splitFragments(text) {
  const fragments = [];
  // A screenshot joins lines: 「羊血1 單獨一張發票」 → the note starts its own sentence.
  const separated = text.replace(/\s+(?=單獨|隨貨|統編|謝謝|感謝|地址|收件|麻煩您|效期|扣款|急用|請於|請在)/gu, "\n");
  for (const sentence of separated.split(/[。；;\n!！?？]+/u)) {
    let parts = sentence.split(/[、，,]|還有|以及|另外|再加|然後|(?:跟|和)(?![您你妳])/u);
    // 「兩瓶羊血及一瓶蛋黃液」: 及 joins two items only when both sides carry a quantity.
    parts = parts.flatMap((part) => {
      const pieces = part.split("及");
      return pieces.length === 2 && pieces.every((piece) => findQuantity(piece)) ? pieces : [part];
    }).flatMap(splitByQuantities);
    parts.map((part) => part.trim()).filter(Boolean).forEach((part, index) => fragments.push({ text: part, sentence, first: index === 0 }));
  }
  return fragments;
}

function leftoverName(fragment, quantity, price) {
  let rest = fragment;
  for (const piece of [quantity?.text, price?.text]) if (piece) rest = rest.replace(piece, " ");
  rest = rest.replace(/(?:貨號|料號|REF|型號)\s*[:：]?/giu, " ").replace(/含稅|未稅|元|\/\s*[一-鿿A-Za-z]+/gu, " ");
  for (const word of FILLERS) rest = rest.split(word).join(" ");
  return rest.replace(/^[\s:：、，,.。]+|[\s:：、，,.。]+$/gu, "").replace(/\s+/g, " ").trim();
}

// ---- products ----------------------------------------------------------------------------

// Latin words stay whole (with a crude stem, so Lactobacillus ≈ Lactobacilli); Chinese goes by character.
function words(text) {
  const lower = String(text || "").normalize("NFKC").toLowerCase();
  return [...new Set([...(lower.match(/[a-z][a-z0-9]+|\d+[a-z]*/g) || []).map((word) => (word.length > 6 ? word.slice(0, 6) : word)), ...(lower.match(/[一-鿿]/gu) || [])])]
    .filter((word) => !["difco", "bd", "bbl", "oxoid", "cmp", "the", "and", "with"].includes(word));
}

function popularity(reference) {
  if (!reference.popularity) {
    reference.popularity = new Map();
    for (const entry of reference.history) reference.popularity.set(entry.code, (reference.popularity.get(entry.code) || 0) + 1);
  }
  return reference.popularity;
}

// Ranks catalog products for a spoken name. Never decides alone: the best guess is pre-filled and marked 待確認.
export function productCandidates(query, reference, customerNo = "", limit = 5) {
  const key = comparisonKey(query);
  if (!key) return [];
  const bought = customerNo ? customerCodes(reference, customerNo) : new Map();
  const queryWords = words(query);
  const sold = popularity(reference);
  const scored = [];
  // 「Sa」「TSI」: two or three letters are an abbreviation, never a fragment of any longer word.
  const short = /^[a-z0-9]{1,3}$/.test(key);
  for (const product of reference.productList) {
    const acronymHit = product.acronyms.some((acronym) => comparisonKey(acronym) === key);
    const haystack = comparisonKey(`${product.name} ${product.nameZh} ${product.code}`);
    let score = 0;
    if (acronymHit) score += 60;
    if (short) {
      // Two letters: only a written abbreviation. Three: also a word start, or the name's start (LB Agar → LBA).
      const wordStart = key.length >= 3 && ((product.name.toLowerCase().match(/[a-z0-9]+/g) || []).some((word) => word.startsWith(key)) || comparisonKey(product.name).startsWith(key));
      if (!acronymHit && !wordStart) continue;
      if (!acronymHit) score += 25;
    } else if (haystack.includes(key)) score += 40 + Math.min(20, key.length * 2) + Math.round((key.length / Math.max(haystack.length, 1)) * 10);
    else {
      const hits = queryWords.filter((word) => haystack.includes(word)).length;
      if (!hits || hits / queryWords.length < 0.5) continue;
      score += (hits / queryWords.length) * 40;
    }
    if (bought.has(product.code)) score += 35;
    // Among equals, what the company actually sells often is the better first guess.
    score += Math.min(15, Math.log2((sold.get(product.code) || 0) + 1) * 3);
    scored.push({ code: product.code, score, bought: bought.get(product.code) || "" });
  }
  // Products the customer bought that are missing from the catalog still deserve a place.
  for (const [code, date] of bought) {
    if (reference.products.has(code)) continue;
    const entry = reference.history.find((item) => item.code === code);
    if (entry && comparisonKey(`${entry.name} ${code}`).includes(key)) scored.push({ code, score: 70, bought: date });
  }
  return scored.sort((left, right) => right.score - left.score || String(right.bought).localeCompare(String(left.bought))).slice(0, limit);
}

export function aliasKey(text) {
  return comparisonKey(text);
}

// Does a loose description ("Difco Potato Dextrose Broth", "去纖維羊血") describe this product?
function describes(text, product) {
  if (!product) return false;
  const tokens = (comparisonKey(text).match(/[a-z]{2,}|[一-鿿]/gu) || []).filter((token) => !["difco", "bd", "bbl", "oxoid", "cmp"].includes(token));
  if (!tokens.length) return false;
  const haystack = comparisonKey(`${product.name} ${product.nameZh} ${product.spec}`);
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length >= 0.6;
}

function resolveProduct(item, { reference, customerNo, aliases }) {
  if (item.codes?.length === 1 && item.codeWhy !== "訊息有完整品名") return { code: item.codes[0], status: "確定", why: item.codeWhy || "訊息有料號" };
  if (item.codes?.length === 1 && !item.chineseName) return { code: item.codes[0], status: "確定", why: "訊息品名與商品清單完全相同" };
  if (item.codes?.length === 1) return { code: item.codes[0], status: "待確認", why: `「${item.name}」與商品中文名相同，請確認規格`, candidates: item.codes };
  if (item.codes?.length > 1) {
    const bought = customerCodes(reference, customerNo);
    const preferred = item.codes.filter((code) => bought.has(code));
    if (preferred.length === 1) return { code: preferred[0], status: "確定", why: "同名品項中，客戶買過這個規格", candidates: item.codes };
    return { code: preferred[0] || item.codes[0], status: "待確認", why: `同名品項有 ${item.codes.length} 種規格，請確認`, candidates: item.codes };
  }
  const key = aliasKey(item.name);
  const learned = aliases[`${customerNo}|${key}`] || aliases[key];
  if (learned) return { code: learned, status: "確定", why: `「${item.name}」你先前確認過是 ${learned}` };
  const candidates = productCandidates(item.name, reference, customerNo);
  if (!candidates.length) return { code: "", status: "待確認", why: `找不到「${item.name}」對應的商品，請選擇料號`, candidates: [] };
  return { code: candidates[0].code, status: "待確認", why: `「${item.name}」依品名${candidates[0].bought ? "與購買紀錄" : ""}推測，請確認`, candidates: candidates.map((candidate) => candidate.code) };
}

function unitMismatch(spoken, salesUnit) {
  const allowed = SPOKEN_TO_SALES[spoken];
  if (!spoken || !salesUnit || !allowed) return false;
  return !allowed.includes(String(salesUnit).toUpperCase());
}

// ---- pricing -----------------------------------------------------------------------------

// 客戶指定 > 該客戶最近一次成交價 > 商品清單定價 > 待確認. Always says where the price came from.
export function priceFor({ reference, customerNo, code, specified, today }) {
  const product = reference.products.get(code);
  const story = customerNo && code ? priceStory(reference, customerNo, code) : null;
  const alerts = [];
  let unitPrice = null;
  let source = "";
  let status = "確定";
  if (specified) {
    unitPrice = specified.tax === "含稅" ? withoutTax(specified.value) : specified.value;
    source = specified.tax === "含稅" ? `客戶指定（含稅 ${specified.value}）` : "客戶指定";
    if (story && story.latest.unitPrice === unitPrice) source += `，與 ${story.latest.date.replaceAll("-", "/")} 成交價相同`;
    if (story && story.latest.unitPrice !== unitPrice) alerts.push(`客戶指定價 ${unitPrice} 與上次成交價 ${story.latest.unitPrice}（${formatShortDate(story.latest.date)}）不同，以客戶最新訊息為準`);
  } else if (story) {
    unitPrice = story.latest.unitPrice;
    source = `最近成交 ${story.latest.date.replaceAll("-", "/")}${story.latest.source === "LINE" ? "（LINE 訂單）" : ""}`;
  } else if (product?.listPrice) {
    unitPrice = product.listPrice;
    source = "商品清單定價（客戶沒買過）";
    // A list price far from what other customers recently paid is often a pack-size or data error.
    const others = reference.history.find((entry) => entry.code === code && entry.unitPrice !== null);
    if (others) {
      source += `；其他客戶最近成交 ${others.unitPrice}（${others.date.replaceAll("-", "/")}）`;
      if (Math.abs(product.listPrice - others.unitPrice) / others.unitPrice > 0.5) alerts.push(`商品清單定價 ${product.listPrice} 與其他客戶最近成交價 ${others.unitPrice} 差很多，請確認`);
    }
  } else {
    status = "待確認";
    source = code ? "沒有成交紀錄，商品清單也沒有定價" : "料號未確定";
  }
  // 漲價/定價提醒, graded like the 整理規則 sheet: 可維持 / 需注意 / 建議調價確認.
  const listPrice = story?.listPrice ?? product?.listPrice ?? null;
  let grade = "可維持";
  const reasons = [];
  if (unitPrice !== null && listPrice !== null) {
    const gap = round(listPrice - unitPrice, 2);
    if (gap > 0) { reasons.push(`低於本幣未稅訂價 ${listPrice}，差 ${gap}`); grade = "需注意"; }
    else if (gap < 0) reasons.push(`高於本幣未稅訂價 ${listPrice}，多 ${-gap}`);
  } else if (unitPrice !== null) { reasons.push("本幣未稅訂價缺漏，無法比對定價差額"); grade = "需注意"; }
  if (story) {
    const stale = story.changedAt && today && story.changedAt <= addDays(today, -365);
    if (story.previousPrice !== null && story.previousPrice < story.latest.unitPrice) reasons.push(`${story.changedAt.replaceAll("-", "/")} 由 ${story.previousPrice} 調為 ${story.latest.unitPrice}`);
    if (stale) { reasons.push(`${story.latest.unitPrice} 自 ${story.changedAt.replaceAll("-", "/")} 起未調整，已超過一年`); if (grade === "需注意") grade = "建議調價確認"; }
    if (story.highest.unitPrice > (unitPrice ?? 0)) reasons.push(`曾以較高價 ${story.highest.unitPrice} 成交（${story.highest.date.replaceAll("-", "/")}）`);
  } else if (code) { reasons.push("沒有這位客戶的成交紀錄"); if (grade === "可維持") grade = "需注意"; }
  return { unitPrice, source, status, alerts, priceAlert: code ? { grade, reasons } : null, listPrice };
}

// ---- the whole message -------------------------------------------------------------------

function orderNotes(plain) {
  const notes = [];
  const add = (text) => { if (text && !notes.includes(text)) notes.push(text); };
  const expiry = plain.match(/效期[^0-9]{0,6}(\d{4}[/.-]\d{1,2}(?:[/.-]\d{1,2})?)/u);
  if (expiry) add(`效期 ${expiry[1].replace(/[.-]/g, "/")}`);
  else if (/效期/u.test(plain)) add("客戶詢問效期，需確認");
  if (/單獨(?:一張)?發票|分開(?:開)?發票/u.test(plain)) add("客戶要求單獨一張發票");
  if (/隨貨附?發票|發票隨貨|可以開發票|開發票/u.test(plain)) add("隨貨附發票");
  const taxId = plain.match(/統編\s*[:：]?\s*(\d{8})/u);
  if (taxId) add(`統編 ${taxId[1]}`);
  if (/扣款|扣寄款|直接扣/u.test(plain)) add("直接扣款");
  const partial = plain.match(/先寄\s*([^，。；,;]{1,12})/u);
  if (partial) add(`先寄 ${partial[1].trim()}`);
  if (/COA/iu.test(plain)) add("需附 COA");
  if (/低溫|冷藏|冷凍配送/u.test(plain)) add("需低溫配送");
  if (/估價單/u.test(plain)) add("客戶需要估價單");
  const receiver = plain.match(/(?:收件人|寄送到|寄到|送至|送到|地址)\s*[:：]?\s*([^；;。\n]{4,60})/u);
  if (receiver) add(`收件：${receiver[1].trim()}`);
  if (/詢價|報價(?!單)|詢問/u.test(plain) && !/確認訂購|要訂|訂購|需要\s*\d|叫貨|要買/u.test(plain)) add("客戶詢價，尚未確定訂購");
  const visit = plain.match(VISIT_REQUEST);
  if (visit) {
    // 「要請您順便來進行自動取膜機的教學一下」 → 自動取膜機教學
    const what = plain.slice(visit.index, visit.index + visit[0].length + 8).replace(/[，。；,;\n(（].*$/u, "")
      .replace(/要請您|請您|順便|過來|來進行|進行|來|一下|的|拜託/gu, "").trim();
    add(`客戶請業務到場：${what || "到場服務"}（時間待約）`);
  }
  return notes;
}

function shipTime(plain, today) {
  if (/今天/u.test(plain)) return { text: `今天寄出（${today.replaceAll("-", "/")}）`, urgent: true };
  if (/明天/u.test(plain)) return { text: `明天寄出（${addDays(today, 1).replaceAll("-", "/")}）`, urgent: true };
  if (/急用|越快越好|盡快|儘快/u.test(plain)) return { text: "急用，請盡快出貨", urgent: true };
  const before = plain.match(/(\d{4}[/.-])?(\d{1,2})[/.-](\d{1,2})\s*(?:前|之前)(?:到貨|寄出|出貨)?/u);
  if (before) return { text: `${before[1] ? before[1].replace(/[.-]/, "/") : ""}${before[2]}/${before[3]} 前到貨`, urgent: false };
  if (/下週|下星期/u.test(plain)) return { text: "預計下週寄出", urgent: false };
  return null;
}

export function parseOrderMessage(text, { model = null, reference, aliases = {}, salutations = {}, today, customerOverride = null } = {}) {
  const plain = normalize(text).trim();
  const customer = customerOverride || identifyCustomer(plain, { model, reference, salutations });
  // Who is ordering is not what they order: drop the customer's names and the 「…要訂購：」 lead-in.
  let body = plain;
  for (const mention of [...(customer.mentions || []), customer.company, customer.contact].filter((value) => value && value.length >= 2).sort((left, right) => right.length - left.length)) body = body.split(mention).join(" ");
  const head = body.match(HEAD);
  if (head && head.index < 30 && !/[A-Za-z]{2,}\d|\d\s*(?:盒|罐|瓶|包|箱|片)/u.test(body.slice(0, head.index))) body = body.slice(head.index + head[0].length);
  const protectedText = protect(body, reference);
  const fragments = splitFragments(protectedText.text);
  const raw = [];
  const excluded = [];
  for (const fragment of fragments) {
    const placeholders = [...fragment.text.matchAll(/⟦(\d+)⟧/g)].map((match) => protectedText.tokens[Number(match[1])]);
    let piece = fragment.text.replace(/⟦\d+⟧/g, " ");
    // Numeric codes: 「貨號211387」「REF 254920」, matched to the catalog by their digits.
    const numeric = piece.match(/(?:貨號|料號|REF|型號)?\s*(?<!\d)(\d{5,7})(?!\d)/iu);
    let numericCodes = [];
    if (numeric && !/\d{4}[/.-]\d/.test(piece.slice(Math.max(0, numeric.index - 5), numeric.index + numeric[0].length + 3))) {
      numericCodes = reference.productList.filter((product) => product.code.replace(/[^0-9]/g, "").endsWith(numeric[1]) || product.code.endsWith(numeric[1])).map((product) => product.code);
      if (numericCodes.length) piece = piece.replace(numeric[0], " ");
    }
    const specless = piece.replace(SPEC, " ");
    const price = findPrice(specless);
    const quantity = findQuantity(price ? specless.replace(price.text, " ") : specless);
    const name = leftoverName(specless, quantity, price);
    const codeToken = placeholders.find((token) => token.kind === "code");
    const nameToken = placeholders.find((token) => token.kind === "name");
    const codes = codeToken ? [codeToken.code] : numericCodes.length ? numericCodes : nameToken ? nameToken.codes : [];
    // A visit request, or a question without a quantity, is conversation around the order.
    if (VISIT_REQUEST.test(fragment.text) && !codeToken) continue;
    if (QUESTION.test(fragment.text) && !quantity && !price && !codeToken) continue;
    const noteOnly = NOTE_WORDS.test(fragment.text) && !quantity && !codes.length;
    const hasProduct = codes.length > 0 || (name.length >= 2 && PRODUCTISH.test(name) && !noteOnly && !NOTE_WORDS.test(name));
    if (NEGATION.test(fragment.text) && hasProduct) { excluded.push(name || codeToken?.text || ""); continue; }
    if (!hasProduct) {
      // 「各兩盒」「價格 3400」 on their own belong to the items just before them; 「改訂 2 盒」 replaces.
      if (quantity && raw.length && /改訂|改成|改為|更正/u.test(fragment.text)) raw.at(-1).quantity = quantity;
      else if (quantity?.each) raw.filter((item) => !item.quantity).forEach((item) => { item.quantity = { ...quantity }; });
      else if (quantity && raw.length && !raw.at(-1).quantity && !NOTE_WORDS.test(fragment.text)) raw.at(-1).quantity = quantity;
      if (price && raw.length && !raw.at(-1).price) raw.at(-1).price = price;
      continue;
    }
    raw.push({
      sentence: fragment.sentence, name: name || codeToken?.text || nameToken?.text || "", codes,
      codeWhy: codeToken ? "訊息有料號" : numericCodes.length ? `由貨號 ${numeric[1]} 對應` : nameToken ? "訊息有完整品名" : "",
      chineseName: !codeToken && !numericCodes.length && Boolean(nameToken?.chinese),
      quantity, price,
    });
  }
  // 「MOX 跟李斯培養基，各兩盒」: an 各 quantity in a later fragment of the same sentence.
  for (const item of raw) {
    if (item.quantity) continue;
    const each = item.sentence.match(new RegExp(`各\\s*(?:買|訂|要)?\\s*(${NUM})\\s*(${UNITS})?`, "u"));
    if (each) item.quantity = { value: chineseNumber(each[1]), unit: each[2] || "", each: true };
  }
  const allPrices = raw.filter((item) => item.price);
  const loosePrice = !allPrices.length ? findPrice(plain.replace(SPEC, " ")) : null;
  if (loosePrice && raw.length === 1) raw[0].price = loosePrice;
  const anyTax = /含稅/u.test(plain) ? "含稅" : /未稅/u.test(plain) ? "未稅" : "";

  // 「CMP0400950 Defib.SheepBlood；去纖維羊血 $2500」 and 「REF 254920，Difco Potato Dextrose Broth」
  // describe one product twice: fold the description into the item before it.
  const resolvedItems = [];
  for (const item of raw) {
    const resolved = resolveProduct(item, { reference, customerNo: customer.customerNo, aliases });
    const previous = resolvedItems.at(-1);
    if (previous && (!item.quantity || !previous.quantity)) {
      const related = (one, other) => one.code && (one.code === other.code || (other.candidates || []).includes(one.code));
      const sameProduct = related(resolved, previous.resolved) || related(previous.resolved, resolved);
      const description = previous.resolved.status === "確定" && !item.quantity && item.codeWhy !== "訊息有料號" && (/^(?:規格|品名|用途)/u.test(item.name) || describes(item.name, reference.products.get(previous.resolved.code)));
      // 「一罐macconkey，貨號211387」: the name and the code are one item; the certain code wins.
      if ((sameProduct && (resolved.status === "確定" || previous.resolved.status === "確定")) || description) {
        if (resolved.status === "確定" && previous.resolved.status !== "確定") previous.resolved = resolved;
        previous.price ||= item.price;
        previous.quantity ||= item.quantity;
        continue;
      }
    }
    resolvedItems.push({ ...item, resolved });
  }
  // A quote line further down (「SAR114H6Z47SJREA … 每盒 1625 元」) settles an earlier 「需要10盒的濾膜」:
  // a certain code with no quantity joins the earlier item it is a candidate for.
  for (let index = resolvedItems.length - 1; index > 0; index -= 1) {
    const late = resolvedItems[index];
    if (late.resolved.status !== "確定" || late.quantity) continue;
    const earlier = resolvedItems.slice(0, index).find((item) => item.quantity && item.resolved.status !== "確定"
      && ((item.resolved.candidates || []).includes(late.resolved.code) || item.resolved.code === late.resolved.code || describes(item.name, reference.products.get(late.resolved.code))));
    if (!earlier) continue;
    earlier.resolved = { ...late.resolved, why: `${late.resolved.why}（與「${earlier.name}」是同一項）` };
    earlier.price ||= late.price;
    resolvedItems.splice(index, 1);
  }
  // A stock or expiry question in a sentence of its own (「效期多久？」) concerns every item.
  const itemSentences = new Set(resolvedItems.map((item) => item.sentence));
  const loose = fragments.filter((fragment) => !itemSentences.has(fragment.sentence)).map((fragment) => fragment.sentence).join(" ");
  const items = resolvedItems.map((item) => {
    const contextChecks = [];
    const about = `${item.sentence} ${loose}`;
    if (/庫存|現貨|有貨|還有.*嗎/u.test(about)) contextChecks.push({ field: "stock", text: "客戶詢問庫存／現貨，請確認" });
    if (/效期/u.test(about) && !/效期[^0-9]{0,6}\d{4}/u.test(about)) contextChecks.push({ field: "expiry", text: "客戶詢問效期，請確認" });
    return finishItem({
      said: item.name, code: item.resolved.code, codeStatus: item.resolved.status, codeWhy: item.resolved.why, candidates: item.resolved.candidates || [],
      quantity: item.quantity?.value ?? null, spokenUnit: item.quantity?.unit || "",
      specified: item.price ? { ...item.price, tax: item.price.tax || anyTax } : null, contextChecks,
    }, { reference, customerNo: customer.customerNo, today });
  });

  const checks = [];
  if (customer.status !== "確定") checks.push({ field: "customer", text: customer.why });
  if (!customer.salutation) checks.push({ field: "salutation", text: "客戶稱呼待確認，請填一次，之後會記住" });
  if (!items.length) checks.push({ field: "items", text: "沒有辨識到品項，請手動加入" });
  if (excluded.length) checks.push({ field: "items", text: `客戶表示這次不用：${excluded.filter(Boolean).join("、")}`, soft: true });
  const ship = shipTime(plain, today);
  const delivery = /自取|面交|親送|來拿|過去拿/u.test(plain) ? { value: "自取", source: "訊息" } : /寄|送至|送到|出貨/u.test(plain) ? { value: "寄送", source: "訊息" } : { value: "寄送", source: "預設" };
  return {
    date: today, raw: plain, customer, items, delivery,
    taxType: { value: anyTax === "含稅" && !/未稅/u.test(plain) ? "含稅" : "未稅", source: anyTax ? "訊息" : "預設" },
    shipTime: ship?.text || "", urgent: Boolean(ship?.urgent), notes: orderNotes(plain), checks,
  };
}

// Fills in an item from its essentials (code, quantity, the price the customer named or typed)
// and lists what still needs checking. Used by the parser and again after every edit on screen.
export function finishItem(base, { reference, customerNo, today }) {
  const product = reference.products.get(base.code);
  const history = base.code && customerNo ? customerHistory(reference, customerNo, base.code)[0] : null;
  const pricing = base.manualPrice !== undefined && base.manualPrice !== null
    ? { unitPrice: base.manualPrice, source: "手動輸入", status: "確定", alerts: [], priceAlert: priceFor({ reference, customerNo, code: base.code, specified: { value: base.manualPrice, tax: "未稅" }, today }).priceAlert, listPrice: null }
    : priceFor({ reference, customerNo, code: base.code, specified: base.specified, today });
  // The spec's 「/BOT」 is more reliable than the 銷售單位 column (which says SET or CTN for single bottles).
  const specUnit = String(product?.spec || history?.spec || "").match(/\/\s*([A-Za-z]{2,5})\s*$/)?.[1]?.toUpperCase() || "";
  const salesUnit = specUnit || history?.unit || product?.unit || "";
  const checks = [];
  if (base.codeStatus !== "確定") checks.push({ field: "code", text: base.codeWhy || "請選擇料號" });
  if (!base.quantity) checks.push({ field: "quantity", text: "訊息沒有寫數量，請確認" });
  if (pricing.status !== "確定") checks.push({ field: "price", text: `價格待確認：${pricing.source}` });
  pricing.alerts.forEach((text) => checks.push({ field: "price", text, soft: true }));
  if (unitMismatch(base.spokenUnit, salesUnit)) checks.push({ field: "unit", text: `客戶說「${base.spokenUnit}」，銷售單位是 ${salesUnit}，請確認數量`, soft: true });
  if (base.code && !product) checks.push({ field: "discontinued", text: "商品清單查無此料號，可能停售或停產，請確認" });
  // The 商品清單 itself marks some items, e.g. 規格「(停產)100 test /BOX」.
  if (product && /停產|停售|停止供應|已停/u.test(`${product.name} ${product.nameZh} ${product.spec}`)) checks.push({ field: "discontinued", text: `商品清單標示 ${base.code} 已停產／停售，請確認替代品項` });
  const stopped = base.code && reference.lineOrders.find((entry) => /停產|停售/u.test(entry.note) && entry.note.includes(base.code) && entry.code !== base.code);
  if (stopped) checks.push({ field: "discontinued", text: `LINE 訂單備註曾提到 ${base.code} 停產／停售，請確認` });
  checks.push(...(base.contextChecks || []));
  return {
    ...base,
    name: product?.name || history?.name || base.name || "", nameZh: product?.nameZh || "", spec: product?.spec || history?.spec || base.spec || "",
    unit: base.spokenUnit || salesUnit, salesUnit,
    unitPrice: pricing.unitPrice, priceSource: pricing.source, priceStatus: pricing.status, priceAlert: pricing.priceAlert, listPrice: pricing.listPrice,
    checks,
  };
}

// An edit on screen: a picked code is the user's decision, so it counts as 確定.
export function updateItem(item, changes, context) {
  const base = { ...item, ...changes };
  if ("code" in changes) {
    base.code = normalizeCode(changes.code);
    base.codeStatus = base.code ? "確定" : "待確認";
    base.codeWhy = base.code ? "你選定的料號" : "請選擇料號";
    base.name = ""; base.spec = "";
  }
  // 「庫存已確認」: the user checked stock or expiry, so that reminder goes away.
  if (changes.clearCheck) base.contextChecks = (item.contextChecks || []).filter((check) => check.field !== changes.clearCheck);
  delete base.clearCheck;
  return finishItem(base, context);
}

export function blankItem(context) {
  return finishItem({ said: "", code: "", codeStatus: "待確認", codeWhy: "請選擇料號", candidates: [], quantity: null, spokenUnit: "", specified: null, contextChecks: [] }, context);
}

// Picking another customer changes every 「最近成交價」, so the items are priced again.
export function changeCustomer(draft, customer, { reference, today, salutations = {} }) {
  const next = { ...customer, salutation: customer.salutation || salutationFor(customer.contact, salutations), status: "確定", why: "你選定的客戶" };
  // Guesses made without knowing the customer are ranked again with what this customer actually buys.
  const items = draft.items.map((item) => {
    if (item.codeStatus === "確定" || !item.said) return finishItem(item, { reference, customerNo: next.customerNo, today });
    const candidates = productCandidates(item.said, reference, next.customerNo);
    const top = candidates[0];
    return finishItem({
      ...item, code: top?.code || item.code, candidates: candidates.length ? candidates.map((candidate) => candidate.code) : item.candidates,
      codeWhy: top ? `「${item.said}」依品名${top.bought ? `與這位客戶的購買紀錄（${top.bought} 買過）` : ""}推測，請確認` : item.codeWhy,
    }, { reference, customerNo: next.customerNo, today });
  });
  return { ...draft, customer: next, items, checks: draftChecks(next, items, draft.checks) };
}

export function draftChecks(customer, items, previous = []) {
  const checks = previous.filter((check) => !["customer", "salutation", "items"].includes(check.field) || check.soft);
  if (customer.status !== "確定") checks.unshift({ field: "customer", text: customer.why || "請選擇客戶" });
  if (!customer.salutation) checks.push({ field: "salutation", text: "客戶稱呼待確認，請填一次，之後會記住" });
  if (!items.length) checks.push({ field: "items", text: "沒有辨識到品項，請手動加入" });
  return checks;
}

// The customer picker: everyone we know by name, contact or number, app customers and ERP/LINE customers alike.
export function customerChoices(query, { model, reference, limit = 8 }) {
  const key = comparisonKey(query);
  if (!key) return [];
  const found = new Map();
  for (const customer of reference.customers.values()) {
    const names = [...customer.names, ...customer.contacts];
    if (customer.customerNo.includes(key) || names.some((name) => comparisonKey(name).includes(key))) {
      found.set(customer.customerNo, { customerNo: customer.customerNo, company: [...customer.names][0] || "", contact: [...customer.contacts][0] || "", customerId: "" });
    }
  }
  for (const customer of model?.customers || []) {
    const no = normalizeCustomerNo(customer.customerNo);
    if (!comparisonKey(`${customer.name}${no}`).includes(key)) continue;
    const id = no || `app:${customer.id}`;
    found.set(id, { ...(found.get(id) || { contact: "" }), customerNo: no, company: customer.name, customerId: customer.id });
  }
  return [...found.values()].slice(0, limit);
}

export function productLabel(reference, code) {
  const product = reference.products.get(code);
  if (product) return [code, product.name, product.nameZh ? `（${product.nameZh}）` : "", product.spec ? `｜${product.spec}` : ""].join(" ").replace(/\s+/g, " ").trim();
  const entry = reference.history.find((item) => item.code === code);
  return entry ? `${code} ${entry.name}｜${entry.spec}（商品清單沒有）` : code;
}

export const parsingInternals = { findQuantity, findPrice, splitFragments };

// ---- totals and texts ---------------------------------------------------------------------

// Each item's 含稅小計 is rounded on its own and the 含稅總金額 is their sum, so the customer's
// lines always add up; 稅額 is whatever separates that from the 未稅 total.
export function itemGross(item) {
  return item.unitPrice !== null && item.quantity ? Math.round(item.unitPrice * item.quantity * (1 + TAX_RATE)) : null;
}

export function orderTotals(items) {
  const priced = items.filter((item) => item.unitPrice !== null && item.quantity);
  const net = priced.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const gross = priced.reduce((sum, item) => sum + itemGross(item), 0);
  return { net: round(net, 2), tax: gross - Math.round(net), gross, complete: priced.length === items.length && items.length > 0, missing: items.length - priced.length };
}

export function pendingChecks(draft) {
  return [...draft.checks.filter((check) => !check.soft), ...draft.items.flatMap((item) => item.checks.filter((check) => !check.soft))];
}

const money = (value) => (Number.isInteger(round(value, 4)) ? round(value).toLocaleString("en-US") : round(value, 4).toLocaleString("en-US", { maximumFractionDigits: 4 }));
const roundedMoney = (value) => `${Number.isInteger(round(value, 2)) ? "" : "約 "}${Math.round(value).toLocaleString("en-US")}`;
const itemLabel = (item) => [item.code || "料號待確認", [item.name || item.said, item.nameZh ? `（${item.nameZh}）` : ""].join("")].join("｜");

// 「興農 楊津銘」 already names the contact; do not print 楊津銘 twice.
export function customerDisplayName(draft) {
  const { company = "", contact = "" } = draft.customer;
  return contact && company.includes(contact) ? company : [company, contact].filter(Boolean).join(" ");
}

export function secretaryText(draft) {
  const lines = [
    `客戶姓名：${customerDisplayName(draft) || "待確認"}`,
    `客戶編號：${draft.customer.customerNo || "待確認"}`,
  ];
  draft.items.forEach((item, index) => {
    const pending = item.checks.filter((check) => !check.soft && check.field !== "code" && check.field !== "price" && check.field !== "quantity");
    lines.push("", `${index + 1}. 訂購品項：${itemLabel(item)}${item.codeStatus === "確定" ? "" : "（待確認）"}`);
    lines.push(`規格：${item.spec || "待確認"}`);
    lines.push(`數量：${item.quantity ?? "待確認"}${item.quantity ? ` ${item.unit}` : ""}`);
    lines.push(`價格：${item.unitPrice !== null ? `${money(item.unitPrice)}／${item.unit || "單位"}（未稅）；含稅 ${money(withTax(item.unitPrice))}` : "待確認"}`);
    if (item.priceSource) lines.push(`價格來源：${item.priceSource}`);
    if (item.unitPrice !== null && item.quantity) lines.push(`小計：${roundedMoney(item.unitPrice * item.quantity)}（未稅）；含稅 ${itemGross(item).toLocaleString("en-US")}`);
    const flags = item.checks.filter((check) => ["stock", "expiry", "discontinued", "unit"].includes(check.field) || (check.field === "price" && !check.soft && item.unitPrice === null));
    if (flags.length || pending.length) lines.push(`注意：${[...new Set([...flags, ...pending].map((check) => check.text))].join("；")}`);
  });
  const totals = orderTotals(draft.items);
  lines.push("", `配送方式：${draft.delivery.value}`, `稅額：${draft.taxType.value}`);
  lines.push(`未稅合計：${roundedMoney(totals.net)}${totals.complete ? "" : `（另有 ${totals.missing} 項價格待確認）`}`);
  lines.push(`稅額 5%：${totals.tax.toLocaleString("en-US")}`, `含稅合計：${totals.gross.toLocaleString("en-US")}`);
  const notes = [...draft.notes, draft.shipTime].filter(Boolean);
  lines.push(`備註：${notes.length ? notes.join("；") : "無"}`);
  return lines.join("\n");
}

// The customer sees 含稅 prices: unit, each subtotal and the total, all of which add up.
export function customerText(draft) {
  const greeting = draft.customer.salutation ? `${draft.customer.salutation}您好` : "（稱呼待確認）您好";
  const unsure = draft.items.filter((item) => item.codeStatus !== "確定" || !item.quantity);
  const flagged = draft.items.filter((item) => item.checks.some((check) => ["stock", "expiry", "discontinued"].includes(check.field)));
  const lines = [unsure.length ? `${greeting}，以下是本次訂購內容，有幾項想先跟您確認一下 😊` : `${greeting}，以下是本次訂購內容 😊`, ""];
  draft.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${[item.code, item.name || item.said, item.spec].filter(Boolean).join("｜")}${item.codeStatus === "確定" ? "" : `（您說的「${item.said}」是這項嗎？）`}`);
    lines.push(`數量：${item.quantity ?? "請問需要幾個？"}${item.quantity ? ` ${item.unit}` : ""}`);
    if (item.unitPrice !== null) {
      lines.push(`含稅單價：${money(Math.round(withTax(item.unitPrice) * 100) / 100)} 元／${item.unit || "單位"}`);
      if (item.quantity) lines.push(`小計：${itemGross(item).toLocaleString("en-US")} 元`);
    } else lines.push("單價：確認後回覆您");
    lines.push("");
  });
  const totals = orderTotals(draft.items);
  if (totals.complete) lines.push(`含稅總金額：${totals.gross.toLocaleString("en-US")} 元`);
  else lines.push(`含稅總金額：待價格確認後回覆您`);
  if (flagged.length) lines.push(`${flagged.map((item) => item.name || item.said).join("、")} 的供貨狀況（庫存／效期／是否停產）我確認後再回覆您。`);
  if (draft.shipTime) lines.push(`出貨時間：${draft.shipTime}`);
  lines.push(unsure.length ? "再麻煩您確認，謝謝！" : "確認沒問題的話我就幫您安排出貨，謝謝！");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function priceAlertText(draft) {
  const rows = draft.items.filter((item) => item.priceAlert).map((item) => `- [${item.priceAlert.grade}] ${item.name || item.said}：${item.unitPrice !== null ? `本次 ${money(item.unitPrice)}（${item.priceSource}）` : "價格待確認"}${item.priceAlert.reasons.length ? `；${item.priceAlert.reasons.join("；")}` : ""}`);
  return rows.length ? `漲價/定價提醒：\n${rows.join("\n")}` : "漲價/定價提醒：沒有可比對的品項";
}

// One row per item for the LINE訂單整理 tab, in its column order; the last column is APP編號.
export function lineOrderRows(draft, { appIds, status = "待確認" }) {
  const inclusive = draft.taxType.value === "含稅";
  const date = draft.date.replaceAll("-", "/");
  const notes = [...draft.notes, draft.shipTime].filter(Boolean);
  return draft.items.map((item, index) => {
    // Supply warnings (stock, expiry, discontinued, unit) are written once; other open points get 「待確認：」.
    const supply = item.checks.filter((check) => ["stock", "expiry", "discontinued", "unit"].includes(check.field)).map((check) => check.text);
    const pending = item.checks.filter((check) => !check.soft && !supply.includes(check.text)).map((check) => check.text);
    const itemNotes = [...notes, ...supply];
    return {
      日期: date, 客戶姓名: customerDisplayName(draft) || "待確認", 客戶編號: draft.customer.customerNo || "待確認",
      產品編號: item.codeStatus === "確定" ? item.code : `待確認${item.code ? `（${item.code}?）` : ""}`,
      訂購品項: [item.name || item.said, item.nameZh ? `（${item.nameZh}）` : ""].join(""), 規格: item.spec || "待確認",
      數量: item.quantity ?? "待確認", 價格: item.unitPrice === null ? "待確認" : inclusive ? withTax(item.unitPrice) : item.unitPrice,
      配送方式: draft.delivery.value, 稅額: draft.taxType.value, 原始訊息: draft.raw,
      備註: [...new Set([...itemNotes, ...pending.map((text) => `待確認：${text}`)])].join("；"), 狀態: status, APP編號: appIds[index],
    };
  });
}
