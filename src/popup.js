let platformOs = "mac";
let deviceLabel = "your Mac";

function helperInstallHint() {
  return platformOs === "win" ? "run native/windows/install.ps1" : "run native/install.sh";
}

function applyPlatformCopy() {
  const nohelper = document.getElementById("nohelper-msg");
  const store = document.getElementById("nohelper-link");
  const pinMsg = document.getElementById("pin-msg");
  if (platformOs === "win") {
    nohelper.textContent =
      "Couldn't reach Apple's password helper. Install iCloud for Windows, turn on Passwords, then " +
      helperInstallHint() +
      " and fully quit the browser.";
    store.hidden = false;
    pinMsg.textContent =
      "A verification code was sent by iCloud for Windows. Enter it to grant access. If this popup closes when the code appears, click the toolbar icon again.";
  } else {
    nohelper.textContent =
      "Couldn't reach Apple's password helper. This needs macOS 14+ with the Passwords app, and the extension must run with Apple's accepted ID.";
    store.hidden = true;
    pinMsg.textContent = "A verification code was generated on your Mac. Enter it to grant access.";
  }
}

document.getElementById("icloud-store").addEventListener("click", (e) => {
  e.preventDefault();
  const storeUrl = "ms-windows-store://pdp/?productid=9PKTQ5699M62";
  chrome.tabs.create({ url: storeUrl }, () => {
    if (chrome.runtime.lastError) {
      chrome.tabs.create({ url: "https://apps.microsoft.com/detail/9pktq5699m62" });
    }
  });
});

const views = {
  nohelper: document.getElementById("view-nohelper"),
  pin: document.getElementById("view-pin"),
  connecting: document.getElementById("view-connecting"),
  unlocked: document.getElementById("view-unlocked"),
};
const dot = document.getElementById("dot");
const pinInput = document.getElementById("pin");
const pinError = document.getElementById("pin-error");
const refreshBtn = document.getElementById("refresh");

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
}

