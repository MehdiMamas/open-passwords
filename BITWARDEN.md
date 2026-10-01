# Keeping up with Bitwarden

PassBridge copies **behavior** from the Bitwarden browser extension and fills from **Apple Passwords**. The extension id stays `pejdijmoenmkgeppbflobdenhhabjlaj` because Apple's helper only accepts that id.

Pinned Bitwarden commit: `fc5de86` (30 Sep 2026), recorded in [vendor/bitwarden/PINNED](vendor/bitwarden/PINNED).

## What is vendored

`vendor/bitwarden/` is a snapshot of these paths from `bitwarden/clients` (GPL-3.0), listed in [scripts/bitwarden-tracked.txt](scripts/bitwarden-tracked.txt):

- `services/autofill-constants.ts` keyword lists
- `utils/qualification.ts` and `services/inline-menu-field-qualification.service.ts`
- `services/dom-element-visibility.service.ts`
- `services/insert-autofill-content.service.ts`
- `enums/autofill-overlay.enum.ts` port names the adapter speaks
- `models/autofill-script.ts`
- `content/autofill.css`
- `autofill.design.md`

The whole autofill stack imports `@bitwarden/common` and does not compile inside this repo. We do not vendor that. `src/adapter/` implements the port names, fill-script actions, and sub-frame offset walk. `src/content.js` is the running menu, detector, and fill path, with the site fixes in [patches/site-fixes.md](patches/site-fixes.md).

## How to update

```bash
npm run sync:bitwarden -- <new-commit>
```

That downloads the tracked files into `vendor/bitwarden/.sync-tmp` and prints a diff against the current snapshot. Read it, port the behavior into `src/`, copy the files you accept into `vendor/bitwarden/`, and write the new commit into `PINNED`.

Do not copy anything from `bitwarden_license/`. Do not use the Bitwarden name or logo in the UI.

## Parity

HAVE = already worked before this fork. ADD = built here. PARTIAL = built, with the Apple limit named. CANNOT = the helper or the OS blocks it.

| Area | Status | Notes |
|---|---|---|
| Inline menu on login fields, keyboard, OTP skipped | HAVE | |
| Closed shadow host, top-layer popover, in-field icon, focus / icon / off | ADD | List rows stay in light DOM so the harness can click them. The host shadow is closed. |
| Tab returns to the page, Escape returns to the field | ADD | |
| Sub-frame offset walk, depth 8 | ADD | The menu is drawn in the field's frame, so the rect is already local. `frameShift()` is the parent walk a top frame would add. |
| Shadow-DOM field focus via `composedPath` | HAVE | |
| Favicon and username on popup rows | ADD | |
| Tuned username / password / OTP detection | HAVE | Site fixes in `patches/site-fixes.md`. Vendored qualification is the diff baseline. |
| Fill sequence: click, focus, keys, native setter, input, change, 20ms gap, flash | ADD | |
| Sandbox and cross-origin iframe refusal | HAVE | |
| Autofill on page load | PARTIAL | Off by default. Single match only. Can trigger Touch ID or Windows Hello. |
| Per-login URI match rules, equivalent domains | CANNOT | Apple's helper matches. |
| Ctrl/Cmd+Shift+L cycles logins | ADD | Most-recently used first. |
| Context menu: autofill, copy username, copy password, copy code, generate | ADD | |
| Toolbar badge | ADD | Count of usernames, no password read. |
| Lock command | ADD | Drops the session. |
| Save / update bar, never for this site, excluded domains | ADD | Apple's sheet still confirms the write. |
| webRequest cancels the offer on a failed POST | ADD | |
| Popup copy buttons, clipboard clear, look up another site | ADD | Search cannot list the whole vault. The helper answers one URL at a time. |
| Settings page | ADD | |
| Cards, identities, notes, folders, editing | CANNOT | Not in Apple's protocol. Open the Passwords app instead. |
| Passkeys through this extension | CANNOT | Chrome on macOS already offers iCloud passkeys. The hide-passkey toggle remains. |
| Skip pairing or the OS password prompt | CANNOT | Auto-pair is the workaround for the 6-digit code. |
| Linux, Chrome Web Store | CANNOT | No helper on Linux. The extension id belongs to Apple. |
