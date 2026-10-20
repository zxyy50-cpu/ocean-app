import { requestId } from "../../core/ids.js";
import { applyMergeSuggestions, mergeSuggestions } from "../../data/dedupe.js";
import { familyMergeSuggestions } from "../../data/company-family.js";
import { impactLabel } from "../../data/merge.js";
import { customerIdentity } from "../../data/model.js";
import { badge, confirmDialog, emptyState, h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { duplicateGroups } from "../../data/customers.js";
import { customerInAreas } from "../../data/tags.js";
import { openMergeGroupDialog } from "../forms/merge-group.js";
import { pageHeader } from "../shell.js";

const state = { mineOnly: true, limit: 30, familyLimit: 30, running: false };

export function resetDedupeState() {
  Object.assign(state, { mineOnly: true, limit: 30, familyLimit: 30, running: false });
}

function groupCard(ctx, suggestion, selected, refresh = () => ctx.refreshDedupeCount?.(), pickData = { pickGroup: suggestion.primary.id }) {
  const checkbox = h("input", { type: "checkbox", checked: selected.has(suggestion.primary.id), dataset: pickData, "aria-label": `合併「${suggestion.primary.name}」這一組`, onChange: (event) => { if (event.target.checked) selected.add(suggestion.primary.id); else selected.delete(suggestion.primary.id); refresh(); } });
  return h("section", { className: "card", dataset: { mergeGroup: suggestion.primary.id } }, [
    h("div", { className: "section-head" }, [
      h("label", { className: "chip" }, [checkbox, h("strong", { text: suggestion.primary.name })]),
      badge(`${suggestion.secondaries.length + 1} 筆合成 1 筆`, "accent"),
    ]),
    h("ul", { className: "task-list" }, [
      h("li", { className: "task-row" }, [
        h("a", { href: `#/customer/${encodeURIComponent(suggestion.primary.id)}`, className: "task-main" }, [h("strong", { text: "保留這筆" }), h("span", { text: customerIdentity(ctx.model, suggestion.primary) })]),
        suggestion.primary.customerNo ? badge("有客戶編號", "ok") : null,
      ]),
      ...suggestion.secondaries.map(({ customer, impact, filled, why }) => h("li", { className: "task-row", dataset: { mergeSecondary: customer.id } }, [
        h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, className: "task-main" }, [
          h("strong", { text: `併入：${customer.name}` }),
          h("span", { text: customerIdentity(ctx.model, customer) }),
          why ? h("small", { text: `為什麼：${why}` }) : null,
          h("small", { className: "muted", text: `會搬過去：${impactLabel(impact)}${filled.length ? `；補上保留那筆空白的：${filled.join("、")}` : ""}` }),
        ]),
        h("a", { className: "button small ghost", href: `#/merge?primary=${encodeURIComponent(suggestion.primary.id)}&secondary=${encodeURIComponent(customer.id)}`, text: "逐欄比較" }),
      ])),
    ]),
  ]);
}

