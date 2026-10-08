import { cleanText } from "../core/text.js";

// Six axes, scored 1–5 from the customer's point of view (not ours).
export const AXES = Object.freeze([
  { key: "tech", label: "技術", hint: "方法、速度、準確度、認證" },
  { key: "price", label: "價格／付款", hint: "報價、票期彈性、總持有成本" },
  { key: "service", label: "服務團隊", hint: "人力、回應時效、在地支援" },
  { key: "experience", label: "產業經驗", hint: "同業案例、市占" },
  { key: "brand", label: "品牌", hint: "信任門檻、內部好不好交代" },
  { key: "marketing", label: "行銷資源", hint: "教育訓練、研討會、共同發表" },
]);

export const STRATEGIES = Object.freeze({
  frontal: { label: "正面迎擊", when: "客戶痛點強、時程急、我方有優勢", moves: ["以解決方案直接對應核心痛點", "用速度與專業取得主導權", "拿出同業成功案例建立信任"] },
  flank: { label: "側面攻擊", when: "現有評估框架對我方不利、客戶內部意見分歧", moves: ["重新定義需求或評估標準（例如從單價改成總持有成本、放行時間）", "接觸新的部門或決策者，擴大影響圈", "把討論導向我方領先的那一軸"] },
  segment: { label: "專案劃分", when: "競爭激烈、客戶習慣多家採購、我方在特定項目有優勢", moves: ["先從一個項目或一條產線切入", "與現有供應商分工共存", "在切入的項目做出門檻，再擴大"] },
  block: { label: "圍堵防守", when: "既有客戶被搶、對手積極、客戶尚未公開評估", moves: ["用長約、綁服務或整合方案建立黏著度", "強化關係網，讓對手難以滲透"] },
  delay: { label: "延遲戰術", when: "客戶暫無預算或需求、技術尚未成熟", moves: ["持續提供產業資訊、教育客戶需求", "拉長決策週期，等待時機成熟", "先佈局，成為未來需求的首選方案"] },
});

export const STRATEGY_QUESTIONS = Object.freeze([
  { key: "pain", label: "客戶有明確痛點嗎？" },
  { key: "advantage", label: "我方在客戶在意的那一軸有優勢嗎？" },
  { key: "urgent", label: "時程急迫嗎？" },
  { key: "framework", label: "現在的評估方式對我方不利嗎？" },
]);

function score(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
}

export function normalizeCompetition(input = {}) {
  const ours = Object.fromEntries(AXES.map(({ key }) => [key, score(input.ours?.[key] ?? input[`ours.${key}`])]));
  const competitors = [];
  for (let index = 0; index < 3; index += 1) {
    const name = cleanText(input.competitors?.[index]?.name ?? input[`competitor${index}.name`]);
    if (!name) continue;
    const scores = Object.fromEntries(AXES.map(({ key }) => [key, score(input.competitors?.[index]?.scores?.[key] ?? input[`competitor${index}.${key}`])]));
    competitors.push({ name, scores });
  }
  const answers = Object.fromEntries(STRATEGY_QUESTIONS.map(({ key }) => [key, ["yes", "no"].includes(input.answers?.[key] ?? input[`answer.${key}`]) ? (input.answers?.[key] ?? input[`answer.${key}`]) : ""]));
  return { ours, competitors, answers, notes: String(input.notes ?? "").trim() };
}

// The axis with the biggest gap: defend where they lead, attack (make it the criterion) where we lead.
export function gapAnalysis(competition = {}) {
  const ours = competition.ours || {};
  return (competition.competitors || []).map((competitor) => {
    let defend = null;
    let attack = null;
    for (const axis of AXES) {
      const mine = ours[axis.key];
      const theirs = competitor.scores?.[axis.key];
      if (!mine || !theirs) continue;
      const gap = theirs - mine;
      if (gap > 0 && (!defend || gap > defend.gap)) defend = { axis: axis.key, label: axis.label, gap };
      if (gap < 0 && (!attack || -gap > attack.gap)) attack = { axis: axis.key, label: axis.label, gap: -gap };
    }
    return { name: competitor.name, defend, attack };
  });
}

// Pain? → Advantage? → Urgent? → Framework against us?
export function recommendStrategy(answers = {}) {
  if (answers.pain === "no") return { key: "delay", reason: "客戶還沒有明確痛點，硬打只會浪費資源" };
  if (answers.advantage === "no") return { key: answers.framework === "yes" ? "flank" : "segment", reason: answers.framework === "yes" ? "我方沒有優勢、框架也不利：先改變評估標準" : "我方沒有全面優勢：找一個能贏的項目切入，或守住既有關係" };
  if (answers.framework === "yes") return { key: "flank", reason: "我方有優勢但評估方式不利：把標準改成我方領先的那一軸" };
  if (answers.urgent === "yes" && answers.advantage === "yes") return { key: "frontal", reason: "痛點明確、時程急、我方有優勢：直接正面迎擊" };
  if (answers.pain === "yes" && answers.advantage === "yes") return { key: "frontal", reason: "痛點明確且我方有優勢：可以正面推進，同時注意時程" };
  return null;
}

export function saveCompetition(db, opportunityId, input, requestId) {
  return db.update("opportunity", opportunityId, { competition: normalizeCompetition(input) }, requestId);
}
