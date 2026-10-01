#!/usr/bin/env python3
# Puts a verification-code setup key into the iCloud Passwords window on Windows.
# The key is sent only to that process's setup field. It is not written to disk and not returned.
import json
import queue
import re
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

EXT_ORIGIN = "chrome-extension://pejdijmoenmkgeppbflobdenhhabjlaj/"
REASONS = {"filled", "many", "none", "no-window", "no-setup", "no-field", "no-save", "helper", "done"}
SECRET_RE = re.compile(r"^[A-Za-z2-7]{8,128}$")


def origin_ok():
    if len(sys.argv) < 2:
        return False
    return sys.argv[1].rstrip("/") == EXT_ORIGIN.rstrip("/")


def send(obj):
    raw = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack("<I", len(raw)) + raw)
    sys.stdout.buffer.flush()


def norm(value):
    return " ".join(str(value or "").lower().split())


def blob(item):
    return norm(" ".join([item.get("name") or "", item.get("site") or "", item.get("user") or ""]))


def related(item, hints):
    text = blob(item)
    site = norm(item.get("site"))
    host = norm(hints.get("host"))
    issuer = norm(hints.get("issuer"))
    host_ok = bool(host) and (host in site or host in text)
    issuer_ok = bool(issuer) and issuer in text
    if host or issuer:
        return host_ok or issuer_ok
    return True


def choose_login(items, hints):
    rows = [item for item in (items or []) if isinstance(item, dict)]
    if not rows:
        return ("none", None)
    account = norm(hints.get("account"))
    users = []
    for raw in hints.get("usernames") or []:
        user = norm(raw)
        if user and user != "(no username)" and user not in users:
            users.append(user)
    host = norm(hints.get("host"))
    issuer = norm(hints.get("issuer"))
    identifying = bool(account or users)
    strong = []
    for item in rows:
        if not related(item, hints):
            continue
        user = norm(item.get("user"))
        text = blob(item)
        if account and ((user and user == account) or (account in text and (not user or user == account))):
            strong.append(item)
        elif user and user in users:
            strong.append(item)
    if len(strong) == 1:
        return ("one", strong[0])
    if len(strong) > 1:
        return ("many", None)
    # A known account that is not on the row is not a match, even if the site is.
    if identifying:
        return ("none", None)
    matched = []
    for item in rows:
        text = blob(item)
        site = norm(item.get("site"))
        host_ok = bool(host) and (host in site or host in text)
        issuer_ok = bool(issuer) and issuer in text
        if host and issuer:
            if host_ok and issuer_ok:
                matched.append(item)
        elif host and host_ok:
            matched.append(item)
        elif (not host) and issuer_ok:
            matched.append(item)
    if not matched and host and issuer:
        for item in rows:
            if related(item, {"host": host, "issuer": issuer}):
                matched.append(item)
    if len(matched) == 1:
        return ("one", matched[0])
    if len(matched) > 1:
        return ("many", None)
    return ("none", None)


def search_queries(hints):
    users = []
    for raw in hints.get("usernames") or []:
        user = str(raw or "").strip()
        if user and user != "(no username)" and user not in users:
            users.append(user)
    queries = []
    if len(users) == 1:
        queries.append(users[0])
    account = str(hints.get("account") or "").strip()
    host = str(hints.get("host") or "").strip()
    issuer = str(hints.get("issuer") or "").strip()
    for query in (account, host, issuer):
        if query and query.lower() not in [q.lower() for q in queries]:
            queries.append(query)
    return queries[:4]


def as_items(value):
    if isinstance(value, dict):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return []


def public(res):
    reason = res.get("reason") if isinstance(res, dict) else "helper"
    if reason not in REASONS:
        reason = "helper"
    filled = bool(res.get("filled")) if isinstance(res, dict) else False
    if filled:
        reason = "filled"
    return {"ok": True, "filled": filled, "reason": reason}


def scrub(line, secret):
    if secret and secret in line:
        return line.replace(secret, "")
    return line


class Session:
    def __init__(self, timeout_s):
        script = Path(__file__).with_name("passbridge-totpsetup.ps1")
        if not script.is_file():
            raise FileNotFoundError("missing helper script")
        self.timeout_s = timeout_s
        self.deadline = time.time() + timeout_s
        self.proc = subprocess.Popen(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        try:
            for line in self.proc.stdout:
                self.lines.put(line)
        except Exception:
            pass
        self.lines.put(None)

    def call(self, obj, secret):
        remaining = self.deadline - time.time()
        if remaining <= 0:
            raise TimeoutError("timeout")
        self.proc.stdin.write(json.dumps(obj) + "\n")
        self.proc.stdin.flush()
        line = self.lines.get(timeout=remaining)
        if not line:
            raise TimeoutError("timeout")
        data = json.loads(scrub(line, secret) or "{}")
        if not isinstance(data, dict):
            return {"ok": False, "filled": False, "reason": "helper"}
        if secret and secret in json.dumps(data):
            return {"ok": False, "filled": False, "reason": "helper"}
        data["items"] = as_items(data.get("items"))
        return data

    def close(self):
        try:
            if self.proc.poll() is None and self.proc.stdin:
                self.proc.stdin.write(json.dumps({"op": "done"}) + "\n")
                self.proc.stdin.flush()
                self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=2)
        except Exception:
            self.proc.kill()


