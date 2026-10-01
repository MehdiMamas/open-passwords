# PassBridge desktop

Windows tray app that types an iCloud login into the field you have focused. It uses the same iCloud for Windows helper as the PassBridge extension. It does not keep its own copy of your passwords.

The extension release stays separate. This program is published only from `desktop-v*` tags.

## Install

iCloud for Windows has to be installed, with Passwords turned on. Download `passbridge-desktop-windows-x64.zip` from a `desktop-v*` release, unzip it, and run `passbridge-desktop.exe`.

The exe is unsigned. Windows SmartScreen will warn until the file is signed. That warning is expected.

A second launch does nothing if the tray icon is already running. The icon is the standard Windows application icon. Right-click it to unlock, lock, edit app rules, or quit.

## Hotkey

`Ctrl+Alt+P` fills the focused field in the foreground app.

The extension keeps `Ctrl+Shift+L` for websites. If the foreground process is Chrome, Edge, Brave, Vivaldi, or Chromium, the desktop hotkey does nothing.

The first press while locked asks for the 6-digit code the iCloud helper is showing, then Windows Hello when a password is read. That unlock is separate from the browser extension. Each one has its own session with the helper.

## App rules

Rules live in `%APPDATA%\PassBridge\apps.json`. Nothing is installed for you. A rule maps a process to the URL already saved in iCloud:

```json
{
  "rules": [
    {
      "process": "RiotClientUx.exe",
      "titleContains": "Riot Client",
      "url": "https://account.riotgames.com"
    }
  ]
}
```

`process` is the exe name. `titleContains` is optional. `url` must be an `https://` URL whose host matches the saved item. The helper looks up logins by that host, the same way the extension does.

Focus the username box and press the hotkey, then the password box and press it again. If several usernames match, a list asks which one.

`desktop/apps.example.json` has a Riot Client sample. Add the rule from the tray menu, or copy it into `apps.json`.

## What it will not do

- It only types into a text field that already has keyboard focus, and only when that process is in `apps.json`.
- It does not scan a window for a field you have not focused.
- It does not inject into another process, and it does not fill a game or anti-cheat process unless you put that process in the allowlist yourself. Do not add those.
- It does not fill another browser extension's own pages. The Chrome extension cannot do that either.
- It does not save new logins. Create the item in the browser or the Passwords app, then point a rule at its URL.
- A custom-drawn window can ignore the keystrokes. If that happens, the password is not written anywhere else.

## Build

```bash
cargo test --manifest-path desktop/Cargo.toml
cargo build --release --manifest-path desktop/Cargo.toml
```

The release binary is `desktop/target/release/passbridge-desktop.exe`.
