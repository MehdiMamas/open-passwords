// Port names match Bitwarden autofill-overlay.enum.ts at the pinned commit.
// See vendor/bitwarden and BITWARDEN.md. Messages without the per-tab key are dropped.

export const INLINE_MENU_PORTS = new Set([
  "autofill-inline-menu-button-port",
  "autofill-inline-menu-list-port",
  "autofill-inline-menu-button-message-connector",
  "autofill-inline-menu-list-message-connector",
]);

const keys = new Map();

export function portKeyForTab(tabId) {
  const id = tabId ?? 0;
  if (!keys.has(id)) {
    const bytes = crypto.getRandomValues(new Uint8Array(9));
    keys.set(id, [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12));
  }
  return keys.get(id);
}

export function dropPortKey(tabId) {
  keys.delete(tabId);
}
