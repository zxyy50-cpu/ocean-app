import { uuid } from "../core/ids.js";
import { createGoogleAuth } from "./google-auth.js";
import { createSyncClient } from "./sync-client.js";
import { createAppsScriptTransport } from "./transport.js";

export function validateSyncConfig(config = {}) {
  const errors = {};
  const endpoint = String(config.endpoint || "").trim();
  const clientId = String(config.clientId || "").trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) errors.endpoint = "請貼上 Apps Script Web App 網址（https://script.google.com/macros/s/…/exec）";
  if (!/^[0-9A-Za-z-]+\.apps\.googleusercontent\.com$/.test(clientId)) errors.clientId = "請貼上 Google 用戶端 ID（…apps.googleusercontent.com）";
  return { ok: !Object.keys(errors).length, errors, values: { endpoint, clientId } };
}

export async function deviceId(db) {
  let id = await db.getMeta("deviceId", null);
  if (!id) { id = `device-${uuid()}`; await db.setMeta("deviceId", id); }
  return id;
}

// Wires sign-in, transport and the sync client into the running app.
export async function connectSync(ctx, config, { auth: authOverride, transport: transportOverride } = {}) {
  const device = await deviceId(ctx.db);
  const auth = authOverride || createGoogleAuth({ clientId: config.clientId, onChange: () => ctx.refreshChrome() });
  const transport = transportOverride || createAppsScriptTransport({ endpoint: config.endpoint, getIdToken: () => auth.getIdToken(), deviceId: device });
  const client = createSyncClient({ db: ctx.db, transport, onStatus: () => ctx.refreshChrome() });
  ctx.auth = auth;
  ctx.setSync(client);
  client.start();
  return client;
}

export async function loadSyncConfig(db) {
  return db.getMeta("syncConfig", null);
}

export async function saveSyncConfig(db, config) {
  const validation = validateSyncConfig(config);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  await db.setMeta("syncConfig", validation.values);
  return { ok: true, value: validation.values };
}
