import jsQR from "jsqr";

let timer = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "offscreenCopy") {
    const text = String(msg.text || "");
    const clearMs = Number(msg.clearMs) || 0;
    navigator.clipboard.writeText(text).catch(() => {});
    if (timer) clearTimeout(timer);
    if (clearMs > 0) {
      timer = setTimeout(() => {
        navigator.clipboard.writeText("").catch(() => {});
      }, clearMs);
    }
    return false;
  }
  if (msg?.type !== "offscreenDecodeQr") return false;
  decodeQr(msg.dataUrl, msg.rect)
    .then((values) => sendResponse({ ok: true, values }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read the screenshot."));
    img.src = url;
  });
}

function readQr(img, x, y, w, h, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
  return code?.data ? [code.data] : [];
}

async function decodeQr(dataUrl, rect) {
  const img = await loadImage(dataUrl);
  const dpr = Number(rect?.dpr) || 1;
  const pad = 16 * dpr;
  let x = Math.floor((Number(rect?.x) || 0) * dpr - pad);
  let y = Math.floor((Number(rect?.y) || 0) * dpr - pad);
  let w = Math.floor((Number(rect?.w) || 0) * dpr + pad * 2);
  let h = Math.floor((Number(rect?.h) || 0) * dpr + pad * 2);
  if (x < 0) { w += x; x = 0; }
  if (y < 0) { h += y; y = 0; }
  if (x + w > img.width) w = img.width - x;
  if (y + h > img.height) h = img.height - y;
  w = Math.max(1, w);
  h = Math.max(1, h);
  const scale = Math.max(1, Math.min(3, 240 / Math.max(w, h)));
  const first = readQr(img, x, y, w, h, scale);
  if (first.length) return first;
  if (scale >= 2) return [];
  return readQr(img, x, y, w, h, Math.min(3, scale * 2));
}
