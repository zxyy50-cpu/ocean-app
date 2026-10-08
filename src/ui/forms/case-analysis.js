import { addDays } from "../../core/dates.js";
import { requestId } from "../../core/ids.js";
import { addAction, archiveStakeholder, caseCompleteness, caseRedFlags, ENV_FIELDS, INFLUENCE, opportunityContext, RELATIONS, ROLE_HINTS, ROLES, saveCaseEnv, saveStakeholder, STANCES, vagueness } from "../../data/case-analysis.js";
import { completeReminder } from "../../data/reminders.js";
import { badge, chipGroup, emptyState, field, formToObject, h, input, openDialog, select, showErrors, toast } from "../dom.js";

const FLAG_TONE = { red: "danger", warn: "warn", info: "info" };

function flagsCard(ctx, opportunity) {
  const flags = caseRedFlags(ctx.model, opportunity, ctx.today());
  const percent = caseCompleteness(ctx.model, opportunity);
  return h("section", { className: "card", dataset: { caseFlags: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "最大風險與資訊缺口" }), badge(`案況完整度 ${percent}%`, percent >= 80 ? "ok" : percent >= 50 ? "accent" : "warn")]),
    h("div", { className: "meter" }, [h("i", { style: { width: `${percent}%` } })]),
    flags.length ? h("ul", { className: "task-list", style: { marginTop: "10px" } }, flags.map((flag) => h("li", { className: `task-row${flag.level === "red" ? " warn" : ""}`, dataset: { flag: flag.code } }, [
      h("div", { className: "task-main" }, [h("strong", { text: `${flag.level === "red" ? "★ " : ""}${flag.text}` }), h("span", { text: flag.hint })]),
      badge(flag.level === "red" ? "最大風險" : flag.level === "warn" ? "注意" : "待補", FLAG_TONE[flag.level]),
    ]))) : h("p", { className: "ok-text", style: { marginTop: "10px" }, text: "目前沒有明顯的風險或缺口，照行動計畫推進。" }),
  ]);
}

function envCard(ctx, opportunity) {
  const env = opportunity.caseEnv || {};
  const form = h("form", { className: "card form-card", dataset: { form: "case-env" } }, [
    h("h2", { text: "A　案件環境：這個案子客觀上在什麼狀態" }),
    h("p", { className: "muted", text: "重點不是有沒有寫，而是寫得夠不夠具體。「不確定」也要寫成：不確定什麼、預計何時、由誰確認。" }),
    h("div", { className: "form-grid" }, ENV_FIELDS.map((item) => {
      const area = h("textarea", { name: item.key, rows: 2, value: env[item.key] || "", placeholder: `例：${item.example}` });
      const state = vagueness(env[item.key]);
      return field(item.label, area, { hint: state === "vague" ? "⚠ 太模糊了：" + item.hint : item.hint, className: item.key === "competitors" ? "span-2" : "" });
    })),
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: "儲存案件環境" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await saveCaseEnv(ctx.db, opportunity.id, formToObject(form), requestId("case-env"));
    form.removeAttribute("data-dirty");
    toast(result.ok ? "已儲存案件環境" : "儲存失敗", { tone: result.ok ? "ok" : "error" });
  });
  return form;
}

