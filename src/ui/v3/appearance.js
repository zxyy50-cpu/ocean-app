import { h, toast } from "../dom.js";
import { registerSettingsSection } from "../pages/settings.js";
import { mountDecor } from "./skin-decor.js";

// Skin choice is a per-device preference (phone and computer can differ).
export const SKIN_KEY = "ocean-skin";
export const DEFAULT_SKIN = "summer";
export const SKINS = Object.freeze([
  { id: "summer", label: "夏日繽紛", hint: "天空藍、海水綠、陽光黃", colors: ["#22b7e0", "#2fd3c0", "#ffb21f", "#ff6b8a"] },
  { id: "ocean", label: "深海", hint: "海豚和各種鯨魚在背景游來游去", colors: ["#0b4f6c", "#1f8fb3", "#7fd4e8", "#e8f7fb"] },
  { id: "fantasy", label: "龍焰奇幻", hint: "石牆、血紅與金，餘燼飄升、巨龍飛過", colors: ["#15110f", "#3a1714", "#b3261e", "#c9a24a"] },
  { id: "wizard", label: "魔法學院", hint: "星空、漂浮蠟燭、貓頭鷹送信", colors: ["#171329", "#3b2350", "#7a1f2b", "#d4a944"] },
  { id: "boho", label: "波西米亞", hint: "陶土紅、芥末黃、鼠尾草綠、編織流蘇", colors: ["#b3553a", "#d8a23e", "#7f9160", "#c77d83"] },
  { id: "cockpit", label: "深色駕駛艙", hint: "深色底、晚上不刺眼", colors: ["#0e151b", "#16202a", "#4fe3b5", "#f5b547"] },
]);

export function currentSkin() {
  try { return globalThis.localStorage?.getItem(SKIN_KEY) || DEFAULT_SKIN; } catch { return DEFAULT_SKIN; }
}

// A skin that no longer exists (清爽專業, 溫暖手帳, 活力品牌) falls back to the default.
export function applySkin(id, root = globalThis.document?.documentElement) {
  if (!root) return;
  const skin = SKINS.some((item) => item.id === id) ? id : DEFAULT_SKIN;
  root.setAttribute("data-skin", skin);
  mountDecor(skin, root.ownerDocument);
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

// On start: the attribute was set before first paint (index.html); add the moving backdrop now.
if (globalThis.document?.body) applySkin(currentSkin());
