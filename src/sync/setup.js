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

// Pulls the two values out of a pasted setup link (or any text that contains them).
export function parseSetupLink(text = "") {
  const value = String(text || "");
  const query = value.includes("?") ? value.slice(value.indexOf("?") + 1) : value;
  let params;
  try { params = new URLSearchParams(query); } catch { params = new URLSearchParams(); }
  const endpoint = params.get("endpoint") || (value.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/) || [])[0] || "";
  const clientId = params.get("clientId") || (value.match(/[0-9A-Za-z-]+\.apps\.googleusercontent\.com/) || [])[0] || "";
  return { endpoint: endpoint.trim(), clientId: clientId.trim() };
}

export async function deviceId(db) {
  let id = await db.getMeta("deviceId", null);
  if (!id) { id = `device-${uuid()}`; await db.setMeta("deviceId", id); }
  return id;
}

const SESSION_META = "syncSession";

// The 30-day session from the Apps Script, kept on this device (never in source or the sheet).
export async function createSessionStore(db, onChange = () => {}) {
  let value = await db.getMeta(SESSION_META, null);
  const valid = () => value?.token && Number(value.exp || 0) - Date.now() > 60000;
  return {
    get: () => (valid() ? value : null),
    async set(next) { value = next; await db.setMeta(SESSION_META, next); onChange(); },
    async clear() { value = null; await db.setMeta(SESSION_META, null); onChange(); },
  };
}

// While the session is good the APP counts as signed in, and Google is not asked every hour.
export function withSession(google, session) {
  return {
    ...google,
    email: () => session.get()?.email || google.email(),
    signedIn: () => Boolean(session.get()) || google.signedIn(),
    needsClick: () => !session.get() && google.needsClick(),
    signOut: () => { session.clear(); google.signOut(); },
  };
}

// Wires sign-in, transport and the sync client into the running app.
export async function connectSync(ctx, config, { auth: authOverride, transport: transportOverride } = {}) {
  const device = await deviceId(ctx.db);
  const google = authOverride || createGoogleAuth({ clientId: config.clientId, onChange: () => ctx.refreshChrome() });
  const session = await createSessionStore(ctx.db, () => ctx.refreshChrome());
  const auth = withSession(google, session);
  const transport = transportOverride || createAppsScriptTransport({ endpoint: config.endpoint, getIdToken: () => google.getIdToken(), session, deviceId: device });
  const client = createSyncClient({ db: ctx.db, transport, onStatus: () => ctx.refreshChrome() });
  ctx.auth = auth;
  // Order intake calls the same Apps Script for its own actions (reference data, LINE sheet, OCR).
  ctx.transport = transport;
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
