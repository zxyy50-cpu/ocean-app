// Google Identity Services sign-in. The ID token stays in memory only; it is
// never written to storage or source code.
const GIS_SRC = "https://accounts.google.com/gsi/client";

function decodePayload(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent([...atob(part)].map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.id) { resolve(); return; }
    const existing = document.querySelector(`script[src="${src}"]`);
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("無法載入 Google 登入（請確認網路）")), { once: true });
    if (!existing) { script.src = src; script.async = true; document.head.append(script); }
  });
}

export function createGoogleAuth({ clientId, onChange = () => {} }) {
  let token = null;
  let payload = {};
  let initialized = false;
  const waiters = [];

  async function init() {
    if (initialized) return;
    await loadScript(GIS_SRC);
    globalThis.google.accounts.id.initialize({
      client_id: clientId,
      auto_select: true,
      cancel_on_tap_outside: false,
      callback: (response) => {
        token = response.credential;
        payload = decodePayload(token);
        waiters.splice(0).forEach((resolve) => resolve(token));
        onChange({ signedIn: true, email: payload.email });
      },
    });
    initialized = true;
  }

  const valid = () => token && (Number(payload.exp || 0) * 1000 - Date.now()) > 60000;

  return {
    email: () => (valid() ? payload.email : ""),
    signedIn: () => Boolean(valid()),
    async renderButton(element) {
      await init();
      globalThis.google.accounts.id.renderButton(element, { theme: "outline", size: "large", text: "signin_with", locale: "zh-TW" });
    },
    // Returns a fresh token, trying a silent sign-in first. Resolves null if the user must click.
    async getIdToken() {
      if (valid()) return token;
      try { await init(); } catch { return null; }
      return new Promise((resolve) => {
        waiters.push(resolve);
        globalThis.google.accounts.id.prompt();
        setTimeout(() => { const index = waiters.indexOf(resolve); if (index >= 0) { waiters.splice(index, 1); resolve(null); } }, 8000);
      });
    },
    signOut() {
      token = null;
      payload = {};
      globalThis.google?.accounts?.id?.disableAutoSelect?.();
      onChange({ signedIn: false });
    },
  };
}
