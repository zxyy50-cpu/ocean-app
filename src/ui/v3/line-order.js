import { requestId } from "../../core/ids.js";
import {
  blankItem, changeCustomer, customerChoices, customerDisplayName, customerText, draftChecks, itemGross, orderTotals, withTax, parseOrderMessage, pendingChecks, priceAlertText,
  productCandidates, productLabel, salutationFor, secretaryText, updateItem,
} from "../../data/order-intake.js";
import { emptyReference } from "../../data/order-reference.js";
import { customerPurchases, draftFromPicks, lastOrder } from "../../data/reorder.js";
import {
  appIdsOf, draftRows, LINE_SHEETS, learnAlias, loadReference, orderAliases, recognizeImage, refreshReference, saveLineOrder, saveSalutation,
  orderTaxByCustomer, rememberTax, savedOrderRows, savedSalutations, setLineOrderStatus, sheetState, writeOrderToSheet,
} from "../../data/line-orders.js";
import { badge, confirmDialog, emptyState, h, money, toast } from "../dom.js";
import { registerPage } from "../app.js";

// LINE 訂單: paste a LINE message (or a screenshot) → a checked draft → secretary / customer texts
// → saved in the app and written to LINE訂單整理. Nothing is written until the user presses save.
const DRAFT_META = "lineOrderDraft";
const state = { text: "", draft: null, saved: null, sheet: "test", restored: false, mode: "message", reorder: { customer: null, picks: {}, showAll: false, extra: [] } };
let reference = emptyReference();

export function resetLineOrderState() {
  Object.assign(state, { text: "", draft: null, saved: null, sheet: "test", restored: false, mode: "message", reorder: { customer: null, picks: {}, showAll: false, extra: [] } });
  reference = emptyReference();
}

// Each browser tab keeps its own draft (sessionStorage survives a reload in the same tab),
// so two open order tabs never overwrite each other.
function draftKey() {
  try {
    let id = globalThis.sessionStorage?.getItem("ocean-line-order-tab");
    if (!id) { id = Math.random().toString(36).slice(2, 10); globalThis.sessionStorage?.setItem("ocean-line-order-tab", id); }
    return `${DRAFT_META}:${id}`;
  } catch {
    return DRAFT_META;
  }
}

const persist = (ctx) => ctx.db.setMeta(draftKey(), { text: state.text, draft: state.draft, saved: state.saved, sheet: state.sheet }).catch(() => {});

function copyButton(getText, label) {
  return h("button", { type: "button", className: "small ghost", text: `複製${label}`, onClick: async (event) => {
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(getText()); button.textContent = "已複製"; } catch { button.textContent = "請長按文字複製"; }
    setTimeout(() => { button.textContent = `複製${label}`; }, 1500);
  } });
}

function checkList(checks) {
  if (!checks.length) return null;
  return h("ul", { className: "line-checks" }, checks.map((check) => h("li", { className: check.soft ? "soft" : "hard", dataset: { check: check.field }, text: `${check.soft ? "提醒" : "待確認"}：${check.text}` })));
}

