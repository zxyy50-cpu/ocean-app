import { requestId } from "../../core/ids.js";
import { ARCHIVE_REASONS, archiveCustomer, archiveImpact, createCustomer, duplicateCandidates, impactText, knownAreaLabels, normalizeCustomerInput, statusOptions, saveContact, updateCustomer } from "../../data/customers.js";
import { customerIdentity } from "../../data/model.js";
import { field, formToObject, h, input, openDialog, select, showErrors, toast } from "../dom.js";

function areaPicker(ctx, selected = []) {
  const chosen = new Set(selected);
  const mine = ctx.settings.myAreas || [];
  const known = knownAreaLabels(ctx.model).filter((area) => !mine.includes(area));
  const options = [...new Set([...mine, ...selected, ...known.slice(0, 12)])];
  const extra = selected.filter((area) => !options.includes(area));
  return h("div", { className: "field span-2", dataset: { field: "areaTags" } }, [
    h("span", { className: "field-label", text: "區域標籤（可複選）" }),
    h("div", { className: "chip-group" }, [...options, ...extra].map((area) => h("label", { className: "chip" }, [
      h("input", { type: "checkbox", name: "areaTags", value: area, checked: chosen.has(area) }), h("span", { text: area }),
    ]))),
    h("input", { name: "areaTagsExtra", placeholder: "其他區域，用「、」分隔", "aria-label": "其他區域" }),
  ]);
}

function duplicateNotice(ctx, candidates) {
  if (!candidates.length) return null;
  return h("div", { className: "warning-banner", tabIndex: -1, dataset: { duplicateNotice: "" } }, [
    h("div", {}, [
      h("strong", { text: `可能已有相同客戶（${candidates.length}）` }),
      h("ul", {}, candidates.map((candidate) => h("li", {}, [
        h("a", { href: `#/customer/${encodeURIComponent(candidate.id)}`, target: "_self", text: `${candidate.name}${candidate.customerNo ? `（${candidate.customerNo}）` : ""}` }),
        ` — ${candidate.reasons.join("、")}${candidate.note ? `；${candidate.note}` : ""}`,
        h("div", { className: "muted", text: customerIdentity(ctx.model, ctx.model.customersById.get(candidate.id)) }),
      ]))),
      h("small", { text: "系統不會自動合併。如果是同一家，點上面的名字直接到那位客戶；確認是不同公司再建立。" }),
    ]),
  ]);
}

export function openCustomerEditor(ctx, { customer = null, initial = {}, onSaved } = {}) {
  const isNew = !customer;
  const rid = requestId(isNew ? "customer-create" : "customer-edit");
  const values = customer || { relationStatus: "未接觸", areaTags: [], ...initial };
  return openDialog((close) => {
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "customer" } });
    const noticeSlot = h("div", { dataset: { noticeSlot: "" } });
    const submitButton = h("button", { type: "submit", className: "primary", dataset: { saveCustomer: "" }, text: isNew ? "建立客戶" : "儲存變更" });
    const contactBlock = isNew ? h("fieldset", { className: "form-grid span-2" }, [
      h("legend", { text: "主要聯絡人（可之後再補）" }),
      field("姓名", input("contact.name", "")),
      field("職稱", input("contact.title", "")),
      field("電話", input("contact.phone", "", { inputmode: "tel" })),
      field("手機", input("contact.mobile", "", { inputmode: "tel" })),
      field("Email", input("contact.email", "", { type: "email", inputmode: "email" }), { className: "span-2" }),
    ]) : null;
    form.append(
      h("h2", { text: isNew ? "新增客戶" : `編輯 ${customer.name}` }),
      h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
      noticeSlot,
      h("div", { className: "form-grid" }, [
        field("公司名稱 *", input("name", values.name, { required: true, autocomplete: "organization" }), { className: "span-2" }),
        field("客戶編號", input("customerNo", values.customerNo), { hint: "成交後由 ERP 取得，潛在客戶可先空白" }),
        field("公司電話", input("phone", values.phone, { inputmode: "tel" })),
        field("地址", input("address", values.address, { autocomplete: "street-address" }), { className: "span-2" }),
        areaPicker(ctx, values.areaTags || []),
        field("產業／客群", input("industryTags", (values.industryTags || []).join("、")), { hint: "用「、」分隔，例如：乳品、食品廠" }),
        field("關係狀態", select("relationStatus", statusOptions(values.relationStatus), values.relationStatus)),
        field("備註", h("textarea", { name: "notes", rows: 3, value: values.notes || "" }), { className: "span-2" }),
        contactBlock,
        // Rarely needed for selling; folded so the form stays short (still saved if filled).
        h("details", { className: "span-2", dataset: { moreCustomerFields: "" } }, [
          h("summary", { text: "其他欄位（統編、產品興趣、其他分類，選填）" }),
          h("div", { className: "form-grid" }, [
            field("統編", input("taxId", values.taxId, { inputmode: "numeric", maxlength: 8 })),
            field("產品興趣標籤", input("productTags", (values.productTags || []).join("、"))),
            field("其他分類標籤", input("segmentTags", (values.segmentTags || []).join("、")), { className: "span-2" }),
          ]),
        ]),
      ]),
      h("div", { className: "sheet-actions" }, [
        h("button", { type: "button", className: "ghost", text: "取消", onClick: close }),
        submitButton,
      ]),
    );
    const collect = () => {
      const raw = formToObject(form);
      return { ...raw, areaTags: [...(raw.areaTags || []), ...String(raw.areaTagsExtra || "").split(/[、,，]/)] };
    };
    // Possible duplicates show up while typing; if new ones appear right as the user
    // submits, the first press only reveals them and a second press creates the customer.
    let shownKey = "";
    const candidatesNow = () => duplicateCandidates({ ...normalizeCustomerInput(collect()), id: customer?.id }, ctx.model.customers, ctx.model.contactsByCustomer).slice(0, 5);
    const refreshNotice = () => {
      const candidates = candidatesNow();
      shownKey = candidates.map((candidate) => candidate.id).join(",");
      noticeSlot.replaceChildren(...[duplicateNotice(ctx, candidates)].filter(Boolean));
      submitButton.textContent = isNew ? (candidates.length ? "確認是不同公司，建立客戶" : "建立客戶") : "儲存變更";
      return candidates;
    };
    let typingTimer = null;
    form.elements.name.addEventListener("input", () => { clearTimeout(typingTimer); typingTimer = setTimeout(refreshNotice, 300); });
    ["name", "customerNo", "taxId", "phone"].forEach((name) => form.elements[name].addEventListener("change", refreshNotice));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearTimeout(typingTimer);
      const previousKey = shownKey;
      const candidates = refreshNotice();
      if (isNew && candidates.length && shownKey !== previousKey) {
        noticeSlot.querySelector("[data-duplicate-notice]")?.focus?.();
        noticeSlot.scrollIntoView?.({ block: "nearest" });
        return;
      }
      const raw = collect();
      const contact = isNew ? { name: raw["contact.name"], title: raw["contact.title"], phone: raw["contact.phone"], mobile: raw["contact.mobile"], email: raw["contact.email"] } : null;
      const result = isNew
        ? await createCustomer(ctx.db, raw, { contact, requestId: rid })
        : await updateCustomer(ctx.db, customer.id, raw, { expectedRev: customer.localRev, requestId: `${rid}:${Date.now()}` });
      if (!result.ok) {
        if (result.error === "stale") { showErrors(form, { _: "這筆資料剛剛在別處被修改過，請關閉後重新開啟再編輯。你輸入的內容還在畫面上。" }); return; }
        const more = form.querySelector("[data-more-customer-fields]");
        if (more && result.errors?.taxId) more.open = true;
        showErrors(form, result.errors || { _: "儲存失敗，請再試一次" });
        return;
      }
      close();
      toast(isNew ? "已建立客戶" : "已儲存");
      onSaved?.(result.value);
    });
    setTimeout(() => form.elements.name?.focus?.(), 0);
    return form;
  }, { label: isNew ? "新增客戶" : "編輯客戶" });
}

