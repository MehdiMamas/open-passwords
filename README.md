<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="PassBridge logo">
</p>

<h1 align="center">PassBridge</h1>

<p align="center">
  iCloud Passwords in Chrome, with the autofill behavior of the Bitwarden extension.
  macOS and Windows. Not affiliated with Apple or Bitwarden.
</p>

PassBridge is a fork of [Open Passwords](https://github.com/ManiForoughi2/open-passwords). It speaks Apple's native-messaging protocol (`com.apple.passwordmanager`) so the live vault stays in iCloud, and it takes its menu, fill sequence, shortcuts, and save prompts from [Bitwarden's browser extension](https://github.com/bitwarden/clients) (pinned in [BITWARDEN.md](BITWARDEN.md)).

Start here: **[SETUP.md](SETUP.md)** for macOS and Windows.

## What you get

- An inline menu on login fields, with an icon in the field, keyboard navigation, and a top-layer popover the page cannot cover.
- Ctrl/Cmd+Shift+L to fill and cycle matching logins. A toolbar badge with the count.
- A right-click menu to fill, copy a username, password, or verification code, or generate a password.
- A save / update bar that hands the password to Apple's own save sheet. Nothing is written without that sheet.
- Verification codes from the Passwords app, and links that open the entry in the Passwords app.

## What stays Apple's

- The 6-digit pairing code once per browser launch, and Touch ID or Windows Hello when the vault asks.
- Matching a login to a site. The helper does that. There is no per-item "exact URL" rule.
- Passkeys. Chrome on macOS already offers iCloud passkeys. This extension does not invent a second passkey store.
- No Linux, and no Chrome Web Store listing. The helper only accepts Apple's extension id, so this copy is loaded unpacked. See [SETUP.md](SETUP.md).

## Credits

- [ManiForoughi2/open-passwords](https://github.com/ManiForoughi2/open-passwords) (Apache-2.0), the client this fork starts from.
- [au2001/icloud-passwords-firefox](https://github.com/au2001/icloud-passwords-firefox) (Apache-2.0), the protocol implementation in `src/apple/`.
- [bitwarden/clients](https://github.com/bitwarden/clients) (GPL-3.0), the autofill behavior. Snapshot under `vendor/bitwarden/`. Nothing from `bitwarden_license/` is included.

See [NOTICE](NOTICE). License: GPL-3.0, see [LICENSE](LICENSE).

"Apple", "iCloud", and "Passwords" are trademarks of Apple Inc. "Bitwarden" is a trademark of Bitwarden Inc.
