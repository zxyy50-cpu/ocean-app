import { requestId } from "../../core/ids.js";
import { addConcession, CHIPS, concessionRoom, currentOffer, DEAL_PURPOSES, EXCHANGES, MAX_CONCESSIONS, negotiationWarnings, plan532, saveNegotiation, SAY_NO_TEMPLATE, zopa } from "../../data/negotiation.js";
import { badge, chipGroup, field, formToObject, h, input, money, select, showErrors, toast } from "../dom.js";

// Until a price is written down, the opportunity amount stands in as the opening price.
function effective(opportunity) {
  const negotiation = opportunity.negotiation || {};
  const amount = Number(opportunity.amount);
  return Number.isFinite(negotiation.desiredPrice) || !Number.isFinite(amount) || !amount ? negotiation : { ...negotiation, desiredPrice: amount };
}

function warningsCard(opportunity) {
  const negotiation = effective(opportunity);
  const warnings = negotiationWarnings(negotiation, opportunity.stage);
  const room = concessionRoom(negotiation);
  const region = zopa(negotiation);
  const offer = currentOffer(negotiation);
  const used = (negotiation.concessions || []).length;
  return h("section", { className: "card", dataset: { negotiationSummary: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "談判狀態" }), badge(`已讓價 ${used} / ${MAX_CONCESSIONS} 次`, used >= MAX_CONCESSIONS ? "danger" : "neutral")]),
    h("dl", { className: "kv" }, [
      h("dt", { text: "目前報價" }), h("dd", { text: offer !== null ? money(offer) : "先填開價" }),
      h("dt", { text: "可讓空間" }), h("dd", { text: room !== null ? money(room) : "填開價與離場點後計算" }),
      h("dt", { text: "談判區間（ZOPA）" }), h("dd", { dataset: { zopa: "" }, text: !region ? "填我方離場點與「估對方離場點」後判斷" : region.exists ? `${money(region.low)} ～ ${money(region.high)}` : `可能沒有交集（差 ${money(region.gap)}）` }),
    ]),
    warnings.length ? h("ul", { className: "task-list", style: { marginTop: "10px" } }, warnings.map((warning) => h("li", { className: `task-row${warning.level === "red" ? " warn" : ""}`, dataset: { negotiationWarning: warning.text } }, [h("div", { className: "task-main" }, [h("strong", { text: warning.text }), h("span", { text: warning.hint })])]))) : h("p", { className: "ok-text", style: { marginTop: "10px" }, text: "準備完整，照讓價計畫走。" }),
    opportunity.stage !== "議價" ? h("p", { className: "muted", text: "這個商機還不在「議價」階段，可以先把底線和籌碼準備好。" }) : null,
  ]);
}

