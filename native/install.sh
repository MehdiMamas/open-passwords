#!/bin/sh
# macOS only, run once after cloning
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="pejdijmoenmkgeppbflobdenhhabjlaj" # the ID our manifest key forces
SUPPORT="$HOME/Library/Application Support"

# outside the repo so moving it wont break the host path, and out of ~/Downloads where TCC can block the browser launching it
APPDIR="$SUPPORT/PassBridge"
mkdir -p "$APPDIR"
cp "$DIR/passbridge-policy.py" "$APPDIR/passbridge-policy.py"
chmod +x "$APPDIR/passbridge-policy.py"
HELPER="$APPDIR/passbridge-policy.py"

cp "$DIR/passbridge-autopair.py" "$APPDIR/passbridge-autopair.py"
chmod +x "$APPDIR/passbridge-autopair.py"
AUTOPAIR="$APPDIR/passbridge-autopair.py"

# app bundle so the permission prompt says "PassBridge" instead of "Python 3"
APP="$APPDIR/PassBridge Helper.app"
if command -v cc >/dev/null 2>&1; then
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  cp "$DIR/passbridge-autopair.py" "$APP/Contents/Resources/passbridge-autopair.py"
  cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>PassBridge</string>
  <key>CFBundleDisplayName</key><string>PassBridge</string>
  <key>CFBundleIdentifier</key><string>com.passbridge.helper</string>
  <key>CFBundleExecutable</key><string>PassBridge Helper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>PassBridge reads the 6-digit pairing code from the Passwords helper's window so you don't have to type it.</string>
</dict>
</plist>
EOF
  if cc -O2 -o "$APP/Contents/MacOS/PassBridge Helper" "$DIR/autopair-launcher.c" 2>/dev/null \
     && codesign -s - -f -i com.passbridge.helper "$APP" >/dev/null 2>&1; then
    AUTOPAIR="$APP/Contents/MacOS/PassBridge Helper"
    echo "  built $(basename "$APP")"
  else
    rm -rf "$APP"
    echo "  (no C compiler or codesign, the pairing-code reader runs as plain python)"
  fi
fi

found=0
register() {
  d="$1/NativeMessagingHosts"
  mkdir -p "$d"
  cat > "$d/com.passbridge.policy.json" <<EOF
{
  "name": "com.passbridge.policy",
  "description": "PassBridge policy helper",
  "path": "$HELPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  cat > "$d/com.passbridge.autopair.json" <<EOF
{
  "name": "com.passbridge.autopair",
  "description": "PassBridge pairing-code reader",
  "path": "$AUTOPAIR",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  rm -f "$d/com.openpasswords.policy.json" "$d/com.openpasswords.autopair.json"
  echo "  registered: $(basename "$1")"
  found=$((found + 1))
}

for b in "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Dev" "Google/Chrome Canary" "Microsoft Edge" "Chromium" "Arc/User Data" "Vivaldi"; do
  [ -d "$SUPPORT/$b" ] && register "$SUPPORT/$b"
done
for d in "$SUPPORT/BraveSoftware/"*/; do
  [ -d "$d" ] && register "${d%/}"
done

echo
echo "Helper installed to $HELPER ($found browser(s))"
echo "Now FULLY QUIT and reopen your browser (Cmd+Q), then use the popup toggle."