export function renderDedupe(ctx) {
  const { suggestions, skippedSeveralNumbers, skippedNoNumber } = mergeSuggestions(ctx.model, { myAreas: ctx.settings.myAreas, mineOnly: state.mineOnly });
  const selected = new Set();
  const shown = suggestions.slice(0, state.limit);
  const progress = h("p", { className: "muted", role: "status", dataset: { dedupeProgress: "" } });
  const runButton = h("button", { type: "button", className: "primary", dataset: { runMerge: "" }, disabled: state.running });
  ctx.refreshDedupeCount = () => {
    runButton.textContent = selected.size ? `合併勾選的 ${selected.size} 組` : "先勾選要合併的組";
    runButton.disabled = state.running || !selected.size;
  };
  ctx.refreshDedupeCount();

  runButton.addEventListener("click", async () => {
    const chosen = suggestions.filter((suggestion) => selected.has(suggestion.primary.id));
    if (!chosen.length) return;
    const records = chosen.reduce((sum, suggestion) => sum + suggestion.secondaries.length, 0);
    const ok = await confirmDialog({
      title: `合併 ${chosen.length} 組（${records} 筆客戶併入）？`,
      body: h("div", {}, [
        h("p", { text: "每組保留有客戶編號的那一筆；其他筆的聯絡人、拜訪、商機、訂單與提醒會搬過去，被併入的客戶會封存。" }),
        h("p", { text: "保留那筆已經有的資料不會被覆蓋，只補上空白欄位。每一筆合併都可以在「封存與復原 → 合併紀錄」單獨取消。" }),
      ]),
      confirmLabel: "開始合併",
    });
    if (!ok) return;
    state.running = true;
    ctx.refreshDedupeCount();
    const result = await applyMergeSuggestions(ctx.db, chosen, requestId("dedupe"), ({ done, total }) => { progress.textContent = `合併中… ${done} / ${total} 組`; });
    state.running = false;
    toast(result.failed ? `已合併 ${result.merged} 筆，${result.failed} 筆失敗（資料沒有變動，可再試一次）` : `已合併 ${result.merged} 筆，可在合併紀錄取消`, { tone: result.failed ? "error" : "ok", timeout: 8000 });
    ctx.render();
  });

  const selectAll = h("button", { type: "button", className: "small ghost", dataset: { selectAllGroups: "" }, text: `全選這頁 ${shown.length} 組`, onClick: () => {
    shown.forEach((suggestion) => selected.add(suggestion.primary.id));
    document.querySelectorAll("[data-pick-group]").forEach((node) => { node.checked = true; });
    ctx.refreshDedupeCount();
  } });
  const mine = h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: state.mineOnly, dataset: { dedupeMineOnly: "" }, onChange: (event) => { state.mineOnly = event.target.checked; state.limit = 30; ctx.render(); } }), h("span", { text: "只看我的區域" })]);

  return h("div", { className: "stack" }, [
    pageHeader("整理同名客戶", "同一家公司在不同表格各記了一筆。勾選確認後才合併，每一筆都能復原。"),
    h("div", { className: "info-banner" }, [h("span", { text: `建議合併 ${suggestions.length} 組：每組只有一筆有客戶編號，保留那一筆。另有 ${skippedSeveralNumbers} 組有多個不同客戶編號（可能是不同廠區）、${skippedNoNumber} 組都沒有編號，列在最下面讓你逐組決定。` })]),
    h("div", { className: "button-row" }, [mine, shown.length ? selectAll : null, runButton]),
    progress,
    shown.length ? h("div", { className: "stack" }, shown.map((suggestion) => groupCard(ctx, suggestion, selected))) : h("section", { className: "card" }, [emptyState(state.mineOnly ? "我的區域沒有需要整理的同名客戶" : "沒有需要整理的同名客戶", state.mineOnly ? "可以取消「只看我的區域」看看其他區域。" : "")]),
    suggestions.length > state.limit ? h("button", { type: "button", className: "ghost", text: `顯示更多（還有 ${suggestions.length - state.limit} 組）`, onClick: () => { state.limit += 30; ctx.render(); } }) : null,
    familySection(ctx),
    manualGroups(ctx),
  ]);
}