document.getElementById("open-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

let showFavicons = true;

function setDot(state) {
  dot.className = "dot";
  if (state === "unlocked") {
    dot.classList.add("ok");
    dot.title = "Unlocked";
  } else if (state === "needs_pin") {
    dot.classList.add("warn");
    dot.title = "Needs the verification code";
  } else if (state === "no_helper") {
    dot.classList.add("err");
    dot.title = "Password helper unavailable";
  } else {
    dot.title = "Connecting";
  }
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let lastState = "disconnected";

async function render(state) {
  lastState = state;
  setDot(state);
  refreshBtn.hidden = state !== "unlocked" && state !== "needs_pin";
  if (state === "no_helper") return show("nohelper");
  if (state === "disconnected") return show("connecting");
  if (state === "needs_pin") {
    show("pin");
    pinInput.focus();
    return;
  }
  if (state === "unlocked") {
    await renderLogins();
    show("unlocked");
    renderCodes();
    renderAppLinks();
    return;
  }
  // unknown state must never leave every view hidden (blank popup)
  show("connecting");
}

async function renderLogins() {
  const tab = await activeTab();
  document.getElementById("site").textContent = tab?.url ? new URL(tab.url).hostname : "";
  const list = document.getElementById("logins");
  const none = document.getElementById("nologins");
  list.innerHTML = "";
  none.hidden = true;

  const res = await send({ type: "getLogins", tabId: tab.id, url: tab.url });
  if (!res?.ok) {
    none.hidden = false;
    none.textContent = res?.error ?? "Couldn't load logins.";
    return;
  }
  if (!res.logins.length) {
    none.hidden = false;
    return;
  }
  const host = tab?.url ? new URL(tab.url).hostname : "";
  for (const login of res.logins) {
    const li = document.createElement("li");
    li.className = "account";
    const who = document.createElement("div");
    who.className = "who";
    if (showFavicons && host) {
      const icon = document.createElement("img");
      icon.className = "favicon";
      icon.alt = "";
      icon.width = 16;
      icon.height = 16;
      icon.src = `https://icons.duckduckgo.com/ip3/${host}.ico`;
      who.appendChild(icon);
    }
    const u = document.createElement("span");
    u.className = "u";
    u.textContent = login.username || "(no username)";
    u.title = login.username || "";
    who.appendChild(u);
    const fill = document.createElement("button");
    fill.className = "fill";
    fill.type = "button";
    fill.textContent = "Fill";
    const err = document.createElement("p");
    err.className = "error fill-error";
    err.hidden = true;
    fill.addEventListener("click", async () => {
      fill.disabled = true;
      err.hidden = true;
      const r = await send({ type: "fillOnPage", tabId: tab.id, url: tab.url, loginName: login });
      if (r?.ok && r.filled) {
        window.close();
        return;
      }
      fill.disabled = false;
      err.textContent = r?.error || "Couldn't find a login form on this page.";
      err.hidden = false;
    });
    const copies = document.createElement("div");
    copies.className = "copies";
    const copyUser = document.createElement("button");
    copyUser.className = "copy";
    copyUser.type = "button";
    copyUser.textContent = "Copy username";
    copyUser.addEventListener("click", () => send({ type: "copyField", field: "username", username: login.username }));
    const copyPass = document.createElement("button");
    copyPass.className = "copy";
    copyPass.type = "button";
    copyPass.textContent = "Copy password";
    copyPass.addEventListener("click", () => send({ type: "copyField", field: "password", username: login.username }));
    copies.append(copyUser, copyPass);
    li.append(who, fill, err, copies);
    list.appendChild(li);
  }
}

document.getElementById("lookup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = document.getElementById("lookup-site").value.trim();
  if (!raw) return;
  const res = await send({ type: "lookupLogins", url: raw });
  const list = document.getElementById("logins");
  const none = document.getElementById("nologins");
  list.innerHTML = "";
  document.getElementById("site").textContent = res?.host || raw;
  if (!res?.ok || !res.logins?.length) {
    none.hidden = false;
    none.textContent = res?.error || "No saved passwords for that site.";
    return;
  }
  none.hidden = true;
  for (const login of res.logins) {
    const li = document.createElement("li");
    const u = document.createElement("span");
    u.className = "u";
    u.textContent = login.username || "(no username)";
    li.appendChild(u);
    list.appendChild(li);
  }
});

async function renderCodes() {
  const list = document.getElementById("codes");
  list.innerHTML = "";
  list.hidden = true;
  const res = await send({ type: "getOneTimeCodes" });
  if (!res?.ok || !res.rows?.length) return;
  for (const row of res.rows) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "u";
    const label = document.createElement("span");
    label.className = "code-label";
    label.textContent =
      row.source === "totp"
        ? row.domain
          ? `Verification code for ${row.domain}`
          : "Verification code"
        : "Code from Messages";
    text.appendChild(label);
    if (row.username) {
      const sub = document.createElement("span");
      sub.className = "subnote";
      sub.textContent = row.username;
      text.appendChild(sub);
    }
    const fill = document.createElement("button");
    fill.textContent = "Fill";
    fill.addEventListener("click", async () => {
      fill.disabled = true;
      const r = await send({ type: "fillOneTimeCode", id: row.id });
      if (r?.ok && r.filled) return window.close();
      if (r?.ok && r.code) {
        fill.replaceWith(codeBadge(r.code));
        return;
      }
      fill.disabled = false;
      flashNote(r?.error ? `Couldn't read the code: ${r.error}` : "Couldn't read the code");
    });
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.addEventListener("click", () => send({ type: "copyField", field: "otp", id: row.id }));
    li.append(text, copy, fill);
    list.appendChild(li);
  }
  list.hidden = false;
}

function codeBadge(code) {
  const b = document.createElement("span");
  b.className = "code-value";
  b.textContent = code;
  b.title = "Current code";
  return b;
}

