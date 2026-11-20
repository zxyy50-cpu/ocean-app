import { addProduct } from "../../data/line-orders.js";
import { field, formToObject, h, input, openDialog, showErrors, toast } from "../dom.js";

// 「新增商品」: a product 商品清單 doesn't have yet. Saved to the 「APP新增商品」 tab of the company
// workbook (商品清單 itself is left alone) and usable in orders and quotes right away.
// prefill: { code, name, nameZh, spec, brand, listPrice, unit } — from the message or the purchase history.
export function openAddProduct(ctx, prefill = {}, onSaved = () => {}) {
  return openDialog((close) => {
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "add-product" } });
    const save = h("button", { type: "submit", className: "primary", dataset: { saveProduct: "" }, text: "新增商品" });
    form.append(
      h("h2", { text: "新增商品" }),
      h("p", { className: "muted", text: "會存到試算表的「APP新增商品」分頁（不會改動商品清單），報價和訂單馬上可以用。之後再請維護商品清單的人正式加進去。" }),
      h("p", { className: "field-error", role: "alert", hidden: true, dataset: { formErrors: "" } }),
      h("div", { className: "form-grid" }, [
        field("料號 *", input("code", prefill.code || "", { required: true, autocapitalize: "characters", placeholder: "例如 GIB211693" })),
        field("銷售單位", input("unit", prefill.unit || "", { placeholder: "BOT、BOX、SET…" })),
        field("品名 *", input("name", prefill.name || "", { required: true }), { className: "span-2" }),
        field("中文名稱", input("nameZh", prefill.nameZh || ""), { className: "span-2" }),
        field("規格", input("spec", prefill.spec || "", { placeholder: "例如 500 g /BOT" })),
        field("品牌", input("brand", prefill.brand || "")),
        field("未稅定價", input("listPrice", prefill.listPrice ?? "", { type: "number", min: 0, step: "any", inputmode: "decimal" })),
        field("備註", input("note", prefill.note || ""), { className: "span-2" }),
      ]),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), save]),
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      save.textContent = "存到試算表中…";
      const result = await addProduct(ctx.db, ctx.transport, formToObject(form));
      save.disabled = false;
      save.textContent = "新增商品";
      if (result.errors) { showErrors(form, result.errors); return; }
      if (!result.ok) { toast(result.message, { tone: "error", timeout: 10000 }); return; }
      toast(`已新增 ${result.code}，存在試算表「APP新增商品」`);
      close();
      await onSaved(result.code);
    });
    return form;
  }, { label: "新增商品" });
}

// What the form starts with: the history's name, spec, unit and ERP 訂價 when the code was shipped before.
export function productPrefill(reference, { code = "", said = "" } = {}) {
  const known = code ? reference.products.get(code) : null;
  if (known) return { code, name: known.name, nameZh: known.nameZh, spec: known.spec, brand: known.brand, listPrice: known.listPrice ?? "", unit: known.unit };
  const looksLikeCode = /^[A-Za-z]{2,}[A-Za-z0-9-]*\d[A-Za-z0-9-]*$/.test(String(said).trim());
  return looksLikeCode ? { code: String(said).trim().toUpperCase() } : { code, name: said };
}
