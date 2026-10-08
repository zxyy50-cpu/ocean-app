import { formatShortDate } from "../core/dates.js";

// Splits a visit note into its 【heading】 sections; text before the first heading is "intro".
export function parseSections(note = "") {
  const sections = [];
  let current = { heading: "intro", lines: [] };
  for (const line of String(note).split("\n")) {
    const match = line.match(/^\s*【([^】]+)】\s*(?:（[^）]*）)?\s*(.*)$/);
    if (match) {
      if (current.lines.join("").trim() || current.heading !== "intro") sections.push(current);
      current = { heading: match[1].trim(), lines: match[2] ? [match[2]] : [] };
    } else current.lines.push(line);
  }
  sections.push(current);
  return sections.map((section) => ({ heading: section.heading, text: section.lines.join("\n").trim() })).filter((section) => section.text);
}

const BUCKETS = [
  { key: "challenge", title: "一、貴司目前面臨的挑戰", match: ["需求", "P 問題", "客戶疑問", "不處理的影響", "品質", "時間", "成本"] },
  { key: "cause", title: "二、挑戰發生的原因", match: ["為什麼是現在", "I 影響", "決策者"] },
  { key: "current", title: "三、目前的做法", match: ["目前使用", "S 現況", "競品", "原供應商"] },
  { key: "proposal", title: "四、我們建議的方案", match: ["N 價值", "創新", "預算與時程"] },
  { key: "next", title: "五、後續關注的事項與時程", match: ["下一步", "誰一起決定"] },
];

function bucketFor(heading) {
  return BUCKETS.find((bucket) => bucket.match.some((word) => heading.includes(word)))?.key || null;
}

export function buildLou({ activity, customer, contact = null, opportunity = null, actions = [], senderName = "Ocean" }) {
  const filled = Object.fromEntries(BUCKETS.map(({ key }) => [key, []]));
  for (const section of parseSections(activity.detailedNote)) {
    const key = section.heading === "intro" ? "challenge" : bucketFor(section.heading);
    if (key) filled[key].push(section.text);
  }
  if (!filled.proposal.length && opportunity) filled.proposal.push(`${opportunity.product || opportunity.name}${opportunity.notes ? `\n${opportunity.notes}` : ""}`);
  const nextLines = [
    ...actions.filter((action) => action.status !== "完成").map((action) => `・${action.title}${action.owner ? `（${action.owner}）` : ""}${action.dueDate ? `，預計 ${formatShortDate(action.dueDate)} 前` : ""}`),
    activity.nextAction ? `・${activity.nextAction}${activity.nextFollowUpDate ? `，預計 ${formatShortDate(activity.nextFollowUpDate)}` : ""}` : null,
  ].filter(Boolean);
  filled.next.push(...nextLines);
  const missing = BUCKETS.filter(({ key }) => !filled[key].length).map(({ title }) => title.replace(/^.、/, ""));
  const greeting = `${contact?.name ? `${contact.name} 您好` : "您好"}：`;
  const subject = `【會議記錄】${customer?.name || ""}${opportunity ? `｜${opportunity.name}` : ""}（${activity.activityDate || ""}）`;
  const body = [
    greeting,
    "",
    `感謝您 ${activity.activityDate ? formatShortDate(activity.activityDate) : ""} 撥冗討論。以下整理這次聽到的重點與後續安排，方便您向內部說明；若有理解不正確的地方，請直接指正。`,
    "",
    ...BUCKETS.flatMap(({ key, title }) => [title, filled[key].length ? filled[key].join("\n") : "（請補充）", ""]),
    "如有任何問題，歡迎隨時與我聯繫。",
    "",
    senderName,
  ].join("\n");
  return { subject, body, missing, to: contact?.email || "" };
}

export function mailtoHref({ to = "", subject = "", body = "" }) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
