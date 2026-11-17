import { cleanText, comparisonKey } from "../core/text.js";

// Filling in customers that have no 聯絡人／電話／地址: from the company 客戶資料 sheet
// (already downloaded with the order reference) or from rows pasted out of the ERP 聯絡人 table.

const PHONE = /^[+()\d\s#-]{6,30}$/;
const MOBILE = /09\d{2}[-\s]?\d{3}[-\s]?\d{3}/;
// (08)7701234#100, 08-7701234, 07 123 4567, 0912345678
const PHONE_IN_TEXT = /(?:\(0\d{1,2}\)\s?|0\d{1,2}[-\s])?\d{3,4}[-\s]?\d{3,4}(?:\s?#\s?\d{1,5})?/g;
const TITLES = ["老師", "教授", "副教授", "助理教授", "主任", "經理", "副理", "課長", "副課長", "組長", "技師", "技術員", "博士", "處長", "廠長", "協理", "助理", "專員", "研究員", "採購", "會計", "品保", "品管", "研發", "業務", "秘書", "特助", "總經理", "副總", "總監", "執行長", "董事長", "董事", "老闆", "老闆娘", "店長", "襄理", "科長", "股長", "營養師", "醫師", "小姐", "先生", "太太"];
// A surname with one of these is the name itself: 王小姐, 張課長.
const ADDRESS_FORMS = ["小姐", "先生", "太太"];
const ADDRESS = /[縣市].*[路街道巷號]|[路街道]\S*號/;
const ROW_LABELS = /^(?:FIN|項次|部門單位|郵遞區號|聯絡人-?\d*|地址|室內電話.*|手機.*|E-?mail.*)$/i;

function splitPersonAndTitle(text) {
  const value = cleanText(text).replace(/[（(]([^）)]*)[）)]/g, " $1 ");
  const title = TITLES.filter((word) => value.includes(word)).sort((left, right) => right.length - left.length)[0] || "";
  const name = cleanText(title ? value.replace(title, " ") : value).split(/\s+/)[0] || "";
  return { name, title };
}

function phonesIn(text) {
  const value = String(text || "");
  const mobile = (value.match(MOBILE) || [""])[0].replace(/[-\s]/g, "");
  const phone = (value.replace(MOBILE, " ").match(PHONE_IN_TEXT) || []).map(cleanText).find((candidate) => candidate.replace(/\D/g, "").length >= 7) || "";
  return { phone: PHONE.test(phone) ? phone : "", mobile };
}

// A 聯絡人 cell as people type it: 「劉巧玲小姐#37309」「曾慧心-品管」「採購劉義山R.#7070」
// 「林孟柔S. 0930-220758」「張課長」「*」. Returns null when no one is named.
export function personFromCell(text) {
  let value = cleanText(String(text || "").replace(/^[\s"'“”]+|[\s"'“”]+$/g, ""));
  if (!/[一-鿿A-Za-z]/.test(value)) return null;
  const { phone, mobile } = phonesIn(value.replace(/#\s?\d+/g, " "));
  const ext = (value.match(/#\s?(\d{2,6})/) || [])[1] || "";
  value = value.replace(MOBILE, " ").replace(PHONE_IN_TEXT, (match) => (match.replace(/\D/g, "").length >= 7 ? " " : match)).replace(/#\s?\d+/g, " ").replace(/\b[A-Z]\.\s*/g, " ");
  const [person, department = ""] = value.split(/\s*[-－]\s*/);
  let { name, title } = splitPersonAndTitle(person);
  name = name.replace(/[^一-鿿A-Za-z]/g, "");
  if (name.length === 1 && title) name = `${name}${title}`;
  if (ADDRESS_FORMS.includes(title)) title = "";
  if (!name || (name.length < 2 && !/[A-Za-z]{2}/.test(name))) return null;
  return { name, title, department: cleanText(department), phone, mobile, ext };
}

// One 客戶資料 row → a contact (or null when it names nobody).
export function contactFromSheetRow(row) {
  const person = personFromCell(row.contact);
  if (!person) return null;
  const sheet = phonesIn(row.phone);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email || "") ? row.email : "";
  const notes = ["從公司客戶資料補上", person.ext ? `分機 ${person.ext}` : ""].filter(Boolean).join("；");
  return { name: person.name, title: person.title, department: person.department, phone: person.phone || sheet.phone, mobile: person.mobile || sheet.mobile, email, notes };
}

// Rows copied out of the ERP 聯絡人 grid (tab-separated) or typed by hand, one person per line:
// 「10	老師	912301	王大明	屏東縣內埔鄉學府路1號… 0912345678	(08)7701234#100」
export function parseContactText(text) {
  const people = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!cleanText(line)) continue;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}|[，,、|]/)).map(cleanText).filter(Boolean);
    let name = ""; let title = ""; let department = ""; let address = "";
    const { phone, mobile } = phonesIn(line);
    for (const cell of cells) {
      if (ROW_LABELS.test(cell) || /^\d{1,6}$/.test(cell) || /^[\d()#\s-]+$/.test(cell) || /@/.test(cell)) continue;
      if (ADDRESS.test(cell)) { if (!address) address = cell; continue; }
      if (TITLES.includes(cell)) { title ||= cell; continue; }
      if (/系|科|部|室|課|組|中心|實驗室|Lab/i.test(cell) && cell.length <= 16 && !name) { department ||= cell; continue; }
      if (!name) { const person = splitPersonAndTitle(cell); name = person.name; title ||= person.title; }
    }
    // A line with only an address can still say who: 「…王大明老師 0912345678」.
    if (!name && address) {
      const named = address.match(/([一-鿿]{2,4})(老師|教授|主任|經理|小姐|先生)/u);
      if (named) { name = named[1]; title ||= named[2]; }
    }
    if (!name || /^\d/.test(name)) continue;
    const email = (line.match(/[^\s@，,]+@[^\s@，,]+\.[^\s@，,]+/) || [""])[0];
    people.push({ name, title, department, phone, mobile, email, address, notes: "從 ERP 貼上" });
  }
  return people;
}

const known = (contacts) => new Set(contacts.map((contact) => comparisonKey(contact.name)).filter(Boolean));

// What could be added to this customer: 客戶資料 rows first (they have phones), then names seen on orders.
export function contactSuggestions(model, reference, customer) {
  const entry = customer?.customerNo ? reference?.customers?.get(customer.customerNo) : null;
  if (!entry) return { contacts: [], phone: "", address: "" };
  const have = known(model.contactsByCustomer.get(customer.id) || []);
  const contacts = [];
  const add = (contact) => { const key = comparisonKey(contact?.name); if (!key || have.has(key)) return; have.add(key); contacts.push(contact); };
  for (const row of entry.sheetRows || []) add(contactFromSheetRow(row));
  for (const name of entry.contacts || []) add({ ...splitPersonAndTitle(name), department: "", phone: "", mobile: "", email: "", notes: "訂單上出現過的聯絡人" });
  const rows = entry.sheetRows || [];
  const phone = customer.phone ? "" : rows.map((row) => phonesIn(row.phone).phone).find(Boolean) || "";
  const address = customer.address ? "" : rows.map((row) => row.address).find((value) => ADDRESS.test(value || "")) || "";
  return { contacts, phone, address };
}

// Adds the given contacts (skipping names already there) and fills an empty 電話／地址 on the customer.
export async function addContacts(db, model, customer, { contacts = [], phone = "", address = "" }, requestId) {
  const have = known(model.contactsByCustomer.get(customer.id) || []);
  const fresh = contacts.filter((contact) => { const key = comparisonKey(contact.name); if (!key || have.has(key)) return false; have.add(key); return true; });
  const firstAddress = address || contacts.map((contact) => contact.address).find(Boolean) || "";
  const patch = {};
  if (!customer.phone && phone) patch.phone = phone;
  if (!customer.address && firstAddress) patch.address = firstAddress;
  if (!fresh.length && !Object.keys(patch).length) return { ok: true, added: 0, filled: [] };
  const hadPrimary = (model.contactsByCustomer.get(customer.id) || []).some((contact) => contact.isPrimary);
  // The main contact is the one with a title (老師、經理…) rather than whoever was pasted first.
  const primaryIndex = hadPrimary ? -1 : Math.max(0, fresh.findIndex((contact) => contact.title));
  const result = await db.transact(requestId, async (tx) => {
    for (const [index, contact] of fresh.entries()) {
      const values = { name: cleanText(contact.name), title: cleanText(contact.title), department: cleanText(contact.department), phone: PHONE.test(contact.phone || "") ? contact.phone : "", mobile: PHONE.test(contact.mobile || "") ? contact.mobile : "", email: contact.email || "", isPrimary: index === primaryIndex, notes: contact.notes || "" };
      await tx.create("contact", { ...values, customerId: customer.id });
    }
    if (Object.keys(patch).length) await tx.update("customer", customer.id, patch);
    return true;
  });
  return result.ok ? { ok: true, added: fresh.length, filled: Object.keys(patch).map((key) => (key === "phone" ? "電話" : "地址")) } : result;
}

// Every customer the 客戶資料 sheet can fill by 客戶編號: contacts from the sheet itself (names only
// seen on orders are left for the customer page), plus an empty 電話／地址.
export function fillableCustomers(model, reference) {
  return model.customers
    .filter((customer) => !customer.archivedAt && customer.customerNo)
    .map((customer) => {
      const found = contactSuggestions(model, reference, customer);
      return { customer, ...found, contacts: found.contacts.filter((contact) => contact.notes.startsWith("從公司客戶資料補上")) };
    })
    .filter((entry) => entry.contacts.length || entry.phone || entry.address);
}
