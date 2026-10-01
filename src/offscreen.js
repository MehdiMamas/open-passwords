let timer = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "offscreenCopy") return;
  const text = String(msg.text || "");
  const clearMs = Number(msg.clearMs) || 0;
  navigator.clipboard.writeText(text).catch(() => {});
  if (timer) clearTimeout(timer);
  if (clearMs > 0) {
    timer = setTimeout(() => {
      navigator.clipboard.writeText("").catch(() => {});
    }, clearMs);
  }
});
