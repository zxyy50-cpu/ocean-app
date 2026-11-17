export class TransportError extends Error {
  constructor(message, { retryable = false, auth = false, status = 0 } = {}) {
    super(message);
    this.retryable = retryable;
    this.auth = auth;
    this.status = status;
  }
}

// Apps Script Web Apps accept "simple" CORS requests, so the body is sent as text/plain.
// session (optional): { get(), set(value), clear() } — the 30-day session the Apps Script hands out
// after one Google sign-in, so the hourly Google token does not have to be renewed in the page.
export function createAppsScriptTransport({ endpoint, getIdToken, session = null, fetchImpl = globalThis.fetch?.bind(globalThis), deviceId = "", timeoutMs = 120000 }) {
  async function call(action, payload = {}, { skipSession = false } = {}) {
      const saved = skipSession ? null : session?.get() || null;
      const idToken = saved ? "" : await getIdToken();
      if (!saved && !idToken) throw new TransportError("需要先登入 Google", { auth: true });
      // Never let one stuck request freeze syncing; the retry is idempotent.
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...payload, action, idToken, session: saved?.token || "", wantSession: Boolean(session), deviceId }), redirect: "follow", signal: controller?.signal });
      } catch {
        clearTimeout(timer);
        throw new TransportError(controller?.signal.aborted ? "同步伺服器太久沒有回應" : "無法連線到同步伺服器", { retryable: true });
      }
      if (response.status === 429 || response.status >= 500) { clearTimeout(timer); throw new TransportError(`伺服器暫時無法處理（${response.status}）`, { retryable: true, status: response.status }); }
      const text = await response.text().catch(() => "");
      clearTimeout(timer);
      let body;
      try { body = JSON.parse(text); } catch {
        // Keep a short, tag-free excerpt so the sync center shows what Google actually returned.
        const excerpt = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
        throw new TransportError(`伺服器回應格式不正確（${response.status}）${excerpt ? `：${excerpt}` : ""}`, { retryable: true, status: response.status });
      }
      if (!body.ok) {
        // A session that expired or was revoked: forget it and sign in with Google once more.
        if (body.auth && saved) { await session.clear(); return call(action, payload, { skipSession: true }); }
        if (body.auth) throw new TransportError(body.error === "Access denied" ? "這個 Google 帳號沒有使用權限" : "登入已過期，請重新登入", { auth: true });
        throw new TransportError(body.error || "同步失敗", { retryable: Boolean(body.retry) });
      }
      if (body.session?.token && session) await session.set(body.session);
      return body;
  }
  return { call };
}
