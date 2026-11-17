import { cleanText } from "../core/text.js";
import { normalizeCustomerNo } from "./order-reference.js";

// 「Ocean 客戶資料」 → 客戶資料 tab, pasted in once (select all, copy, paste): 新客編, 客戶編號, 全名,
// 簡稱, 聯絡人, 電話, 聯絡人2, 電話2, 信箱, 地址. Kept on this device (meta "customerDirectory")
// and folded into the order reference, so short names and contacts show without an Apps Script change.

export const DIRECTORY_META = "customerDirectory";
const COLUMNS = { newNo: ["新客編"], no: ["客戶編號"], fullName: ["全名", "客戶名稱", "公司全名"], shortName: ["簡稱", "客戶簡稱"], contact: ["聯絡人"], phone: ["電話"], contact2: ["聯絡人2"], phone2: ["電話2"], email: ["信箱", "Email", "E-mail"], address: ["地址"], grade: ["客戶分級"] };
const NUMBER = /^\d{5,10}$/;

// Copied cells that hold a line break come quoted: 「"陳麗君\n薛先生"」. Read them as one cell.
export function splitTsv(text) {
  const value = String(text || "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"' && value[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === "\t") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function parseDirectory(text) {
  const lines = splitTsv(text);
  const headAt = lines.findIndex((cells) => cells.some((cell) => ["新客編", "客戶編號"].includes(cleanText(cell))));
  if (headAt < 0) return { ok: false, message: "找不到「客戶編號」或「新客編」標題列，請從第一列一起複製（⌘A 全選）" };
  const head = lines[headAt].map(cleanText);
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, head.findIndex((cell) => names.includes(cell))]));
  if (index.shortName < 0 && index.fullName < 0) return { ok: false, message: "找不到「簡稱」或「全名」欄" };
  const rows = [];
  for (const cells of lines.slice(headAt + 1)) {
    const value = (key) => (index[key] >= 0 ? cleanText(cells[index[key]]) : "");
    const numbers = [...new Set([value("newNo"), value("no")].map(normalizeCustomerNo).filter((no) => NUMBER.test(no)))];
    if (!numbers.length) continue;
    const raw = (key) => (index[key] >= 0 ? String(cells[index[key]] ?? "") : "");
    const people = [...raw("contact").split("\n"), ...raw("contact2").split("\n")].map(cleanText).filter(Boolean);
    const phones = [...raw("phone").split("\n"), ...raw("phone2").split("\n")].map(cleanText).filter(Boolean);
    rows.push({ numbers, fullName: value("fullName"), shortName: value("shortName"), contact: people[0] || "", phone: phones[0] || "", contact2: people.slice(1).join("、"), phone2: phones[1] || "", email: value("email"), address: value("address"), grade: value("grade"), people });
  }
  return rows.length ? { ok: true, rows } : { ok: false, message: "沒有讀到任何客戶，請確認貼的是「客戶資料」分頁" };
}

export async function loadDirectory(db) {
  return db.getMeta(DIRECTORY_META, null);
}

export async function saveDirectory(db, rows) {
  const value = { loadedAt: new Date().toISOString(), rows };
  await db.setMeta(DIRECTORY_META, value);
  return value;
}

// Adds the directory to reference.customers: names (簡稱 first), and one sheet row per contact.
export function applyDirectory(reference, directory) {
  if (!directory?.rows?.length) return reference;
  const customers = new Map(reference.customers);
  for (const row of directory.rows) {
    for (const customerNo of row.numbers) {
      const current = customers.get(customerNo);
      const entry = { customerNo, names: new Set(current?.names || []), contacts: new Set(current?.contacts || []), codes: current?.codes || new Set(), phone: current?.phone || "", sheetRows: [...(current?.sheetRows || [])], shortName: row.shortName || current?.shortName || "", grade: row.grade || current?.grade || "" };
      // The 簡稱 goes first: it is what tells 50 records called 國立屏東科技大學 apart.
      entry.names = new Set([row.shortName, ...entry.names, row.fullName].filter(Boolean));
      if (!entry.phone) entry.phone = row.phone;
      const people = row.people || [row.contact, row.contact2].filter(Boolean);
      if (!people.length && !entry.sheetRows.length) entry.sheetRows.push({ name: row.fullName || row.shortName, contact: "", phone: row.phone, email: "", address: row.address });
      people.forEach((contact, index) => entry.sheetRows.push({ name: row.fullName || row.shortName, contact, phone: index === 0 ? row.phone : index === 1 ? row.phone2 : "", email: index === 0 ? row.email : "", address: row.address }));
      customers.set(customerNo, entry);
    }
  }
  return { ...reference, customers };
}

// 「客戶名稱只要留簡稱」: each customer whose number has a 簡稱 is renamed to it; the old name
// stays as an alias, so searching 國立屏東科技大學 still finds all of them.
export function shortNameChanges(model, directory) {
  const shortByNo = new Map();
  for (const row of directory?.rows || []) for (const no of row.numbers) if (row.shortName && !shortByNo.has(no)) shortByNo.set(no, row.shortName);
  return model.customers
    .filter((customer) => !customer.archivedAt && customer.customerNo && shortByNo.has(String(customer.customerNo)))
    .map((customer) => ({ customer, from: customer.name, to: shortByNo.get(String(customer.customerNo)) }))
    .filter((change) => change.to !== change.from);
}

export async function renameToShortNames(db, changes, requestId) {
  if (!changes.length) return { ok: true, renamed: 0 };
  const result = await db.transact(requestId, async (tx) => {
    for (const { customer, from, to } of changes) {
      const aliases = [...new Set([...(customer.aliases || []), from].filter((alias) => alias && alias !== to))];
      await tx.update("customer", customer.id, { name: to, aliases });
    }
    return true;
  });
  return result.ok ? { ok: true, renamed: changes.length } : result;
}