function prepForm(ctx, opportunity) {
  const negotiation = effective(opportunity);
  const room = concessionRoom(negotiation);
  const steps = plan532(room);
  const form = h("form", { className: "card form-card", novalidate: true, dataset: { form: "negotiation" } }, [
    h("h2", { text: "談判前準備：先畫出那一條線" }),
    h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
    h("div", { className: "form-grid" }, [
      field("我方開價（期望價）", input("desiredPrice", negotiation.desiredPrice ?? opportunity.amount ?? "", { type: "number", min: 0, inputmode: "numeric" })),
      field("我方離場點（低於此價寧可不做）", input("walkAway", negotiation.walkAway ?? "", { type: "number", min: 0, inputmode: "numeric" })),
      field("對方期望價（他最想買到的價）", input("buyerTarget", negotiation.buyerTarget ?? "", { type: "number", min: 0, inputmode: "numeric" })),
      field("估對方離場點（高於此價他會換人）", input("buyerWalkAway", negotiation.buyerWalkAway ?? "", { type: "number", min: 0, inputmode: "numeric" })),
      field("我方替代方案（談不成時怎麼辦）", h("textarea", { name: "batna", rows: 2, value: negotiation.batna || "" }), { hint: "例：把產能留給另一家已在議價的客戶" }),
      field("對方的替代方案有多好", h("textarea", { name: "buyerBatna", rows: 2, value: negotiation.buyerBatna || "" }), { hint: "例：現用 3M，換掉要重新驗證方法" }),
      field("這張單對公司的意義", select("purpose", [{ value: "", label: "請選擇" }, ...DEAL_PURPOSES], negotiation.purpose || "")),
      field("讓客戶現在決定的理由", input("urgency", negotiation.urgency || "", { placeholder: "例：報價有效到 10/31、年底前要過稽核" })),
    ]),
    h("div", { className: "field" }, [h("span", { className: "field-label", text: "價格以外的籌碼（勾選我方有的）" }), chipGroup("chips", CHIPS, negotiation.chips || [], { multiple: true })]),
    field("Say No 腳本：什麼條件下離場、怎麼說", h("textarea", { name: "sayNo", rows: 2, value: negotiation.sayNo || SAY_NO_TEMPLATE })),
    steps.length ? h("div", { className: "info-banner", dataset: { plan532: "" }, text: `532 讓價計畫（可讓 ${money(room)}）：第一次讓 ${money(steps[0])} → 第二次 ${money(steps[1])} → 最後 ${money(steps[2])} 並要求當場決定。每次都要換回條件。` }) : null,
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: "儲存談判準備" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveNegotiation(ctx.db, opportunity.id, formToObject(form), requestId("negotiation"));
    if (!result.ok) { showErrors(form, result.errors || { _: "儲存失敗" }); return; }
    form.removeAttribute("data-dirty");
    toast("已儲存談判準備");
  });
  return form;
}

function concessionCard(ctx, opportunity) {
  const negotiation = effective(opportunity);
  const concessions = negotiation.concessions || [];
  const steps = plan532(concessionRoom(negotiation));
  const suggested = steps[concessions.length] ?? "";
  const form = h("form", { className: "form-grid", novalidate: true, dataset: { form: "concession" } }, [
    field("這次讓價金額", input("amount", suggested, { type: "number", min: 0, inputmode: "numeric" }), { hint: suggested ? `532 建議：${money(suggested)}` : "" }),
    field("換回什麼條件", select("exchange", [{ value: "", label: "（還沒有）" }, ...EXCHANGES], "")),
    field("日期", input("date", ctx.today(), { type: "date" })),
    field("備註", input("note", "", { placeholder: "例：對方要求同業價" })),
    h("p", { className: "field-error span-2", hidden: true, dataset: { formErrors: "" } }),
    h("div", { className: "form-actions span-2" }, [h("button", { type: "submit", className: concessions.length >= 3 ? "danger" : "primary", text: concessions.length >= 3 ? "仍要再讓價（不建議）" : "記錄這次讓價" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await addConcession(ctx.db, opportunity.id, formToObject(form), requestId("concession"));
    if (!result.ok) { showErrors(form, result.errors || { _: "儲存失敗" }); return; }
    form.removeAttribute("data-dirty");
    toast("已記錄讓價");
  });
  return h("section", { className: "card form-card", dataset: { concessions: "" } }, [
    h("h2", { text: "讓價紀錄" }),
    h("p", { className: "muted", text: "讓價是設計出來的節奏：不超過三次、一次比一次小、每次都換回東西；立刻答應的讓步沒有價值。" }),
    concessions.length ? h("ol", { className: "timeline" }, concessions.map((item, index) => h("li", { dataset: { concession: index } }, [
      h("div", { className: "when", text: `第 ${index + 1} 次・${item.date || ""}` }),
      h("div", { text: `讓 ${money(item.amount)}${item.exchange ? `，換到：${item.exchange}` : "，沒有換回條件"}` }),
      item.note ? h("small", { className: "muted", text: item.note }) : null,
    ]))) : h("p", { className: "muted", text: "還沒有讓價。" }),
    form,
  ]);
}

export function negotiationSection(ctx, opportunity) {
  return h("div", { className: "stack", dataset: { negotiationSection: "" } }, [warningsCard(opportunity), prepForm(ctx, opportunity), concessionCard(ctx, opportunity)]);
}