def attach(req):
    secret = str(req.get("secret") or "")
    if not SECRET_RE.fullmatch(secret):
        return {"ok": True, "filled": False, "reason": "helper"}
    hints = {
        "issuer": str(req.get("issuer") or "")[:200],
        "account": str(req.get("account") or "")[:200],
        "host": str(req.get("host") or "")[:200],
        "usernames": [str(item)[:200] for item in (req.get("usernames") or [])[:8]],
    }
    timeout_s = min(20.0, max(5.0, float(req.get("timeoutMs") or 15000) / 1000.0))
    session = None
    try:
        session = Session(timeout_s)
        state = session.call({"op": "inspect"}, secret)
        if not state.get("ok"):
            return public(state)
        edit = state.get("edit") if isinstance(state.get("edit"), dict) else None
        if edit and edit.get("open"):
            item = {
                "name": edit.get("title") or "",
                "site": edit.get("title") or "",
                "user": edit.get("user") or "",
            }
            kind, _picked = choose_login([item], hints)
            if kind != "one":
                return {"ok": True, "filled": False, "reason": "many" if kind == "many" else "none"}
            return public(session.call({
                "op": "fill-edit",
                "secret": secret,
                "expectTitle": item["name"],
                "expectUser": item["user"],
            }, secret))
        reason = "none"
        queries = search_queries(hints)
        if not queries:
            return {"ok": True, "filled": False, "reason": "none"}
        for query in queries:
            found = session.call({"op": "search", "query": query}, secret)
            if not found.get("ok"):
                return public(found)
            kind, picked = choose_login(found.get("items") or [], hints)
            if kind == "one" and picked and picked.get("name"):
                return public(session.call({
                    "op": "fill-item",
                    "secret": secret,
                    "expectName": picked.get("name") or "",
                }, secret))
            if kind == "many":
                reason = "many"
        return {"ok": True, "filled": False, "reason": reason}
    except (TimeoutError, queue.Empty, FileNotFoundError, OSError, json.JSONDecodeError):
        return {"ok": True, "filled": False, "reason": "helper"}
    finally:
        if session:
            session.close()


def selftest():
    many = [
        {"name": "Example alice", "site": "example.com", "user": "alice"},
        {"name": "Example bob", "site": "example.com", "user": "bob"},
    ]
    assert choose_login(many, {"host": "example.com", "account": "alice", "usernames": []})[0] == "one"
    assert choose_login(many, {"host": "example.com", "usernames": ["alice", "bob"]})[0] == "many"
    assert choose_login(many, {"host": "other.test"})[0] == "none"
    assert choose_login([{"name": "Bank bob", "site": "bank.test", "user": "alice"}], {"host": "example.com", "account": "alice"})[0] == "none"
    assert choose_login([], {"host": "example.com"})[0] == "none"
    assert choose_login([{"name": "Example", "site": "example.com", "user": ""}], {"host": "example.com"})[0] == "one"
    one = choose_login(
        [{"name": "Example alice", "site": "Example", "user": "alice"}],
        {"issuer": "Example", "host": "example.com"},
    )
    assert one[0] == "one" and one[1]["user"] == "alice"
    assert search_queries({"usernames": ["alice", "bob"], "host": "example.com", "issuer": "Example"}) == [
        "example.com",
        "Example",
    ]
    assert search_queries({"usernames": ["alice"], "account": "alice", "host": "example.com"}) == [
        "alice",
        "example.com",
    ]
    print("selftest ok")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        selftest()
        return
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        sys.exit(0)
    (n,) = struct.unpack("<I", raw)
    if n > 100_000:
        send({"ok": False, "filled": False, "reason": "helper"})
        return
    if not origin_ok():
        send({"ok": False, "filled": False, "reason": "helper"})
        return
    try:
        req = json.loads(sys.stdin.buffer.read(n) or b"{}")
    except json.JSONDecodeError:
        send({"ok": False, "filled": False, "reason": "helper"})
        return
    if not isinstance(req, dict) or req.get("action") != "attach":
        send({"ok": False, "filled": False, "reason": "helper"})
        return
    send(attach(req))


if __name__ == "__main__":
    main()
