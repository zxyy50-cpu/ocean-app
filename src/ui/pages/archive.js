import { requestId } from "../../core/ids.js";
import { ARCHIVE_TYPES, archiveLog, displayName, listArchived, mergeEvents, restoreEntity } from "../../data/archive.js";
import { duplicateGroups } from "../../data/customers.js";
import { undoMerge } from "../../data/merge.js";
import { badge, confirmDialog, emptyState, h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

const VIEWS = [
  { value: "archived", label: "已封存" }, { value: "merges", label: "合併紀錄" }, { value: "duplicates", label: "重複檢查" }, { value: "log", label: "操作紀錄" },
];
const EVENT_LABELS = { archive: "封存", restore: "復原", merge: "合併", unmerge: "取消合併" };
const state = { type: "all", query: "", dupLimit: 20 };

function linkFor(record) {
  if (record.type === "customer") return `#/customer/${encodeURIComponent(record.id)}`;
  if (record.type === "opportunity") return `#/opportunity/${encodeURIComponent(record.id)}`;
  return record.customerId ? `#/customer/${encodeURIComponent(record.customerId)}` : null;
}

function archivedView(ctx) {
  const items = listArchived(ctx.model, state);
  const search = h("input", { type: "search", value: state.query, placeholder: "搜尋名稱或封存原因", "aria-label": "搜尋封存資料" });
  search.addEventListener("change", () => { state.query = search.value; ctx.render(); });
  const typeChips = h("div", { className: "chip-group" }, [["all", "全部"], ...Object.entries(ARCHIVE_TYPES)].map(([value, label]) => h("label", { className: "chip" }, [
    h("input", { type: "radio", name: "archiveType", value, checked: state.type === value, onChange: () => { state.type = value; ctx.render(); } }), h("span", { text: label }),
  ])));
  const list = items.length ? h("ul", { className: "task-list" }, items.slice(0, 200).map((record) => {
    const href = linkFor(record);
    const merged = record.type === "customer" && record.mergedIntoId;
    return h("li", { className: "task-row", dataset: { archived: record.id } }, [
      h(href ? "a" : "span", { href, className: "task-main" }, [h("strong", { text: displayName(ctx.model, record) }), h("span", { text: `${ARCHIVE_TYPES[record.type]}・${record.archiveReason || "未填原因"}・${new Date(record.archivedAt).toLocaleDateString("zh-TW")}` })]),
      badge(ARCHIVE_TYPES[record.type]),
      h("div", { className: "row-actions" }, [merged
        ? h("a", { className: "button small ghost", href: "#/archive?view=merges", text: "到合併紀錄取消合併" })
        : h("button", { type: "button", className: "small primary", dataset: { restore: record.id }, text: "復原", onClick: async () => {
          if (!(await confirmDialog({ title: `復原「${displayName(ctx.model, record)}」？`, body: h("p", { text: "復原後會回到日常清單。" }), confirmLabel: "復原" }))) return;
          const result = await restoreEntity(ctx.db, record, requestId("restore"));
          toast(result.ok ? "已復原" : result.message || "復原失敗", { tone: result.ok ? "ok" : "error" });
        } })]),
    ]);
  })) : emptyState("封存區是空的", "被封存的客戶、商機與聯絡人會出現在這裡，隨時可以復原。");
  return h("section", { className: "card form-card" }, [h("div", { className: "search-box" }, [search]), typeChips, list]);
}

function mergesView(ctx) {
  const events = mergeEvents(ctx.model);
  if (!events.length) return h("section", { className: "card" }, [emptyState("還沒有合併紀錄", "在客戶頁或「重複檢查」比較後合併的紀錄會出現在這裡。")]);
  return h("section", { className: "card" }, [h("ul", { className: "task-list" }, events.map((event) => h("li", { className: "task-row", dataset: { mergeEvent: event.id } }, [
    h("a", { href: `#/customer/${encodeURIComponent(event.snapshot?.primaryId || "")}`, className: "task-main" }, [h("strong", { text: event.reason }), h("span", { text: `${new Date(event.createdAt).toLocaleString("zh-TW")}・移動 ${event.impactSummary}` })]),
    event.undoneAt ? badge("已取消合併", "ok") : badge("已合併", "accent"),
    event.undoneAt ? null : h("div", { className: "row-actions" }, [h("button", { type: "button", className: "small danger", dataset: { undoMerge: event.id }, text: "取消合併", onClick: async () => {
      if (!(await confirmDialog({ title: "取消這次合併？", body: h("p", { text: "兩位客戶與所有原本的聯絡人、拜訪、商機、訂單與提醒會回到合併前的歸屬。合併後新增在主要客戶的資料會留在主要客戶。" }), confirmLabel: "取消合併", tone: "danger" }))) return;
      const result = await undoMerge(ctx.db, event.id, requestId("unmerge"));
      toast(result.ok ? `已取消合併，移回 ${result.value.restored} 筆資料` : result.message || "取消失敗", { tone: result.ok ? "ok" : "error" });
    } })]),
  ])))]);
}

function duplicatesView(ctx) {
  const groups = duplicateGroups(ctx.model.customers).sort((left, right) => right.length - left.length);
  if (!groups.length) return h("section", { className: "card" }, [emptyState("目前沒有名稱重複的客戶")]);
  const stat = (customer, type) => (ctx.model[`${type}ByCustomer`].get(customer.id) || []).length;
  return h("div", { className: "stack" }, [
    h("div", { className: "info-banner" }, [h("span", { text: `共 ${groups.length} 組名稱相同或相似。客戶編號不同的通常是不同據點，請只合併確定是同一家的資料。` }), h("a", { href: "#/dedupe", text: "只有一筆有編號的，可到「整理同名客戶」批次處理 →" })]),
    ...groups.slice(0, state.dupLimit).map((members) => h("section", { className: "card", dataset: { duplicateGroup: members[0].name } }, [
      h("div", { className: "section-head" }, [h("h2", { text: members[0].name }), badge(`${members.length} 筆`)]),
      h("div", { className: "table-wrap" }, [h("table", {}, [
        h("thead", {}, [h("tr", {}, ["名稱", "客戶編號", "區域", "聯絡人", "拜訪", "商機", "訂單", ""].map((label) => h("th", { text: label })))]),
        h("tbody", {}, members.map((customer, index) => h("tr", {}, [
          h("td", {}, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, text: customer.name })]),
          h("td", { text: customer.customerNo || "—" }),
          h("td", { text: (customer.areaTags || []).join("、") || "—" }),
          h("td", { className: "num", text: stat(customer, "contacts") }),
          h("td", { className: "num", text: stat(customer, "activities") }),
          h("td", { className: "num", text: stat(customer, "opportunities") }),
          h("td", { className: "num", text: stat(customer, "orders") }),
          h("td", {}, [index === 0 ? h("span", { className: "muted", text: "比較基準" }) : h("a", { className: "button small ghost", href: `#/merge?primary=${encodeURIComponent(members[0].id)}&secondary=${encodeURIComponent(customer.id)}`, text: "比較／合併" })]),
        ]))),
      ])]),
    ])),
    groups.length > state.dupLimit ? h("button", { type: "button", className: "ghost", text: `顯示更多（還有 ${groups.length - state.dupLimit} 組）`, onClick: () => { state.dupLimit += 20; ctx.render(); } }) : null,
  ]);
}

