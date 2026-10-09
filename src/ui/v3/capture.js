import { formatShortDate, weekdayLabel } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { presetDate } from "../../data/activities.js";
import { parseCapture, saveCapture } from "../../data/capture.js";
import { searchCustomers } from "../../data/customers.js";
import { opportunityTitle, productOptions } from "../../data/products.js";
import { createDraftStore } from "../../data/drafts.js";
import { customerIdentity, primaryContact } from "../../data/model.js";
import { chipGroup, field, h, input, select, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { openCustomerEditor } from "../forms/customer-forms.js";

const QUICK_DATES = [["明天", 1], ["3 天後", 3], ["下週", 7], ["2 週後", 14]];
let cleanup = () => {};

export function captureDraftKey(customerId) {
  return `capture:${customerId || "new"}`;
}

export function renderCapture(ctx, route) {
  cleanup();
  const today = ctx.today();
  const drafts = (ctx.drafts ||= createDraftStore(ctx.db));
  const options = ctx.settings.visitOptions;
  const routeCustomer = ctx.model.customersById.get(route.query.get("customer") || "") ? route.query.get("customer") : "";
  const draftKey = captureDraftKey(routeCustomer);
  // What the user set by hand wins over anything the rules guess later.
  const touched = new Set();
  const state = { customerId: routeCustomer, contactId: routeCustomer ? primaryContact(ctx.model, routeCustomer)?.id || "" : "", channel: "", reaction: "", nextAction: "", nextFollowUpDate: "", noReminder: false, opportunityId: route.query.get("opportunity") || "", opportunityMode: route.query.get("opportunity") ? "update" : "", opportunityName: "", opportunityProduct: "", opportunityAmount: "", opportunityCloseDate: "", reminderSuggested: false, candidates: [], prep: {} };
  if (routeCustomer) touched.add("customerId");
  if (state.opportunityId) touched.add("opportunity");

  const form = h("form", { className: "capture stack", novalidate: true, dataset: { form: "capture" } });
  const text = h("textarea", { name: "detailedNote", rows: 6, dataset: { captureText: "" }, placeholder: "像傳 LINE 一樣寫：\n某某食品王副理說報價比原廠貴 15%，廠長要看人力節省試算，下週二前給\n\n手機鍵盤上的麥克風可以直接用講的。", "aria-label": "這次聯絡的內容" });
  const saveState = h("small", { className: "muted", role: "status", dataset: { captureSaveState: "" }, text: "會自動暫存在這台裝置" });
  const preview = h("section", { className: "card capture-preview", dataset: { capturePreview: "" } });

  let draftTimer = null;
  const persist = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      drafts.save(draftKey, { detailedNote: text.value, ...state, candidates: undefined, touched: [...touched] })
        .then(() => { saveState.textContent = `草稿已暫存 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`; })
        .catch(() => { saveState.textContent = "草稿暫存失敗，內容還在畫面上，請先別關掉"; });
    }, 300);
  };

  const applyGuess = () => {
    const guess = parseCapture(ctx.model, text.value, { today, toolkit: ctx.toolkit || [] });
    state.candidates = guess.candidates;
    for (const key of ["customerId", "channel", "reaction", "nextAction", "nextFollowUpDate", "opportunityCloseDate"]) {
      if (!touched.has(key) && guess[key] !== undefined) state[key] = guess[key];
    }
    if (!touched.has("nextFollowUpDate")) state.reminderSuggested = guess.reminderSuggested;
    // Which opportunity (or a new one) moves together as one choice.
    if (!touched.has("opportunity")) Object.assign(state, { opportunityMode: guess.opportunityMode, opportunityId: guess.opportunityId, opportunityName: guess.opportunityName });
    // The product (a knowledge-base match gives brand + name) and an amount if one was said.
    if (!touched.has("opportunityProduct")) state.opportunityProduct = guess.opportunityProduct;
    if (!touched.has("opportunityAmount")) state.opportunityAmount = guess.opportunityAmount ?? "";
    if (!touched.has("noReminder")) state.noReminder = guess.noReminder;
    if (!touched.has("contactId")) {
      const top = guess.candidates.find((candidate) => candidate.customer.id === state.customerId);
      state.contactId = top?.contact?.id || (state.customerId ? primaryContact(ctx.model, state.customerId)?.id || "" : "");
    }
    if (!touched.has("opportunity") && state.opportunityId && ctx.model.opportunitiesById.get(state.opportunityId)?.customerId !== state.customerId) Object.assign(state, { opportunityMode: "", opportunityId: "" });
    drawPreview();
  };

  const set = (key, value) => { state[key] = value; touched.add(key); persist(); drawPreview(); };

  const customerPicker = () => {
    const chosen = ctx.model.customersById.get(state.customerId);
    const others = state.candidates.filter((candidate) => candidate.customer.id !== state.customerId).slice(0, 4);
    const search = h("input", { type: "search", placeholder: "不是這家？搜尋其他客戶", "aria-label": "搜尋其他客戶", dataset: { captureCustomerSearch: "" }, autocomplete: "off" });
    const results = h("div", { className: "picker-results" });
    search.addEventListener("input", (event) => {
      event.stopPropagation();
      const found = search.value.trim() ? searchCustomers(ctx.model, { query: search.value, myAreas: ctx.settings.myAreas, today, limit: 6 }).items : [];
      results.replaceChildren(...found.map(({ customer }) => h("button", { type: "button", dataset: { pickCustomer: customer.id }, onClick: () => { touched.delete("contactId"); set("customerId", customer.id); state.contactId = primaryContact(ctx.model, customer.id)?.id || ""; drawPreview(); } }, [h("span", { text: customer.name }), h("small", { className: "muted", text: customerIdentity(ctx.model, customer) })])));
    });
    return h("div", { className: "field", dataset: { field: "customerId" } }, [
      h("span", { className: "field-label", text: "客戶" }),
      h("input", { type: "hidden", name: "customerId", value: state.customerId }),
      chosen ? h("div", { className: "chosen", dataset: { captureCustomer: chosen.id } }, [h("strong", { text: chosen.name }), h("small", { className: "muted", text: customerIdentity(ctx.model, chosen) })]) : h("p", { className: "muted", text: "還認不出是哪一家，請從下面選或搜尋。" }),
      others.length ? h("div", { className: "chip-group" }, others.map(({ customer }) => h("button", { type: "button", className: "small ghost", dataset: { altCustomer: customer.id }, title: customerIdentity(ctx.model, customer), text: `${customer.name}${customer.customerNo ? ` #${customer.customerNo}` : ""}`, onClick: () => { touched.delete("contactId"); set("customerId", customer.id); state.contactId = primaryContact(ctx.model, customer.id)?.id || ""; drawPreview(); } }))) : null,
      search, results,
      // A brand-new prospect: create it here without losing what was written.
      h("button", { type: "button", className: "small ghost", dataset: { captureNewCustomer: "" }, text: "＋ 新增客戶", onClick: () => openCustomerEditor(ctx, {
        initial: { name: search.value.trim(), areaTags: [] },
        onSaved: (customer) => { touched.delete("contactId"); state.customerId = customer.id; touched.add("customerId"); state.contactId = ""; persist(); setTimeout(drawPreview, 50); },
      }) }),
    ]);
  };

  // One choice for the case this note belongs to: none, a new one, or an existing one.
  const opportunityPicker = (open) => {
    const value = state.opportunityMode === "create" ? "new" : state.opportunityId || "";
    const choice = select("opportunityChoice", [{ value: "", label: "不處理商機" }, { value: "new", label: "＋ 建立新商機" }, ...open.map((item) => ({ value: item.id, label: `更新：${opportunityTitle(item, 24)}（${item.stage}）` }))], value);
    choice.addEventListener("change", () => {
      touched.add("opportunity");
      Object.assign(state, choice.value === "new" ? { opportunityMode: "create", opportunityId: "" } : choice.value ? { opportunityMode: "update", opportunityId: choice.value } : { opportunityMode: "", opportunityId: "" });
      persist();
      drawPreview();
    });
    const name = input("opportunityName", state.opportunityName, { placeholder: "例如：VIDAS 沙門氏菌儀器" });
    name.addEventListener("input", () => { state.opportunityName = name.value; touched.add("opportunity"); persist(); });
    const chosen = state.opportunityMode === "update" ? ctx.model.opportunitiesById.get(state.opportunityId) : null;
    const close = input("opportunityCloseDate", state.opportunityCloseDate, { type: "date", min: today });
    close.addEventListener("change", () => set("opportunityCloseDate", close.value));
    const product = input("opportunityProduct", state.opportunityProduct, { list: "capture-products", placeholder: "例如：bioMérieux VIDAS" });
    product.addEventListener("input", () => { state.opportunityProduct = product.value; touched.add("opportunityProduct"); persist(); });
    const amount = input("opportunityAmount", state.opportunityAmount ?? "", { type: "number", min: 0, inputmode: "numeric", placeholder: chosen?.amount ? `目前 ${Number(chosen.amount).toLocaleString("zh-TW")}，空白＝不變` : "例如：800000" });
    amount.addEventListener("input", () => { state.opportunityAmount = amount.value; touched.add("opportunityAmount"); persist(); });
    return h("div", { className: "stack", dataset: { captureOpportunity: "" } }, [
      field("商機", choice),
      state.opportunityMode === "create" ? field("新商機名稱", name) : null,
      state.opportunityMode ? field("預估金額（未稅）", amount, { hint: state.opportunityAmount && !touched.has("opportunityAmount") ? "從你說的金額帶入" : "" }) : null,
      state.opportunityMode ? field("推的產品（品牌＋名稱）", product, { hint: chosen?.product && chosen.product !== chosen.name ? `目前：${chosen.product}，空白＝不變` : "從產品知識庫選，或自己打" }) : null,
      h("datalist", { id: "capture-products" }, productOptions(ctx.toolkit || []).map((value) => h("option", { value }))),
      state.opportunityMode ? field(chosen?.expectedCloseDate && !state.opportunityCloseDate ? `預計結案日（目前 ${chosen.expectedCloseDate}，空白＝不變）` : "預計結案日", close) : null,
    ]);
  };
  const drawPreview = () => {
    const customer = ctx.model.customersById.get(state.customerId);
    const contacts = customer ? ctx.model.contactsByCustomer.get(customer.id) || [] : [];
    const open = customer ? (ctx.model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage)) : [];
    const contact = select("contactId", [{ value: "", label: "（未指定）" }, ...contacts.map((item) => ({ value: item.id, label: item.name }))], state.contactId);
    contact.addEventListener("change", () => set("contactId", contact.value));
    // Chips for the usual answers, plus a box for anything that doesn't fit them.
    const withOther = (key, list, chipOptions, placeholder) => {
      const chips = chipGroup(key, chipOptions, state[key]);
      chips.addEventListener("change", (event) => { if (event.target.name === key) { other.value = ""; set(key, event.target.value); } });
      const other = h("input", { name: `${key}Other`, value: state[key] && !list.includes(state[key]) ? state[key] : "", placeholder, "aria-label": placeholder, dataset: { other: key } });
      other.addEventListener("input", () => {
        state[key] = other.value.trim();
        touched.add(key);
        chips.querySelectorAll("input").forEach((node) => { node.checked = false; });
        persist();
      });
      return h("div", { className: "stack", style: { gap: "6px" } }, [chips, other]);
    };
    const channel = withOther("channel", options.channels, options.channels, "其他方式，自己寫");
    const reaction = withOther("reaction", options.reactions, ["", ...options.reactions].map((value) => ({ value, label: value || "不確定" })), "客戶的反應，自己寫（例如：要等老闆出國回來）");
    const next = input("nextAction", state.nextAction, { placeholder: "例如：寄人力節省試算" });
    next.addEventListener("input", () => { state.nextAction = next.value; touched.add("nextAction"); persist(); });
    const date = input("nextFollowUpDate", state.nextFollowUpDate, { type: "date", min: today, disabled: state.noReminder });
    date.addEventListener("change", () => set("nextFollowUpDate", date.value));
    const noReminder = h("input", { type: "checkbox", name: "noReminder", checked: state.noReminder, onChange: (event) => set("noReminder", event.target.checked) });
    const opportunityBlock = customer ? opportunityPicker(open) : null;
    preview.replaceChildren(
      h("h2", { text: "幫你整理成這樣" }),
      h("p", { className: "muted", text: "看一眼，不對的地方改掉再儲存。你寫的原文會完整保存。" }),
      customerPicker(),
      customer ? field("聯絡人", contact) : null,
      h("div", { className: "field", dataset: { field: "channel" } }, [h("span", { className: "field-label", text: state.channel ? "方式" : "方式（沒提到，預設電話）" }), channel]),
      h("div", { className: "field", dataset: { field: "reaction" } }, [h("span", { className: "field-label", text: "客戶反應" }), reaction]),
      field("下一步", next),
      h("div", { className: "field", dataset: { field: "nextFollowUpDate" } }, [
        h("span", { className: "field-label", text: state.nextFollowUpDate ? `提醒：${formatShortDate(state.nextFollowUpDate)} 週${weekdayLabel(state.nextFollowUpDate)}${state.reminderSuggested ? "（沒提到日期，先排一週後）" : ""}` : "提醒日期" }),
        h("div", { className: "chip-group" }, QUICK_DATES.map(([label, days]) => h("button", { type: "button", className: "small ghost", dataset: { quickDate: days }, text: label, onClick: () => { state.noReminder = false; set("nextFollowUpDate", presetDate(today, days)); } }))),
        date,
        h("label", { className: "chip" }, [noReminder, h("span", { text: "不需提醒" })]),
      ]),
      opportunityBlock,
    );
  };

  let guessTimer = null;
  text.addEventListener("input", () => { persist(); clearTimeout(guessTimer); guessTimer = setTimeout(applyGuess, 350); });

  form.append(
    h("header", { className: "page-header" }, [h("div", {}, [h("h1", { text: "記錄" }), h("p", { text: "講完或寫完就好，其他交給系統整理。" })])]),
    h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
    h("div", { className: "field capture-input", dataset: { field: "detailedNote" } }, [text]),
    preview,
    h("p", { className: "muted" }, ["需要填更多欄位（主題、結果、建立新商機）？ ", h("a", { href: `#/visit${state.customerId ? `?customer=${encodeURIComponent(state.customerId)}` : ""}`, text: "用完整表單" })]),
    h("div", { className: "sticky-actions" }, [saveState, h("button", { type: "submit", className: "primary", dataset: { saveCapture: "" }, text: "儲存" })]),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearTimeout(guessTimer);
    clearTimeout(draftTimer);
    if (!text.value.trim()) { showErrors(form, { detailedNote: "先寫下這次聊了什麼" }); return; }
    const result = await saveCapture(ctx.db, {
      ...state, ...state.prep, text: text.value, reminderId: route.query.get("reminder") || "",
      nextFollowUpDate: state.noReminder ? "" : state.nextFollowUpDate,
    }, { requestId: requestId("capture"), today, fallbackChannel: options.channels[0] });
    if (!result.ok) {
      const errors = { ...result.errors };
      if (errors.nextFollowUpDate) errors.nextFollowUpDate = "選一個提醒日期，或勾「不需提醒」";
      if (errors.customerId) errors.customerId = "還不知道是哪一家客戶，請選一下";
      for (const [from, to] of [["opportunity.name", "opportunityName"], ["opportunity.expectedCloseDate", "opportunityCloseDate"], ["opportunity.id", "opportunityChoice"]]) {
        if (errors[from]) { errors[to] = from === "opportunity.name" ? "新商機要取個名字" : errors[from]; delete errors[from]; }
      }
      showErrors(form, errors);
      saveState.textContent = "還沒儲存：請看標紅的地方，內容都還在";
      return;
    }
    await drafts.clear(draftKey);
    const reminder = result.value?.reminder;
    toast(reminder ? `已記錄，${formatShortDate(reminder.dueDate)} 週${weekdayLabel(reminder.dueDate)} 會提醒你` : "已記錄", { timeout: 6000 });
    ctx.navigate(`customer/${encodeURIComponent(state.customerId)}`);
  });

  drawPreview();
  drafts.get(draftKey).then((draft) => {
    if (!draft) return;
    const { detailedNote = "", touched: wasTouched = [], savedAt, ...rest } = draft;
    for (const key of ["customerId", "contactId", "channel", "reaction", "nextAction", "nextFollowUpDate", "noReminder", "opportunityId", "opportunityMode", "opportunityName", "opportunityProduct", "opportunityAmount", "opportunityCloseDate"]) if (rest[key] !== undefined && (wasTouched.includes(key) || !text.value)) state[key] = rest[key];
    state.prep = rest.prep || {};
    wasTouched.forEach((key) => touched.add(key));
    if (detailedNote && !text.value) { text.value = detailedNote; saveState.textContent = `已接續上次的草稿（${new Date(savedAt).toLocaleString("zh-TW")}）`; }
    if (text.value) applyGuess(); else drawPreview();
  }).catch(() => {});
  setTimeout(() => text.focus?.(), 0);

  const flush = () => { if (text.value.trim()) drafts.save(draftKey, { detailedNote: text.value, ...state, candidates: undefined, touched: [...touched] }).catch(() => {}); };
  globalThis.addEventListener?.("pagehide", flush);
  cleanup = () => globalThis.removeEventListener?.("pagehide", flush);
  return form;
}

registerPage("capture", { title: "記錄", render: renderCapture, keepOnDataChange: true });
