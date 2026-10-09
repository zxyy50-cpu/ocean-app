import { daysBetween } from "../../core/dates.js";
import { createDraftStore } from "../../data/drafts.js";
import { buildPrep } from "../../data/prep.js";
import { opportunityTitle } from "../../data/products.js";
import { badge, emptyState, field, h, input, money } from "../dom.js";
import { registerPage } from "../app.js";
import { captureDraftKey } from "./capture.js";
import { quickContact } from "../pages/customer.js";

function block(title, children, data) {
  return h("section", { className: "card prep-block", dataset: { prep: data } }, [h("h2", { text: title }), ...[].concat(children).filter(Boolean)]);
}

// The card to read in the car: what was said last time, who matters, what to walk out
// with, and what to ask. The three answers ride along into the record after the visit.
export function renderPrep(ctx, route) {
  const prep = buildPrep(ctx.model, route.id, { opportunityId: route.query.get("opportunity") || "", today: ctx.today(), toolkit: ctx.toolkit || [] });
  if (!prep) return emptyState("找不到這位客戶", "", h("a", { className: "button primary", href: "#/search", text: "搜尋客戶" }));
  const { customer, opportunity, last } = prep;
  const drafts = (ctx.drafts ||= createDraftStore(ctx.db));
  const answers = h("form", { className: "stack", dataset: { form: "prep" } }, prep.prepQuestions.map((question) => field(question.label, input(`prep.${question.key}`, prep.previousPrep[question.key] && question.key !== "commitment" ? prep.previousPrep[question.key] : "", { placeholder: question.key === "commitment" ? "例如：約好試用日期與決策時間" : "" }))));
  const start = async () => {
    const values = Object.fromEntries([...answers.elements].filter((element) => element.name).map((element) => [element.name, element.value]));
    const key = captureDraftKey(customer.id);
    const existing = (await drafts.get(key)) || {};
    await drafts.save(key, { ...existing, prep: { ...(existing.prep || {}), ...values } });
    ctx.navigate(`capture?customer=${encodeURIComponent(customer.id)}${opportunity ? `&opportunity=${encodeURIComponent(opportunity.id)}` : ""}`);
  };

  return h("div", { className: "stack prep" }, [
    h("header", { className: "page-header" }, [h("div", {}, [
      h("p", { className: "eyebrow" }, [h("a", { href: `#/customer/${encodeURIComponent(customer.id)}`, text: customer.name })]),
      h("h1", { text: "拜訪前準備" }),
      opportunity ? h("p", { text: `${opportunityTitle(opportunity, 30)}・${opportunity.stage}${opportunity.amount ? `・${money(opportunity.amount)}` : ""}` }) : h("p", { className: "muted", text: "沒有進行中的商機" }),
    ])]),
    quickContact(ctx, customer),
    block("上次聊到", [
      last ? h("p", {}, [h("strong", { text: `${last.activityDate}（${daysBetween(last.activityDate, ctx.today())} 天前）${last.channel ? `・${last.channel}` : ""}` }), h("br"), String(last.detailedNote || last.summary || "").slice(0, 160)]) : h("p", { className: "muted", text: "還沒有紀錄，這是第一次。" }),
      prep.promised ? h("p", { dataset: { promised: "" } }, ["上次說好：", h("strong", { text: prep.promised })]) : null,
    ], "last"),
    block("誰在場、站在哪邊", prep.people.length
      ? h("ul", { className: "result-rows" }, prep.people.map((person) => h("li", {}, [h("strong", { text: `${person.name}${person.title ? `（${person.title}）` : ""}` }), h("small", { className: "muted", text: [person.role, person.stance ? `看法：${person.stance}` : "看法未知", person.relation].filter(Boolean).join("・") })])))
      : [h("p", { className: "muted", text: prep.contacts.length ? `聯絡人：${prep.contacts.map((contact) => contact.name).join("、")}。還沒標記誰拍板、誰使用。` : "還不知道會見到誰。" }), opportunity ? h("a", { className: "small", href: `#/opportunity/${encodeURIComponent(opportunity.id)}?tab=case`, text: "標記關鍵人物 →" }) : null],
    "people"),
    prep.flags.length ? block("這個案子最大的缺口", h("ul", {}, prep.flags.map((flag) => h("li", {}, [h("strong", { text: flag.text }), h("div", { className: "muted", text: flag.hint })]))), "flags") : null,
    block("可以問", h("ol", {}, prep.questions.map((question) => h("li", { text: question }))), "questions"),
    prep.materials.length ? block("可以帶的資料", h("ul", {}, prep.materials.map((item) => h("li", {}, [h("strong", { text: item.name }), item.pitch ? h("div", { className: "muted", text: item.pitch }) : null]))), "materials") : null,
    block("進門前回答三題", [answers, h("small", { className: "muted", text: "答案會帶到拜訪後的記錄裡。" })], "answers"),
    h("div", { className: "sticky-actions" }, [badge(customer.customerNo ? `#${customer.customerNo}` : "無客戶編號"), h("button", { type: "button", className: "primary", dataset: { startCapture: "" }, text: "拜訪完，開始記錄", onClick: start })]),
  ]);
}

registerPage("prep", { title: "拜訪前準備", render: renderPrep, keepOnDataChange: true });
