import { PREP_QUESTIONS, PROMPT_GROUPS } from "./activities.js";
import { caseRedFlags, opportunityContext } from "./case-analysis.js";
import { lastActivity } from "./model.js";
import { PRICE_QUESTIONS } from "./objections.js";
import { recommendToolkit } from "./toolkit.js";

const strip = (text) => String(text || "").replace(/^【[^】]*】/, "").replace(/（[^）]*）/g, "").trim();
const questionOf = (prompt) => (String(prompt.text).match(/（([^）]+)）/) || [])[1] || strip(prompt.text);

// Questions worth asking at this stage of the case (from the consultative selling course).
function suggestedQuestions(opportunity, lastReaction) {
  const group = (id) => PROMPT_GROUPS.find((item) => item.id === id)?.prompts || [];
  const spin = group("spin");
  const root = group("root");
  let list;
  if (!opportunity || opportunity.stage === "接觸") list = [spin[0], spin[1], root[0]];
  else if (opportunity.stage === "提案") list = [spin[2], spin[3], root[2]];
  else list = [root[2], root[1], spin[3]];
  const questions = list.filter(Boolean).map(questionOf);
  if (lastReaction === "價格考量") questions.unshift(...PRICE_QUESTIONS.slice(0, 2).map((item) => item.question));
  return [...new Set(questions)].slice(0, 4);
}

// Everything worth knowing in the 30 seconds before walking in.
export function buildPrep(model, customerId, { opportunityId = "", today, toolkit = [] } = {}) {
  const customer = model.customersById.get(customerId);
  if (!customer) return null;
  const open = (model.opportunitiesByCustomer.get(customerId) || []).filter((opportunity) => ["接觸", "提案", "議價"].includes(opportunity.stage));
  const opportunity = (opportunityId && model.opportunitiesById.get(opportunityId)) || (open.length === 1 ? open[0] : null)
    || [...open].sort((left, right) => (Number(right.amount) || 0) - (Number(left.amount) || 0))[0] || null;
  const last = lastActivity(model, customerId);
  const people = opportunity ? opportunityContext(model, opportunity).stakeholders : [];
  const flags = opportunity ? caseRedFlags(model, opportunity, today).filter((flag) => flag.level !== "info").slice(0, 2) : [];
  const previousPrep = (model.activitiesByCustomer.get(customerId) || []).find((activity) => activity.prep)?.prep || {};
  return {
    customer,
    opportunity,
    otherOpportunities: open.filter((item) => item.id !== opportunity?.id),
    last,
    promised: customer.nextAction || last?.nextAction || opportunity?.nextAction || "",
    people,
    contacts: people.length ? [] : (model.contactsByCustomer.get(customerId) || []).slice(0, 4),
    flags,
    questions: suggestedQuestions(opportunity, last?.reaction),
    materials: recommendToolkit(customer, toolkit).slice(0, 2),
    prepQuestions: PREP_QUESTIONS,
    previousPrep,
  };
}
