#!/usr/bin/env python3
# reads the 6-digit pairing code off the iCloud for Windows toast through UI Automation.
# looks only at windows whose title mentions iCloud, Passwords, or a notification.
import json
import re
import struct
import subprocess
import sys

EXT_ORIGIN = "chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/"

# $timeoutMs is substituted below. descendants are capped so a huge UWP tree cannot stall the host.
DUMP = r"""
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$hits = New-Object System.Collections.Generic.List[string]
foreach ($w in $wins) {
  $name = ""
  try { $name = [string]$w.Current.Name } catch {}
  if ($name -notmatch 'iCloud|Password|notification|Notification') { continue }
  if ($name) { $hits.Add($name) }
  $subs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  $n = [Math]::Min($subs.Count, 250)
  for ($i = 0; $i -lt $n; $i++) {
    try {
      $t = [string]$subs.Item($i).Current.Name
      if ($t) { $hits.Add($t) }
    } catch {}
  }
}
$hits -join "`n"
"""

CHECK = r"""
Add-Type -AssemblyName UIAutomationClient
$null = [System.Windows.Automation.AutomationElement]::RootElement
Write-Output ok
"""


def origin_ok():
    if len(sys.argv) < 2:
        return False
    return sys.argv[1].rstrip("/") == EXT_ORIGIN.rstrip("/")


def send(obj):
    raw = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(raw)) + raw)
    sys.stdout.buffer.flush()


def extract_code(dump):
    lines = [line.strip() for line in dump.splitlines()]
    for line in lines:
        match = re.search(r"(?<!\d)(\d{6})(?!\d)", re.sub(r"[\s-]", "", line))
        if match:
            return match.group(1)
    run = []
    for line in lines:
        if re.fullmatch(r"\d", line):
            run.append(line)
            if len(run) == 6:
                return "".join(run)
        else:
            run = []
    for line in lines:
        match = re.search(r"(?<!\d)(\d(?:[\s-]\d){5})(?!\d)", line)
        if match:
            return re.sub(r"[\s-]", "", match.group(1))
    return None


def powershell(script, timeout):
    return subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def read_code(timeout_ms):
    timeout_ms = max(500, min(int(timeout_ms), 20000))
    try:
        result = powershell(DUMP, timeout_ms / 1000.0 + 5)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "UI Automation did not answer"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    if result.returncode != 0 and not result.stdout:
        err = (result.stderr or "").strip() or f"powershell exit {result.returncode}"
        return {"ok": False, "error": err}
    code = extract_code(result.stdout or "")
    if code:
        return {"ok": True, "code": code}
    return {"ok": False, "error": "no pairing toast with a 6-digit code was visible"}


def check():
    try:
        result = powershell(CHECK, 12)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "UI Automation did not answer"}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}
    if result.returncode == 0 and "ok" in (result.stdout or ""):
        return {"ok": True}
    err = (result.stderr or result.stdout or "UI Automation is unavailable").strip()
    return {"ok": False, "error": err}


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        assert extract_code("iCloud Passwords\nVerification code\n482913\n") == "482913"
        assert extract_code("4\n8\n2\n9\n1\n3\n") == "482913"
        assert extract_code("code 4 8 2 9 1 3 ok") == "482913"
        assert extract_code("1234567\nno code here\n12345") is None
        print("selftest ok")
        return
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        sys.exit(0)
    (n,) = struct.unpack("<I", raw)
    if n > 1_000_000:
        send({"ok": False, "error": "message too large"})
        return
    if not origin_ok():
        send({"ok": False, "error": "forbidden"})
        return
    req = json.loads(sys.stdin.buffer.read(n) or b"{}")
    action = req.get("action")
    if action == "check":
        send(check())
    elif action == "read":
        send(read_code(req.get("timeoutMs", 6000)))
    else:
        send({"ok": False, "error": "unknown action"})


if __name__ == "__main__":
    main()