export function renderLineOrder(ctx, route) {
  const today = ctx.today();
  if (route?.query?.get("mode") === "reorder") state.mode = "reorder";
  const refInfo = h("p", { className: "muted", dataset: { lineReference: "" }, text: "讀取商品與購買紀錄…" });
  const text = h("textarea", { rows: 6, value: state.text, dataset: { lineText: "" }, "aria-label": "LINE 訂購訊息", placeholder: "貼上客戶的 LINE 訊息，例如：\n興農 楊津銘：我要 1罐PDA、1罐LBA，然後要一罐macconkey，貨號211387；單獨一張發票。" });
  const status = h("p", { className: "muted", role: "status", dataset: { lineStatus: "" } });
  const draftBox = h("div", { className: "stack", dataset: { lineDraft: "" } });
  const savedBox = h("section", { className: "card", dataset: { lineSaved: "" } });
  const context = () => ({ reference, customerNo: state.draft?.customer.customerNo || "", today });

  const setDraft = (draft) => {
    state.draft = draft ? { ...draft, checks: draftChecks(draft.customer, draft.items, draft.checks) } : null;
    persist(ctx);
    drawDraft();
  };
  const editItem = (index, changes) => {
    const items = state.draft.items.map((item, at) => (at === index ? updateItem(item, changes, context()) : item));
    setDraft({ ...state.draft, items });
  };

  const parse = () => {
    state.text = text.value;
    if (!text.value.trim()) { status.textContent = "先貼上訂購訊息"; return; }
    const all = ctx.model.all;
    state.saved = null;
    setDraft(parseOrderMessage(text.value, { model: ctx.model, reference, aliases: orderAliases(all), salutations: savedSalutations(all), taxByCustomer: orderTaxByCustomer(all), today }));
    status.textContent = reference.productList.length ? "" : "還沒有商品清單與購買紀錄，料號與價格都會是待確認。請先按「更新商品與購買紀錄」。";
  };
  text.addEventListener("input", () => { state.text = text.value; persist(ctx); });

  const imageInput = h("input", { type: "file", accept: "image/*", hidden: true, dataset: { lineImage: "" }, onChange: async () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    status.textContent = "辨識截圖文字中…";
    const result = await recognizeImage(ctx.transport, file);
    imageInput.value = "";
    if (!result.ok) { status.textContent = result.message; return; }
    text.value = [text.value.trim(), result.text].filter(Boolean).join("\n");
    state.text = text.value;
    status.textContent = "截圖文字已放進上面，請先看一下有沒有辨識錯字，再按「辨識訂單」。";
    persist(ctx);
  } });

  function customerCard(draft) {
    const customer = draft.customer;
    const results = h("div", { className: "picker-results" });
    const search = h("input", { type: "search", placeholder: "換客戶：輸入公司、聯絡人或客戶編號", "aria-label": "搜尋客戶", dataset: { lineCustomerSearch: "" } });
    search.addEventListener("input", () => {
      results.replaceChildren(...customerChoices(search.value, { model: ctx.model, reference }).map((choice) => h("button", {
        type: "button", className: "small ghost", dataset: { lineCustomerPick: choice.customerNo || choice.customerId },
        text: [choice.company, choice.contact, choice.customerNo ? `#${choice.customerNo}` : "（無客戶編號）"].filter(Boolean).join(" "),
        onClick: () => setDraft(changeCustomer(state.draft, { ...customer, ...choice, contact: customer.contact || choice.contact, salutation: "" }, { reference, today, salutations: savedSalutations(ctx.model.all), taxByCustomer: orderTaxByCustomer(ctx.model.all) })),
      })));
    });
    const contact = h("input", { value: customer.contact, placeholder: "聯絡人", "aria-label": "聯絡人", dataset: { lineContact: "" }, onChange: (event) => {
      const value = event.target.value.trim();
      setDraft({ ...state.draft, customer: { ...customer, contact: value, salutation: customer.salutation || salutationFor(value, savedSalutations(ctx.model.all)) } });
    } });
    const salutation = h("input", { value: customer.salutation, placeholder: "例如：郁婷、陳老師", "aria-label": "客戶稱呼", dataset: { lineSalutation: "" }, className: customer.salutation ? "" : "needs-check", onChange: (event) => {
      setDraft({ ...state.draft, customer: { ...customer, salutation: event.target.value.trim() } });
    } });
    return h("section", { className: "card", dataset: { lineCustomer: "" } }, [
      h("div", { className: "section-head" }, [
        h("div", {}, [h("strong", { text: customerDisplayName(draft) || "客戶待確認" }), h("div", { className: "muted", text: customer.customerNo ? `客戶編號 ${customer.customerNo}` : "客戶編號待確認" })]),
        badge(customer.status === "確定" ? "客戶已對應" : "客戶待確認", customer.status === "確定" ? "ok" : "warn"),
      ]),
      h("small", { className: "muted", text: customer.why }),
      customer.status !== "確定" && customer.candidates?.length ? h("div", { className: "chip-group" }, customer.candidates.map((candidate) => h("button", {
        type: "button", className: "small ghost", text: `${candidate.company || ""} ${candidate.contact || ""} #${candidate.customerNo || "—"}`.trim(),
        onClick: () => setDraft(changeCustomer(state.draft, { ...customer, ...candidate, contact: customer.contact || candidate.contact, salutation: "" }, { reference, today, salutations: savedSalutations(ctx.model.all), taxByCustomer: orderTaxByCustomer(ctx.model.all) })),
      }))) : null,
      h("div", { className: "search-box" }, [search]), results,
      (customer.contactChoices || []).length > 1 && !customer.contact ? h("div", { className: "stack" }, [
        h("small", { className: "muted", text: "這位客戶有幾位聯絡人，這次是誰下單？" }),
        h("div", { className: "chip-group", dataset: { lineContactChoices: "" } }, customer.contactChoices.map((name) => h("button", {
          type: "button", className: "small ghost", text: name,
          onClick: () => setDraft({ ...state.draft, customer: { ...customer, contact: name, salutation: salutationFor(name, savedSalutations(ctx.model.all)) } }),
        }))),
      ]) : null,
      h("div", { className: "form-grid" }, [
        h("label", { className: "field" }, [h("span", { className: "field-label", text: "聯絡人" }), contact]),
        h("label", { className: "field" }, [h("span", { className: "field-label", text: "客戶版稱呼（存一次會記住）" }), salutation]),
      ]),
    ]);
  }

  function itemCard(item, index) {
    const candidates = [...new Set([item.code, ...(item.candidates || [])].filter(Boolean))];
    const picker = candidates.length ? h("select", { "aria-label": "料號", dataset: { lineCode: index }, onChange: (event) => editItem(index, { code: event.target.value }) },
      [h("option", { value: "", text: "選擇料號…", selected: !item.code }), ...candidates.map((code) => h("option", { value: code, text: productLabel(reference, code), selected: code === item.code }))]) : null;
    const results = h("div", { className: "picker-results" });
    const search = h("input", { type: "search", placeholder: "搜尋其他料號或品名", "aria-label": "搜尋商品", dataset: { lineProductSearch: index } });
    search.addEventListener("input", () => {
      results.replaceChildren(...productCandidates(search.value, reference, state.draft.customer.customerNo, 6).map((candidate) => h("button", {
        type: "button", className: "small ghost", text: `${productLabel(reference, candidate.code)}${candidate.bought ? `・曾買 ${candidate.bought}` : ""}`,
        onClick: () => editItem(index, { code: candidate.code, candidates: [...new Set([candidate.code, ...(item.candidates || [])])] }),
      })));
    });
    const number = (name, value, label, onChange) => h("label", { className: "field" }, [
      h("span", { className: "field-label", text: label }),
      h("input", { type: "number", min: 0, step: "any", value: value ?? "", dataset: { [name]: index }, className: value === null || value === undefined || value === "" ? "needs-check" : "", onChange }),
    ]);
    const confirmable = item.checks.filter((check) => ["stock", "expiry"].includes(check.field));
    return h("article", { className: `card line-item${item.checks.some((check) => !check.soft) ? " has-checks" : ""}`, dataset: { lineItem: index } }, [
      h("div", { className: "section-head" }, [
        h("strong", { text: `${index + 1}. ${item.said ? `客戶寫「${item.said}」` : "新增品項"}` }),
        h("button", { type: "button", className: "small ghost", text: "移除", dataset: { lineRemove: index }, onClick: () => setDraft({ ...state.draft, items: state.draft.items.filter((_, at) => at !== index) }) }),
      ]),
      h("div", { className: "muted", text: item.code ? `${item.codeStatus === "確定" ? "料號" : "建議料號"}：${productLabel(reference, item.code)}` : "料號待確認" }),
      picker,
      h("div", { className: "search-box" }, [search]), results,
      h("div", { className: "form-grid" }, [
        number("lineQty", item.quantity, "數量", (event) => editItem(index, { quantity: event.target.value === "" ? null : Number(event.target.value) })),
        h("label", { className: "field" }, [h("span", { className: "field-label", text: "單位" }), h("input", { value: item.unit, dataset: { lineUnit: index }, onChange: (event) => editItem(index, { spokenUnit: event.target.value.trim() }) })]),
        number("linePrice", item.unitPrice, "單價（未稅）", (event) => editItem(index, { manualPrice: event.target.value === "" ? null : Number(event.target.value) })),
      ]),
      item.unitPrice !== null ? h("div", { className: "line-tax", dataset: { lineTaxed: index } }, [
        h("span", { text: `含稅單價 ${money(withTax(item.unitPrice))}` }),
        item.quantity ? h("strong", { text: `含稅小計 ${money(itemGross(item))}` }) : null,
        item.quantity ? h("span", { className: "muted", text: `未稅小計 ${money(item.unitPrice * item.quantity)}` }) : null,
      ]) : null,
      h("small", { className: "muted", dataset: { linePriceSource: index }, text: item.priceSource ? `價格來源：${item.priceSource}` : "價格來源：待確認" }),
      checkList(item.checks),
      confirmable.length ? h("div", { className: "chip-group" }, confirmable.map((check) => h("button", { type: "button", className: "small ghost", text: check.field === "stock" ? "庫存已確認" : "效期已確認", onClick: () => editItem(index, { clearCheck: check.field }) }))) : null,
    ]);
  }

  function orderCard(draft) {
    const select = (value, options, label, data, onChange) => h("label", { className: "field" }, [h("span", { className: "field-label", text: label }), h("select", { dataset: data, onChange }, options.map((option) => h("option", { value: option, text: option, selected: option === value })))]);
    const totals = orderTotals(draft.items);
    const inclusive = draft.taxType.value === "含稅";
    // One tap switches every price the customer sees; the choice is remembered for this customer.
    const setTax = (value) => {
      if (draft.taxType.value === value) return;
      setDraft({ ...state.draft, taxType: { value, source: "手動" } });
      rememberTax(ctx.db, ctx.model.all, draft.customer.customerNo, value, requestId("order-tax")).catch(() => {});
    };
    const taxToggle = h("div", { className: "field" }, [
      h("span", { className: "field-label", text: `報價稅別${draft.taxType.source && draft.taxType.source !== "手動" ? `（${draft.taxType.source}）` : ""}` }),
      h("div", { className: "tax-toggle", role: "radiogroup", "aria-label": "報價稅別", dataset: { lineTaxToggle: "" } }, ["未稅", "含稅"].map((value) => h("button", {
        type: "button", role: "radio", "aria-checked": String(draft.taxType.value === value), className: draft.taxType.value === value ? "is-on" : "", dataset: { lineTax: value }, text: value, onClick: () => setTax(value),
      }))),
    ]);
    return h("section", { className: "card", dataset: { lineOrderFields: "" } }, [
      h("div", { className: "form-grid" }, [
        taxToggle,
        select(draft.delivery.value, ["寄送", "自取", "待確認"], `配送方式${draft.delivery.source === "預設" ? "（預設）" : ""}`, { lineDelivery: "" }, (event) => setDraft({ ...state.draft, delivery: { value: event.target.value, source: "手動" } })),
        h("label", { className: "field" }, [h("span", { className: "field-label", text: "出貨時間" }), h("input", { value: draft.shipTime, dataset: { lineShip: "" }, placeholder: "例如：今天寄出、9/4 前到貨", onChange: (event) => setDraft({ ...state.draft, shipTime: event.target.value.trim() }) })]),
      ]),
      h("label", { className: "field" }, [h("span", { className: "field-label", text: "備註（一行一項，例如效期、發票、扣款、先寄部分）" }), h("textarea", { rows: 3, value: draft.notes.join("\n"), dataset: { lineNotes: "" }, onChange: (event) => setDraft({ ...state.draft, notes: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) }) })]),
      h("div", { className: "line-totals", dataset: { lineTotals: "" } }, [
        inclusive ? h("span", { text: `未稅合計 ${money(Math.round(totals.net))}` }) : h("strong", { text: `未稅合計 ${money(Math.round(totals.net))}` }),
        h("span", { text: `稅額 5% ${money(totals.tax)}` }),
        inclusive ? h("strong", { text: `含稅總金額 ${money(totals.gross)}` }) : h("span", { text: `含稅總金額 ${money(totals.gross)}` }),
        h("small", { className: "muted", text: inclusive ? "給客戶的文字用含稅價" : "給客戶的文字用未稅價" }),
        totals.complete ? null : badge(`${totals.missing} 項價格待確認`, "warn"),
      ]),
    ]);
  }

  function outputs(draft) {
    const block = (title, value, data) => h("section", { className: "card", dataset: data }, [
      h("div", { className: "section-head" }, [h("h2", { text: title }), copyButton(() => value, "")]),
      h("pre", { className: "line-output", text: value }),
    ]);
    return h("div", { className: "stack" }, [
      block("給秘書", secretaryText(draft), { lineSecretary: "" }),
      block("給客戶", customerText(draft), { lineCustomerText: "" }),
      block("漲價／定價提醒（只給你看）", priceAlertText(draft), { linePriceAlert: "" }),
    ]);
  }

  async function save() {
    const draft = state.draft;
    const pending = pendingChecks(draft);
    const sheet = LINE_SHEETS[state.sheet];
    const ok = await confirmDialog({
      title: `儲存並寫入「${sheet}」？`,
      body: [
        h("p", { text: `${draft.items.length} 個品項，每個品項寫一列，狀態「待確認」。` }),
        pending.length ? h("div", { className: "warning-banner" }, [h("span", { text: `還有 ${pending.length} 項待確認，會照實寫「待確認」進試算表：` }), h("ul", {}, pending.slice(0, 8).map((check) => h("li", { text: check.text })))]) : null,
      ],
      confirmLabel: "儲存並寫入",
    });
    if (!ok) return;
    const saved = await saveLineOrder(ctx.db, draft, requestId("line-order"));
    if (!saved.ok) { toast("儲存失敗，內容還在畫面上，請再試一次", { tone: "error" }); return; }
    // What the user picked by hand is remembered: next time 「羊血」 for this customer is certain.
    for (const item of draft.items) if (item.codeWhy === "你選定的料號" && item.said) await learnAlias(ctx.db, ctx.db.peekAll(), { said: item.said, code: item.code, customerNo: draft.customer.customerNo }, requestId("order-alias"));
    if (draft.customer.contact && draft.customer.salutation) await saveSalutation(ctx.db, ctx.db.peekAll(), draft.customer.contact, draft.customer.salutation, requestId("order-salutation"));
    const written = await writeOrderToSheet(ctx.db, ctx.transport, { order: saved.order, rows: draftRows(draft, saved.appIds), sheet }, requestId("line-sheet"));
    state.saved = { orderId: saved.order.id, orderNo: saved.order.orderNo, sheet, written: written.ok, message: written.ok ? `已寫入「${sheet}」${written.duplicates ? `（${written.duplicates} 列先前已寫過）` : ""}` : written.message };
    persist(ctx);
    toast(written.ok ? `已存成 ${saved.order.orderNo}，${state.saved.message}` : `已存成 ${saved.order.orderNo}；${written.message}`, { tone: written.ok ? "ok" : "error", timeout: 8000 });
    ctx.rebuild();
    drawDraft();
    drawSaved();
  }

  function drawDraft() {
    const draft = state.draft;
    if (!draft) { draftBox.replaceChildren(); return; }
    const sheetChoice = h("div", { className: "chip-group", role: "radiogroup", dataset: { lineSheetChoice: "" } }, Object.entries(LINE_SHEETS).map(([key, name]) => h("label", { className: "chip" }, [
      h("input", { type: "radio", name: "lineSheet", value: key, checked: state.sheet === key, onChange: () => { state.sheet = key; persist(ctx); } }),
      h("span", { text: key === "test" ? `測試：${name}` : `正式：${name}` }),
    ])));
    const pending = pendingChecks(draft);
    draftBox.replaceChildren(...[
      state.saved ? h("div", { className: state.saved.written ? "info-banner" : "warning-banner", dataset: { lineSavedBanner: "" } }, [
        h("span", { text: `已存成 ${state.saved.orderNo}：${state.saved.message}` }),
        h("button", { type: "button", className: "small", text: "開始新的一筆", onClick: () => { Object.assign(state, { text: "", draft: null, saved: null }); text.value = ""; persist(ctx); drawDraft(); } }),
      ]) : null,
      pending.length ? h("div", { className: "warning-banner", dataset: { linePending: "" } }, [h("span", { text: `${pending.length} 項待確認，黃色的地方請看一下` })]) : null,
      checkList(draft.checks),
      customerCard(draft),
      ...draft.items.map(itemCard),
      h("button", { type: "button", className: "small ghost", dataset: { lineAddItem: "" }, text: "＋ 加一個品項", onClick: () => setDraft({ ...state.draft, items: [...state.draft.items, blankItem(context())] }) }),
      orderCard(draft),
      outputs(draft),
      state.saved ? null : h("section", { className: "card stack" }, [
        h("strong", { text: "寫入哪個分頁" }), sheetChoice,
        h("button", { type: "button", className: "primary", dataset: { lineSave: "" }, text: "儲存並寫入試算表", onClick: save }),
        h("small", { className: "muted", text: "會先存在 App（訂單中心看得到），再寫入試算表；離線時之後可以再補寫。" }),
      ]),
    ].filter(Boolean));
  }

  function drawSaved() {
    const orders = (ctx.model.all.order || []).filter((order) => !order.archivedAt && order.source === "LINE" && sheetState(order))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt))).slice(0, 15);
    if (!orders.length) { savedBox.replaceChildren(h("h2", { text: "最近的 LINE 訂單" }), emptyState("還沒有從這裡建立的訂單")); return; }
    savedBox.replaceChildren(h("h2", { text: "最近的 LINE 訂單" }), h("ul", { className: "task-list" }, orders.map((order) => {
      const sheet = sheetState(order);
      const items = ctx.model.itemsByOrder.get(order.id) || [];
      const step = async (status) => {
        const ok = await confirmDialog({ title: `改成「${status}」？`, body: h("p", { text: `${order.customerName || "（客戶待確認）"}・${items.length} 項。${sheet.written ? `會同時更新「${sheet.sheet}」裡 ${appIdsOf(ctx.model, order.id).length} 列的狀態。` : "這張還沒寫入試算表，只改 App 內的狀態。"}` }), confirmLabel: `確認${status}` });
        if (!ok) return;
        const result = await setLineOrderStatus(ctx.db, ctx.transport, ctx.model, order, status, requestId("line-status"));
        toast(result.ok ? `已改成「${status}」` : result.message, { tone: result.ok ? "ok" : "error", timeout: 7000 });
        ctx.rebuild(); drawSaved();
      };
      return h("li", { className: "task-row", dataset: { lineSavedOrder: order.id } }, [
        h("div", { className: "task-main" }, [
          h("strong", { text: `${order.customerName || "客戶待確認"}・${order.orderNo}` }),
          h("small", { className: "muted", text: [order.orderDate, `${items.length} 項`, sheet.written ? `已寫入 ${sheet.sheet}` : "還沒寫入試算表"].join("・") }),
        ]),
        badge(order.status, order.status === "待確認" ? "warn" : "ok"),
        h("div", { className: "row-actions" }, [
          sheet.written ? null : h("button", { type: "button", className: "small ghost", text: "寫入試算表", onClick: async () => {
            const result = await writeOrderToSheet(ctx.db, ctx.transport, { order, rows: savedOrderRows(ctx.model, order), sheet: LINE_SHEETS[state.sheet] }, requestId("line-sheet-retry"));
            toast(result.ok ? "已寫入" : result.message, { tone: result.ok ? "ok" : "error" });
            ctx.rebuild(); drawSaved();
          } }),
          order.status === "待確認" ? h("button", { type: "button", className: "small primary", dataset: { lineToSecretary: order.id }, text: "已給秘書", onClick: () => step("已給秘書") }) : null,
          order.status === "已給秘書" ? h("button", { type: "button", className: "small primary", dataset: { lineHistoryUpdated: order.id }, text: "已更新購買紀錄", onClick: () => step("已更新購買紀錄") }) : null,
        ]),
      ]);
    })));
  }

  const showReference = (loaded) => {
    const counts = `客戶 ${reference.customerRows.toLocaleString()}・商品 ${reference.productList.length.toLocaleString()}・購買紀錄 ${reference.history.length.toLocaleString()}・LINE 訂單 ${reference.lineOrders.length.toLocaleString()}`;
    refInfo.textContent = loaded.loadedAt ? `${counts}（更新於 ${new Date(loaded.loadedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）`
      : ctx.transport ? "還沒有讀取商品清單與購買紀錄，請按右邊「更新商品與購買紀錄」" : "還沒有讀取商品清單與購買紀錄：這個瀏覽器還沒連上 Google 試算表（更多 → 設定 → 同步中心 →「測試連線」看原因）";
  };
  const refresh = async () => {
    refInfo.textContent = "從試算表讀取商品清單、歷年購買紀錄、LINE 訂單整理…";
    const result = await refreshReference(ctx.db, ctx.transport);
    const loaded = await loadReference(ctx.db);
    reference = loaded.reference;
    showReference(loaded);
    if (!result.ok) {
      refInfo.textContent = `讀取失敗：${result.message}`;
      toast(result.message, { tone: "error", timeout: 10000 });
    }
    if (state.draft) drawDraft();
    drawReorder();
  };

  (async () => {
    const loaded = await loadReference(ctx.db);
    reference = loaded.reference;
    showReference(loaded);
    if (!state.restored) {
      state.restored = true;
      // This tab's own draft; a draft saved before per-tab drafts existed is picked up once.
      const stored = (await ctx.db.getMeta(draftKey(), null)) || (await ctx.db.getMeta(DRAFT_META, null));
      if (stored && !state.text && !state.draft) { Object.assign(state, { text: stored.text || "", draft: stored.draft || null, saved: stored.saved || null, sheet: stored.sheet || "test" }); text.value = state.text; }
    }
    drawDraft();
    drawReorder();
    // Only refresh in the background when already signed in: a sign-in prompt from here
    // would open Google's account window behind the user's back and freeze the tab.
    if (loaded.stale && ctx.transport && ctx.auth?.signedIn?.()) refresh();
  })();
  drawSaved();

  // ---- 常購快速下單 ----------------------------------------------------------------------
  const reorderBox = h("section", { className: "card stack", dataset: { reorder: "" } });
  const reorder = state.reorder;
  if (route?.query?.get("customerNo") && reorder.customer?.customerNo !== route.query.get("customerNo")) {
    Object.assign(reorder, { customer: { customerNo: route.query.get("customerNo"), company: route.query.get("name") || "", contact: "", customerId: route.query.get("customer") || "" }, picks: {}, showAll: false });
  }

  function pickCustomer(choice) {
    Object.assign(reorder, { customer: choice, picks: {}, showAll: false });
    drawReorder();
  }

  function drawReorder() {
    if (state.mode !== "reorder") return;
    const customer = reorder.customer;
    const search = h("input", { type: "search", placeholder: "客戶：公司、聯絡人或客戶編號", "aria-label": "選擇客戶", dataset: { reorderCustomerSearch: "" } });
    const results = h("div", { className: "picker-results" });
    search.addEventListener("input", () => {
      results.replaceChildren(...customerChoices(search.value, { model: ctx.model, reference }).filter((choice) => choice.customerNo).map((choice) => h("button", {
        type: "button", className: "small ghost", dataset: { reorderPick: choice.customerNo }, text: `${[choice.company, choice.contact].filter(Boolean).join(" ")} #${choice.customerNo}`,
        onClick: () => pickCustomer(choice),
      })));
    });
    if (!customer?.customerNo) {
      reorderBox.replaceChildren(h("strong", { text: "先選客戶" }), h("div", { className: "search-box" }, [search]), results,
        h("small", { className: "muted", text: "會列出這位客戶在歷年購買紀錄與 LINE 訂單整理裡買過的品項。" }));
      return;
    }
    if (!customer.company) customer.company = [...(reference.customers.get(customer.customerNo)?.names || [])][0] || "";
    const rows = customerPurchases(reference, customer.customerNo, { today });
    const shown = reorder.showAll ? rows : rows.filter((row) => row.recent);
    const picked = Object.entries(reorder.picks).filter(([, pick]) => pick.checked);
    const last = lastOrder(reference, customer.customerNo);
    const generate = h("button", { type: "button", className: "primary", dataset: { reorderGenerate: "" }, disabled: !picked.length, text: picked.length ? `產生訂單（${picked.length} 項）` : "勾選要訂的品項",
      onClick: () => {
        const picks = picked.map(([code, pick]) => {
          const row = rows.find((item) => item.code === code);
          // Only a price the user changed overrides the latest deal.
          const price = pick.price !== undefined && pick.price !== "" && Number(pick.price) !== row?.lastPrice ? pick.price : null;
          return { code, name: row?.name, quantity: pick.quantity === "" || pick.quantity === undefined ? null : Number(pick.quantity), price };
        });
        state.saved = null;
        setDraft(draftFromPicks({ customer, picks, reference, today, salutations: savedSalutations(ctx.model.all), taxByCustomer: orderTaxByCustomer(ctx.model.all) }));
        draftBox.scrollIntoView?.({ behavior: "smooth", block: "start" });
      } });
    const productSearch = h("input", { type: "search", placeholder: "加入其他商品：料號或品名", "aria-label": "加入其他商品", dataset: { reorderProductSearch: "" } });
    const productResults = h("div", { className: "picker-results" });
    productSearch.addEventListener("input", () => {
      productResults.replaceChildren(...productCandidates(productSearch.value, reference, customer.customerNo, 6).map((candidate) => h("button", {
        type: "button", className: "small ghost", text: productLabel(reference, candidate.code),
        onClick: () => { reorder.picks[candidate.code] = { checked: true, quantity: 1 }; reorder.extra = [...new Set([...(reorder.extra || []), candidate.code])]; drawReorder(); },
      })));
    });
    const extraRows = (reorder.extra || []).filter((code) => !rows.some((row) => row.code === code)).map((code) => ({ code, name: reference.products.get(code)?.name || code, spec: reference.products.get(code)?.spec || "", count: 0, lastDate: "", lastQuantity: null, lastPrice: null, recent: true }));
    const row = (item) => {
      const pick = reorder.picks[item.code] || {};
      const box = h("input", { type: "checkbox", checked: Boolean(pick.checked), "aria-label": `選 ${item.name}`, dataset: { reorderCheck: item.code }, onChange: (event) => {
        reorder.picks[item.code] = { ...pick, checked: event.target.checked, quantity: pick.quantity ?? item.lastQuantity ?? 1 };
        drawReorder();
      } });
      const qty = h("input", { type: "number", min: 0, step: "any", value: pick.quantity ?? item.lastQuantity ?? "", "aria-label": "數量", dataset: { reorderQty: item.code }, onChange: (event) => { reorder.picks[item.code] = { ...reorder.picks[item.code], checked: true, quantity: event.target.value }; drawReorder(); } });
      const price = h("input", { type: "number", min: 0, step: "any", value: pick.price ?? item.lastPrice ?? "", placeholder: "單價（未稅）", "aria-label": "單價（未稅）", dataset: { reorderPrice: item.code }, onChange: (event) => { reorder.picks[item.code] = { ...reorder.picks[item.code], checked: true, price: event.target.value }; drawReorder(); } });
      return h("li", { className: `reorder-row${pick.checked ? " is-picked" : ""}`, dataset: { reorderRow: item.code } }, [
        box,
        h("div", { className: "reorder-main" }, [
          h("strong", { text: `${item.code}｜${item.name}${item.nameZh ? `（${item.nameZh}）` : ""}` }),
          h("small", { className: "muted", text: [item.spec, item.count ? `買過 ${item.count} 次・最近 ${String(item.lastDate).replaceAll("-", "/")}${item.lastQuantity ? ` ×${item.lastQuantity}` : ""}${item.lastPrice !== null ? ` @${item.lastPrice}` : ""}` : "新加入的商品"].filter(Boolean).join("・") }),
        ]),
        h("div", { className: "reorder-inputs" }, [qty, price]),
      ]);
    };
    reorderBox.replaceChildren(
      h("div", { className: "section-head" }, [
        h("div", {}, [h("strong", { text: `${customer.company || "客戶"} #${customer.customerNo}` }), h("div", { className: "muted", text: rows.length ? `買過 ${rows.length} 種品項` : "購買紀錄裡沒有這位客戶" })]),
        h("button", { type: "button", className: "small ghost", text: "換客戶", onClick: () => { reorder.customer = null; drawReorder(); } }),
      ]),
      last.items.length ? h("button", { type: "button", className: "ghost", dataset: { reorderLast: "" }, text: `照上次訂單（${last.date.replaceAll("-", "/")}，${last.items.length} 項）`, onClick: () => {
        reorder.picks = Object.fromEntries(last.items.map((item) => [item.code, { checked: true, quantity: item.quantity ?? 1 }]));
        reorder.showAll = reorder.showAll || last.items.some((item) => !rows.find((row) => row.code === item.code)?.recent);
        drawReorder();
      } }) : null,
      h("ul", { className: "reorder-list" }, [...extraRows, ...shown].map(row)),
      rows.length > shown.length ? h("button", { type: "button", className: "small ghost", dataset: { reorderShowAll: "" }, text: `顯示一年前買過的（還有 ${rows.length - shown.length} 項）`, onClick: () => { reorder.showAll = true; drawReorder(); } }) : null,
      h("div", { className: "search-box" }, [productSearch]), productResults,
      h("div", { className: "button-row" }, [generate]),
    );
  }

  const modeTabs = h("div", { className: "tabs", role: "tablist" }, [["message", "貼上訊息／截圖"], ["reorder", "常購快速下單"]].map(([value, label]) => h("button", {
    type: "button", className: "button small ghost", role: "tab", "aria-selected": String(state.mode === value), dataset: { lineMode: value }, text: label,
    onClick: () => { state.mode = value; ctx.render(); },
  })));

  return h("div", { className: "stack line-order" }, [
    h("header", { className: "page-header" }, [h("div", {}, [h("h1", { text: "LINE 訂單" }), h("p", { text: state.mode === "reorder" ? "常買的品項直接勾選；價格帶這位客戶的最近成交價，可以改。" : "貼上訊息或截圖，系統查客戶、料號與最近成交價；不確定的一律標「待確認」。" })])]),
    modeTabs,
    state.mode === "reorder" ? h("div", { className: "stack" }, [
      h("div", { className: "section-head" }, [refInfo, h("button", { type: "button", className: "small ghost", dataset: { lineRefresh: "" }, text: "更新商品與購買紀錄", onClick: refresh })]),
      reorderBox,
    ]) : h("section", { className: "card stack" }, [
      h("div", { className: "section-head" }, [refInfo, h("button", { type: "button", className: "small ghost", dataset: { lineRefresh: "" }, text: "更新商品與購買紀錄", onClick: refresh })]),
      text,
      h("div", { className: "button-row" }, [
        h("button", { type: "button", className: "primary", dataset: { lineParse: "" }, text: "辨識訂單", onClick: parse }),
        h("button", { type: "button", className: "ghost", dataset: { lineScreenshot: "" }, text: "上傳截圖", onClick: () => imageInput.click() }),
        imageInput,
      ]),
      status,
    ]),
    draftBox,
    savedBox,
  ]);
}

registerPage("line-order", { title: "LINE 訂單", render: renderLineOrder, keepOnDataChange: true });
