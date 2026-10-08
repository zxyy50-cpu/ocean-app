import { requestId } from "../../core/ids.js";
import { applyBackup, applyImportPlan, buildExportSheets, createBackup, detectImportKind, planCustomerImport, planOrderImport, previewBackup } from "../../data/exchange.js";
import { buildXlsx, parseCsv, readXlsx, rowsToObjects } from "../../data/xlsx.js";
import { h, select, toast } from "../dom.js";
import { registerDataSection } from "./data.js";
import { ensureClassified } from "./orders.js";

const TYPE_LABELS = { customer: "客戶", contact: "聯絡人", opportunity: "商機", activity: "拜訪", reminder: "提醒", order: "訂單", orderItem: "訂單品項", archiveEvent: "封存紀錄", setting: "設定" };

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function backupCard(ctx) {
  const region = h("div", { className: "preview", "aria-live": "polite", dataset: { restorePreview: "" } });
  const fileInput = h("input", { type: "file", accept: ".json,application/json", "aria-label": "選擇備份檔" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    let preview;
    try { preview = previewBackup(JSON.parse(await file.text()), ctx.db.peekAll()); } catch { preview = { ok: false, error: "無法讀取這個檔案" }; }
    if (!preview.ok) { region.replaceChildren(h("p", { className: "field-error", text: preview.error })); return; }
    const rows = Object.entries(preview.counts).filter(([, count]) => count.missing || count.different);
    const mode = select("mode", [{ value: "missing", label: "只補回目前沒有的資料（建議）" }, { value: "overwrite", label: "補回並以備份內容覆蓋不同的資料" }], "missing", { "aria-label": "還原方式" });
    const confirm = h("button", { type: "button", className: "primary", dataset: { confirmRestore: "" }, text: "確認還原", disabled: !rows.length });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      download(`ocean-還原前自動備份-${stamp()}.json`, JSON.stringify(await createBackup(ctx.db)), "application/json");
      const result = await applyBackup(ctx.db, preview, { overwrite: mode.value === "overwrite", requestId: requestId("restore-backup") });
      region.replaceChildren(h("p", { className: result.ok ? "ok-text" : "field-error", text: result.ok ? `已還原：補回 ${result.value.added} 筆${result.value.replaced ? `、覆蓋 ${result.value.replaced} 筆` : ""}。還原前的狀態已另存一份備份。` : "還原失敗，資料沒有任何變更。" }));
    });
    region.replaceChildren(
      h("p", { text: `備份時間：${preview.exportedAt ? new Date(preview.exportedAt).toLocaleString("zh-TW") : "未知"}` }),
      rows.length ? h("div", { className: "table-wrap" }, [h("table", {}, [
        h("thead", {}, [h("tr", {}, ["類型", "目前沒有（會補回）", "內容不同"].map((label) => h("th", { text: label })))]),
        h("tbody", {}, rows.map(([type, count]) => h("tr", {}, [h("td", { text: TYPE_LABELS[type] || type }), h("td", { className: "num", text: count.missing }), h("td", { className: "num", text: count.different })]))),
      ])]) : h("p", { className: "muted", text: "備份內容與目前資料一致，不需要還原。" }),
      h("p", { className: "muted", text: "還原不會移除你目前已有的任何資料。確認前會自動下載一份目前狀態的備份。" }),
      mode, confirm,
    );
  });
  return h("section", { className: "card form-card" }, [
    h("h2", { text: "完整備份與還原" }),
    h("p", { className: "muted", text: "下載這台裝置上的所有資料（含未同步的修改與草稿）。建議每週下載一次。" }),
    h("div", { className: "button-row" }, [
      h("button", { type: "button", className: "primary", dataset: { downloadBackup: "" }, text: "下載完整備份（JSON）", onClick: async () => { download(`ocean-backup-${stamp()}.json`, JSON.stringify(await createBackup(ctx.db), null, 1), "application/json"); toast("已下載備份"); } }),
      h("label", { className: "button ghost file-button" }, ["還原備份…", fileInput]),
    ]),
    region,
  ]);
}

