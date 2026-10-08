import { daysBetween, formatShortDate, weekdayLabel } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { PREP_QUESTIONS, PROMPT_GROUPS, REMINDER_PRESETS, insertPrompt, presetDate, saveVisit, suggestsPostVisitActions } from "../../data/activities.js";
import { searchCustomers } from "../../data/customers.js";
import { createDraftStore, hasContent, UNASSIGNED_DRAFT } from "../../data/drafts.js";
import { customerIdentity, lastActivity, primaryContact } from "../../data/model.js";
import { STAGE_DEFAULT_PROBABILITY } from "../../data/opportunities.js";
import { LOST_REASONS } from "../../data/schema.js";
import { OBJECTION_REACTIONS, OBJECTION_TYPES, objectionNote, PRICE_QUESTIONS, toolkitObjections } from "../../data/objections.js";
import { chipGroup, cssEscape, field, formToObject, h, input, select, showErrors, toast } from "../dom.js";
import { registerPage } from "../app.js";

const ERROR_FIELDS = {
  "opportunity.name": "opportunityName", "opportunity.stage": "opportunityStage", "opportunity.amount": "opportunityAmount",
  "opportunity.probability": "opportunityProbability", "opportunity.expectedCloseDate": "opportunityCloseDate",
  "opportunity.lostReason": "opportunityLostReason", "opportunity.id": "opportunityId", "opportunity.customerId": "customerId",
};
const CREATE_STAGES = ["接觸", "提案", "議價", "成交", "失敗"];

let cleanup = () => {};

function fillForm(form, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    const controls = form.querySelectorAll(`[name="${cssEscape(name)}"]`);
    controls.forEach((control) => {
      if (control.type === "radio" || control.type === "checkbox") control.checked = String(control.value) === String(value) || (control.type === "checkbox" && controls.length === 1 && value === true);
      else if (control.type !== "hidden" || name === "reminderId") control.value = value ?? "";
    });
  }
}

