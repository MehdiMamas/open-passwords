// User-facing defaults. Content scripts repeat this object because they are not modules.

export const SETTINGS_DEFAULTS = {
  inlineMenuVisibility: "on-focus",
  autofillOnPageLoad: false,
  copyTotpAfterFill: true,
  clipboardClearMs: 30000,
  enableContextMenu: true,
  enableBadge: true,
  askToSave: true,
  askToUpdate: true,
  excludedDomains: [],
  blockedDomains: [],
  showAnimations: true,
  showFavicons: true,
};

export function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_DEFAULTS, (o) => {
      if (chrome.runtime.lastError) resolve({ ...SETTINGS_DEFAULTS });
      else resolve({ ...SETTINGS_DEFAULTS, ...o });
    });
  });
}

export function hostBlocked(host, list) {
  host = (host || "").toLowerCase();
  return (list || []).some((d) => {
    d = String(d || "").trim().toLowerCase();
    if (!d) return false;
    return host === d || host.endsWith("." + d);
  });
}