function importCard(ctx) {
  const region = h("div", { className: "preview", "aria-live": "polite", dataset: { importPreview: "" } });
  const showPlan = (plan) => {
    const summary = [["新增", plan.add.length, "ok"], ["更新", plan.update.length, "info"], ["重複（預設略過）", plan.duplicate.length, "warn"], ["無效", plan.invalid.length, "danger"], ["無變更", plan.unchanged.length, "neutral"]];
    const includeDuplicates = h("input", { type: "checkbox", name: "includeDuplicates" });
    const confirm = h("button", { type: "button", className: "primary", dataset: { confirmImportPlan: "" }, text: "確認匯入", disabled: !(plan.add.length || plan.update.length || plan.duplicate.length) });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      const result = await applyImportPlan(ctx.db, plan, { includeDuplicates: includeDuplicates.checked, requestId: requestId("import-sheet") });
      if (!result.ok) { region.append(h("p", { className: "field-error", text: "匯入失敗，資料沒有任何變更。" })); confirm.disabled = false; return; }
      if (plan.kind === "orders") await ensureClassified(ctx).catch(() => {});
      const created = result.value;
      region.replaceChildren(h("p", { className: "ok-text", dataset: { importDone: "" }, text: plan.kind === "orders" ? `已匯入 ${created.order} 張訂單、${created.orderItem} 個品項，並完成首次購買比對。` : `已新增 ${created.customer} 位客戶、更新 ${created.updated} 位。` }));
    });
    const list = (title, items) => items.length ? h("details", {}, [h("summary", { text: `${title}（${items.length}）` }), h("ul", {}, items.slice(0, 50).map((item) => h("li", { text: `第 ${item.row} 列：${item.name || ""}${item.reason ? `｜${item.reason}` : ""}` })))]) : null;
    region.replaceChildren(...[
      h("ul", { className: "count-list", dataset: { importCounts: "" } }, summary.map(([label, count]) => h("li", {}, [h("span", { text: label }), h("strong", { text: String(count) })]))),
      list("新增", plan.add), list("更新", plan.update), list("重複", plan.duplicate), list("無效", plan.invalid),
      plan.kind === "customers" && plan.duplicate.some((item) => item.values) ? h("label", { className: "chip" }, [includeDuplicates, h("span", { text: "名稱重複的也新增為不同客戶（不會合併）" })]) : null,
      confirm,
    ].filter(Boolean));
  };
  const handleRows = (rows, label) => {
    const { headers, records } = rowsToObjects(rows);
    const kind = detectImportKind(headers);
    if (!kind) { region.replaceChildren(h("p", { className: "field-error", text: `看不出「${label}」是客戶或訂單資料。需要有「客戶名稱」欄，或「日期＋產品編號」欄。` })); return; }
    showPlan(kind === "orders" ? planOrderImport(records, ctx.model) : planCustomerImport(records, ctx.model));
  };
  const fileInput = h("input", { type: "file", accept: ".xlsx,.csv,text/csv", "aria-label": "選擇 Excel 或 CSV" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    region.replaceChildren(h("p", { className: "muted", text: "讀取中…" }));
    try {
      if (/\.csv$/i.test(file.name)) { handleRows(parseCsv(await file.text()), file.name); return; }
      const { sheets } = await readXlsx(await file.arrayBuffer());
      const usable = sheets.filter((sheet) => detectImportKind(rowsToObjects(sheet.rows).headers));
      if (!usable.length) { region.replaceChildren(h("p", { className: "field-error", text: "檔案裡找不到可匯入的客戶或訂單分頁。" })); return; }
      if (usable.length === 1) { handleRows(usable[0].rows, usable[0].name); return; }
      const picker = select("sheet", usable.map((sheet) => sheet.name), usable[0].name, { "aria-label": "選擇分頁" });
      region.replaceChildren(h("p", { text: "這個檔案有多個分頁，請選擇要匯入哪一個：" }), picker, h("button", { type: "button", className: "ghost", text: "預覽這個分頁", onClick: () => { const sheet = usable.find((item) => item.name === picker.value); handleRows(sheet.rows, sheet.name); } }));
    } catch (error) {
      region.replaceChildren(h("p", { className: "field-error", text: error.message || "無法讀取這個檔案" }));
    }
  });
  return h("section", { className: "card form-card" }, [
    h("h2", { text: "匯入 Excel／CSV" }),
    h("p", { className: "muted", text: "支援客戶名單與訂單（例如 LINE訂單整理、ERP 交易明細）。匯入前會先顯示新增、更新、重複與無效筆數；公司名稱相同只會列為重複，不會自動合併。" }),
    h("label", { className: "button ghost file-button" }, ["選擇檔案…", fileInput]),
    region,
  ]);
}

function exportCard(ctx) {
  return h("section", { className: "card form-card" }, [
    h("h2", { text: "匯出 Excel" }),
    h("p", { className: "muted", text: "依目前試算表的欄位格式匯出：客戶資料、拜訪電訪紀錄、2026 商機重點整理、LINE訂單整理。提供公司正式範本後可以調整成完全一致。" }),
    h("button", { type: "button", className: "primary", dataset: { exportExcel: "" }, text: "下載 Excel", onClick: () => {
      download(`ocean-業務資料-${stamp()}.xlsx`, buildXlsx(buildExportSheets(ctx.model)), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      toast("已下載 Excel");
    } }),
  ]);
}

registerDataSection(backupCard);
registerDataSection(importCard);
registerDataSection(exportCard);
