import { DEFAULT_MY_AREAS, normalizeAreas } from "./tags.js";

export const DEFAULT_VISIT_OPTIONS = Object.freeze({
  channels: ["電話", "親訪", "視訊", "Email", "LINE", "展覽／研討會", "其他"],
  purposes: ["初次接觸", "需求訪談", "產品介紹", "Demo／展示", "送樣／試用", "報價", "追蹤報價", "技術支援", "客訴處理", "收款／對帳", "例行關係維護"],
  reactions: ["有興趣", "需要評估", "要求資料", "等待報價", "價格考量", "已有供應商", "暫無需求", "無法聯絡"],
  results: ["找到需求", "等待客戶回覆", "安排展示／試用", "完成報價", "取得訂單", "暫時無機會"],
  nextActions: ["寄資料", "提供報價", "再次聯絡", "安排拜訪", "送樣", "安排 Demo", "暫停追蹤"],
});

export const SETTING_DEFAULTS = Object.freeze({
  myAreas: [...DEFAULT_MY_AREAS],
  visitOptions: DEFAULT_VISIT_OPTIONS,
});

export function settingId(key) {
  return `setting-${key}`;
}

export function readSetting(all, key) {
  const record = (all.setting || []).find((item) => item.id === settingId(key) && !item.archivedAt);
  if (record && record.value !== undefined && record.value !== null) return record.value;
  return structuredClone(SETTING_DEFAULTS[key] ?? null);
}

export function validateSetting(key, value) {
  if (key === "myAreas") {
    const areas = normalizeAreas(value);
    return areas.length ? { ok: true, value: areas } : { ok: false, errors: { myAreas: "請至少選擇一個區域" } };
  }
  if (key === "visitOptions") {
    const cleaned = {};
    for (const group of Object.keys(DEFAULT_VISIT_OPTIONS)) {
      const list = [...new Set((value?.[group] || []).map((item) => String(item).trim()).filter(Boolean))];
      if (!list.length) return { ok: false, errors: { [group]: "每一組選項至少需要一項" } };
      cleaned[group] = list;
    }
    return { ok: true, value: cleaned };
  }
  return { ok: true, value };
}

export async function saveSetting(db, key, value, requestId) {
  const validation = validateSetting(key, value);
  if (!validation.ok) return { ok: false, error: "validation", errors: validation.errors };
  return db.transact(requestId, async (tx) => {
    const id = settingId(key);
    const existing = await tx.get("setting", id);
    if (existing) return tx.update("setting", id, { value: validation.value });
    return tx.create("setting", { key, value: validation.value }, { id });
  });
}
