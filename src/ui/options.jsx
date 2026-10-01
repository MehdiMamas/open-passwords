import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send } from "./chrome.js";

const CHECKS = [
  ["autofillOnPageLoad", "Autofill on page load", "Off by default. A single match can ask for Touch ID or Windows Hello as the page opens."],
  ["copyTotpAfterFill", "Copy verification code after fill", ""],
  ["enableContextMenu", "Context menu", ""],
  ["enableBadge", "Badge count on the toolbar icon", ""],
  ["showAnimations", "Fill animation", ""],
  ["showFavicons", "Website icons", ""],
  ["askToSave", "Ask to save a new login", ""],
  ["askToUpdate", "Ask to update an existing login", ""],
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

function Row({ label, note, children }) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-[color-mix(in_srgb,CanvasText_8%,Canvas)] py-2.5 text-[13px]">
      <span>
        {label}
        {note && <span className="mt-0.5 block text-[11px] text-[color-mix(in_srgb,CanvasText_55%,Canvas)]">{note}</span>}
      </span>
      {children}
    </label>
  );
}

function Switch({ checked, onChange, disabled }) {
  return (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 shrink-0 accent-ok"
    />
  );
}

function OptionsApp() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [excludedText, setExcludedText] = useState("");
  const [blockedText, setBlockedText] = useState("");
  const [policy, setPolicy] = useState({ disabled: true, hidden: false, note: "needs native/install.sh or native/windows/install.ps1" });
  const [bubble, setBubble] = useState({ shown: false, checked: false, disabled: true, note: "" });
  const [address, setAddress] = useState({ shown: false, checked: false, disabled: true, note: "" });
  const [autoNote, setAutoNote] = useState("");

  useEffect(() => {
    chrome.storage.local.get(DEFAULTS, (saved) => {
      const next = { ...DEFAULTS, ...saved };
      setSettings(next);
      setExcludedText((next.excludedDomains || []).join("\n"));
      setBlockedText((next.blockedDomains || []).join("\n"));
    });
    sendPolicy("get").then((r) => {
      if (r.error || !r.ok) return;
      setPolicy({ disabled: false, hidden: !!r.hidden, note: r.note || "" });
    });
    readPrivacy("passwordSavingEnabled", setBubble);
    readPrivacy("autofillAddressEnabled", setAddress);
  }, []);

  function persist(partial) {
    const next = { ...settings, ...partial };
    setSettings(next);
    chrome.storage.local.set(partial);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <header className="mb-6 flex items-center gap-2">
        <img src="../icons/icon48.png" alt="" width="28" height="28" />
        <h1 className="text-lg font-semibold">PassBridge</h1>
      </header>
      <section>
        <h2 className="mb-1 text-xs font-semibold tracking-wide uppercase opacity-60">Autofill</h2>
        <Row label="Inline menu">
          <select
            value={settings.inlineMenuVisibility}
            onChange={(e) => persist({ inlineMenuVisibility: e.target.value })}
            className="rounded-lg border border-[color-mix(in_srgb,CanvasText_16%,Canvas)] bg-[Canvas] px-2 py-1"
          >
            <option value="on-focus">Show on field focus</option>
            <option value="on-click">Show when the icon is clicked</option>
            <option value="off">Off</option>
          </select>
        </Row>
        {CHECKS.map(([id, label, note]) => (
          <Row key={id} label={label} note={note}>
            <Switch checked={settings[id]} onChange={(on) => persist({ [id]: on })} />
          </Row>
        ))}
        <Row label="Clear clipboard">
          <select
            value={String(settings.clipboardClearMs)}
            onChange={(e) => persist({ clipboardClearMs: Number(e.target.value) })}
            className="rounded-lg border border-[color-mix(in_srgb,CanvasText_16%,Canvas)] bg-[Canvas] px-2 py-1"
          >
            <option value="0">Never</option>
            <option value="10000">10 seconds</option>
            <option value="20000">20 seconds</option>
            <option value="30000">30 seconds</option>
            <option value="60000">1 minute</option>
            <option value="300000">5 minutes</option>
          </select>
        </Row>
        <p className="py-2">
          <button type="button" className="text-[13px] text-accent" onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}>
            Keyboard shortcuts
          </button>
        </p>
      </section>
      <section className="mt-6">
        <h2 className="mb-1 text-xs font-semibold tracking-wide uppercase opacity-60">Save prompts</h2>
        <label className="mb-3 block text-[13px]">
          Excluded domains
          <span className="mb-1 block text-[11px] opacity-60">One hostname per line. PassBridge will not offer to save these.</span>
          <textarea
            value={excludedText}
            onChange={(e) => setExcludedText(e.target.value)}
            onBlur={() => persist({ excludedDomains: lines(excludedText) })}
            className="mt-1 min-h-16 w-full rounded-lg border border-[color-mix(in_srgb,CanvasText_16%,Canvas)] bg-[Canvas] p-2"
          />
        </label>
        <label className="block text-[13px]">
          Blocked domains
          <span className="mb-1 block text-[11px] opacity-60">One hostname per line. No inline menu on these sites.</span>
          <textarea
            value={blockedText}
            onChange={(e) => setBlockedText(e.target.value)}
            onBlur={() => persist({ blockedDomains: lines(blockedText) })}
            className="mt-1 min-h-16 w-full rounded-lg border border-[color-mix(in_srgb,CanvasText_16%,Canvas)] bg-[Canvas] p-2"
          />
        </label>
      </section>
      <section className="mt-6">
        <h2 className="mb-1 text-xs font-semibold tracking-wide uppercase opacity-60">This browser</h2>
        {bubble.shown && (
          <Row label="Hide browser save-password bubble" note={bubble.note}>
            <Switch checked={bubble.checked} disabled={bubble.disabled} onChange={(on) => setPrivacy("passwordSavingEnabled", on, setBubble, "suppressSaveBubble")} />
          </Row>
        )}
        <Row label="Hide browser password manager entirely" note={policy.note}>
          <Switch
            checked={policy.hidden}
            disabled={policy.disabled}
            onChange={async (on) => {
              const r = await sendPolicy(on ? "set" : "clear");
              if (r.error || !r.ok) setPolicy((p) => ({ ...p, note: r.error || "helper failed" }));
              else setPolicy({ disabled: false, hidden: !!r.hidden, note: r.note || "" });
            }}
          />
        </Row>
        {address.shown && (
          <Row label="Hide browser autofill suggestions" note={address.note}>
            <Switch checked={address.checked} disabled={address.disabled} onChange={(on) => setPrivacy("autofillAddressEnabled", on, setAddress, "suppressAddressAutofill")} />
          </Row>
        )}
        <Row label="Hide passkey autofill">
          <Switch checked={settings.hidePasskeys} onChange={(on) => persist({ hidePasskeys: on })} />
        </Row>
        <Row label="Enter the pairing code for me" note={autoNote}>
          <Switch
            checked={settings.autoPair}
            onChange={async (on) => {
              persist({ autoPair: on });
              if (!on) {
                setAutoNote("");
                return;
              }
              const r = await send({ type: "autoPairCheck" });
              setAutoNote(r?.ok ? "Pairing code reader is available." : r?.error || "the reader could not reach the pairing window");
            }}
          />
        </Row>
      </section>
    </div>
  );
}

function lines(value) {
  return value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

function sendPolicy(action) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage("com.passbridge.policy", { action }, (resp) => {
        if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
        else resolve(resp || { error: "no reply" });
      });
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function readPrivacy(name, setRow) {
  const pref = chrome.privacy?.services?.[name];
  if (!pref?.get) return;
  pref.get({}, (d) => {
    if (chrome.runtime.lastError || !d) return;
    const controllable = d.levelOfControl === "controllable_by_this_extension" || d.levelOfControl === "controlled_by_this_extension";
    setRow({ shown: true, checked: d.value === false, disabled: !controllable, note: controllable ? "" : "controlled elsewhere" });
  });
}

function setPrivacy(name, on, setRow, storageKey) {
  const pref = chrome.privacy?.services?.[name];
  if (!pref) return;
  chrome.storage.local.set({ [storageKey]: on });
  const done = () => readPrivacy(name, setRow);
  if (on) pref.set({ value: false }, done);
  else pref.clear({}, done);
}

createRoot(document.getElementById("root")).render(<OptionsApp />);
