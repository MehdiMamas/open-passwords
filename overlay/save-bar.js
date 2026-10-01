const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const update = params.get("update") === "1";
const user = params.get("user") || "";

const root = document.createElement("div");
root.setAttribute("data-passbridge", "save-bar");
root.style.cssText = [
  "box-sizing:border-box",
  "width:360px",
  "padding:14px 14px 12px",
  "border-radius:14px",
  "background:Canvas",
  "color:CanvasText",
  "color-scheme:light dark",
  "border:1px solid rgba(128,128,128,0.35)",
  "box-shadow:0 12px 32px rgba(0,0,0,0.22)",
  "font:13px/1.4 system-ui,sans-serif",
].join(";");

const title = document.createElement("div");
title.textContent = update ? "Update password in iCloud Passwords?" : "Save login to iCloud Passwords?";
title.style.cssText = "font-weight:650;margin-bottom:4px";
const sub = document.createElement("div");
sub.textContent = user ? user : "Apple's save sheet still asks you to confirm.";
sub.style.cssText = "opacity:.7;margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
const row = document.createElement("div");
row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";

function button(label, action, primary) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = primary
    ? "background:#0a84ff;color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer"
    : "background:transparent;color:inherit;border:none;padding:6px 8px;cursor:pointer;opacity:.8";
  b.addEventListener("click", () => parent.postMessage({ token, action }, "*"));
  return b;
}

row.append(
  button("Never for this site", "never", false),
  button("Not now", "dismiss", false),
  button(update ? "Update" : "Save", "save", true),
);
root.append(title, sub, row);
document.body.appendChild(root);