// Different names, one company: the same address, or an entry from a list with nothing of its own.
function familySection(ctx) {
  const suggestions = familyMergeSuggestions(ctx.model, { myAreas: ctx.settings.myAreas, mineOnly: state.mineOnly });
  if (!suggestions.length) return null;
  const selected = new Set();
  const shown = suggestions.slice(0, state.familyLimit);
  const run = h("button", { type: "button", className: "primary", dataset: { runFamilyMerge: "" } });
  const refresh = () => { run.textContent = selected.size ? `合併勾選的 ${selected.size} 組` : "先勾選要合併的組"; run.disabled = state.running || !selected.size; };
  refresh();
  run.addEventListener("click", async () => {
    const chosen = suggestions.filter((suggestion) => selected.has(suggestion.primary.id));
    if (!chosen.length) return;
    const ok = await confirmDialog({
      title: `合併 ${chosen.length} 組（${chosen.reduce((sum, item) => sum + item.secondaries.length, 0)} 筆併入）？`,
      body: h("div", {}, [h("p", { text: "每組保留上面那一筆（有客戶編號或拜訪紀錄的），其他筆的資料搬過去後封存；保留那筆已有的資料不會被覆蓋。" }), h("p", { text: "每一筆都可以在「封存與復原 → 合併紀錄」單獨取消。" })]),
      confirmLabel: "開始合併",
    });
    if (!ok) return;
    state.running = true;
    refresh();
    const result = await applyMergeSuggestions(ctx.db, chosen, requestId("family-merge"));
    state.running = false;
    toast(result.failed ? `已合併 ${result.merged} 筆，${result.failed} 筆失敗（資料沒有變動）` : `已合併 ${result.merged} 筆，可在合併紀錄取消`, { tone: result.failed ? "error" : "ok", timeout: 8000 });
    ctx.render();
  });
  return h("section", { className: "stack", dataset: { familyGroups: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "名稱不同、其實是同一家" }), badge(`${suggestions.length} 組`)]),
    h("p", { className: "muted", text: "例如「第一生化」和「台灣第一生化科技股份有限公司嘉義保健飲料廠」：同一個地址，或名單上只有名稱、沒有其他資料。不同地址的工廠不會列在這裡，會分開保留（搜尋時收在同一列）。" }),
    h("div", { className: "button-row" }, [
      h("button", { type: "button", className: "small ghost", text: `全選這頁 ${shown.length} 組`, onClick: () => { shown.forEach((item) => selected.add(item.primary.id)); document.querySelectorAll("[data-pick-family]").forEach((node) => { node.checked = true; }); refresh(); } }),
      run,
    ]),
    ...shown.map((suggestion) => groupCard(ctx, suggestion, selected, refresh, { pickFamily: suggestion.primary.id })),
    suggestions.length > shown.length ? h("button", { type: "button", className: "ghost", text: `顯示更多（還有 ${suggestions.length - shown.length} 組）`, onClick: () => { state.familyLimit += 30; ctx.render(); } }) : null,
  ]);
}

// Groups the safe rule doesn't cover (no number, or several different numbers): one 整理 button each.
function manualGroups(ctx) {
  const suggested = new Set(mergeSuggestions(ctx.model, { myAreas: ctx.settings.myAreas, mineOnly: false }).suggestions.map((suggestion) => suggestion.primary.id));
  const groups = duplicateGroups(ctx.model.customers)
    .filter((members) => !members.some((customer) => suggested.has(customer.id)))
    .filter((members) => !state.mineOnly || members.some((customer) => customerInAreas(customer, ctx.settings.myAreas)))
    .sort((left, right) => right.length - left.length);
  if (!groups.length) return null;
  return h("section", { className: "card", dataset: { manualGroups: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "需要你決定的同名組" }), badge(`${groups.length} 組`)]),
    h("p", { className: "muted", text: "沒有客戶編號，或有好幾個不同編號（可能是不同廠區）。點「整理」逐組選要保留哪一筆。" }),
    h("ul", { className: "task-list" }, groups.slice(0, 60).map((members) => h("li", { className: "task-row", dataset: { manualGroup: members[0].id } }, [
      h("div", { className: "task-main" }, [h("strong", { text: `${members[0].name}（${members.length} 筆）` }), h("small", { className: "muted", text: members.map((customer) => customer.customerNo ? `#${customer.customerNo}` : "無編號").join("、") })]),
      h("button", { type: "button", className: "small primary", text: "整理", onClick: () => openMergeGroupDialog(ctx, members, { onDone: () => ctx.render() }) }),
    ]))),
  ]);
}

// Merging fires many data changes; keep the page steady until the batch finishes.
registerPage("dedupe", { title: "整理同名客戶", render: renderDedupe, keepOnDataChange: true });