export function openStakeholderEditor(ctx, opportunity, person = null) {
  const contacts = ctx.model.contactsByCustomer.get(opportunity.customerId) || [];
  const values = person || { role: "使用者", influence: "中", stance: "", relation: "普通" };
  const rid = requestId(person ? "stakeholder-edit" : "stakeholder-create");
  openDialog((close) => {
    const contactPick = select("contactId", [{ value: "", label: "（手動輸入姓名）" }, ...contacts.map((contact) => ({ value: contact.id, label: [contact.name, contact.title].filter(Boolean).join("・") }))], values.contactId || "");
    const name = input("name", values.name || "");
    const title = input("title", values.title || "");
    const roleHint = h("small", { className: "muted", text: ROLE_HINTS[values.role] || "" });
    contactPick.addEventListener("change", () => {
      const contact = contacts.find((item) => item.id === contactPick.value);
      if (contact) { name.value = contact.name; title.value = contact.title || ""; }
    });
    const form = h("form", { className: "sheet-body", novalidate: true, dataset: { form: "stakeholder" } }, [
      h("h2", { text: person ? `編輯 ${person.name}` : "加入關鍵人物" }),
      h("p", { className: "field-error", hidden: true, dataset: { formErrors: "" } }),
      h("div", { className: "form-grid" }, [field("從聯絡人選", contactPick), field("姓名", name), field("職務", title)]),
      h("div", { className: "field", dataset: { field: "role" } }, [h("span", { className: "field-label", text: "角色（同時有多種身分時選主要的，其他寫在備註）" }), chipGroup("role", ROLES, values.role), roleHint]),
      h("div", { className: "field" }, [h("span", { className: "field-label", text: "影響力" }), chipGroup("influence", INFLUENCE, values.influence)]),
      h("div", { className: "field" }, [h("span", { className: "field-label", text: "對此案的看法" }), chipGroup("stance", STANCES, values.stance)]),
      h("div", { className: "field" }, [h("span", { className: "field-label", text: "和我們的關係" }), chipGroup("relation", RELATIONS, values.relation)]),
      h("div", { className: "form-grid" }, [
        field("他個人的好處（Personal Win）", input("personalWin", values.personalWin || "", { placeholder: "例：年底考核要交出降低重工的成績" })),
        field("公司的好處（Company Win）", input("companyWin", values.companyWin || "", { placeholder: "例：放行時間縮短一天、減少客訴" })),
        field("備註", h("textarea", { name: "notes", rows: 2, value: values.notes || "" }), { className: "span-2" }),
      ]),
      h("div", { className: "sheet-actions" }, [h("button", { type: "button", className: "ghost", text: "取消", onClick: close }), h("button", { type: "submit", className: "primary", text: "儲存" })]),
    ]);
    form.addEventListener("change", (event) => { if (event.target.name === "role") roleHint.textContent = ROLE_HINTS[event.target.value] || ""; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = await saveStakeholder(ctx.db, { ...formToObject(form), opportunityId: opportunity.id }, { id: person?.id || null, requestId: `${rid}:${Date.now()}` });
      if (!result.ok) { showErrors(form, result.errors || { _: "儲存失敗" }); return; }
      close();
      toast("已更新關鍵人物");
    });
    return form;
  }, { label: "關鍵人物" });
}

function peopleCard(ctx, opportunity) {
  const { stakeholders } = opportunityContext(ctx.model, opportunity);
  const order = (person) => ROLES.indexOf(person.role);
  return h("section", { className: "card", dataset: { casePeople: "" } }, [
    h("div", { className: "section-head" }, [h("h2", { text: "B　關鍵人物：每個人主觀上站在哪一邊" }), h("button", { type: "button", className: "small primary", dataset: { addStakeholder: "" }, text: "＋ 關鍵人物", onClick: () => openStakeholderEditor(ctx, opportunity) })]),
    stakeholders.length ? h("div", { className: "table-wrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, ["姓名", "角色", "影響力", "看法", "關係", "個人／公司好處", ""].map((label) => h("th", { text: label })))]),
      h("tbody", {}, [...stakeholders].sort((left, right) => order(left) - order(right)).map((person) => h("tr", { dataset: { stakeholder: person.id } }, [
        h("td", {}, [h("strong", { text: person.name }), person.title ? h("div", { className: "muted", text: person.title }) : null]),
        h("td", { text: person.role }),
        h("td", { text: person.influence || "—" }),
        h("td", {}, [person.stance ? badge(person.stance, person.stance === "需要" ? "ok" : person.stance === "不需要" ? "danger" : "neutral") : h("span", { className: "muted", text: "未知" })]),
        h("td", {}, [person.relation ? badge(person.relation, person.relation === "友好" ? "ok" : person.relation === "敵對" ? "danger" : "neutral") : "—"]),
        h("td", {}, [person.personalWin ? h("div", { text: `個人：${person.personalWin}` }) : null, person.companyWin ? h("div", { text: `公司：${person.companyWin}` }) : null, !person.personalWin && !person.companyWin ? h("span", { className: "muted", text: "未填" }) : null]),
        h("td", {}, [h("div", { className: "row-actions" }, [
          h("button", { type: "button", className: "small ghost", text: "編輯", onClick: () => openStakeholderEditor(ctx, opportunity, person) }),
          h("button", { type: "button", className: "small ghost", text: "移除", onClick: async () => { await archiveStakeholder(ctx.db, person.id, requestId("stakeholder-archive")); toast("已移除（可在封存區找回）"); } }),
        ])]),
      ]))),
    ])]) : emptyState("還沒有關鍵人物", "B2B 賣的是「一個決定」給一群人：先找出誰拍板、誰使用、誰把關、誰帶路。"),
  ]);
}

