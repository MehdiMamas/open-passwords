const CHECKS = [
  "autofillOnPageLoad",
  "copyTotpAfterFill",
  "enableContextMenu",
  "enableBadge",
  "showAnimations",
  "showFavicons",
  "askToSave",
  "askToUpdate",
  "hidePasskeys",
  "autoPair",
];
const DEFAULTS = {
  inlineMenuVisibility: "on-focus",
  autofillOnPageLoad: false,
  copyTotpAfterFill: true,
  clipboardClearMs: 30000,
  enableContextMenu: true,
  enableBadge: true,
  askToSave: true,
  askToUpdate: true,
  showAnimations: true,
  showFavicons: true,
  excludedDomains: [],
  blockedDomains: [],
  hidePasskeys: false,
  autoPair: false,
};

function lines(id) {
  return document.getElementById(id).value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function policyMsg(action) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage("com.passbridge.policy", { action }, (resp) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(resp || { error: "no reply" });
      });
    } catch (e) {
      resolve({ error: String(e) });
    }
  });
}

document.getElementById("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

chrome.storage.local.get(DEFAULTS, (o) => {
  const saved = { ...DEFAULTS, ...o };
  document.getElementById("inlineMenuVisibility").value = saved.inlineMenuVisibility;
  document.getElementById("clipboardClearMs").value = String(saved.clipboardClearMs);
  document.getElementById("excludedDomains").value = (saved.excludedDomains || []).join("\n");
  document.getElementById("blockedDomains").value = (saved.blockedDomains || []).join("\n");
  for (const id of CHECKS) {
    const el = document.getElementById(id);
    if (el) el.checked = !!saved[id];
  }
  document.getElementById("pk-toggle").checked = !!saved.hidePasskeys;
  document.getElementById("autopair-toggle").checked = !!saved.autoPair;
});

function persist(partial) {
  chrome.storage.local.set(partial);
}

document.getElementById("inlineMenuVisibility").addEventListener("change", (e) => persist({ inlineMenuVisibility: e.target.value }));
document.getElementById("clipboardClearMs").addEventListener("change", (e) => persist({ clipboardClearMs: Number(e.target.value) }));
for (const id of ["autofillOnPageLoad", "copyTotpAfterFill", "enableContextMenu", "enableBadge", "showAnimations", "showFavicons", "askToSave", "askToUpdate"]) {
  document.getElementById(id).addEventListener("change", (e) => persist({ [id]: e.target.checked }));
}
document.getElementById("excludedDomains").addEventListener("change", () => persist({ excludedDomains: lines("excludedDomains") }));
document.getElementById("blockedDomains").addEventListener("change", () => persist({ blockedDomains: lines("blockedDomains") }));

const pmToggle = document.getElementById("pm-toggle");
const pmNote = document.getElementById("pm-note");
function renderPmToggle() {
  const pref = chrome.privacy?.services?.passwordSavingEnabled;
  const row = document.getElementById("pm-row");
  if (!pref?.get) return;
  pref.get({}, (d) => {
    if (chrome.runtime.lastError || !d) return;
    row.hidden = false;
    pmToggle.checked = d.value === false;
    const controllable = d.levelOfControl === "controllable_by_this_extension" || d.levelOfControl === "controlled_by_this_extension";
    pmToggle.disabled = !controllable;
    pmNote.textContent = controllable ? "" : "controlled elsewhere";
  });
}
pmToggle.addEventListener("change", () => {
  const pref = chrome.privacy?.services?.passwordSavingEnabled;
  if (!pref) return;
  const on = pmToggle.checked;
  chrome.storage.local.set({ suppressSaveBubble: on });
  if (on) pref.set({ value: false }, renderPmToggle);
  else pref.clear({}, renderPmToggle);
});
renderPmToggle();

const policyToggle = document.getElementById("policy-toggle");
const policyNote = document.getElementById("policy-note");
async function renderPolicyToggle() {
  const r = await policyMsg("get");
  if (r.error || !r.ok) {
    policyToggle.disabled = true;
    policyNote.textContent = "needs native/install.sh or native/windows/install.ps1";
    return;
  }
  policyToggle.disabled = false;
  policyToggle.checked = !!r.hidden;
  policyNote.textContent = r.note || "";
}
policyToggle.addEventListener("change", async () => {
  const on = policyToggle.checked;
  const r = await policyMsg(on ? "set" : "clear");
  if (r.error || !r.ok) {
    policyNote.textContent = r.error || "helper failed";
    policyToggle.checked = !on;
    return;
  }
  policyToggle.checked = !!r.hidden;
  policyNote.textContent = r.note || "";
});
renderPolicyToggle();

const afToggle = document.getElementById("af-toggle");
const afNote = document.getElementById("af-note");
function renderAfToggle() {
  const pref = chrome.privacy?.services?.autofillAddressEnabled;
  const row = document.getElementById("af-row");
  if (!pref?.get) return;
  pref.get({}, (d) => {
    if (chrome.runtime.lastError || !d) return;
    row.hidden = false;
    afToggle.checked = d.value === false;
    const controllable = d.levelOfControl === "controllable_by_this_extension" || d.levelOfControl === "controlled_by_this_extension";
    afToggle.disabled = !controllable;
    afNote.textContent = controllable ? "" : "controlled elsewhere";
  });
}
afToggle.addEventListener("change", () => {
  const pref = chrome.privacy?.services?.autofillAddressEnabled;
  if (!pref) return;
  const on = afToggle.checked;
  chrome.storage.local.set({ suppressAddressAutofill: on });
  if (on) pref.set({ value: false }, renderAfToggle);
  else pref.clear({}, renderAfToggle);
});
renderAfToggle();

document.getElementById("pk-toggle").addEventListener("change", (e) => persist({ hidePasskeys: e.target.checked }));
document.getElementById("autopair-toggle").addEventListener("change", async (e) => {
  const on = e.target.checked;
  persist({ autoPair: on });
  const note = document.getElementById("autopair-note");
  if (!on) {
    note.textContent = "";
    return;
  }
  const r = await send({ type: "autoPairCheck" });
  note.textContent = r?.ok ? "on" : (r?.error || "the reader could not reach the pairing window");
});
