import { syncPayload } from "../data/db.js";

const BATCH = 200;
const BACKOFF = [5000, 15000, 45000, 120000, 300000];
const INTERVAL = 5 * 60 * 1000;

// Groups pending changes per record: one push item carries the record's latest
// values and the server version the edits were based on.
export async function buildPushItems(db) {
  const pending = await db.pendingChanges();
  const groups = new Map();
  for (const change of pending) {
    const key = `${change.entityType}:${change.entityId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  const items = [];
  for (const changes of groups.values()) {
    const { entityType, entityId } = changes[0];
    const record = await db.get(entityType, entityId);
    if (!record || record.syncStatus === "conflict") continue;
    const patch = Object.assign({}, ...changes.map((change) => change.patch || {}));
    const last = changes[changes.length - 1];
    items.push({
      changeIds: changes.map((change) => change.id),
      requestId: `push:${entityType}:${entityId}:${last.id}:${changes.length}`,
      entityType, entityId,
      operation: record.version === 0 ? "create" : last.operation,
      baseVersion: record.version || 0,
      patch,
      values: syncPayload(record),
    });
  }
  return items;
}

// Google's front end sometimes drops a Web App request (404 page) before the
// script runs; retrying the same batch is safe because requestIds are idempotent.
const BATCH_RETRY_DELAYS = [2000, 5000, 10000];
const wait = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

export function createSyncClient({ db, transport = null, setTimer = globalThis.setTimeout?.bind(globalThis), clearTimer = globalThis.clearTimeout?.bind(globalThis), isOnline = () => globalThis.navigator?.onLine !== false, onStatus = () => {}, batchRetryDelays = BATCH_RETRY_DELAYS, sleep = wait } = {}) {
  const state = { configured: Boolean(transport), online: isOnline(), running: false, lastSyncAt: null, lastError: "", needsSignIn: false, attempt: 0 };
  let current = null;
  let retryTimer = null;
  let intervalTimer = null;
  let changeTimer = null;
  const cleanups = [];
  const emit = () => onStatus({ ...state });

  async function call(action, payload) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await transport.call(action, payload);
      } catch (error) {
        if (!error.retryable || attempt >= batchRetryDelays.length) throw error;
        await sleep(batchRetryDelays[attempt]);
      }
    }
  }

  async function push() {
    const items = await buildPushItems(db);
    let accepted = 0;
    let conflicts = 0;
    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH);
      const response = await call("push", { changes: batch.map(({ changeIds, ...item }) => item) });
      const byRequest = new Map(batch.map((item) => [item.requestId, item]));
      const acknowledged = [];
      for (const result of response.results || []) {
        const item = byRequest.get(result.requestId);
        if (!item) continue;
        if (result.status === "accepted") {
          acknowledged.push({ changeIds: item.changeIds, serverRecord: { ...result.record, type: item.entityType, id: item.entityId } });
          accepted += 1;
        } else if (result.status === "conflict") {
          const { _seq, ...server } = result.serverRecord || {};
          await db.markConflict({ changeIds: item.changeIds, entityType: item.entityType, entityId: item.entityId, serverRecord: { ...server, type: item.entityType } });
          conflicts += 1;
        } else {
          await db.markFailed(item.changeIds, result.error || "伺服器拒絕這筆資料");
        }
      }
      await db.acknowledgeMany(acknowledged);
    }
    return { pushed: items.length, accepted, conflicts };
  }

  async function pull() {
    let cursor = Number(await db.getMeta("syncCursor", 0)) || 0;
    let applied = 0;
    let conflicts = 0;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await call("pull", { cursor });
      const records = (page.records || []).map(({ _seq, ...record }) => record);
      if (records.length) {
        const summary = await db.applyRemote(records);
        applied += summary.applied;
        conflicts += summary.conflicts;
      }
      cursor = page.cursor ?? cursor;
      await db.setMeta("syncCursor", cursor);
      if (!page.hasMore) break;
    }
    return { applied, conflicts };
  }

  async function run() {
    if (!transport) return { ok: false, error: "尚未設定同步連線" };
    state.online = isOnline();
    if (!state.online) { emit(); return { ok: false, error: "目前離線，資料已保存在這台裝置" }; }
    state.running = true;
    emit();
    try {
      const pushed = await push();
      const pulled = await pull();
      state.lastSyncAt = new Date().toISOString();
      state.lastError = "";
      state.needsSignIn = false;
      state.attempt = 0;
      return { ok: true, ...pushed, pulled };
    } catch (error) {
      state.lastError = error.message || String(error);
      if (error.auth) state.needsSignIn = true;
      const failedIds = (await db.pendingChanges()).map((change) => change.id);
      if (failedIds.length && !error.auth) await db.markFailed(failedIds, state.lastError);
      if (error.retryable) scheduleRetry();
      return { ok: false, error: state.lastError, auth: Boolean(error.auth) };
    } finally {
      state.running = false;
      emit();
    }
  }

  function scheduleRetry() {
    if (!setTimer) return;
    clearTimer?.(retryTimer);
    const delay = BACKOFF[Math.min(state.attempt, BACKOFF.length - 1)];
    state.attempt += 1;
    retryTimer = setTimer(() => { retryTimer = null; client.sync(); }, delay);
  }

  const client = {
    status: () => ({ ...state }),
    sync() {
      if (!current) current = run().finally(() => { current = null; });
      return current;
    },
    start({ window: win = globalThis.window, document: doc = globalThis.document } = {}) {
      if (!transport) return;
      const onOnline = () => { state.online = true; client.sync(); };
      const onOffline = () => { state.online = false; emit(); };
      const onVisible = () => { if (doc?.visibilityState === "visible") client.sync(); };
      win?.addEventListener?.("online", onOnline);
      win?.addEventListener?.("offline", onOffline);
      doc?.addEventListener?.("visibilitychange", onVisible);
      cleanups.push(() => { win?.removeEventListener?.("online", onOnline); win?.removeEventListener?.("offline", onOffline); doc?.removeEventListener?.("visibilitychange", onVisible); });
      cleanups.push(db.onChange(() => {
        clearTimer?.(changeTimer);
        // Only local edits need an upload; sync's own bookkeeping writes leave nothing pending.
        changeTimer = setTimer?.(() => { db.pendingChanges().then((pending) => { if (pending.length) client.sync(); }).catch(() => {}); }, 3000);
      }));
      if (setTimer) {
        const tick = () => { intervalTimer = setTimer(() => { client.sync(); tick(); }, INTERVAL); };
        tick();
      }
      client.sync();
    },
    stop() {
      cleanups.splice(0).forEach((cleanup) => cleanup());
      [retryTimer, intervalTimer, changeTimer].forEach((timer) => clearTimer?.(timer));
    },
  };
  return client;
}