export function renderVisit(ctx, route) {
  cleanup();
  const drafts = (ctx.drafts ||= createDraftStore(ctx.db));
  const today = ctx.today();
  const options = ctx.settings.visitOptions;
  let customerId = route.query.get("customer") || "";
  if (customerId && !ctx.model.customersById.get(customerId)) customerId = "";
  let draftKey = customerId || UNASSIGNED_DRAFT;
  let rid = requestId("visit");
  let dirty = false;

  const form = h("form", { className: "visit-form", novalidate: true, dataset: { form: "visit" } });
  const customerInput = h("input", { type: "hidden", name: "customerId", value: customerId });
  const reminderInput = h("input", { type: "hidden", name: "reminderId", value: route.query.get("reminder") || "" });
  const customerSlot = h("div", { dataset: { customerSlot: "" } });
  const opportunitySlot = h("div", { className: "form-grid", dataset: { opportunitySlot: "" } });
  const saveState = h("span", { className: "save-state", role: "status", dataset: { saveState: "" }, text: "輸入內容會自動暫存在這台裝置" });
  const restoredNotice = h("div", { className: "info-banner", hidden: true, dataset: { restoredDraft: "" } });

  const collect = () => formToObject(form);
  const persist = async () => {
    if (!dirty) return;
    try {
      const saved = await drafts.save(draftKey, collect());
      saveState.textContent = `草稿已自動暫存 ${new Date(saved.savedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      saveState.textContent = "草稿暫存失敗，內容仍在畫面上，請勿關閉頁面";
    }
  };
  let timer = null;
  const schedule = () => { dirty = true; clearTimeout(timer); timer = setTimeout(persist, 400); };

  // ---- customer ----
  const contactPicker = (customer) => {
    const contacts = ctx.model.contactsByCustomer.get(customer.id) || [];
    const primary = primaryContact(ctx.model, customer.id);
    const picker = select("contactId", [{ value: "", label: "（未指定）" }, ...contacts.map((contact) => ({ value: contact.id, label: [contact.name, contact.title].filter(Boolean).join("・") })), { value: "__new", label: "＋ 新聯絡人" }], primary?.id || "");
    const newFields = h("div", { className: "form-grid", hidden: true, dataset: { newContact: "" } }, [field("新聯絡人姓名", input("newContactName", "")), field("職稱", input("newContactTitle", ""))]);
    picker.addEventListener("change", () => { newFields.hidden = picker.value !== "__new"; });
    return h("div", { className: "stack" }, [field("這次聯絡的人", picker), newFields]);
  };

  const priorPanel = (customer) => {
    const last = lastActivity(ctx.model, customer.id);
    const open = (ctx.model.opportunitiesByCustomer.get(customer.id) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
    if (!last && !open.length && !customer.nextAction) return h("p", { className: "muted", text: "這是第一次記錄這位客戶。" });
    return h("div", { className: "prior-visit", dataset: { priorVisit: "" } }, [
      last ? h("strong", { text: `上次拜訪 ${last.activityDate}（${daysBetween(last.activityDate, today) ?? "?"} 天前）・${[last.channel, last.purpose].filter(Boolean).join("・")}` }) : h("strong", { text: "尚無拜訪紀錄" }),
      last ? h("p", { text: last.detailedNote || last.summary || "" }) : null,
      customer.nextAction || last?.nextAction ? h("small", { text: `上次約定的下一步：${customer.nextAction || last.nextAction}` }) : null,
      open.length ? h("small", { text: `進行中商機：${open.map((opportunity) => `${opportunity.name}（${opportunity.stage}）`).join("、")}` }) : null,
    ]);
  };

  const pickCustomer = (id) => {
    const previousKey = draftKey;
    customerId = id;
    customerInput.value = id;
    draftKey = id || UNASSIGNED_DRAFT;
    drawCustomer();
    drawOpportunity();
    if (previousKey !== draftKey) { dirty = true; drafts.move(previousKey, draftKey, collect()); }
  };

  const drawCustomer = () => {
    const customer = ctx.model.customersById.get(customerId);
    if (customer) {
      customerSlot.replaceChildren(
        h("div", { className: "selected-customer", dataset: { selectedCustomer: customer.id } }, [
          h("div", {}, [h("strong", { text: customer.name }), h("div", { className: "muted", text: [customer.customerNo ? `#${customer.customerNo}` : "", ...(customer.areaTags || [])].filter(Boolean).join("・") })]),
          h("button", { type: "button", className: "small ghost", text: "換客戶", onClick: () => pickCustomer("") }),
        ]),
        contactPicker(customer),
        priorPanel(customer),
      );
      return;
    }
    const results = h("div", { className: "picker-results", dataset: { pickerResults: "" } });
    const search = h("input", { type: "search", placeholder: "輸入公司、聯絡人或電話關鍵字", "aria-label": "搜尋要記錄的客戶", dataset: { visitCustomerSearch: "" }, autocomplete: "off" });
    search.addEventListener("input", (event) => {
      event.stopPropagation();
      const found = search.value.trim() ? searchCustomers(ctx.model, { query: search.value, myAreas: ctx.settings.myAreas, today, limit: 8 }).items : [];
      // Same-name customers need their number, contact and last contact to be told apart.
      results.replaceChildren(...found.map(({ customer, outsideMyAreas }) => h("button", { type: "button", dataset: { pickCustomer: customer.id }, onClick: () => pickCustomer(customer.id) }, [
        h("span", { text: ctx.model.sameNameCount(customer) ? `${customer.name}（同名 ${ctx.model.sameNameCount(customer) + 1} 筆）` : customer.name }),
        h("small", { className: "muted", text: [customerIdentity(ctx.model, customer), outsideMyAreas ? "非我的區域" : ""].filter(Boolean).join("・") }),
      ])));
      if (search.value.trim() && !found.length) results.replaceChildren(h("p", { className: "muted", text: "找不到，換個關鍵字，或先到「客戶」新增。" }));
    });
    customerSlot.replaceChildren(h("div", { className: "search-box" }, [search]), results, h("small", { className: "muted", text: "可以先寫紀錄，再選客戶，內容不會消失。" }));
  };

  // ---- opportunity ----
  const drawOpportunity = () => {
    const action = form.querySelector('[name="opportunityAction"]:checked')?.value || "none";
    const open = (ctx.model.opportunitiesByCustomer.get(customerId) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
    if (action === "none") { opportunitySlot.replaceChildren(); return; }
    const stageSelect = select("opportunityStage", action === "update" ? [{ value: "", label: "（階段不變）" }, ...CREATE_STAGES] : CREATE_STAGES, action === "update" ? "" : "接觸");
    const lostField = field("未成交原因", select("opportunityLostReason", [{ value: "", label: "請選擇" }, ...LOST_REASONS], ""));
    lostField.hidden = true;
    const probability = input("opportunityProbability", "", { type: "number", min: 0, max: 100, inputmode: "numeric", placeholder: `預設 ${STAGE_DEFAULT_PROBABILITY["接觸"]}` });
    stageSelect.addEventListener("change", () => {
      lostField.hidden = stageSelect.value !== "失敗";
      probability.placeholder = stageSelect.value ? `預設 ${STAGE_DEFAULT_PROBABILITY[stageSelect.value]}` : "不變";
    });
    const amount = input("opportunityAmount", "", { type: "number", min: 0, inputmode: "numeric" });
    const closeDate = input("opportunityCloseDate", "", { type: "date" });
    const common = [
      field("階段", stageSelect, { hint: action === "create" ? "提案以後需填金額" : "" }),
      field("預估金額（未稅）", amount),
      field("成交機率 %", probability),
      field("預計結案日", closeDate),
      lostField,
    ];
    if (action === "create") {
      opportunitySlot.replaceChildren(field("商機名稱 *", input("opportunityName", "", { placeholder: "例如：沙門氏菌快篩導入" })), field("產品／服務", input("opportunityProduct", "")), ...common);
      return;
    }
    // Updating: show what the opportunity says today, so blanks clearly mean "keep".
    const current = h("div", { className: "span-2", dataset: { opportunityCurrent: "" } });
    const picker = open.length ? select("opportunityId", [{ value: "", label: "請選擇" }, ...open.map((opportunity) => ({ value: opportunity.id, label: `${opportunity.name}（${opportunity.stage}）` }))], route.query.get("opportunity") || "") : null;
    const showCurrent = () => {
      const chosen = picker && ctx.model.opportunitiesById.get(picker.value);
      if (!chosen) { current.replaceChildren(); return; }
      amount.placeholder = chosen.amount ? `目前 ${Number(chosen.amount).toLocaleString("zh-TW")}，空白＝不變` : "目前未填";
      probability.placeholder = chosen.probability !== null && chosen.probability !== undefined && chosen.probability !== "" ? `目前 ${chosen.probability}，空白＝不變` : probability.placeholder;
      const overdueDays = chosen.expectedCloseDate && chosen.expectedCloseDate < today ? daysBetween(chosen.expectedCloseDate, today) : 0;
      current.replaceChildren(
        h("p", { className: "muted", text: `目前：${[chosen.stage, chosen.amount ? `NT$ ${Number(chosen.amount).toLocaleString("zh-TW")}` : "金額未填", chosen.probability !== null && chosen.probability !== undefined && chosen.probability !== "" ? `${chosen.probability}%` : null, chosen.expectedCloseDate ? `預計結案 ${chosen.expectedCloseDate}` : "未填預計結案日"].filter(Boolean).join("・")}。空白的欄位會維持原值。` }),
        overdueDays ? h("p", { className: "warning-banner", dataset: { closeDateOverdue: "" }, text: `預計結案日已過 ${overdueDays} 天，建議這次一併填新的預計結案日。` }) : null,
      );
    };
    picker?.addEventListener("change", showCurrent);
    opportunitySlot.replaceChildren(
      picker ? field("要更新的商機", picker, { className: "span-2" }) : h("p", { className: "muted span-2", text: customerId ? "這位客戶目前沒有進行中的商機，可改選「建立新商機」。" : "請先選擇客戶。" }),
      current,
      ...common,
    );
    showCurrent();
  };

  // ---- note ----
  const note = h("textarea", { name: "detailedNote", rows: 12, placeholder: "完整記錄客戶說了什麼、需求背景、現在用什麼、誰決定、疑問與你的觀察……\n\n可以用下面的提示按鈕快速插入段落標題。", "aria-label": "完整拜訪紀錄" });
  const promptRow = h("div", { className: "prompt-row", "aria-label": "插入提示" });
  const promptTip = h("small", { className: "muted", dataset: { promptTip: "" } });
  const drawPrompts = (group) => {
    promptTip.textContent = group.tip || "";
    promptRow.replaceChildren(...group.prompts.map((prompt) => h("button", {
      type: "button", className: "small ghost", text: `＋ ${prompt.label}`, dataset: { notePrompt: prompt.label },
      onClick: () => {
        const { value, cursor } = insertPrompt(note.value, prompt.text, note.selectionStart ?? note.value.length);
        note.value = value;
        note.focus();
        note.setSelectionRange?.(cursor, cursor);
        schedule();
      },
    })));
    promptTabs.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.promptGroup === group.id)));
  };
  const promptTabs = h("div", { className: "tabs", "aria-label": "提示類型" }, PROMPT_GROUPS.map((group) => h("button", { type: "button", className: "small ghost", dataset: { promptGroup: group.id }, text: group.label, onClick: () => drawPrompts(group) })));
  const prompts = h("div", { className: "stack", style: { gap: "8px" } }, [promptTabs, promptTip, promptRow]);
  drawPrompts(PROMPT_GROUPS[0]);

  // ---- before / after the visit ----
  const prepCard = h("details", { className: "card section", dataset: { prepCard: "" } }, [
    h("summary", {}, [h("span", { text: "拜訪前 30 秒準備（選填）" })]),
    h("p", { className: "muted", text: "進場前先回答這三題，帶著目的去，而不是帶著通用簡報去。" }),
    h("div", { className: "form-grid" }, [...PREP_QUESTIONS.map((question) => field(question.label, input(`prep.${question.key}`, ""))), field("與會者與角色", input("prep.attendees", "", { placeholder: "例：王經理（拍板者）、陳工程師（使用者）" }))]),
  ]);
  const postVisit = h("input", { type: "checkbox", name: "postVisitActions", value: "yes", dataset: { postVisit: "" } });
  let postVisitTouched = false;
  postVisit.addEventListener("change", () => { postVisitTouched = true; });
  const syncPostVisit = () => { if (!postVisitTouched) postVisit.checked = suggestsPostVisitActions(collect()); };

  // ---- objection cheat sheet ----
  const insertIntoNote = (text) => {
    const { value, cursor } = insertPrompt(note.value, text, note.value.length);
    note.value = value;
    note.focus();
    note.setSelectionRange?.(cursor, cursor);
    schedule();
  };
  const objectionPanel = h("div", { className: "prior-visit", hidden: true, dataset: { objectionPanel: "" } });
  const drawObjections = () => {
    const customer = ctx.model.customersById.get(customerId);
    const matches = toolkitObjections(ctx.toolkit || [], { tags: [...(customer?.industryTags || []), ...(customer?.productTags || [])] });
    objectionPanel.replaceChildren(
      h("strong", { text: "疑慮小抄：先找原因，再給策略" }),
      h("div", { className: "stack", style: { gap: "8px" } }, OBJECTION_TYPES.map((type) => h("div", { dataset: { objectionType: type.id } }, [
        h("div", {}, [h("strong", { text: `${type.label}　` }), h("span", { className: "muted", text: `背後原因：${type.cause}` })]),
        h("div", { text: `回應：${type.strategy}` }),
        h("small", { className: "muted", text: type.example }),
        h("div", {}, [h("button", { type: "button", className: "small ghost", dataset: { insertObjection: type.id }, text: `＋ 記下${type.label}疑慮`, onClick: () => insertIntoNote(objectionNote(type.id)) })]),
      ]))),
      h("details", { dataset: { priceQuestions: "" } }, [
        h("summary", { text: "客戶說「太貴了」：把結論拆回比較條件" }),
        h("ul", {}, PRICE_QUESTIONS.map((item) => h("li", { text: `${item.axis}：${item.question}` }))),
        h("button", { type: "button", className: "small ghost", text: "＋ 記下他的比較基準", onClick: () => insertIntoNote("【太貴了→比較基準】（跟誰比？只看單價還是含人力、重驗、放行時間？）") }),
      ]),
      matches.length ? h("details", { dataset: { toolkitObjections: "" } }, [
        h("summary", { text: `產品知識庫的常見疑慮（${matches.length}）` }),
        h("ul", {}, matches.map((item) => h("li", {}, [h("strong", { text: item.name }), h("div", { className: "muted", text: `疑慮：${item.objection}` }), h("div", { text: `回應：${item.answer}` })]))),
      ]) : null,
    );
  };
  const syncObjections = () => {
    const reaction = form.querySelector('[name="reaction"]:checked')?.value;
    if (OBJECTION_REACTIONS.includes(reaction)) { drawObjections(); objectionPanel.hidden = false; }
  };
  const objectionToggle = h("button", { type: "button", className: "small ghost", dataset: { objectionToggle: "" }, text: "疑慮小抄", onClick: () => { if (objectionPanel.hidden) drawObjections(); objectionPanel.hidden = !objectionPanel.hidden; } });

  // ---- follow-up ----
  const nextFollowUp =input("nextFollowUpDate", "", { type: "date", min: today });
  const noReminder = h("input", { type: "checkbox", name: "followUpMode", value: "none" });
  noReminder.addEventListener("change", () => { nextFollowUp.disabled = noReminder.checked; });
  const nextAction = input("nextAction", "", { list: "next-action-options", placeholder: "例如：寄報價單" });
  // Each button shows the real date it picks; weekends roll to Monday.
  const presets = h("div", { className: "prompt-row" }, REMINDER_PRESETS.map((preset) => {
    const date = presetDate(today, preset.days);
    return h("button", {
      type: "button", className: "small ghost", text: `${preset.label}（${formatShortDate(date)} 週${weekdayLabel(date)}）`, dataset: { reminderPreset: preset.days },
      onClick: () => { noReminder.checked = false; nextFollowUp.disabled = false; nextFollowUp.value = date; schedule(); },
    });
  }));

  form.append(
    customerInput, reminderInput,
    h("header", { className: "page-header" }, [h("div", {}, [h("h1", { text: "記錄拜訪" }), h("p", { text: "選項幫你分類，完整紀錄才是重點。" })])]),
    restoredNotice,
    h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
    h("section", { className: "card form-card" }, [h("h2", { text: "1. 客戶" }), customerSlot]),
    prepCard,
    h("section", { className: "card form-card" }, [
      h("h2", { text: "2. 這次怎麼聯絡" }),
      h("div", { className: "form-grid" }, [field("日期", input("activityDate", today, { type: "date", max: today }))]),
      h("div", { className: "field", dataset: { field: "channel" } }, [h("span", { className: "field-label", text: "拜訪方式" }), chipGroup("channel", options.channels, options.channels[0])]),
      h("div", { className: "field", dataset: { field: "purpose" } }, [h("span", { className: "field-label", text: "主題" }), chipGroup("purpose", options.purposes, "")]),
      h("div", { className: "field", dataset: { field: "reaction" } }, [h("div", { className: "section-head" }, [h("span", { className: "field-label", text: "客戶反應" }), objectionToggle]), chipGroup("reaction", options.reactions, "")]),
      objectionPanel,
    ]),
    h("section", { className: "card form-card note-area" }, [h("h2", { text: "3. 完整拜訪紀錄" }), h("div", { className: "field", dataset: { field: "detailedNote" } }, [note]), prompts]),
    h("section", { className: "card form-card" }, [
      h("h2", { text: "4. 結果與商機" }),
      h("div", { className: "field", dataset: { field: "result" } }, [h("span", { className: "field-label", text: "這次結果" }), chipGroup("result", options.results, "")]),
      h("div", { className: "field" }, [h("span", { className: "field-label", text: "商機" }), chipGroup("opportunityAction", [{ value: "none", label: "不處理" }, { value: "create", label: "建立新商機" }, { value: "update", label: "更新既有商機" }], route.query.get("opportunity") ? "update" : "none")]),
      opportunitySlot,
    ]),
    h("section", { className: "card form-card" }, [
      h("h2", { text: "5. 下一步與提醒" }),
      field("收尾必問：下一步應該找誰談？", input("nextContactHint", "", { placeholder: "例：品保經理建議找廠長談預算" })),
      field("下一步", nextAction),
      h("datalist", { id: "next-action-options" }, options.nextActions.map((value) => h("option", { value }))),
      presets,
      h("div", { className: "form-grid" }, [field("下次提醒日期", nextFollowUp), h("label", { className: "chip" }, [noReminder, h("span", { text: "不需提醒" })])]),
      h("label", { className: "chip" }, [postVisit, h("span", { text: "自動排會後動作：明天寄會後信、後天確認關鍵人物" })]),
    ]),
    h("div", { className: "sticky-actions" }, [saveState, h("button", { type: "submit", className: "primary", dataset: { saveVisit: "" }, text: "儲存拜訪紀錄" })]),
  );

  form.addEventListener("input", schedule);
  form.addEventListener("change", (event) => {
    if (event.target.name === "opportunityAction") drawOpportunity();
    if (event.target.name === "channel" || event.target.name === "purpose") syncPostVisit();
    if (event.target.name === "reaction") syncObjections();
    schedule();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearTimeout(timer);
    const values = collect();
    await drafts.save(draftKey, values);
    const result = await saveVisit(ctx.db, values, { requestId: rid, today });
    if (!result.ok) {
      const errors = Object.fromEntries(Object.entries(result.errors || { _: "儲存失敗，請再試一次" }).map(([key, message]) => [ERROR_FIELDS[key] || key, message]));
      showErrors(form, errors);
      saveState.textContent = "尚未儲存：請修正標示的欄位，內容都還在";
      return;
    }
    await drafts.clear(draftKey);
    dirty = false;
    rid = requestId("visit");
    const activityId = result.value?.activity?.id;
    toast(result.value?.reminder ? `已儲存，${result.value.reminder.dueDate} 會提醒你` : "已儲存拜訪紀錄", { timeout: 8000, action: activityId ? h("button", { type: "button", className: "small", dataset: { openLou: activityId }, text: "產生會後信", onClick: () => ctx.navigate(`lou/${encodeURIComponent(activityId)}`) }) : null });
    ctx.navigate(`customer/${encodeURIComponent(values.customerId)}`);
  });

  const flushNow = () => { if (dirty) { clearTimeout(timer); persist(); } };
  const onVisibility = () => { if (document.visibilityState === "hidden") flushNow(); };
  globalThis.addEventListener?.("pagehide", flushNow);
  document.addEventListener("visibilitychange", onVisibility);
  const onHash = () => { flushNow(); };
  globalThis.addEventListener?.("hashchange", onHash);
  cleanup = () => {
    globalThis.removeEventListener?.("pagehide", flushNow);
    document.removeEventListener("visibilitychange", onVisibility);
    globalThis.removeEventListener?.("hashchange", onHash);
  };

  drawCustomer();
  drawOpportunity();
  syncPostVisit();
  drafts.get(draftKey).then((draft) => {
    if (!hasContent(draft) || dirty) return;
    const { customerId: _ignored, reminderId: _reminder, savedAt, ...rest } = draft;
    fillForm(form, rest);
    if (rest.opportunityAction && rest.opportunityAction !== "none") {
      drawOpportunity();
      fillForm(form, rest);
      form.querySelector('[name="opportunityId"]')?.dispatchEvent(new Event("change"));
    }
    if (rest.followUpMode === "none") nextFollowUp.disabled = true;
    restoredNotice.hidden = false;
    restoredNotice.textContent = `已恢復上次未完成的草稿（${new Date(savedAt).toLocaleString("zh-TW")}）。`;
  }).catch(() => {});
  return form;
}

registerPage("visit", { title: "記錄拜訪", render: renderVisit, keepOnDataChange: true });
