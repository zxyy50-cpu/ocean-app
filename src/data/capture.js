import { addDays, addWorkdays, isDateOnly } from "../core/dates.js";
import { cleanText, comparisonKey, companyKey } from "../core/text.js";
import { saveVisit, suggestsPostVisitActions } from "./activities.js";
import { primaryContact } from "./model.js";

// Quick capture: the salesperson types (or dictates) one message like they used to in
// LINE; these rules suggest the structured fields. Nothing leaves the device, nothing is
// saved without confirmation, and anything the rules can't tell is left blank.

// Short prefixes that say nothing about which company is meant.
const GENERIC_PREFIXES = new Set(["國立", "台灣", "臺灣", "中華", "財團", "股份", "有限", "嘉義", "雲林", "高雄", "屏東", "台南", "台中", "台北", "新北", "桃園", "新竹", "彰化", "南投", "台東", "花蓮", "宜蘭", "苗栗", "基隆", "中國", "東海", "中興", "中正", "成功", "大學", "公司", "食品", "生技", "科技", "實業", "企業"]);
const SHEET_ERROR = /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NULL!|NUM!)$/i;
const TITLE_SUFFIX = /(先生|小姐|女士|經理|副理|課長|組長|主任|廠長|老師|教授|博士|專員|技術員|研究員)+$/u;

// Longest leading part of the company name (at least 2 characters, not a generic word) found in the text.
function nameMatchLength(textKey, name) {
  const key = companyKey(name);
  if (!key) return 0;
  for (let length = Math.min(key.length, 12); length >= 2; length -= 1) {
    const prefix = key.slice(0, length);
    if (length <= 3 && GENERIC_PREFIXES.has(prefix)) return 0;
    if (textKey.includes(prefix)) return length;
  }
  return 0;
}

function contactTokens(contact) {
  return String(contact.name || "").split(/[\s,，、/／]+/).map((part) => comparisonKey(part)).filter((part) => part.length >= 2 && !SHEET_ERROR.test(part))
    .flatMap((part) => [part, part.replace(TITLE_SUFFIX, "")]).filter((part) => part.length >= 2);
}

export function matchCustomers(model, text, { limit = 5 } = {}) {
  const textKey = comparisonKey(text);
  if (textKey.length < 2) return [];
  const results = [];
  for (const customer of model.customers) {
    let score = nameMatchLength(textKey, customer.name);
    for (const alias of customer.aliases || []) score = Math.max(score, nameMatchLength(textKey, alias));
    const contacts = (model.contactsByCustomer.get(customer.id) || []).filter((contact) => contactTokens(contact).some((token) => textKey.includes(token)));
    if (!score && !contacts.length) continue;
    if (contacts.length) score += 3;
    // "某某生技嘉義廠" should prefer the 嘉義 record: other parts of the name or its area also in the text.
    const parts = String(customer.name || "").split(/[()（）\-－—_\s/／・]+/).slice(1).map((part) => comparisonKey(part)).filter((part) => part.length >= 2);
    if (parts.some((part) => textKey.includes(part)) || (customer.areaTags || []).some((area) => textKey.includes(comparisonKey(area)))) score += 1;
    if (customer.customerNo) score += 1;
    if (customer.important) score += 0.5;
    results.push({ customer, score, contact: contacts[0] || null });
  }
  return results.sort((left, right) => right.score - left.score || String(right.customer.lastContactAt || "").localeCompare(String(left.customer.lastContactAt || ""))).slice(0, limit);
}

const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const CHINESE_NUMBERS = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function weekdayAfter(today, target, nextWeek) {
  const current = weekday(today);
  const mondayOffset = (current + 6) % 7;
  const monday = addDays(today, -mondayOffset);
  let date = addDays(monday, (target + 6) % 7 + (nextWeek ? 7 : 0));
  if (!nextWeek && date <= today) date = addDays(date, 7);
  return date;
}

