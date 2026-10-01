import { frameOffsetFromWindow } from "./adapter/frame-offset.js";

let qrImageEl = null;
let qrImageAt = 0;
let totpHost = null;
let totpOnMsg = null;

export function installQrPage() {
  document.addEventListener("contextmenu", (e) => {
    const el = e.target instanceof Element ? e.target.closest("img") : null;
    if (!(el instanceof HTMLImageElement)) return;
    qrImageEl = el;
    qrImageAt = Date.now();
  }, true);
}

export function qrImageRect() {
  const img = qrImageEl;
  if (!img || !img.isConnected || Date.now() - qrImageAt > 10000) return null;
  const r = img.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  const off = frameOffsetFromWindow(window);
  return {
    x: r.left + off.x,
    y: r.top + off.y,
    w: r.width,
    h: r.height,
    dpr: window.devicePixelRatio || 1,
  };
}

function rectFrom(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function selectQrRegion() {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("popover", "manual");
    const shadow = host.attachShadow({ mode: "closed" });
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;cursor:crosshair;background:rgba(0,0,0,.35)";
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;border:2px solid #0a84ff;background:rgba(10,132,255,.18);display:none;pointer-events:none";
    const hint = document.createElement("div");
    hint.textContent = "Drag around the QR code. Esc to cancel.";
    hint.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);background:Canvas;color:CanvasText;color-scheme:light dark;padding:8px 12px;border-radius:10px;font:13px system-ui,sans-serif";
    shadow.append(overlay, box, hint);
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      margin: "0",
      padding: "0",
      border: "none",
      background: "transparent",
      zIndex: "2147483647",
      width: "100%",
      height: "100%",
    });
    (document.body || document.documentElement).appendChild(host);
    try { host.showPopover(); } catch {}
    let start = null;
    let done = false;
    const finish = (rect) => {
      if (done) return;
      done = true;
      window.removeEventListener("keydown", onKey, true);
      host.remove();
      if (!rect) {
        resolve(null);
        return;
      }
      resolve({
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        dpr: window.devicePixelRatio || 1,
      });
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    };
    overlay.addEventListener("pointerdown", (e) => {
      overlay.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      box.style.display = "block";
    });
    overlay.addEventListener("pointermove", (e) => {
      if (!start) return;
      const r = rectFrom(start, { x: e.clientX, y: e.clientY });
      Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    });
    overlay.addEventListener("pointerup", (e) => {
      if (!start) return;
      const r = rectFrom(start, { x: e.clientX, y: e.clientY });
      finish(r.w < 8 || r.h < 8 ? null : r);
    });
    window.addEventListener("keydown", onKey, true);
  });
}

export function hideTotpBar() {
  if (totpOnMsg) {
    window.removeEventListener("message", totpOnMsg);
    totpOnMsg = null;
  }
  if (!totpHost) return;
  try { totpHost.hidePopover?.(); } catch {}
  totpHost.remove();
  totpHost = null;
}

export function showTotpBar(payload) {
  hideTotpBar();
  const host = document.createElement("div");
  host.setAttribute("data-passbridge-totp", "1");
  host.setAttribute("popover", "manual");
  const shadow = host.attachShadow({ mode: "closed" });
  const iframe = document.createElement("iframe");
  const token = Math.random().toString(36).slice(2);
  const height = payload.mode === "matches" ? 280 : payload.mode === "error" ? 132 : 168;
  Object.assign(iframe.style, {
    width: "360px",
    height: `${height}px`,
    border: "none",
    background: "transparent",
  });
  shadow.appendChild(iframe);
  Object.assign(host.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    margin: "0",
    padding: "0",
    border: "none",
    background: "transparent",
    zIndex: "2147483647",
    width: "360px",
    height: `${height}px`,
  });
  (document.body || document.documentElement).appendChild(host);
  try { host.showPopover(); } catch {}
  totpHost = host;
  const paint = () => {
    iframe.contentWindow?.postMessage({
      token,
      type: "totp-bar",
      mode: payload.mode,
      issuer: payload.issuer || "",
      account: payload.account || "",
      usernames: payload.usernames || [],
      error: payload.error || "",
    }, "*");
  };
  iframe.addEventListener("load", paint);
  iframe.src = chrome.runtime.getURL(`overlay/totp-bar.html?token=${token}`);
  const onMsg = (e) => {
    if (e.source !== iframe.contentWindow || e.data?.token !== token) return;
    if (e.data.action === "ready") {
      paint();
      return;
    }
    const action = e.data.action;
    hideTotpBar();
    if (action === "choose" || action === "create") {
      chrome.runtime.sendMessage({ type: "confirmTotp" }).catch(() => {});
    } else {
      chrome.runtime.sendMessage({ type: "dismissTotp" }).catch(() => {});
    }
  };
  totpOnMsg = onMsg;
  window.addEventListener("message", onMsg);
}
