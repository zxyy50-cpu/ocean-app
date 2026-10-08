export const UNASSIGNED_DRAFT = "unassigned";
const META_KEY = "visitDrafts";

// Drafts live only on this device (meta store) and are written in order.
export function createDraftStore(db) {
  let queue = Promise.resolve();
  const enqueue = (work) => {
    queue = queue.then(work, work);
    return queue;
  };
  return {
    async all() {
      return (await db.getMeta(META_KEY, {})) || {};
    },
    async get(key) {
      return ((await db.getMeta(META_KEY, {})) || {})[key] || null;
    },
    save(key, values) {
      return enqueue(async () => {
        const drafts = (await db.getMeta(META_KEY, {})) || {};
        drafts[key] = { ...values, savedAt: new Date().toISOString() };
        await db.setMeta(META_KEY, drafts);
        return drafts[key];
      });
    },
    move(fromKey, toKey, values) {
      return enqueue(async () => {
        const drafts = (await db.getMeta(META_KEY, {})) || {};
        delete drafts[fromKey];
        drafts[toKey] = { ...values, savedAt: new Date().toISOString() };
        await db.setMeta(META_KEY, drafts);
      });
    },
    clear(key) {
      return enqueue(async () => {
        const drafts = (await db.getMeta(META_KEY, {})) || {};
        delete drafts[key];
        await db.setMeta(META_KEY, drafts);
      });
    },
  };
}

export function hasContent(draft) {
  return Boolean(draft && String(draft.detailedNote || "").trim());
}
