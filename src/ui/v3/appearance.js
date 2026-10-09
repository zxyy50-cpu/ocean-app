import { h, toast } from "../dom.js";
import { registerSettingsSection } from "../pages/settings.js";

// Skin choice is a per-device preference (phone and computer can differ).
export const SKIN_KEY = "ocean-skin";
export const DEFAULT_SKIN = "summer";
export const SKINS = Object.freeze([
  { id: "summer", label: "夏日繽紛", hint: "天空藍、海水綠、陽光黃", colors: ["#22b7e0", "#2fd3c0", "#ffb21f", "#ff6b8a"] },
  { id: "classic", label: "清爽專業", hint: "白底、墨綠，最穩重", colors: ["#f5f3ee", "#ffffff", "#0f766e", "#1d2a2e"] },
  { id: "notebook", label: "溫暖手帳", hint: "紙質底色、襯線標題", colors: ["#f5efe3", "#fffbf3", "#b5523b", "#2b2a33"] },
  { id: "cockpit", label: "深色駕駛艙", hint: "深色底、晚上不刺眼", colors: ["#0e151b", "#16202a", "#4fe3b5", "#f5b547"] },
  { id: "bold", label: "活力品牌", hint: "藍色標頭、珊瑚色按鈕", colors: ["#2e3fb8", "#eef1fa", "#ffffff", "#ff6b4a"] },
]);

export function currentSkin() {
  try { return globalThis.localStorage?.getItem(SKIN_KEY) || DEFAULT_SKIN; } catch { return DEFAULT_SKIN; }
}

// "classic" is the base stylesheet itself, so it needs no attribute.
export function applySkin(id, root = globalThis.document?.documentElement) {
  if (!root) return;
  if (id === "classic") root.removeAttribute("data-skin");
  else root.setAttribute("data-skin", SKINS.some((skin) => skin.id === id) ? id : DEFAULT_SKIN);
}

export function chooseSkin(id) {
  try { globalThis.localStorage?.setItem(SKIN_KEY, id); } catch { /* still applied for this visit */ }
  applySkin(id);
}

function appearanceSection() {
  const active = currentSkin();
  const options = SKINS.map((skin) => h("button", {
    type: "button", className: "skin-option", "aria-pressed": String(skin.id === active), dataset: { skin: skin.id },
    onClick: (event) => {
      chooseSkin(skin.id);
      event.currentTarget.closest(".skin-grid").querySelectorAll(".skin-option").forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.skin === skin.id)));
      toast(`已換成「${skin.label}」`);
    },
  }, [
    h("span", { className: "skin-swatch", "aria-hidden": "true" }, skin.colors.map((color) => h("i", { style: { background: color } }))),
    h("strong", { text: skin.label }),
    h("small", { className: "muted", text: skin.hint }),
  ]));
  return h("section", { className: "card form-card", dataset: { section: "appearance" } }, [
    h("h2", { text: "外觀" }),
    h("p", { className: "muted", text: "點一下就換，只影響這台裝置。手機開深色模式時會自動換成對應的深色版。" }),
    h("div", { className: "skin-grid" }, options),
  ]);
}

registerSettingsSection(appearanceSection);
