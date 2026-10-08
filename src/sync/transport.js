export class TransportError extends Error {
  constructor(message, { retryable = false, auth = false, status = 0 } = {}) {
    super(message);
    this.retryable = retryable;
    this.auth = auth;
    this.status = status;
  }
}

// Apps Script Web Apps accept "simple" CORS requests, so the body is sent as text/plain.
export function createAppsScriptTransport({ endpoint, getIdToken, fetchImpl = globalThis.fetch?.bind(globalThis), deviceId = "", timeoutMs = 120000 }) {
  return {
    async call(action, payload = {}) {
      const idToken = await getIdToken();
      if (!idToken) throw new TransportError("需要先登入 Google", { auth: true });
      // Never let one stuck request freeze syncing; the retry is idempotent.
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...payload, action, idToken, deviceId }), redirect: "follow", signal: controller?.signal });
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
        if (body.auth) throw new TransportError(body.error === "Access denied" ? "這個 Google 帳號沒有使用權限" : "登入已過期，請重新登入", { auth: true });
        throw new TransportError(body.error || "同步失敗", { retryable: Boolean(body.retry) });
      }
      return body;
    },
  };
}