function actionsCard(ctx, opportunity) {
  const { stakeholders, actions } = opportunityContext(ctx.model, opportunity);
  const rid = requestId("case-action");
  const peopleOptions = [{ value: "", label: "（不指定對象）" }, ...stakeholders.map((person) => ({ value: person.contactId || person.id, label: `${person.name}（${person.role}）` }))];
  const form = h("form", { className: "form-grid", novalidate: true, dataset: { form: "case-action" } }, [
    field("行動項目", input("title", "", { placeholder: "例：拜訪廠長做 ROI 簡報" }), { className: "span-2" }),
    field("對象", select("contactId", peopleOptions, "")),
    field("實施方式", input("method", "", { placeholder: "例：用放行時間縮短換算效益" })),
    field("負責人", input("owner", "我")),
    field("期限", input("dueDate", addDays(ctx.today(), 7), { type: "date" })),
    h("p", { className: "field-error span-2", hidden: true, dataset: { formErrors: "" } }),
    h("div", { className: "form-actions span-2" }, [h("button", { type: "submit", className: "primary", text: "加入行動計畫" })]),
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await addAction(ctx.db, { ...formToObject(form), opportunityId: opportunity.id }, `${rid}:${Date.now()}`);
    if (!result.ok) { showErrors(form, result.errors || { _: "儲存失敗" }); return; }
    form.removeAttribute("data-dirty");
    toast("已加入行動計畫，到期會出現在今日");
  });
  const nameOf = (contactId) => stakeholders.find((person) => (person.contactId || person.id) === contactId)?.name || "";
  return h("section", { className: "card form-card", dataset: { caseActions: "" } }, [
    h("h2", { text: "C　後續行動計畫：所以我們下一步做什麼" }),
    h("p", { className: "muted", text: "每個行動都要對準 B 區塊的一個人、寫得出動詞、有負責人與期限。" }),
    actions.length ? h("ul", { className: "task-list" }, [...actions].sort((left, right) => String(left.dueDate).localeCompare(String(right.dueDate))).map((action) => h("li", { className: `task-row${action.dueDate < ctx.today() ? " warn" : ""}`, dataset: { caseAction: action.id } }, [
      h("div", { className: "task-main" }, [h("strong", { text: action.title }), h("span", { text: [nameOf(action.contactId) && `對象：${nameOf(action.contactId)}`, action.method, action.owner && `負責：${action.owner}`].filter(Boolean).join("・") })]),
      h("span", { className: "due", text: action.dueDate }),
      h("div", { className: "row-actions" }, [h("button", { type: "button", className: "small ghost", text: "完成", onClick: async () => { await completeReminder(ctx.db, action.id, requestId("action-done")); toast("已完成"); } })]),
    ]))) : h("p", { className: "muted", text: "還沒有行動計畫。" }),
    form,
  ]);
}

export function caseAnalysisSection(ctx, opportunity) {
  return h("div", { className: "stack", dataset: { caseAnalysis: "" } }, [flagsCard(ctx, opportunity), peopleCard(ctx, opportunity), envCard(ctx, opportunity), actionsCard(ctx, opportunity)]);
}