let caps = {};
let pageTotpUri = null;
async function renderAppLinks() {
  document.getElementById("new-login").hidden = !caps.newPasswordSheet;
  const totpBtn = document.getElementById("setup-totp");
  totpBtn.hidden = true;
  pageTotpUri = null;
  if (!caps.setUpTotp) return;
  try {
    const tab = await activeTab();
    if (!tab?.id) return;
    const r = await chrome.tabs.sendMessage(tab.id, { type: "findTotpUri" }, { frameId: 0 });
    const uri = r?.uris?.[0];
    if (!uri) return;
    pageTotpUri = uri;
    totpBtn.hidden = false;
  } catch (_) {}
}

document.getElementById("open-app").addEventListener("click", async () => {
  await send({ type: "openPasswordsApp", mode: "search" });
  window.close();
});
document.getElementById("new-login").addEventListener("click", async () => {
  await send({ type: "openPasswordsApp", mode: "new" });
  window.close();
});
document.getElementById("setup-totp").addEventListener("click", async () => {
  if (!pageTotpUri) return;
  await send({ type: "openPasswordsApp", mode: "totp", uri: pageTotpUri });
  window.close();
});

document.getElementById("verify").addEventListener("click", async () => {
  pinError.hidden = true;
  const pin = pinInput.value.trim();
  if (pin.length < 4) return;
  const res = await send({ type: "verifyPin", pin });
  if (res?.ok) render(res.state);
  else {
    // a failed attempt spends the code, so the background put a fresh one on the Mac
    const base = res?.error ?? "Verification failed.";
    pinError.textContent = res?.newCode ? `${base} - enter the new code on ${deviceLabel}` : base;
    pinError.hidden = false;
    pinInput.value = "";
    pinInput.focus();
  }
});

pinInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("verify").click();
});
pinInput.addEventListener("input", () => {
  if (pinInput.value.trim().length === 6) document.getElementById("verify").click();
});

let noteTimer = null;
function flashNote(text) {
  const el = document.getElementById("refresh-note");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (el.hidden = true), 2500);
}

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  refreshBtn.classList.add("spinning");
  if (lastState === "needs_pin") {
    pinError.hidden = true;
    pinInput.value = "";
    const res = await send({ type: "requestChallenge" });
    if (res?.ok) render(res.state);
    else {
      pinError.textContent = res?.error ?? "Couldn't request a code.";
      pinError.hidden = false;
    }
  } else {
    const r = await send({ type: "refreshAndRefill" });
    await renderLogins();
    renderCodes();
    if (r?.refilled) flashNote(`Re-filled ${r.username} with the latest password`);
    else flashNote("Passwords refreshed");
  }
  refreshBtn.classList.remove("spinning");
  refreshBtn.disabled = false;
});

document.getElementById("newcode").addEventListener("click", async () => {
  pinError.hidden = true;
  const res = await send({ type: "requestChallenge" });
  if (res?.ok) render(res.state);
  else {
    pinError.textContent = res?.error ?? "Couldn't request a code.";
    pinError.hidden = false;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "state") {
    // capabilities arrive with the hello, which precedes the first state change
    send({ type: "getState" }).then((r) => {
      caps = r?.caps || caps;
      render(msg.state);
    });
  }
});

(async () => {
  const plat = await send({ type: "getPlatform" });
  if (plat?.os) platformOs = plat.os;
  if (plat?.label) deviceLabel = plat.label;
  applyPlatformCopy();
  const res = await send({ type: "getState" });
  caps = res?.caps || {};
  showFavicons = res?.settings?.showFavicons !== false;
  let state = res?.state ?? "disconnected";
  if (state === "needs_pin") {
    // never on top of a code thats already showing, a second prompt kills the first code
    const ch = await send({ type: "requestChallenge", ifNeeded: true });
    state = ch?.state ?? state;
  }
  render(state);
})();
