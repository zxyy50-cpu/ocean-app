import { requestId } from "../../core/ids.js";
import { editableValues } from "../../data/db.js";
import { displayName } from "../../data/archive.js";
import { connectSync, loadSyncConfig, parseSetupLink, saveSyncConfig } from "../../sync/setup.js";
import { badge, emptyState, field, formToObject, h, input, openDialog, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";
import { registerSettingsSection } from "./settings.js";

const TYPE_LABELS = { customer: "客戶", contact: "聯絡人", opportunity: "商機", activity: "拜訪", reminder: "提醒", order: "訂單", orderItem: "訂單品項", archiveEvent: "封存紀錄", setting: "設定" };
const SKIP_FIELDS = new Set(["updatedAt", "updatedBy", "createdAt", "createdBy", "sourceRef", "_seq"]);

function show(value) {
  if (value === null || value === undefined || value === "") return "（空白）";
  if (Array.isArray(value)) return value.join("、") || "（空白）";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function conflictFields(local) {
  const server = local.conflict?.serverRecord || {};
  const fields = new Set([...Object.keys(editableValues(local)), ...Object.keys(editableValues(server))]);
  return [...fields].filter((field) => !SKIP_FIELDS.has(field) && JSON.stringify(local[field] ?? null) !== JSON.stringify(server[field] ?? null))
    .map((field) => ({ field, local: local[field], server: server[field] }));
}

function conflictDialog(ctx, record) {
  const rows = conflictFields(record);
  const server = record.conflict.serverRecord;
  openDialog((close) => {
    const form = h("form", { className: "sheet-body", dataset: { form: "conflict" } }, [
      h("h2", { text: `資料衝突：${displayName(ctx.model, record)}` }),
      h("p", { className: "muted", text: `這筆${TYPE_LABELS[record.type] || "資料"}在這台裝置與 Google Sheets 都被修改過（雲端由 ${server.updatedBy || "?"} 於 ${server.updatedAt ? new Date(server.updatedAt).toLocaleString("zh-TW") : "?"} 修改）。系統沒有覆蓋任何一方，請選擇要保留的內容。` }),
      h("div", { className: "compare-row" }, [h("span"), h("strong", { text: "這台裝置" }), h("strong", { text: "Google Sheets" })]),
      h("div", { className: "compare" }, rows.map((row) => h("div", { className: "compare-row diff", dataset: { conflictField: row.field } }, [
        h("span", { className: "field-name", text: row.field }),
        h("label", {}, [h("input", { type: "radio", name: row.field, value: "local", checked: true }), h("span", { text: show(row.local) })]),
        h("label", {}, [h("input", { type: "radio", name: row.field, value: "server" }), h("span", { text: show(row.server) })]),
      ]))),
      h("div", { className: "sheet-actions" }, [
        h("button", { type: "button", className: "ghost", text: "稍後再說", onClick: close }),
        h("button", { type: "button", className: "ghost", dataset: { keep: "server" }, text: "全部用雲端版", onClick: () => resolve("server") }),
        h("button", { type: "button", className: "ghost", dataset: { keep: "local" }, text: "全部用本機版", onClick: () => resolve("local") }),
        h("button", { type: "submit", className: "primary", dataset: { keep: "manual" }, text: "依勾選合併" }),
      ]),
    ]);
    async function resolve(choice) {
      let merged = {};
      if (choice === "manual") {
        const picks = formToObject(form);
        merged = { ...editableValues(server) };
        rows.forEach((row) => { merged[row.field] = picks[row.field] === "server" ? row.server : row.local; });
      }
      const result = await ctx.db.resolveConflict(record.type, record.id, choice, merged, requestId("resolve"));
      if (!result.ok) { toast("處理失敗，請再試一次", { tone: "error" }); return; }
      close();
      toast(choice === "server" ? "已採用雲端版" : "已保留，將在下次同步時上傳");
      ctx.sync?.sync?.();
    }
    form.addEventListener("submit", (event) => { event.preventDefault(); resolve("manual"); });
    return form;
  }, { label: "資料衝突" });
}

export function renderSync(ctx) {
  const all = ctx.model.all;
  const records = Object.values(all).flat();
  const conflicts = records.filter((record) => record.syncStatus === "conflict");
  const failed = records.filter((record) => record.syncStatus === "failed");
  const pending = records.filter((record) => record.syncStatus === "pending");
  const status = ctx.sync?.status?.() || { configured: false };
  const summary = h("section", { className: "card" }, [
    h("div", { className: "kpi-strip" }, [["已同步", records.length - conflicts.length - failed.length - pending.length], ["等待同步", pending.length], ["同步失敗", failed.length], ["資料衝突", conflicts.length]].map(([label, count]) => h("div", { className: "kpi-mini", dataset: { syncCount: label } }, [h("small", { text: label }), h("strong", { text: String(count) })]))),
    h("p", { className: "muted", style: { marginTop: "12px" }, text: !status.configured ? "尚未設定同步連線：所有資料都安全地保存在這台裝置，設定完成後會自動上傳。" : status.online === false ? "目前離線，恢復網路後會自動同步。" : status.lastSyncAt ? `上次同步：${new Date(status.lastSyncAt).toLocaleString("zh-TW")}` : "尚未完成第一次同步。" }),
    status.lastError ? h("p", { className: "field-error", dataset: { syncError: "" }, text: `上次錯誤：${status.lastError}` }) : null,
    status.needsSignIn ? h("div", { className: "warning-banner", text: "需要重新登入 Google 才能同步，請到「設定 → 同步連線」登入。" }) : null,
    h("div", { className: "button-row", style: { marginTop: "12px" } }, [
      status.configured ? h("button", { type: "button", className: "primary", dataset: { syncNow: "" }, disabled: status.running, text: status.running ? "同步中…" : "立即同步", onClick: async () => { const result = await ctx.sync.sync(); toast(result.ok ? `同步完成：上傳 ${result.accepted ?? 0} 筆、下載 ${result.pulled?.applied ?? 0} 筆` : result.error, { tone: result.ok ? "ok" : "error" }); } }) : null,
      h("a", { className: "button ghost", href: "#/settings", text: "同步連線設定" }),
    ]),
  ]);
  const conflictList = h("section", { className: "card" }, [
    h("div", { className: "section-head" }, [h("h2", { text: "資料衝突" }), badge(String(conflicts.length), conflicts.length ? "warn" : "neutral")]),
    conflicts.length ? h("ul", { className: "task-list" }, conflicts.map((record) => h("li", { className: "task-row warn", dataset: { conflict: record.id } }, [
      h("div", { className: "task-main" }, [h("strong", { text: displayName(ctx.model, record) }), h("span", { text: `${TYPE_LABELS[record.type]}・不同欄位：${conflictFields(record).map((row) => row.field).join("、")}` })]),
      h("div", { className: "row-actions" }, [h("button", { type: "button", className: "small primary", dataset: { openConflict: record.id }, text: "比較與選擇", onClick: () => conflictDialog(ctx, record) })]),
    ]))) : emptyState("沒有衝突", "兩邊同時修改同一筆資料時，會在這裡讓你選擇。"),
  ]);
  const failedList = failed.length ? h("section", { className: "card" }, [
    h("h2", { text: `同步失敗（${failed.length}）` }),
    h("p", { className: "muted", text: "資料仍保存在這台裝置，系統會自動重試；也可以按「立即同步」。" }),
    h("ul", { className: "task-list" }, failed.slice(0, 50).map((record) => h("li", { className: "task-row" }, [h("span", { className: "task-main" }, [h("strong", { text: displayName(ctx.model, record) }), h("span", { text: TYPE_LABELS[record.type] })])]))),
  ]) : null;
  return h("div", { className: "stack" }, [pageHeader("同步中心", "這台裝置與 Google Sheets 的同步狀態。"), summary, conflictList, failedList].filter(Boolean));
}

// Typed-but-unsaved values survive a phone reloading the page after switching apps.
const DRAFT_KEY = "ocean-sync-connection-draft";
const readDraft = () => { try { return JSON.parse(globalThis.localStorage?.getItem(DRAFT_KEY) || "{}") || {}; } catch { return {}; } };
const writeDraft = (values) => { try { globalThis.localStorage?.setItem(DRAFT_KEY, JSON.stringify(values)); } catch { /* storage may be blocked; the form still works */ } };
const clearDraft = () => { try { globalThis.localStorage?.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
// Per database, so one auto-connect at a time even if the page renders twice meanwhile.
const autoConnecting = new WeakSet();

function connectionSection(ctx) {
  const card = h("section", { className: "card form-card", dataset: { form: "sync-connection" } }, [h("h2", { text: "同步連線（Google Sheets）" }), h("p", { className: "muted", text: "載入中…" })]);
  loadSyncConfig(ctx.db).then(async (config) => {
    // A setup link (#/settings?endpoint=…&clientId=…) connects a new phone in one step; the values
    // stay in the URL fragment and never reach the web host.
    const fromLink = { endpoint: ctx.route.query.get("endpoint") || "", clientId: ctx.route.query.get("clientId") || "" };
    if (!config && fromLink.endpoint && fromLink.clientId && !autoConnecting.has(ctx.db)) {
      autoConnecting.add(ctx.db);
      const saved = await saveSyncConfig(ctx.db, fromLink);
      autoConnecting.delete(ctx.db);
      if (saved.ok) {
        clearDraft();
        await connectSync(ctx, saved.value);
        toast("已從設定連結帶入，請按下方按鈕登入 Google", { timeout: 8000 });
        ctx.navigate("settings");
        return;
      }
    }
    const draft = readDraft();
    const endpoint = input("endpoint", config?.endpoint || fromLink.endpoint || draft.endpoint || "", { placeholder: "https://script.google.com/macros/s/…/exec", inputmode: "url" });
    const clientId = input("clientId", config?.clientId || fromLink.clientId || draft.clientId || "", { placeholder: "…apps.googleusercontent.com" });
    const remember = () => writeDraft({ endpoint: endpoint.value, clientId: clientId.value });
    endpoint.addEventListener("input", remember);
    clientId.addEventListener("input", remember);
    const paste = h("input", { type: "url", placeholder: "把整段設定連結貼在這裡", "aria-label": "貼上設定連結", dataset: { setupLink: "" } });
    paste.addEventListener("input", () => {
      const parsed = parseSetupLink(paste.value);
      if (parsed.endpoint) endpoint.value = parsed.endpoint;
      if (parsed.clientId) clientId.value = parsed.clientId;
      if (parsed.endpoint || parsed.clientId) { remember(); paste.value = ""; toast("已從連結填入，按「儲存並連線」"); }
    });
    const form = h("form", { className: "form-card", novalidate: true }, [
      h("p", { className: "muted", text: "填入 Apps Script Web App 網址與 Google 用戶端 ID。這兩個值不是密碼，只存在這台裝置。" }),
      config ? null : field("最快：貼上設定連結", paste, { hint: "從 LINE 複製整段設定連結貼上，兩格會自動填好" }),
      h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
      field("Web App 網址", endpoint),
      field("Google 用戶端 ID", clientId),
      h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: config ? "更新並重新連線" : "儲存並連線" })]),
    ]);
    const signIn = h("div", { dataset: { signIn: "" } });
    const status = ctx.sync?.status?.();
    const account = h("div", { className: "stack" }, [
      ctx.auth?.signedIn?.() ? h("p", { className: "ok-text", text: `已登入：${ctx.auth.email()}` }) : h("p", { className: "muted", text: status?.configured ? "尚未登入，請按下方按鈕用核准的 Google 帳號登入。" : "儲存連線後會出現 Google 登入按鈕。" }),
      signIn,
      status?.configured ? h("button", { type: "button", className: "ghost", text: "測試連線", onClick: async () => {
        const result = await ctx.sync.sync();
        toast(result.ok ? "連線正常，已完成同步" : result.error, { tone: result.ok ? "ok" : "error", timeout: 6000 });
      } }) : null,
    ]);
    if (status?.configured && ctx.auth?.renderButton && !ctx.auth.signedIn()) ctx.auth.renderButton(signIn).catch((error) => signIn.replaceChildren(h("p", { className: "field-error", text: error.message })));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await saveSyncConfig(ctx.db, formToObject(form));
      if (!result.ok) { showErrors(form, result.errors); return; }
      clearDraft();
      await connectSync(ctx, result.value);
      toast("已儲存同步連線");
      ctx.render();
    });
    card.replaceChildren(h("h2", { text: "同步連線（Google Sheets）" }), form, account);
  });
  return card;
}

registerSettingsSection(connectionSection);
registerPage("sync", { title: "同步中心", render: renderSync });
