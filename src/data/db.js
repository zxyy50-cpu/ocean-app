import { uuid as defaultUuid } from "../core/ids.js";
import { ENTITY_SCHEMAS } from "./schema.js";

const TABLES = ["entities", "changes", "requests", "meta"];
const PROTECTED = new Set(["id", "type", "version", "localRev", "createdAt", "createdBy", "syncStatus", "conflict"]);
const LOCAL_ONLY = new Set(["type", "localRev", "syncStatus", "conflict"]);

export class DbError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

function clone(value) {
  if (value === undefined) return undefined;
  return globalThis.structuredClone ? globalThis.structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function entityKey(type, id) {
  return `${type}:${id}`;
}

export function editableValues(record = {}) {
  return Object.fromEntries(Object.entries(record).filter(([field]) => !PROTECTED.has(field)));
}

export function syncPayload(record = {}) {
  return Object.fromEntries(Object.entries(record).filter(([field]) => !LOCAL_ONLY.has(field)));
}

export function createMemoryAdapter(seed = {}) {
  let tables = Object.fromEntries(TABLES.map((name) => [name, new Map(Object.entries(seed[name] || {}))]));
  return {
    async transaction(mode, work) {
      const draft = Object.fromEntries(TABLES.map((name) => [name, new Map([...tables[name]].map(([key, value]) => [key, clone(value)]))]));
      const tx = {
        async get(table, key) { return clone(draft[table].get(key)); },
        async put(table, key, value) { draft[table].set(key, clone(value)); },
        async getAll(table) { return [...draft[table].values()].map(clone); },
        async clear(table) { draft[table].clear(); },
      };
      const result = await work(tx);
      if (mode === "readwrite") tables = draft;
      return clone(result);
    },
  };
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createIndexedDbAdapter({ indexedDB = globalThis.indexedDB, dbName = "ocean-app:v1" } = {}) {
  if (!indexedDB) throw new Error("IndexedDB unavailable");
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => TABLES.forEach((name) => {
      if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    async transaction(mode, work) {
      const db = await database;
      const transaction = db.transaction(TABLES, mode);
      const done = new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
        transaction.onerror = () => reject(transaction.error);
      });
      const tx = {
        async get(table, key) { return clone(await idbRequest(transaction.objectStore(table).get(key))); },
        async put(table, key, value) { await idbRequest(transaction.objectStore(table).put(clone(value), key)); },
        async getAll(table) { return (await idbRequest(transaction.objectStore(table).getAll())).map(clone); },
        async clear(table) { await idbRequest(transaction.objectStore(table).clear()); },
      };
      try {
        const result = await work(tx);
        await done;
        return clone(result);
      } catch (error) {
        try { transaction.abort(); } catch { /* already finished */ }
        done.catch(() => {});
        throw error;
      }
    },
  };
}

export function createDatabase({ adapter = createIndexedDbAdapter(), now = () => new Date(), uuid = defaultUuid, actor = "Ocean" } = {}) {
  let cache = null;
  const stamp = () => toIso(now());
  const listeners = new Set();

  async function ensureCache() {
    if (!cache) {
      const records = await adapter.transaction("readonly", (tx) => tx.getAll("entities"));
      cache = new Map(records.map((record) => [entityKey(record.type, record.id), record]));
    }
    return cache;
  }

  function notify() {
    listeners.forEach((listener) => { try { listener(); } catch { /* listener errors must not break writes */ } });
  }

  async function run(mode, work) {
    await ensureCache();
    const written = new Map();
    const result = await adapter.transaction(mode, (tx) => work(tx, written));
    written.forEach((record, key) => cache.set(key, record));
    if (written.size) notify();
    return result;
  }

  function context(tx, written, requestId) {
    const changeIds = [];
    async function write(record) {
      const key = entityKey(record.type, record.id);
      await tx.put("entities", key, record);
      written.set(key, clone(record));
    }
    async function logChange(record, operation, patch, baseVersion) {
      const change = {
        id: uuid(), requestId: requestId || null, entityType: record.type, entityId: record.id, operation,
        baseVersion, patch: clone(patch), at: stamp(), actor, status: "pending", attempts: 0, lastError: null,
      };
      await tx.put("changes", change.id, change);
      changeIds.push(change.id);
    }
    async function load(type, id) {
      const current = await tx.get("entities", entityKey(type, id));
      if (!current) throw new DbError("not-found", { entityType: type, entityId: id });
      return current;
    }
    const api = {
      changeIds,
      now: stamp,
      actor,
      get: (type, id) => tx.get("entities", entityKey(type, id)),
      async list(type, { includeArchived = false } = {}) {
        return (await tx.getAll("entities")).filter((record) => record.type === type && (includeArchived || !record.archivedAt));
      },
      async create(type, values = {}, { id } = {}) {
        if (!ENTITY_SCHEMAS[type]) throw new DbError("unknown-type", { entityType: type });
        const recordId = id || uuid();
        if (await tx.get("entities", entityKey(type, recordId))) throw new DbError("duplicate-id", { entityType: type, entityId: recordId });
        const timestamp = stamp();
        const record = {
          ...clone(editableValues(values)), id: recordId, type, version: 0, localRev: 1,
          createdAt: timestamp, createdBy: actor, updatedAt: timestamp, updatedBy: actor,
          archivedAt: values.archivedAt || null, archivedBy: values.archivedBy || null, archiveReason: values.archiveReason || null, sourceRef: values.sourceRef || "", syncStatus: "pending",
        };
        await write(record);
        await logChange(record, "create", editableValues(record), 0);
        return clone(record);
      },
      async update(type, id, patch = {}, { expectedRev, operation = "update" } = {}) {
        const current = await load(type, id);
        if (expectedRev !== undefined && expectedRev !== current.localRev) throw new DbError("stale", { current });
        const changed = {};
        for (const [field, value] of Object.entries(patch)) {
          if (PROTECTED.has(field) || value === undefined) continue;
          if (!sameValue(current[field], value)) changed[field] = clone(value);
        }
        if (!Object.keys(changed).length) return clone(current);
        const record = {
          ...current, ...changed, localRev: current.localRev + 1, updatedAt: stamp(), updatedBy: actor,
          syncStatus: current.syncStatus === "conflict" ? "conflict" : "pending",
        };
        await write(record);
        await logChange(record, operation, changed, current.version);
        return clone(record);
      },
      async archive(type, id, reason = "", options = {}) {
        const current = await load(type, id);
        if (current.archivedAt) throw new DbError("already-archived", { entityType: type, entityId: id });
        return api.update(type, id, { archivedAt: stamp(), archivedBy: actor, archiveReason: String(reason || "").trim() || "未填寫原因" }, { ...options, operation: "archive" });
      },
      async restore(type, id, options = {}) {
        const current = await load(type, id);
        if (!current.archivedAt) throw new DbError("not-archived", { entityType: type, entityId: id });
        return api.update(type, id, { archivedAt: null, archivedBy: null, archiveReason: null }, { ...options, operation: "restore" });
      },
      fail(code, detail = {}) {
        throw new DbError(code, detail);
      },
      // Low-level helpers for sync bookkeeping; they bypass the change log on purpose.
      async putWithoutChange(record) {
        await write(record);
        return clone(record);
      },
      async pendingChangeIds(type, id) {
        return ((await changesByEntity(tx)).get(entityKey(type, id)) || []).map((change) => change.id);
      },
      setChangeStatus: (ids, status, extra) => setChangeStatus(tx, ids, status, extra),
    };
    return api;
  }

  async function transact(requestId, work) {
    try {
      return await run("readwrite", async (tx, written) => {
        if (requestId) {
          const prior = await tx.get("requests", requestId);
          if (prior) return { ...prior, duplicateRequest: true };
        }
        const ctx = context(tx, written, requestId);
        const value = await work(ctx);
        const result = { ok: true, value: value ?? null, changeIds: ctx.changeIds };
        if (requestId) await tx.put("requests", requestId, { ...result, at: stamp() });
        return result;
      });
    } catch (error) {
      if (error instanceof DbError) return { ok: false, error: error.code, ...clone(error.detail) };
      throw error;
    }
  }

  async function changesByEntity(tx) {
    const groups = new Map();
    for (const change of await tx.getAll("changes")) {
      if (change.status !== "pending") continue;
      const key = entityKey(change.entityType, change.entityId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(change);
    }
    return groups;
  }

  async function setChangeStatus(tx, changeIds, status, extra = {}) {
    for (const id of changeIds) {
      const change = await tx.get("changes", id);
      if (change) await tx.put("changes", id, { ...change, status, ...extra });
    }
  }

  return {
    actor,
    now: stamp,
    ready: ensureCache,
    transact,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async get(type, id) {
      return clone((await ensureCache()).get(entityKey(type, id)));
    },
    async list(type, { includeArchived = false } = {}) {
      return [...(await ensureCache()).values()].filter((record) => record.type === type && (includeArchived || !record.archivedAt)).map(clone);
    },
    // Synchronous read-only view for rendering; callers must not mutate the records.
    peekAll() {
      if (!cache) throw new Error("database not ready");
      const byType = Object.fromEntries(Object.keys(ENTITY_SCHEMAS).map((type) => [type, []]));
      cache.forEach((record) => { (byType[record.type] ||= []).push(record); });
      return byType;
    },
    peek(type, id) {
      return cache?.get(entityKey(type, id)) || null;
    },
    create: (type, values, requestId, options) => transact(requestId, (tx) => tx.create(type, values, options)),
    update: (type, id, patch, requestId, options) => transact(requestId, (tx) => tx.update(type, id, patch, options)),
    archive: (type, id, reason, requestId, options) => transact(requestId, (tx) => tx.archive(type, id, reason, options)),
    restore: (type, id, requestId, options) => transact(requestId, (tx) => tx.restore(type, id, options)),

    async pendingChanges() {
      return (await adapter.transaction("readonly", (tx) => tx.getAll("changes")))
        .filter((change) => change.status === "pending")
        .sort((left, right) => String(left.at).localeCompare(String(right.at)));
    },
    async allChanges() {
      return (await adapter.transaction("readonly", (tx) => tx.getAll("changes")))
        .sort((left, right) => String(left.at).localeCompare(String(right.at)));
    },
    // Server accepted a push: adopt the server version, keep newer local edits pending.
    async acknowledge({ changeIds = [], serverRecord }) {
      return (await this.acknowledgeMany([{ changeIds, serverRecord }]))[0];
    },
    // One transaction (and one scan of the change log) per pushed batch.
    async acknowledgeMany(items = []) {
      if (!items.length) return [];
      return run("readwrite", async (tx, written) => {
        const syncedAt = stamp();
        for (const { changeIds = [] } of items) await setChangeStatus(tx, changeIds, "synced", { syncedAt });
        const pendingByEntity = await changesByEntity(tx);
        const results = [];
        for (const { serverRecord } of items) {
          const key = entityKey(serverRecord.type, serverRecord.id);
          const local = await tx.get("entities", key);
          if (!local) { results.push({ ok: false, error: "not-found" }); continue; }
          const remaining = pendingByEntity.get(key) || [];
          const record = remaining.length
            ? { ...local, version: serverRecord.version }
            : { ...local, version: serverRecord.version, updatedAt: serverRecord.updatedAt || local.updatedAt, updatedBy: serverRecord.updatedBy || local.updatedBy, syncStatus: "synced", conflict: null };
          for (const change of remaining) await tx.put("changes", change.id, { ...change, baseVersion: serverRecord.version });
          await tx.put("entities", key, record);
          written.set(key, clone(record));
          results.push({ ok: true, record });
        }
        return results;
      });
    },
    async markConflict({ changeIds = [], entityType, entityId, serverRecord }) {
      return run("readwrite", async (tx, written) => {
        const key = entityKey(entityType, entityId);
        const local = await tx.get("entities", key);
        if (!local) return { ok: false, error: "not-found" };
        await setChangeStatus(tx, changeIds, "conflict");
        const record = { ...local, syncStatus: "conflict", conflict: { serverRecord: clone(serverRecord), changeIds: [...changeIds], detectedAt: stamp() } };
        await tx.put("entities", key, record);
        written.set(key, clone(record));
        return { ok: true, record };
      });
    },
    async markFailed(changeIds = [], message = "同步失敗") {
      return run("readwrite", async (tx, written) => {
        for (const id of changeIds) {
          const change = await tx.get("changes", id);
          if (!change) continue;
          await tx.put("changes", id, { ...change, attempts: (change.attempts || 0) + 1, lastError: message });
          const key = entityKey(change.entityType, change.entityId);
          const record = await tx.get("entities", key);
          if (record && record.syncStatus !== "conflict") {
            const failed = { ...record, syncStatus: "failed" };
            await tx.put("entities", key, failed);
            written.set(key, clone(failed));
          }
        }
        return { ok: true };
      });
    },
    // choice: "server" | "local" | "manual" (manual uses mergedValues)
    async resolveConflict(type, id, choice, mergedValues = {}, requestId) {
      if (!["server", "local", "manual"].includes(choice)) return { ok: false, error: "invalid-choice" };
      return transact(requestId, async (tx) => {
        const local = await tx.get(type, id);
        if (!local || local.syncStatus !== "conflict" || !local.conflict?.serverRecord) tx.fail("no-conflict", { entityType: type, entityId: id });
        const server = local.conflict.serverRecord;
        const stale = [...new Set([...(local.conflict.changeIds || []), ...(await tx.pendingChangeIds(type, id))])];
        await tx.setChangeStatus(stale, "superseded", { supersededAt: stamp() });
        if (choice === "server") {
          return tx.putWithoutChange({ ...server, type, localRev: local.localRev + 1, syncStatus: "synced", conflict: null });
        }
        const values = choice === "manual" ? mergedValues : editableValues(local);
        await tx.putWithoutChange({ ...server, type, localRev: local.localRev, syncStatus: "synced", conflict: null });
        const patch = {};
        for (const [field, value] of Object.entries(editableValues(values))) if (!sameValue(server[field], value)) patch[field] = value;
        return tx.update(type, id, patch, { operation: "resolve" });
      });
    },
    async applyRemote(records = []) {
      return run("readwrite", async (tx, written) => {
        const pending = await changesByEntity(tx);
        const summary = { applied: 0, conflicts: 0, skipped: 0 };
        for (const remote of records) {
          const key = entityKey(remote.type, remote.id);
          const local = await tx.get("entities", key);
          const hasPending = (pending.get(key) || []).length > 0;
          let record = null;
          if (!local || (!hasPending && local.syncStatus !== "conflict")) {
            if (local && local.version >= remote.version) { summary.skipped += 1; continue; }
            record = { ...clone(remote), localRev: (local?.localRev || 0) + 1, syncStatus: "synced", conflict: null };
            summary.applied += 1;
          } else if (remote.version > local.version) {
            record = { ...local, syncStatus: "conflict", conflict: { serverRecord: clone(remote), changeIds: (pending.get(key) || []).map((change) => change.id), detectedAt: stamp() } };
            summary.conflicts += 1;
          } else {
            summary.skipped += 1;
            continue;
          }
          await tx.put("entities", key, record);
          written.set(key, clone(record));
        }
        return summary;
      });
    },
    async getMeta(key, fallback = null) {
      const entry = await adapter.transaction("readonly", (tx) => tx.get("meta", key));
      return entry === undefined ? fallback : entry.value;
    },
    async setMeta(key, value) {
      await adapter.transaction("readwrite", (tx) => tx.put("meta", key, { key, value }));
      return { ok: true };
    },
    async exportAll() {
      return adapter.transaction("readonly", async (tx) => ({
        entities: await tx.getAll("entities"),
        changes: await tx.getAll("changes"),
        meta: Object.fromEntries((await tx.getAll("meta")).map((entry) => [entry.key, entry.value])),
      }));
    },
    async replaceAll({ entities = [], changes = [] } = {}) {
      await adapter.transaction("readwrite", async (tx) => {
        await tx.clear("entities");
        await tx.clear("changes");
        await tx.clear("requests");
        for (const record of entities) await tx.put("entities", entityKey(record.type, record.id), record);
        for (const change of changes) await tx.put("changes", change.id, change);
      });
      cache = null;
      await ensureCache();
      notify();
      return { ok: true };
    },
  };
}
