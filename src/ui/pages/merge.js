import { requestId } from "../../core/ids.js";
import { impactLabel, mergeCustomers, mergePreview, undoMerge } from "../../data/merge.js";
import { confirmDialog, emptyState, h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

function display(value) {
  return Array.isArray(value) ? value.join("、") : String(value ?? "");
}

export function renderMerge(ctx, route) {
  const primaryId = route.query.get("primary") || "";
  const secondaryId = route.query.get("secondary") || "";
  const preview = mergePreview(ctx.model.all, primaryId, secondaryId);
  if (!preview.ok) return h("div", { className: "stack" }, [pageHeader("合併客戶"), h("section", { className: "card" }, [emptyState(preview.error, "", h("a", { className: "button", href: "#/archive?view=duplicates", text: "回到重複檢查" }))])]);
  const { primary, secondary } = preview;
  const rid = requestId("merge");
  const form = h("form", { className: "stack", dataset: { form: "merge" } });
  const rows = preview.fields.map((item) => h("div", { className: `compare-row${item.differs ? " diff" : ""}`, dataset: { mergeField: item.field } }, [
    h("span", { className: "field-name", text: item.label }),
    h("label", {}, [h("input", { type: "radio", name: item.field, value: "primary", checked: preview.defaults[item.field] === "primary", disabled: !item.differs }), h("span", { text: display(item.primary) || "（空白）" })]),
    h("label", {}, [h("input", { type: "radio", name: item.field, value: "secondary", checked: preview.defaults[item.field] === "secondary", disabled: !item.differs }), h("span", { text: display(item.secondary) || "（空白）" })]),
  ]));
  form.append(
    pageHeader("合併客戶", "先比較兩邊資料，確認後才會合併。合併後可以在封存區完整取消。", [
      h("a", { className: "button ghost", href: `#/merge?primary=${encodeURIComponent(secondary.id)}&secondary=${encodeURIComponent(primary.id)}`, dataset: { swap: "" }, text: "⇄ 對調主要客戶" }),
    ]),
    h("section", { className: "card" }, [
      h("div", { className: "compare-row" }, [h("span", {}), h("strong", { text: `保留：${primary.name}` }), h("strong", { text: `併入後封存：${secondary.name}` })]),
      h("div", { className: "compare-row" }, [h("span", { className: "field-name", text: "目前關聯" }), h("span", { text: impactLabel(preview.primaryImpact) }), h("span", { text: impactLabel(preview.impact) })]),
      h("p", { className: "muted", text: "有差異的欄位以底色標示，請選擇要保留哪一邊。區域、產業與產品標籤會合併保留兩邊；被併入的公司名稱會加入別名，搜尋仍找得到。" }),
      h("div", { className: "compare" }, rows),
    ]),
    h("div", { className: "info-banner", dataset: { mergeImpact: "" }, text: `合併後，「${secondary.name}」的 ${impactLabel(preview.impact)} 會移到「${primary.name}」，「${secondary.name}」進入封存區。` }),
    primary.customerNo && secondary.customerNo && primary.customerNo !== secondary.customerNo ? h("div", { className: "warning-banner", text: `兩邊客戶編號不同（${primary.customerNo} / ${secondary.customerNo}），可能是同集團的不同據點。若 ERP 上是兩個客戶，建議不要合併。` }) : null,
    h("div", { className: "form-actions" }, [h("a", { className: "button ghost", href: `#/customer/${encodeURIComponent(primary.id)}`, text: "取消" }), h("button", { type: "submit", className: "danger", dataset: { confirmMerge: "" }, text: "確認合併" })]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selections = Object.fromEntries(preview.fields.filter((item) => item.differs).map((item) => [item.field, form.querySelector(`[name="${item.field}"]:checked`)?.value || "primary"]));
    const ok = await confirmDialog({ title: `把「${secondary.name}」合併到「${primary.name}」？`, body: h("p", { text: `會移動 ${impactLabel(preview.impact)}。之後可在封存區取消合併。` }), confirmLabel: "合併", tone: "danger" });
    if (!ok) return;
    const result = await mergeCustomers(ctx.db, { primaryId: primary.id, secondaryId: secondary.id, selections }, rid);
    if (!result.ok) { toast(result.message || "合併失敗，資料沒有任何變更", { tone: "error" }); return; }
    ctx.navigate(`customer/${encodeURIComponent(primary.id)}`);
    toast(`已合併，移動 ${result.value.moved} 筆關聯資料`, { timeout: 8000, action: h("button", { type: "button", className: "small", text: "取消合併", onClick: async () => {
      const undone = await undoMerge(ctx.db, result.value.eventId, requestId("unmerge"));
      toast(undone.ok ? "已取消合併" : undone.message || "取消失敗", { tone: undone.ok ? "ok" : "error" });
    } }) });
  });
  return form;
}

registerPage("merge", { title: "合併客戶", render: renderMerge });