// Last working day of a month (a weekend month-end moves back to Friday).
function lastWorkdayOfMonth(year, month) {
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return addDays(last, weekday(last) === 6 ? -1 : weekday(last) === 0 ? -2 : 0);
}

// Understands 今天/明天/後天、N 天後、(下)週X、下週、M/D、M月D日、月底、下個月、年底／第四季、年初. Relative days skip weekends.
export function parseDate(text, today) {
  const value = String(text || "");
  const rules = [
    [/大後天/, () => addWorkdays(today, 3)],
    [/後天/, () => addWorkdays(today, 2)],
    [/明天|明日/, () => addWorkdays(today, 1)],
    [/今天|今日/, () => today],
    [/(\d{1,2})\s*天後/, (m) => addWorkdays(today, Number(m[1]))],
    [/([一二兩三四五六七八九十])\s*天後/, (m) => addWorkdays(today, CHINESE_NUMBERS[m[1]])],
    [/下(?:個)?(?:週|周|星期|禮拜)([一二三四五六日天])/, (m) => weekdayAfter(today, WEEKDAYS[m[1]], true)],
    [/(?:這|本)?(?:週|周|星期|禮拜)([一二三四五六日天])/, (m) => weekdayAfter(today, WEEKDAYS[m[1]], false)],
    [/下(?:個)?(?:週|周|星期|禮拜)/, () => addWorkdays(today, 7)],
    [/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*[日號]?/, (m) => {
      const year = Number(today.slice(0, 4));
      const make = (y) => `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
      const date = make(year);
      if (!isDateOnly(date)) return null;
      return date < today ? make(year + 1) : date;
    }],
    [/月底/, () => lastWorkdayOfMonth(...today.split("-").slice(0, 2).map(Number))],
    [/下(?:個)?月/, () => addWorkdays(today, 30)],
    [/年底|年末|第四季|Q4/i, () => lastWorkdayOfMonth(Number(today.slice(0, 4)), 12)],
    [/明年初|年初/, () => lastWorkdayOfMonth(Number(today.slice(0, 4)) + 1, 1)],
  ];
  // Collect every date expression; "今天" usually describes the visit itself, so a later
  // expression wins, and among the rest the one written last (the promised next step) wins.
  const found = [];
  for (const [pattern, toDate] of rules) {
    const match = value.match(pattern);
    if (!match || found.some((item) => item.index <= match.index && match.index < item.index + item.text.length)) continue;
    const date = toDate(match);
    if (date) found.push({ date, text: match[0], index: match.index });
  }
  const useful = found.filter((item) => !/今天|今日/.test(item.text));
  const pick = (useful.length ? useful : found).sort((left, right) => right.index - left.index)[0];
  return pick ? { date: pick.date, text: pick.text } : null;
}

const OBJECTION_WORDS = [
  ["price", /貴|價格|價錢|預算|便宜|折扣|比價|降價|殺價/],
  ["technical", /準不準|準確|偽陽|偽陰|不熟|驗證|導入|技術|操作|判讀/],
  ["timeline", /人力不足|人手不夠|人手不足|來不及|沒時間|產線|太忙|排不出/],
  ["people", /老闆|主管|廠長.{0,6}(決定|同意|點頭)|要負責|上面/],
];

const REACTIONS = [
  ["價格考量", /貴|價格|價錢|預算|便宜|折扣|比價|降價|殺價/],
  ["已有供應商", /已經在用|原本用|現在用|現用|合作廠商|固定跟/],
  ["暫無需求", /不需要|沒需求|暫時不用|先不用/],
  ["要求資料", /要資料|寄資料|型錄|DM|規格書|報告/i],
  ["等待報價", /等報價|要報價|請報價|給報價/],
  ["有興趣", /有興趣|想試|想看|可以試|願意/],
  ["無法聯絡", /沒接|不在|找不到人|聯絡不上/],
];

const CHANNELS = [
  ["視訊", /視訊|線上會議|teams|meet|zoom/i],
  ["LINE", /line/i],
  ["Email", /email|e-mail|寄信|來信|mail/i],
  ["電話", /電話|打給|來電|撥給|通話/],
  ["親訪", /拜訪|到廠|現場|見面|過去|面談|親訪|去了|(我|今天|昨天|剛剛|早上|上午|下午)(去|到)/],
  ["展覽／研討會", /展覽|研討會|攤位/],
];

const NEXT_STEP = /(要|請|給|寄|報價|送樣|demo|試用|試算|回覆|提供|安排|約|準備|確認|追蹤|再聯絡|推)/i;
// Clauses about when the deal closes give the opportunity's close date, not a reminder.
const CLOSING = /結案|成交|簽約|簽下|下單|採購|拍板/;

// Dictated notes have no punctuation, so a space before a Chinese word also ends a clause.
export function splitClauses(text) {
  return String(text || "").split(/[，,。；;！!？?\n]|\s+(?=[一-鿿])/).map((part) => part.trim()).filter(Boolean);
}

export function parseNextAction(text) {
  const clauses = splitClauses(text);
  // Things already done ("已回覆") or turned down ("不需要換") are not next steps, nor is the close date.
  const index = clauses.map((clause, position) => ({ clause, position })).reverse()
    .find(({ clause }) => NEXT_STEP.test(clause) && clause.length >= 3 && !/^已|已經|不需要|不用|不要/.test(clause) && !CLOSING.test(clause))?.position;
  if (index === undefined) return "";
  let pick = clauses[index].replace(/^(然後|之後|再|我要|我們要|我會|下次|要)/, "");
  // "下週二前給" alone doesn't say what; borrow the clause before it ("廠長要看人力節省試算").
  const withoutDate = pick.replace(/(大?後天|明天|今天|\d{1,2}\s*天後|下?(個)?(週|周|星期|禮拜)[一二三四五六日天]?|\d{1,2}\s*[/月]\s*\d{1,2}\s*[日號]?|月底|下(個)?月|前|之前|給|再)/g, "");
  if (withoutDate.trim().length < 2 && index > 0) pick = `${clauses[index - 1]}（${pick}）`;
  return pick.slice(0, 40);
}

// Products and test items worth naming an opportunity after.
const PRODUCT_TERMS = /沙門氏?菌|李斯特菌|金黃色?葡萄球菌|大腸桿菌|腸桿菌科?|總生菌|生菌數|黴菌|酵母菌|過敏原|組織胺|抗生素|快篩|培養基|試劑|儀器|設備|環境監控|檢驗服務/g;
const LATIN_NOISE = new Set(["DEMO", "LINE", "EMAIL", "MAIL", "ERP", "PDF", "DM", "OK", "QC", "QA", "TEST"]);
const BUYING_INTENT = /推|報價|提案|導入|試用|評估|採購|想買|要買|換成|改用|引進|有興趣|demo|買/i;

export function parseProducts(text) {
  const value = String(text || "");
  // A brand right after 比／用／換掉 is what the customer uses now (a competitor), not what we sell.
  const competitor = new Set([...value.matchAll(/(?:比|用|現用|原本用|換掉)\s*([A-Za-z][A-Za-z0-9-]+)/g)].map((match) => match[1].toUpperCase()));
  const latin = [...new Set((value.match(/\b[A-Z][A-Za-z0-9-]{2,}\b/g) || []).filter((word) => !LATIN_NOISE.has(word.toUpperCase()) && !competitor.has(word.toUpperCase())))];
  const chinese = [...new Set(value.match(PRODUCT_TERMS) || [])];
  return { terms: [...latin, ...chinese], name: [latin.join(" "), chinese.join("")].filter(Boolean).join(" ").slice(0, 30) };
}

export function parseCapture(model, text, { today } = {}) {
  const value = String(text || "");
  const clauses = splitClauses(value);
  const candidates = matchCustomers(model, value);
  const top = candidates[0] || null;
  // "今天" is the visit itself; closing words point to the deal's close date instead of a reminder.
  const closeDate = clauses.filter((clause) => CLOSING.test(clause)).map((clause) => parseDate(clause, today)).filter(Boolean).pop() || null;
  const reminder = clauses.filter((clause) => !CLOSING.test(clause)).map((clause) => parseDate(clause, today)).filter((date) => date && !/今天|今日/.test(date.text)).pop() || null;
  const objections = OBJECTION_WORDS.filter(([, pattern]) => pattern.test(value)).map(([id]) => id);
  const reaction = REACTIONS.find(([, pattern]) => pattern.test(value))?.[0] || "";
  const channel = CHANNELS.find(([, pattern]) => pattern.test(value))?.[0] || "";
  const openOpportunities = top ? (model.opportunitiesByCustomer.get(top.customer.id) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage)) : [];
  const products = parseProducts(value);
  const mentions = (opportunity) => products.terms.some((term) => [opportunity.name, opportunity.product, opportunity.notes, opportunity.nextAction].join(" ").toLowerCase().includes(term.toLowerCase()));
  // An open case that mentions the product wins; with a single open case, update it rather
  // than start a duplicate. A new one is suggested only when nothing open fits.
  const existing = openOpportunities.find(mentions) || (openOpportunities.length === 1 ? openOpportunities[0] : null);
  const create = !existing && Boolean(top) && products.terms.length > 0 && BUYING_INTENT.test(value);
  return {
    text: value,
    candidates,
    customerId: top?.customer.id || "",
    contactId: top?.contact?.id || (top ? primaryContact(model, top.customer.id)?.id || "" : ""),
    channel,
    reaction,
    objections,
    nextAction: parseNextAction(value),
    // Nothing said about when to follow up: suggest one week later (shown as a suggestion).
    nextFollowUpDate: reminder?.date || (top ? addWorkdays(today, 7) : ""),
    dateText: reminder?.text || (top ? "沒提到，先排一週後" : ""),
    reminderSuggested: !reminder,
    opportunityMode: existing ? "update" : create ? "create" : "",
    opportunityId: existing?.id || "",
    opportunityName: create ? products.name : "",
    opportunityCloseDate: closeDate?.date || "",
    closeDateText: closeDate?.text || "",
  };
}

// Saves through the regular visit path, so every rule (one transaction, reminders,
// customer timeline, follow-up dates, post-visit actions) is the same as the full form.
export function saveCapture(db, fields, { requestId, today, fallbackChannel = "電話" } = {}) {
  const channel = cleanText(fields.channel) || fallbackChannel;
  const input = {
    customerId: fields.customerId,
    contactId: fields.contactId || "",
    reminderId: fields.reminderId || "",
    activityDate: fields.activityDate || today,
    channel,
    purpose: fields.purpose || "",
    reaction: fields.reaction || "",
    result: "",
    detailedNote: fields.text,
    nextAction: fields.nextAction || "",
    nextFollowUpDate: fields.noReminder ? "" : fields.nextFollowUpDate,
    followUpMode: fields.noReminder ? "none" : "",
    opportunityAction: fields.opportunityMode === "create" ? "create" : fields.opportunityId ? "update" : "none",
    opportunityId: fields.opportunityMode === "create" ? "" : fields.opportunityId || "",
    opportunityName: fields.opportunityName || "",
    opportunityStage: fields.opportunityMode === "create" ? "接觸" : "",
    opportunityCloseDate: fields.opportunityCloseDate || "",
    postVisitActions: suggestsPostVisitActions({ channel, purpose: fields.purpose }) ? "yes" : "",
    ...Object.fromEntries(Object.entries(fields).filter(([key]) => key.startsWith("prep."))),
  };
  return saveVisit(db, input, { requestId, today });
}
