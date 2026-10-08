import { searchToolkit } from "../../data/toolkit.js";
import { emptyState, h } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

const state = { query: "", source: "all" };

export function renderToolkit(ctx) {
  const all = ctx.toolkit || [];
  const sources = [...new Set(all.map((item) => item.source).filter(Boolean))];
  const results = h("div", { className: "result-list cards", dataset: { toolkitResults: "" } });
  const draw = () => {
    const found = searchToolkit(all, state.query).filter((item) => state.source === "all" || item.source === state.source);
    results.replaceChildren(...(found.length ? found.slice(0, 120).map((item) => h("article", { className: "card", dataset: { toolkitItem: item.id } }, [
      h("p", { className: "eyebrow", text: [item.source, item.category].filter(Boolean).join("・") }),
      h("h2", { text: item.name }),
      item.pitch ? h("p", { text: `「${item.pitch}」` }) : null,
      item.summary ? h("p", { className: "muted", text: item.summary }) : null,
      item.fabe ? h("dl", { className: "kv fabe", dataset: { fabe: "" } }, [["F 特徵", item.fabe.F], ["A 優勢", item.fabe.A], ["B 客戶利益", item.fabe.B], ["E 證據", item.fabe.E]].flatMap(([label, value]) => [h("dt", { text: label }), h("dd", {}, [value || h("span", { className: "field-error", text: "待補（沒有證據的利益只是業務的說法）" })])])) : null,
      item.objection ? h("details", { dataset: { objection: "" } }, [h("summary", { text: "客戶常見疑慮與回應" }), h("p", { text: `疑慮：${item.objection}` }), item.answer ? h("p", { text: `回應：${item.answer}` }) : null]) : null,
      item.dm ? h("small", { className: "muted", text: `DM／資料：${item.dm}` }) : null,
      item.keywords.length ? h("div", { className: "tags" }, item.keywords.slice(0, 6).map((word) => h("span", { className: "tag", text: word }))) : null,
    ])) : [emptyState(all.length ? "找不到符合的資料" : "裝備庫還是空的", all.length ? "換個關鍵字，例如產品名稱、產業或常見疑問。" : "匯入快照後，產品優勢知識庫與拜訪產品包會出現在這裡。")]));
  };
  const search = h("input", { type: "search", value: state.query, placeholder: "產品、產業、客戶疑慮…", "aria-label": "搜尋裝備庫", dataset: { toolkitSearch: "" } });
  search.addEventListener("input", () => { state.query = search.value; draw(); });
  const chips = h("div", { className: "chip-group" }, [["all", "全部"], ...sources.map((source) => [source, source])].map(([value, label]) => h("label", { className: "chip" }, [
    h("input", { type: "radio", name: "toolkitSource", value, checked: state.source === value, onChange: () => { state.source = value; draw(); } }), h("span", { text: label }),
  ])));
  draw();
  return h("div", { className: "stack" }, [pageHeader("裝備庫", "產品優勢、拜訪產品包與檢驗方案，拜訪前快速複習。"), h("div", { className: "info-banner", text: "講完一段介紹後自問：客戶聽到的是「產品很厲害」，還是「我的問題會被解決」？後者才是 FABE。" }), h("div", { className: "search-box" }, [search]), chips, results]);
}

registerPage("toolkit", { title: "裝備庫", render: renderToolkit });
