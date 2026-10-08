// Minimal .xlsx writer/reader with no third-party code.
// Writer: stored (uncompressed) ZIP with inline strings. Reader: ZIP + DecompressionStream.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, bytes);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, bytes.length, true); entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, nameBytes.length, true); entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + bytes.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let position = 0;
  for (const part of parts) { output.set(part, position); position += part.length; }
  return output;
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetXml(rows) {
  const widths = [];
  rows.forEach((row) => row.forEach((cell, index) => { widths[index] = Math.min(60, Math.max(widths[index] || 8, String(cell ?? "").split("\n")[0].length * 2 + 2)); }));
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>` : "";
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const ref = `${columnName(c)}${r + 1}`;
    const style = r === 0 ? ' s="1"' : "";
    if (cell === null || cell === undefined || cell === "") return "";
    if (typeof cell === "number" && Number.isFinite(cell)) return `<c r="${ref}"${style}><v>${cell}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

// sheets: [{ name, rows: [[header...], [value...]] }]
export function buildXlsx(sheets) {
  const safeName = (name, index) => escapeXml(String(name || `Sheet${index + 1}`).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${safeName(sheet.name, index)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><name val="Microsoft JhengHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: sheetXml(sheet.rows) })),
  ];
  return zipStore(files);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("這個瀏覽器不支援讀取壓縮的 Excel，請另存為 CSV 後再匯入");
  const source = new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("不是有效的 Excel（.xlsx）檔案");
  const count = view.getUint16(end + 10, true);
  let pointer = view.getUint32(end + 16, true);
  const files = new Map();
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error("Excel 檔案結構損壞");
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    files.set(name, { method, raw });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return {
    names: [...files.keys()],
    async text(name) {
      const file = files.get(name);
      if (!file) return null;
      const data = file.method === 0 ? file.raw : await inflateRaw(file.raw);
      return decoder.decode(data);
    },
  };
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function columnIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/)?.[0] || "A";
  return [...letters].reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function textOf(node) {
  return [...node.getElementsByTagName("t")].map((t) => t.textContent).join("");
}

export async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const workbook = parseXml(await zip.text("xl/workbook.xml"));
  const rels = parseXml((await zip.text("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
  const targets = new Map([...rels.getElementsByTagName("Relationship")].map((rel) => [rel.getAttribute("Id"), rel.getAttribute("Target")]));
  const sharedText = await zip.text("xl/sharedStrings.xml");
  const shared = sharedText ? [...parseXml(sharedText).getElementsByTagName("si")].map(textOf) : [];
  const sheets = [];
  for (const sheet of workbook.getElementsByTagName("sheet")) {
    const relId = sheet.getAttribute("r:id") || sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    let target = targets.get(relId) || "";
    target = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const xml = await zip.text(target);
    if (!xml) continue;
    const rows = [];
    for (const row of parseXml(xml).getElementsByTagName("row")) {
      const values = [];
      for (const cell of row.getElementsByTagName("c")) {
        const type = cell.getAttribute("t");
        const v = cell.getElementsByTagName("v")[0]?.textContent ?? "";
        let value;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = textOf(cell);
        else if (type === "str" || type === "e") value = v;
        else if (type === "b") value = v === "1";
        else value = v === "" ? "" : Number(v);
        values[columnIndex(cell.getAttribute("r"))] = value;
      }
      rows.push(Array.from(values, (value) => value ?? ""));
    }
    sheets.push({ name: sheet.getAttribute("name"), rows });
  }
  return { sheets };
}

export function parseCsv(text) {
  const source = String(text).replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value); rows.push(row); row = []; value = "";
    } else value += char;
  }
  if (value !== "" || row.length) { row.push(value); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
}

export function excelSerialToDate(value) {
  if (typeof value !== "number" || value < 20000 || value > 80000) return null;
  return new Date(Math.round((value - 25569) * 86400000)).toISOString().slice(0, 10);
}

export function rowsToObjects(rows) {
  const headerIndex = rows.findIndex((row) => row.filter((cell) => String(cell).trim()).length >= 2);
  if (headerIndex < 0) return { headers: [], records: [] };
  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  const records = rows.slice(headerIndex + 1).map((row, index) => ({ __row: headerIndex + index + 2, ...Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]).filter(([header]) => header)) }))
    .filter((record) => Object.entries(record).some(([key, value]) => key !== "__row" && String(value).trim() !== ""));
  return { headers, records };
}