export function openContactEditor(ctx, customerId, contact = null) {
  const rid = requestId(contact ? "contact-edit" : "contact-create");
  const values = contact || { isPrimary: !(ctx.model.contactsByCustomer.get(customerId) || []).length };
  return openDialog((close) => {
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "contact" } }, [
      h("h2", { text: contact ? `編輯聯絡人 ${contact.name}` : "新增聯絡人" }),
      h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
      h("div", { className: "form-grid" }, [
        field("姓名 *", input("name", values.name)),
        field("職稱", input("title", values.title)),
        field("部門", input("department", values.department)),
        field("電話", input("phone", values.phone, { inputmode: "tel" })),
        field("手機", input("mobile", values.mobile, { inputmode: "tel" })),
        field("Email", input("email", values.email, { type: "email" })),
        h("label", { className: "chip span-2" }, [h("input", { type: "checkbox", name: "isPrimary", checked: Boolean(values.isPrimary) }), h("span", { text: "設為主要聯絡人" })]),
        field("備註", h("textarea", { name: "notes", rows: 2, value: values.notes || "" }), { className: "span-2" }),
      ]),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "儲存" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await saveContact(ctx.db, customerId, formToObject(form), { id: contact?.id || null, expectedRev: contact?.localRev, requestId: `${rid}:${Date.now()}` });
      if (!result.ok) { showErrors(form, result.errors || { _: "儲存失敗" }); return; }
      close();
      toast("已儲存聯絡人");
    });
    return form;
  }, { label: "聯絡人" });
}

export function openArchiveCustomer(ctx, customer, { onDone } = {}) {
  const impact = archiveImpact(ctx.model, customer.id);
  const rid = requestId("customer-archive");
  return openDialog((close) => {
    const form = h("form", { className: "sheet-body", dataset: { form: "archive-customer" } }, [
      h("h2", { text: `封存「${customer.name}」？` }),
      h("p", { text: "封存後不會出現在日常清單與 KPI，但資料完整保留，隨時可以在「封存與復原」找回。" }),
      h("div", { className: "info-banner", dataset: { impact: "" }, text: `會一起隱藏的關聯資料：${impactText(impact)}` }),
      field("封存原因", select("reason", ARCHIVE_REASONS, ARCHIVE_REASONS[0])),
      field("補充說明（選填）", input("note", "")),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "danger", text: "封存客戶" })]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const { reason, note } = formToObject(form);
      const result = await archiveCustomer(ctx.db, ctx.model, customer.id, [reason, note].filter(Boolean).join("：") || "未填寫原因", rid);
      if (!result.ok) { toast("封存失敗，請再試一次", { tone: "error" }); return; }
      close();
      toast(`已封存 ${customer.name}`, { action: h("button", { type: "button", className: "small", text: "復原", onClick: () => ctx.navigate(`archive`) }) });
      onDone?.();
    });
    return form;
  }, { label: "封存客戶" });
}
