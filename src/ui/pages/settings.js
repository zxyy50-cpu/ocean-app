import { requestId } from "../../core/ids.js";
import { areaOptions, canonicalArea } from "../../data/tags.js";
import { DEFAULT_VISIT_OPTIONS, saveSetting } from "../../data/settings.js";
import { field, h, toast } from "../dom.js";
import { registerPage } from "../app.js";
import { pageHeader } from "../shell.js";

const VISIT_GROUP_LABELS = { channels: "拜訪方式", purposes: "拜訪主題", reactions: "客戶反應", results: "這次結果", nextActions: "下一步" };

function areaSection(ctx) {
  const selected = new Set(ctx.settings.myAreas);
  const options = areaOptions(ctx.model.customers, ctx.settings.myAreas);
  const all = [...options.mine, ...options.others].filter((option) => !option.parent);
  const extra = [...selected].filter((area) => !all.some((option) => option.area === area)).map((area) => ({ area, count: 0 }));
  const form = h("form", { className: "card form-card", dataset: { form: "my-areas" } });
  const chips = h("div", { className: "chip-group wrap" }, [...extra, ...all].map((option) => h("label", { className: "chip" }, [
    h("input", { type: "checkbox", name: "myAreas", value: option.area, checked: selected.has(option.area) }),
    h("span", { text: option.count ? `${option.area}・${option.count}` : option.area }),
  ])));
  const custom = h("input", { name: "customArea", placeholder: "其他區域，例如：台南", "aria-label": "新增其他區域" });
  const error = h("p", { className: "field-error", role: "alert", hidden: true });
  form.append(
    h("h2", { text: "我的區域" }),
    h("p", { className: "muted", text: "客戶探索會預設只顯示這些區域；其他區域收合，但搜尋仍找得到。工業區會自動歸到所屬縣市。" }),
    chips,
    h("div", { className: "inline-add" }, [custom]),
    error,
    h("div", { className: "form-actions" }, [h("button", { type: "submit", className: "primary", text: "儲存我的區域" })]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const areas = [...form.querySelectorAll('[name="myAreas"]:checked')].map((input) => input.value);
    if (custom.value.trim()) areas.push(canonicalArea(custom.value));
    const result = await saveSetting(ctx.db, "myAreas", areas, requestId("my-areas"));
    if (!result.ok) { error.hidden = false; error.textContent = result.errors?.myAreas || "儲存失敗"; return; }
    toast("已更新我的區域");
  });
  return form;
}

function visitOptionSection(ctx) {
  const current = ctx.settings.visitOptions;
  const form = h("form", { className: "card form-card", dataset: { form: "visit-options" } });
  const errors = h("p", { className: "field-error", role: "alert", hidden: true });
  form.append(
    h("h2", { text: "拜訪選項" }),
    h("p", { className: "muted", text: "一行一個選項。快速拜訪會依照這裡的順序顯示，常用的放前面。" }),
    h("div", { className: "form-grid" }, Object.entries(VISIT_GROUP_LABELS).map(([group, label]) => field(label, h("textarea", { name: group, rows: 6, value: (current[group] || []).join("\n") })))),
    errors,
    h("div", { className: "form-actions" }, [
      h("button", { type: "button", className: "ghost", text: "恢復建議值", onClick: () => {
        Object.entries(DEFAULT_VISIT_OPTIONS).forEach(([group, values]) => { form.elements[group].value = values.join("\n"); });
      } }),
      h("button", { type: "submit", className: "primary", text: "儲存拜訪選項" }),
    ]),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = Object.fromEntries(Object.keys(VISIT_GROUP_LABELS).map((group) => [group, form.elements[group].value.split("\n")]));
    const result = await saveSetting(ctx.db, "visitOptions", value, requestId("visit-options"));
    if (!result.ok) { errors.hidden = false; errors.textContent = Object.entries(result.errors || {}).map(([group, message]) => `${VISIT_GROUP_LABELS[group]}：${message}`).join("、"); return; }
    errors.hidden = true;
    toast("已更新拜訪選項");
  });
  return form;
}

export function renderSettings(ctx) {
  const extra = settingsExtensions.map((render) => render(ctx)).filter(Boolean);
  return h("div", { className: "stack" }, [pageHeader("設定", "調整我的區域、拜訪選項與同步連線。"), areaSection(ctx), visitOptionSection(ctx), ...extra]);
}

const settingsExtensions = [];
export function registerSettingsSection(render) {
  settingsExtensions.push(render);
}

registerPage("settings", { title: "設定", render: renderSettings, keepOnDataChange: true });