function logView(ctx) {
  const events = archiveLog(ctx.model);
  if (!events.length) return h("section", { className: "card" }, [emptyState("還沒有封存或復原紀錄")]);
  return h("section", { className: "card" }, [h("ol", { className: "timeline" }, events.map((event) => h("li", {}, [
    h("div", { className: "when", text: `${new Date(event.createdAt).toLocaleString("zh-TW")}・${EVENT_LABELS[event.eventType] || event.eventType}・${ARCHIVE_TYPES[event.entityType] || event.entityType}` }),
    h("div", { text: [event.snapshot?.name, event.reason, event.impactSummary].filter(Boolean).join("｜") || "—" }),
    h("small", { className: "muted", text: `操作者：${event.createdBy}` }),
  ])))]);
}

export function renderArchive(ctx, route) {
  const view = VIEWS.some((item) => item.value === route.query.get("view")) ? route.query.get("view") : "archived";
  const tabs = h("div", { className: "tabs", role: "tablist" }, VIEWS.map((item) => h("a", { href: `#/archive?view=${item.value}`, className: "button small ghost", role: "tab", "aria-selected": String(item.value === view), text: item.label })));
  const body = { archived: archivedView, merges: mergesView, duplicates: duplicatesView, log: logView }[view](ctx);
  return h("div", { className: "stack" }, [pageHeader("封存與復原", "這裡沒有永久刪除，所有封存與合併都可以復原。"), tabs, body]);
}

registerPage("archive", { title: "封存與復原", render: renderArchive });
