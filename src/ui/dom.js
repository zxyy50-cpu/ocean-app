export function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/["\\\]\[]/g, "\\$&");
}

// Tiny DOM builder: h("div", { className, onClick, dataset }, children).
// Text always goes through textContent, so record values can never inject HTML.
export function h(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "className") element.className = value;
    else if (key === "text") element.textContent = String(value);
    else if (key === "dataset") Object.entries(value).forEach(([name, data]) => { if (data !== undefined && data !== null) element.dataset[name] = String(data); });
    else if (key === "style" && typeof value === "object") Object.assign(element.style, value);
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value" && "value" in element) element.value = value;
    else if (key === "checked" || key === "selected" || key === "disabled" || key === "hidden" || key === "required" || key === "open") element[key] = Boolean(value);
    else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of [].concat(children ?? [])) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function money(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return `NT$ ${Math.round(Number(value)).toLocaleString("zh-TW")}`;
}

export function shortMoney(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(number >= 1000000 ? 0 : 1)} 萬`;
  return number.toLocaleString("zh-TW");
}

export function formToObject(form) {
  const result = {};
  for (const element of form.elements) {
    if (!element.name || element.disabled) continue;
    if (element.type === "checkbox") {
      if (form.querySelectorAll(`[name="${element.name}"]`).length > 1) {
        result[element.name] = result[element.name] || [];
        if (element.checked) result[element.name].push(element.value);
      } else if (element.value && element.value !== "on") result[element.name] = element.checked ? element.value : "";
      else result[element.name] = element.checked;
    } else if (element.type === "radio") {
      if (element.checked) result[element.name] = element.value;
      else if (!(element.name in result)) result[element.name] = "";
    } else result[element.name] = element.value;
  }
  return result;
}

export function field(label, control, { error = "", hint = "", className = "" } = {}) {
  if (error) control.setAttribute("aria-invalid", "true");
  return h("label", { className: `field ${className}`.trim(), dataset: { field: control.name || "" } }, [
    h("span", { className: "field-label", text: label }),
    control,
    hint && !error ? h("small", { className: "field-hint", text: hint }) : null,
    error ? h("small", { className: "field-error", role: "alert", text: error }) : null,
  ]);
}

// Shows validation messages next to their fields without touching typed values.
export function showErrors(form, errors = {}) {
  form.querySelectorAll(".field-error[data-generated]").forEach((node) => node.remove());
  form.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  const summary = form.querySelector("[data-form-errors]");
  const messages = [];
  for (const [name, message] of Object.entries(errors)) {
    const control = form.elements?.[name] instanceof Element ? form.elements[name] : form.querySelector(`[name="${cssEscape(name)}"]`);
    const wrapper = control?.closest?.(".field") || form.querySelector(`[data-field="${cssEscape(name)}"]`);
    if (control?.setAttribute) control.setAttribute("aria-invalid", "true");
    if (wrapper) wrapper.append(h("small", { className: "field-error", role: "alert", dataset: { generated: "" }, text: message }));
    else messages.push(message);
  }
  if (summary) {
    summary.hidden = !Object.keys(errors).length;
    summary.textContent = Object.keys(errors).length ? (messages.length ? messages.join("、") : "請修正標示的欄位，已輸入的內容都還在。") : "";
  }
  const first = form.querySelector('[aria-invalid="true"]');
  first?.focus?.();
}

export function input(name, value = "", attrs = {}) {
  return h("input", { name, value: value ?? "", ...attrs });
}

export function select(name, options = [], selected = "", attrs = {}) {
  return h("select", { name, ...attrs }, options.map((option) => {
    const value = typeof option === "object" ? option.value : option;
    const label = typeof option === "object" ? option.label : option;
    return h("option", { value, text: label, selected: String(value) === String(selected ?? "") });
  }));
}

export function chipGroup(name, options = [], selected = "", { multiple = false } = {}) {
  const chosen = new Set([].concat(selected || []).map(String));
  return h("div", { className: "chip-group", role: multiple ? "group" : "radiogroup" }, options.map((option) => {
    const value = typeof option === "object" ? option.value : option;
    const label = typeof option === "object" ? option.label : option;
    return h("label", { className: "chip" }, [
      h("input", { type: multiple ? "checkbox" : "radio", name, value, checked: chosen.has(String(value)) }),
      h("span", { text: label }),
    ]);
  }));
}

export function emptyState(title, detail = "", action = null) {
  return h("div", { className: "empty" }, [h("strong", { text: title }), detail ? h("p", { text: detail }) : null, action]);
}

export function badge(text, tone = "neutral") {
  return h("span", { className: `badge badge-${tone}`, text });
}

export function toast(message, { tone = "ok", action = null, timeout = 4000 } = {}) {
  let region = document.getElementById("toast-region");
  if (!region) {
    region = h("div", { id: "toast-region", className: "toast-region", role: "status", "aria-live": "polite" });
    document.body.append(region);
  }
  const item = h("div", { className: `toast toast-${tone}` }, [h("span", { text: message }), action]);
  region.append(item);
  if (timeout) setTimeout(() => item.remove(), timeout);
  return item;
}

export function openDialog(content, { label = "對話框", onClose } = {}) {
  const dialog = h("dialog", { className: "sheet", "aria-label": label });
  const close = () => { if (dialog.open && typeof dialog.close === "function") dialog.close(); dialog.remove(); onClose?.(); };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  append(dialog, typeof content === "function" ? content(close) : content);
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return { dialog, close };
}

export function confirmDialog({ title, body = [], confirmLabel = "確認", tone = "primary" }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, close) => { if (!settled) { settled = true; resolve(value); } close(); };
    openDialog((close) => h("div", { className: "sheet-body" }, [
      h("h2", { text: title }),
      ...[].concat(body),
      h("div", { className: "sheet-actions" }, [
        h("button", { type: "button", className: "ghost", text: "取消", onClick: () => finish(false, close) }),
        h("button", { type: "button", className: tone, dataset: { confirm: "" }, text: confirmLabel, onClick: () => finish(true, close) }),
      ]),
    ]), { label: title, onClose: () => { if (!settled) { settled = true; resolve(false); } } });
  });
}
