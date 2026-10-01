import { useEffect, useState } from "react";

function StatusDot({ state }) {
  const color =
    state === "unlocked" ? "bg-ok" : state === "needs_pin" ? "bg-warn" : state === "no_helper" ? "bg-danger" : "bg-current opacity-30";
  const label =
    state === "unlocked" ? "Unlocked" : state === "needs_pin" ? "Needs the verification code" : state === "no_helper" ? "Password helper unavailable" : "Connecting";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={label} />;
}

function CodeRow({ row, onCopy, onFillCode }) {
  const [shown, setShown] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex items-center justify-between gap-2 rounded-2xl border border-[color-mix(in_srgb,CanvasText_10%,Canvas)] px-2.5 py-2">
      <span className="text-[13px]">
        {row.source === "totp" ? `Verification code for ${row.domain || "this site"}` : "Code from Messages"}
        {row.username && <span className="block text-[11px] opacity-60">{row.username}</span>}
      </span>
      <span className="flex items-center gap-2">
        <button type="button" className="text-xs text-accent" onClick={() => onCopy("otp", row)}>
          Copy
        </button>
        {shown ? (
          <span className="font-mono text-sm tracking-widest">{shown}</span>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,Canvas)] px-3 py-1 text-xs font-semibold text-accent disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              const res = await onFillCode(row);
              if (res?.ok && res.filled) return;
              if (res?.ok && res.code) {
                setShown(res.code);
                return;
              }
              setBusy(false);
            }}
          >
            Fill
          </button>
        )}
      </span>
    </li>
  );
}

export function PopupScreen({
  state,
  os,
  label,
  site,
  logins,
  codes,
  caps,
  note,
  pinError,
  showFavicons,
  onVerify,
  onNewCode,
  onFill,
  onFillCode,
  onCopy,
  onLookup,
  onOpenApp,
  onNewLogin,
  onSetupTotp,
  onRefresh,
  onSettings,
}) {
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  const win = os === "win";

  async function submitPin(value) {
    const ok = await onVerify(value);
    if (!ok) setPin("");
  }

  useEffect(() => {
    if (pin.trim().length === 6) submitPin(pin.trim());
    // submitPin closes over onVerify; depending on it resubmits the same code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <div className="flex min-h-[240px] w-[340px] flex-col bg-[Canvas] text-[CanvasText]">
      <header className="flex items-center gap-2 border-b border-[color-mix(in_srgb,CanvasText_12%,Canvas)] px-3 py-2.5">
        <img src="../icons/icon48.png" alt="" width="20" height="20" />
        <h1 className="flex-1 text-sm font-semibold tracking-tight">PassBridge</h1>
        {(state === "unlocked" || state === "needs_pin") && (
          <button
            type="button"
            className="rounded-lg border border-[color-mix(in_srgb,CanvasText_12%,Canvas)] px-2 py-0.5 text-base"
            aria-label="Refresh passwords"
            onClick={() => {
              if (state === "needs_pin") setPin("");
              onRefresh();
            }}
          >
            ↻
          </button>
        )}
        <StatusDot state={state} />
      </header>
      <main className="flex flex-1 flex-col gap-2 px-3 py-3">
        {state === "no_helper" && (
          <p className="text-[13px] leading-snug text-[color-mix(in_srgb,CanvasText_60%,Canvas)]">
            {win
              ? "Couldn't reach Apple's password helper. Install iCloud for Windows, turn on Passwords, run native/windows/install.ps1, and fully quit the browser."
              : "Couldn't reach Apple's password helper. This needs macOS 14+ with the Passwords app, and the extension must run with Apple's accepted ID."}
          </p>
        )}
        {state === "connecting" && <p className="text-[13px] text-[color-mix(in_srgb,CanvasText_60%,Canvas)]">Connecting to Apple Passwords…</p>}
        {state === "needs_pin" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitPin(pin.trim());
            }}
          >
            <p className="text-[13px] leading-snug text-[color-mix(in_srgb,CanvasText_60%,Canvas)]">
              {win
                ? "A verification code was sent by iCloud for Windows. Enter it to grant access."
                : `A verification code was generated on ${label || "your Mac"}. Enter it to grant access.`}
            </p>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              className="rounded-xl border border-[color-mix(in_srgb,CanvasText_12%,Canvas)] bg-[color-mix(in_srgb,CanvasText_4%,Canvas)] px-3 py-2 text-center text-xl tracking-[0.4em]"
            />
            <button type="submit" className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white">
              Unlock
            </button>
            <button
              type="button"
              className="text-left text-[13px] text-accent"
              onClick={() => {
                setPin("");
                onNewCode();
              }}
            >
              Request a new code
            </button>
            {pinError && <p className="text-[13px] text-danger">{pinError}</p>}
          </form>
        )}
        {state === "unlocked" && (
          <>
            <p className="text-[13px] font-semibold">{site}</p>
            {logins.length === 0 && <p className="text-[13px] text-[color-mix(in_srgb,CanvasText_60%,Canvas)]">No saved passwords for this site.</p>}
            <ul className="flex flex-col gap-1.5">
              {logins.map((login) => (
                <li key={login.username} className="rounded-2xl border border-[color-mix(in_srgb,CanvasText_10%,Canvas)] bg-[color-mix(in_srgb,CanvasText_4%,Canvas)] p-2.5">
                  <div className="mb-2 flex items-center gap-2">
                    {showFavicons && site && (
                      <img alt="" width="16" height="16" className="h-4 w-4 rounded" src={`https://icons.duckduckgo.com/ip3/${site}.ico`} />
                    )}
                    <span className="truncate text-[13px] font-medium">{login.username || "(no username)"}</span>
                  </div>
                  <button type="button" className="w-full rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-white" onClick={() => onFill(login)}>
                    Fill
                  </button>
                  <div className="mt-1.5 flex gap-3">
                    <button type="button" className="text-xs text-accent" onClick={() => onCopy("username", login)}>
                      Copy username
                    </button>
                    <button type="button" className="text-xs text-accent" onClick={() => onCopy("password", login)}>
                      Copy password
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onLookup(query.trim());
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Look up another site"
                className="min-w-0 flex-1 rounded-lg border border-[color-mix(in_srgb,CanvasText_12%,Canvas)] bg-[color-mix(in_srgb,CanvasText_4%,Canvas)] px-2 py-1.5 text-[13px]"
              />
              <button type="submit" className="text-[13px] text-accent">
                Search
              </button>
            </form>
            {codes.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {codes.map((row) => (
                  <CodeRow key={row.id} row={row} onCopy={onCopy} onFillCode={onFillCode} />
                ))}
              </ul>
            )}
            {note && <p className="text-xs text-ok">{note}</p>}
            <div className="flex flex-col items-start">
              <button type="button" className="py-1 text-xs text-accent" onClick={() => onOpenApp("search")}>
                Open in Passwords app
              </button>
              {caps?.newPasswordSheet && (
                <button type="button" className="py-1 text-xs text-accent" onClick={() => onOpenApp("new")}>
                  New login in Passwords app…
                </button>
              )}
              {caps?.setUpTotp && (
                <button type="button" className="py-1 text-xs text-accent" onClick={onSetupTotp}>
                  Set up verification code in Passwords…
                </button>
              )}
            </div>
          </>
        )}
      </main>
      <footer className="border-t border-[color-mix(in_srgb,CanvasText_12%,Canvas)] px-3 py-2">
        <button type="button" className="text-xs text-accent" onClick={onSettings}>
          Settings
        </button>
      </footer>
    </div>
  );
}

