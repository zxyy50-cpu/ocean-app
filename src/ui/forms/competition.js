import { requestId } from "../../core/ids.js";
import { AXES, gapAnalysis, recommendStrategy, saveCompetition, STRATEGIES, STRATEGY_QUESTIONS } from "../../data/competition.js";
import { chipGroup, field, formToObject, h, input, select, toast } from "../dom.js";

const SCORE_OPTIONS = [{ value: "", label: "—" }, ...["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }))];

function resultCard(competition) {
  const gaps = gapAnalysis(competition);
  const recommendation = recommendStrategy(competition.answers || {});
  const strategy = recommendation ? STRATEGIES[recommendation.key] : null;
  return h("section", { className: "card", dataset: { competitionResult: "" } }, [
    h("h2", { text: "分析結果" }),
    gaps.length ? h("ul", { className: "task-list" }, gaps.map((gap) => h("li", { className: "task-row", dataset: { gap: gap.name } }, [
      h("div", { className: "task-main" }, [
        h("strong", { text: gap.name }),
        h("span", { text: gap.defend ? `要防守：${gap.defend.label}（對方領先 ${gap.defend.gap} 分）` : "對方沒有明顯領先的一軸" }),
        h("span", { text: gap.attack ? `可攻擊：${gap.attack.label}（我方領先 ${gap.attack.gap} 分）——設法讓它變成客戶的評估標準` : "我方還沒有明顯領先的一軸" }),
      ]),
    ]))) : h("p", { className: "muted", text: "填入至少一家競爭對手的分數後，會找出差距最大的一軸。" }),
    strategy ? h("div", { className: "info-banner", dataset: { strategy: recommendation.key } }, [
      h("strong", { text: `建議打法：${strategy.label}` }),
      h("div", { text: recommendation.reason }),
      h("ul", {}, strategy.moves.map((move) => h("li", { text: move }))),
    ]) : h("p", { className: "muted", text: "回答下面四個問題，會建議採取哪種攻守策略。" }),
  ]);
}

export function competitionSection(ctx, opportunity) {
  const competition = opportunity.competition || { ours: {}, competitors: [], answers: {} };
  const competitors = [0, 1, 2].map((index) => competition.competitors?.[index] || { name: "", scores: {} });
  const header = h("tr", {}, [h("th", { text: "面向" }), h("th", { text: "我方" }), ...competitors.map((competitor, index) => h("th", {}, [input(`competitor${index}.name`, competitor.name, { placeholder: `對手 ${String.fromCharCode(65 + index)}`, "aria-label": `競爭對手 ${index + 1} 名稱` })]))]);
  const rows = AXES.map((axis) => h("tr", { dataset: { axis: axis.key } }, [
    h("td", {}, [h("strong", { text: axis.label }), h("div", { className: "muted", text: axis.hint })]),
    h("td", {}, [select(`ours.${axis.key}`, SCORE_OPTIONS, competition.ours?.[axis.key] ? String(competition.ours[axis.key]) : "", { "aria-label": `我方 ${axis.label}` })]),
    ...competitors.map((competitor, index) => h("td", {}, [select(`competitor${index}.${axis.key}`, SCORE_OPTIONS, competitor.scores?.[axis.key] ? String(competitor.scores[axis.key]) : "", { "aria-label": `對手 ${index + 1} ${axis.label}` })])),
  ]));
  const form = h("form", { className: "card form-card", dataset: { form: "competition" } }, [
    h("h2", { text: "六維競爭分析：找出我方能贏的那一軸" }),
    h("p", { className: "muted", text: "分數來自「客戶的認知」，不是我們自己的認知。還不知道對手是誰之前，先別急著降價或加碼。" }),
    h("div", { className: "table-wrap" }, [h("table", {}, [h("thead", {}, [header]), h("tbody", {}, rows)])]),
    h("h3", { text: "攻守策略判斷" }),
    ...STRATEGY_QUESTIONS.map((question) => h("div", { className: "field", dataset: { question: question.key } }, [h("span", { className: "field-label", text: question.label }), chipGroup(`answer.${question.key}`, [{ value: "yes", label: "是" }, { value: "no", label: "否" }], competition.answers?.[question.key] || "")])),
    field("競爭情報備註", h("textarea", { name: "notes", rows: 3, value: competition.notes || "", placeholder: "例：使用者說 3M 偶爾偽陽性；上次採購是採購主導、三週決定" })),
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: "儲存並分析" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveCompetition(ctx.db, opportunity.id, formToObject(form), requestId("competition"));
    form.removeAttribute("data-dirty");
    toast(result.ok ? "已更新競爭分析" : "儲存失敗", { tone: result.ok ? "ok" : "error" });
  });
  return h("div", { className: "stack", dataset: { competitionSection: "" } }, [resultCard(competition), form]);
}
