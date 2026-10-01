import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send } from "./chrome.js";
import { PopupScreen } from "./popup-screen.jsx";

function PopupApp() {
  const [state, setState] = useState("connecting");
  const [os, setOs] = useState("mac");
  const [label, setLabel] = useState("your Mac");
  const [site, setSite] = useState("");
  const [logins, setLogins] = useState([]);
  const [codes, setCodes] = useState([]);
  const [caps, setCaps] = useState({});
  const [note, setNote] = useState("");
  const [pinError, setPinError] = useState("");
  const [showFavicons, setShowFavicons] = useState(true);
  const [tab, setTab] = useState(null);

  async function loadUnlocked() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    setTab(active || null);
    const host = active?.url ? new URL(active.url).hostname : "";
    setSite(host);
    const res = await send({ type: "getLogins", tabId: active?.id, url: active?.url });
    setLogins(res?.ok ? res.logins || [] : []);
    const codeRes = await send({ type: "getOneTimeCodes" });
    setCodes(codeRes?.rows || []);
  }

  async function applyState(next, nextCaps) {
    setState(next);
    if (nextCaps) setCaps(nextCaps);
    if (next === "unlocked") await loadUnlocked();
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      const res = await send({ type: "getState" });
      if (dead || !res) return;
      if (res.os) setOs(res.os);
      if (res.label) setLabel(res.label);
      setShowFavicons(res.settings?.showFavicons !== false);
      setCaps(res.caps || {});
      let next = res.state || "connecting";
      if (next === "disconnected") next = "connecting";
      if (next === "needs_pin") {
        const ch = await send({ type: "requestChallenge", ifNeeded: true });
        next = ch?.state || next;
      }
      await applyState(next, res.caps);
    })();
    const onMsg = (msg) => {
      if (msg?.type === "state") applyState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => {
      dead = true;
      chrome.runtime.onMessage.removeListener(onMsg);
    };
  }, []);

  return (
    <PopupScreen
      state={state}
      os={os}
      label={label}
      site={site}
      logins={logins}
      codes={codes}
      caps={caps}
      note={note}
      pinError={pinError}
      showFavicons={showFavicons}
      onVerify={async (pin) => {
        if (pin.length < 4) return false;
        setPinError("");
        const res = await send({ type: "verifyPin", pin });
        if (res?.ok) {
          await applyState(res.state);
          return true;
        }
        setPinError(res?.newCode ? `${res.error || "Verification failed."} — enter the new code on ${label}` : res?.error || "Verification failed.");
        return false;
      }}
      onNewCode={async () => {
        setPinError("");
        const res = await send({ type: "requestChallenge" });
        if (!res?.ok) setPinError(res?.error || "Couldn't request a code.");
        else await applyState(res.state);
      }}
      onFill={async (login) => {
        const res = await send({ type: "fillOnPage", tabId: tab?.id, url: tab?.url, loginName: login });
        if (res?.ok && res.filled) window.close();
        else setNote(res?.error || "Couldn't find a login form on this page.");
      }}
      onFillCode={async (row) => {
        const res = await send({ type: "fillOneTimeCode", id: row.id });
        if (res?.ok && res.filled) window.close();
        else if (!(res?.ok && res.code)) setNote(res?.error ? `Couldn't read the code: ${res.error}` : "Couldn't read the code");
        return res;
      }}
      onCopy={(field, login) => {
        if (field === "otp") send({ type: "copyField", field: "otp", id: login.id });
        else send({ type: "copyField", field, username: login.username });
      }}
      onLookup={async (raw) => {
        if (!raw) return;
        const res = await send({ type: "lookupLogins", url: raw });
        setSite(res?.host || raw);
        setLogins(res?.ok ? res.logins || [] : []);
      }}
      onOpenApp={async (mode) => {
        await send({ type: "openPasswordsApp", mode });
        window.close();
      }}
      onNewLogin={() => {}}
      onSetupTotp={async () => {
        if (!tab?.id) return;
        try {
          const found = await chrome.tabs.sendMessage(tab.id, { type: "findTotpUri" }, { frameId: 0 });
          const uri = found?.uris?.[0];
          if (!uri) return;
          await send({ type: "openPasswordsApp", mode: "totp", uri });
          window.close();
        } catch {}
      }}
      onRefresh={async () => {
        if (state === "needs_pin") {
          const res = await send({ type: "requestChallenge" });
          if (res?.ok) await applyState(res.state);
          else setPinError(res?.error || "Couldn't request a code.");
          return;
        }
        const res = await send({ type: "refreshAndRefill" });
        await loadUnlocked();
        setNote(res?.refilled ? `Re-filled ${res.username} with the latest password` : "Passwords refreshed");
      }}
      onSettings={() => chrome.runtime.openOptionsPage()}
    />
  );
}

createRoot(document.getElementById("root")).render(<PopupApp />);
