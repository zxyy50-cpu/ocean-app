import { requestId } from "../../core/ids.js";
import { customerIdentity } from "../../data/model.js";
import { applyProspectPlan, planProspectImport } from "../../data/prospects.js";
import { badge, confirmDialog, h, toast } from "../dom.js";
import { registerDataSection } from "./data.js";

// 資料工具 card: import the 嘉雲高屏 factory/prospect list built on this computer.
function prospectsCard(ctx) {
  const region = h("div", { className: "stack", "aria-live": "polite", dataset: { prospectPreview: "" } });
  const button = h("button", { type: "button", className: "primary", dataset: { loadProspects: "" }, text: "預覽嘉雲高屏工廠與開發名單" });
  button.addEventListener("click", async () => {
    region.replaceChildren(h("p", { className: "muted", text: "整理中…" }));
    let module;
    try { module = await import(`../../../../demo/ocean-explorer-v1/prospects-data.js?t=${Date.now()}`); } catch {
      region.replaceChildren(h("p", { className: "field-error", text: "這台電腦還沒有名單檔，請 Claude 先產生。" }));
      return;
    }
    const plan = planProspectImport(module.PROSPECTS || [], ctx.model);
    const mergeSimilar = new Set();
    const areas = Object.entries(plan.areas).sort((left, right) => right[1] - left[1]);
    const similarList = plan.similar.length ? h("details", { open: true, dataset: { prospectSimilar: "" } }, [
      h("summary", { text: `名稱相近 ${plan.similar.length} 家：預設當新客戶；勾選＝其實是同一家，改成補資料` }),
      h("ul", { className: "task-list" }, plan.similar.map((item, index) => h("li", { className: "task-row" }, [
        h("label", { className: "chip" }, [h("input", { type: "checkbox", dataset: { similarIndex: index }, onChange: (event) => { if (event.target.checked) mergeSimilar.add(index); else mergeSimilar.delete(index); } })]),
        h("div", { className: "task-main" }, [
          h("strong", { text: `${item.prospect.name}（${item.prospect.areaTags[0]}）` }),
          h("small", { className: "muted", text: `可能是：${item.customer.name}・${customerIdentity(ctx.model, item.customer)}` }),
          item.prospect.address ? h("small", { className: "muted", text: `名單地址：${item.prospect.address}` }) : null,
        ]),
      ]))),
    ]) : null;
    const go = h("button", { type: "button", className: "primary", dataset: { confirmProspects: "" }, text: "確認匯入" });
    const progress = h("p", { className: "muted", role: "status" });
    go.addEventListener("click", async () => {
      const total = plan.add.length + plan.similar.length + plan.enrich.length;
      if (!(await confirmDialog({ title: `匯入 ${total} 筆？`, body: h("p", { text: `新增約 ${plan.add.length + plan.similar.length - mergeSimilar.size} 家客戶、替 ${plan.enrich.length + mergeSimilar.size} 家既有客戶補資料。新客戶都標成「未接觸」，不會出現在今天的待辦裡。` }), confirmLabel: "開始匯入" }))) return;
      go.disabled = true;
      const result = await applyProspectPlan(ctx.db, plan, { mergeSimilar, requestId: requestId("prospects"), onProgress: ({ done, total: all }) => { progress.textContent = `匯入中… ${done} / ${all}`; } });
      progress.textContent = `完成：新增 ${result.added} 家、補資料 ${result.enriched} 家、聯絡人 ${result.contacts} 位${result.failed ? `，${result.failed} 筆失敗（資料沒變動，可再按一次）` : ""}`;
      toast(result.failed ? "部分沒有匯入，可再試一次" : "匯入完成", { tone: result.failed ? "error" : "ok" });
      go.disabled = false;
    });
    region.replaceChildren(
      h("ul", { className: "count-list" }, [
        h("li", {}, [h("span", { text: "新增客戶" }), h("strong", { text: String(plan.add.length) })]),
        h("li", {}, [h("span", { text: "替既有客戶補資料（統編、地址、工業區）" }), h("strong", { text: String(plan.enrich.length) })]),
        h("li", {}, [h("span", { text: "名稱相近，請你判斷" }), h("strong", { text: String(plan.similar.length) })]),
        h("li", {}, [h("span", { text: "已有、資料也相同（略過）" }), h("strong", { text: String(plan.unchanged + plan.skipped) })]),
      ]),
      h("div", { className: "tags", dataset: { prospectAreas: "" } }, areas.map(([area, count]) => badge(`${area} ${count}`))),
      similarList,
      h("div", { className: "button-row" }, [go]),
      progress,
    );
  });
  return h("section", { className: "card form-card", dataset: { section: "prospects" } }, [
    h("h2", { text: "匯入嘉雲高屏工廠與開發名單" }),
    h("p", { className: "muted", text: "來源：經濟部「登記工廠名錄」（食品、飲料、藥品、化粧品工廠）＋你的開發名單。有工業區的標工業區，其餘標縣市。匯入前會先列出新增、補資料、相近名稱，確認後才寫入。" }),
    h("div", { className: "button-row" }, [button]),
    region,
  ]);
}

registerDataSection(prospectsCard);
