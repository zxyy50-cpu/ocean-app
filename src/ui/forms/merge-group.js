import { requestId } from "../../core/ids.js";
import { mergeCustomers, mergeImpact, impactLabel, mergePreview } from "../../data/merge.js";
import { customerIdentity } from "../../data/model.js";
import { h, openDialog, toast } from "../dom.js";

function score(model, customer) {
  const count = (map) => (map.get(customer.id) || []).length;
  return (customer.customerNo ? 100 : 0) + count(model.activitiesByCustomer) * 5 + count(model.opportunitiesByCustomer) * 5 + count(model.ordersByCustomer) + count(model.contactsByCustomer);
}

// One screen for a group of same-name customers: pick the one to keep, tick the ones to fold in.
// Records with a different customer number start unticked (often a different plant).
export function openMergeGroupDialog(ctx, customers, { onDone } = {}) {
  const members = [...customers].sort((left, right) => score(ctx.model, right) - score(ctx.model, left));
  let keepId = members[0].id;
  const fold = new Set(members.slice(1).filter((customer) => !(customer.customerNo && members[0].customerNo && customer.customerNo !== members[0].customerNo)).map((customer) => customer.id));
  return openDialog((close) => {
    const list = h("ul", { className: "merge-members", dataset: { mergeGroupList: "" } });
    const submit = h("button", { type: "submit", className: "primary", dataset: { mergeGroupConfirm: "" } });
    const draw = () => {
      const keep = members.find((customer) => customer.id === keepId);
      submit.textContent = fold.size ? `合併 ${fold.size} 筆到保留的那筆` : "沒有勾選要併入的";
      submit.disabled = !fold.size;
      list.replaceChildren(...members.map((customer) => {
        const differentNo = customer.id !== keepId && customer.customerNo && keep.customerNo && customer.customerNo !== keep.customerNo;
        return h("li", { className: "merge-member", dataset: { mergeMember: customer.id } }, [
          h("div", { className: "merge-member-main" }, [
            h("strong", { text: customer.name }),
            h("small", { className: "muted", text: customerIdentity(ctx.model, customer) }),
            customer.id === keepId ? null : h("small", { className: "muted", text: `會搬過去：${impactLabel(mergeImpact(ctx.model.all, customer.id))}` }),
            differentNo ? h("small", { className: "field-error", text: "客戶編號不同，可能是不同廠區，確定是同一家再勾" }) : null,
          ]),
          h("div", { className: "merge-member-choices" }, [
            h("label", { className: "chip" }, [h("input", { type: "radio", name: "keep", checked: customer.id === keepId, dataset: { keep: customer.id }, onChange: () => { keepId = customer.id; fold.delete(customer.id); draw(); } }), h("span", { text: "保留這筆" })]),
            customer.id === keepId ? null : h("label", { className: "chip" }, [h("input", { type: "checkbox", checked: fold.has(customer.id), dataset: { fold: customer.id }, onChange: (event) => { if (event.target.checked) fold.add(customer.id); else fold.delete(customer.id); draw(); } }), h("span", { text: "併入保留的那筆" })]),
          ]),
        ]);
      }));
    };
    const form = h("form", { className: "sheet-body", dataset: { form: "merge-group" } }, [
      h("h2", { text: `整理同名客戶（${members.length} 筆）` }),
      h("p", { className: "muted", text: "選一筆保留，勾選要併入的。保留那筆已有的資料不會被覆蓋，只補上空白欄位；每一筆合併都能在「封存與復原 → 合併紀錄」取消。" }),
      list,
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), submit]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      let merged = 0;
      for (const id of fold) {
        const preview = mergePreview(ctx.db.peekAll(), keepId, id);
        if (!preview.ok) continue;
        const result = await mergeCustomers(ctx.db, { primaryId: keepId, secondaryId: id, selections: preview.defaults }, requestId(`merge-group-${id}`));
        if (result.ok) merged += 1;
      }
      close();
      toast(merged === fold.size ? `已合併 ${merged} 筆，可在合併紀錄取消` : `合併了 ${merged} / ${fold.size} 筆，其餘沒有變動`, { tone: merged === fold.size ? "ok" : "error", timeout: 7000 });
      onDone?.(keepId);
    });
    draw();
    return form;
  }, { label: "整理同名客戶" });
}
