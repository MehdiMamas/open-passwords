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
  const [noteTone, setNoteTone] = useState("");
  const [pinError, setPinError] = useState("");
  const [showFavicons, setShowFavicons] = useState(true);
  const [tab, setTab] = useState(null);
  const [lookupUrl, setLookupUrl] = useState(null);

  function showNote(text, tone) {
    setNote(text || "");
    setNoteTone(tone || "");
  }

  async function loadUnlocked() {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    setTab(active || null);
    setLookupUrl(null);
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

  async function bootFrom(res) {
    if (!res) return;
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
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      const res = await send({ type: "getState" });
      if (dead || !res) return;
      await bootFrom(res);
    })();
    const onMsg = (msg) => {
      if (msg?.type !== "state" || dead) return;
      if (msg.state === "disconnected") {
        setState("connecting");
        send({ type: "getState" }).then((res) => {
          if (!dead) bootFrom(res);
        });
        return;
      }
      applyState(msg.state);
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
      noteTone={noteTone}
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
        const res = await send({ type: "fillOnPage", url: lookupUrl || undefined, loginName: login });
        if (res?.ok && res.filled) window.close();
        else showNote(res?.error || "Couldn't find a login form on this page.", "danger");
      }}
      onFillCode={async (row) => {
        const res = await send({ type: "fillOneTimeCode", id: row.id });
        if (res?.ok && res.filled) window.close();
        else if (!(res?.ok && res.code)) showNote(res?.error ? `Couldn't read the code: ${res.error}` : "Couldn't read the code", "danger");
        return res;
      }}
      onCopy={async (field, login) => {
        const res = await send({
          type: "copyField",
          field,
          username: login.username,
          id: login.id,
          url: field === "password" ? lookupUrl || undefined : undefined,
        });
        if (!res?.ok) showNote(res?.error || "nothing to copy", "danger");
        else showNote("Copied", "ok");
      }}
      onLookup={async (raw) => {
        if (!raw) return;
        const res = await send({ type: "lookupLogins", url: raw });
        if (!res?.ok) {
          showNote(res?.error || "Couldn't look up that site.", "danger");
          return;
        }
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
        setLookupUrl(url);
        setSite(res.host || raw);
        setLogins(res.logins || []);
        const codeRes = await send({ type: "getOneTimeCodes", url });
        setCodes(codeRes?.rows || []);
      }}
      onOpenApp={async (mode) => {
        await send({ type: "openPasswordsApp", mode, url: mode === "search" ? lookupUrl || undefined : undefined });
        window.close();
      }}
      onLock={async () => {
        await send({ type: "disconnect" });
        setState("connecting");
        const res = await send({ type: "getState" });
        await bootFrom(res);
      }}
      onNewLogin={() => {}}
      onSetupTotp={async () => {
        if (!tab?.id) {
          showNote("no verification-code setup link on this page", "danger");
          return;
        }
        try {
          const found = await chrome.tabs.sendMessage(tab.id, { type: "findTotpUri" }, { frameId: 0 });
          const uri = found?.uris?.[0];
          if (!uri) {
            showNote("no verification-code setup link on this page", "danger");
            return;
          }
          await send({ type: "openPasswordsApp", mode: "totp", uri });
          window.close();
        } catch {
          showNote("no verification-code setup link on this page", "danger");
        }
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
        if (res?.refilled) showNote(`Re-filled ${res.username} with the latest password`, "ok");
        else if (res?.reason === "none") showNote("Nothing to re-fill", "muted");
        else showNote(res?.error || "Couldn't re-fill this page.", "danger");
      }}
      onSettings={() => chrome.runtime.openOptionsPage()}
    />
  );
}

createRoot(document.getElementById("root")).render(<PopupApp />);
