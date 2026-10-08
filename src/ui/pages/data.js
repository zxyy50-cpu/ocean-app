import { applySnapshotImport, previewSnapshotImport } from "../../data/onboarding.js";
import { h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { ensureClassified } from "./orders.js";
import { pageHeader } from "../shell.js";

const TYPE_LABELS = { customer: "客戶", contact: "聯絡人", opportunity: "商機", activity: "拜訪", reminder: "提醒", order: "訂單", orderItem: "訂單品項" };

function countList(counts = {}) {
  return h("ul", { className: "count-list" }, Object.entries(TYPE_LABELS).map(([type, label]) => h("li", {}, [h("span", { text: label }), h("strong", { text: String(counts[type] || 0) })])));
}

function snapshotImportCard(ctx) {
  const region = h("div", { className: "preview", "aria-live": "polite", dataset: { snapshotPreview: "" } });
  const showPreview = async (snapshot) => {
    region.replaceChildren(h("p", { className: "muted", text: "整理中…" }));
    const preview = await previewSnapshotImport(ctx.db, snapshot);
    if (!preview.ok) { region.replaceChildren(h("p", { className: "field-error", text: preview.error })); return; }
    const total = Object.values(preview.counts).reduce((sum, value) => sum + value, 0);
    const hasReference = Boolean(preview.snapshot?.toolkit?.length || preview.snapshot?.kpis?.length);
    const confirm = h("button", { type: "button", className: "primary", text: total ? "確認匯入" : hasReference ? "只更新 KPI 與裝備庫資料" : "沒有新資料", disabled: !total && !hasReference, dataset: { confirmImport: "" } });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      confirm.textContent = "匯入中…";
      const result = await applySnapshotImport(ctx.db, preview);
      if (!result.ok) { toast("匯入失敗，資料沒有任何變更", { tone: "error" }); confirm.disabled = false; confirm.textContent = "重試"; return; }
      await ctx.loadReference?.();
      await ensureClassified(ctx).catch(() => {});
      const legacyCount = Object.values(result.legacy.created).reduce((sum, value) => sum + value, 0);
      region.replaceChildren(h("p", { className: "ok-text", text: `匯入完成。${legacyCount ? `另外從舊版帶入 ${legacyCount} 筆拜訪／提醒。` : ""}${result.legacy.drafts ? `保留 ${result.legacy.drafts} 份未完成草稿。` : ""}` }), h("a", { className: "button primary", href: "#/customers", text: "開始探索客戶" }));
    });
    region.replaceChildren(...[
      h("p", { text: `快照 ${preview.snapshotId}：以下為新增筆數。已存在的 ${preview.skipped} 筆會略過，不會重複。` }),
      countList(preview.counts),
      preview.issues.length ? h("details", { className: "issues" }, [h("summary", { text: `${preview.issues.length} 筆無法匯入（缺名稱或找不到客戶）` }), h("ul", {}, preview.issues.slice(0, 50).map((issue) => h("li", { text: `${issue.reason}（${issue.key}）` })))]) : null,
      h("p", { className: "muted", text: "公司名稱相同但客戶編號不同的資料會分開保存，只在客戶頁提醒可能重複。" }),
      confirm,
    ].filter(Boolean));
  };
  const fileInput = h("input", { type: "file", accept: ".json,application/json", "aria-label": "選擇快照 JSON" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try { await showPreview(JSON.parse(await file.text())); } catch { region.replaceChildren(h("p", { className: "field-error", text: "無法讀取這個檔案，請確認是 JSON 快照" })); }
  });
  const localButton = h("button", { type: "button", className: "ghost", text: "使用這台電腦上的 9/21 快照", dataset: { localSnapshot: "" } });
  localButton.addEventListener("click", async () => {
    try {
      const module = await import("../../../../demo/ocean-explorer-v1/full-snapshot-data.js");
      await showPreview(module.FULL_SOURCE_SNAPSHOT);
    } catch {
      region.replaceChildren(h("p", { className: "field-error", text: "這台裝置找不到本機快照，請改用「選擇檔案」。" }));
    }
  });
  // Built from the newest spreadsheet exports; only records not already here are added.
  const latestButton = h("button", { type: "button", className: "primary", text: "匯入最新試算表快照", dataset: { latestSnapshot: "" } });
  latestButton.addEventListener("click", async () => {
    try {
      const module = await import(`../../../../demo/ocean-explorer-v1/latest-snapshot-data.js?t=${Date.now()}`);
      await showPreview(module.FULL_SOURCE_SNAPSHOT);
    } catch {
      region.replaceChildren(h("p", { className: "field-error", text: "這台電腦還沒有最新快照，請先把試算表下載成 Excel 交給 Claude 轉換。" }));
    }
  });
  return h("section", { className: "card form-card" }, [
    h("h2", { text: "匯入初始資料" }),
    h("p", { className: "muted", text: "第一次使用時，把既有試算表整理好的快照匯入。匯入前會先顯示筆數，確認後才寫入；舊版 Ocean 探索的拜訪紀錄與草稿會一併帶入。" }),
    h("div", { className: "button-row" }, [latestButton, localButton, h("label", { className: "button ghost file-button" }, ["選擇快照檔", fileInput])]),
    region,
  ]);
}

const dataExtensions = [];
export function registerDataSection(render) {
  dataExtensions.push(render);
}

export function renderData(ctx) {
  return h("div", { className: "stack" }, [pageHeader("資料工具", "匯入、備份、還原與匯出。所有匯入都會先預覽。"), snapshotImportCard(ctx), ...dataExtensions.map((render) => render(ctx))]);
}

registerPage("data", { title: "資料工具", render: renderData, keepOnDataChange: true });
