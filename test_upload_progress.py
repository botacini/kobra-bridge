#!/usr/bin/env python3
"""Checks for chunked printer upload + progress publication.

Runs against the real patched sources with a fake socket, so no printer,
container or network is involved. Verifies the two things that can silently
break: the multipart bytes on the wire, and the Content-Length that frames them.
"""
import builtins
import importlib.util
import json
import pathlib
import sys
import types

DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, "/app")  # container deps when run inside the image
# kobrax_client only reads env_loader in its CLI-only __main__ block; provide a
# stub so this protocol test also runs on the deploy host, where the image's
# env_loader.py is not installed.
sys.modules.setdefault("env_loader", types.SimpleNamespace())


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


client_mod = load("kxclient", DIR / "kobrax_client.py")

RESPONSE = b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"code":200,"message":"success"}'


class FakeSock:
    def __init__(self):
        self.sent = bytearray()
        self._replied = False

    def settimeout(self, value):
        self.timeouts = getattr(self, "timeouts", [])
        self.timeouts.append(value)

    def sendall(self, data):
        self.sent.extend(data)

    def recv(self, _n):
        if self._replied:
            return b""
        self._replied = True
        return RESPONSE

    def close(self):
        pass


def run(payload: bytes, progress_cb=None, require_bounded_reads=False):
    sock = FakeSock()
    client_mod.socket.getaddrinfo = lambda *a, **k: [(2, 1, 6, "", ("1.2.3.4", 18910))]
    client_mod.socket.create_connection = lambda *a, **k: sock
    c = client_mod.KobraXClient.__new__(client_mod.KobraXClient)
    c.host = "1.2.3.4"
    tmp = DIR / "_upload_probe.gcode"
    tmp.write_bytes(payload)
    old_open = getattr(client_mod, "open", None)
    if require_bounded_reads:
        class GuardedReader:
            def __init__(self, fh): self.fh = fh
            def __enter__(self): return self
            def __exit__(self, *a): self.fh.close()
            def read(self, size=-1):
                assert size > 0, "upload_gcode performed an unbounded read"
                return self.fh.read(size)
        client_mod.open = lambda path, mode="r", *a, **k: GuardedReader(
            builtins.open(path, mode, *a, **k))
    try:
        out = c.upload_gcode(str(tmp), "probe.gcode", "http://x/upload?s=TOK",
                             progress_cb=progress_cb)
    finally:
        if require_bounded_reads:
            if old_open is None:
                del client_mod.open
            else:
                client_mod.open = old_open
        tmp.unlink(missing_ok=True)
    run.last_sock = sock
    return out, bytes(sock.sent)

run.last_sock = None


# 1. Body bytes and declared Content-Length agree, and the payload survives intact.
payload = bytes(range(256)) * 4000  # ~1 MB, exercises the chunk loop
out, wire = run(payload)
assert out == {"code": 200, "message": "success"}, out
head, body = wire.split(b"\r\n\r\n", 1)
declared = int(dict(
    line.split(": ", 1) for line in head.decode().split("\r\n")[1:] if ": " in line
)["Content-Length"])
assert declared == len(body), f"Content-Length {declared} != body {len(body)}"
assert payload in body, "file payload missing from multipart body"
assert body.count(b'name="gcode"') == 1 and body.count(b'name="filename"') == 1
assert body.endswith(b"--\r\n"), body[-20:]

# 2. Progress is monotonic, starts at 0 and ends exactly at the file size.
seen = []
run(payload, progress_cb=lambda s, t: seen.append((s, t)))
assert seen[0] == (0, len(payload)), seen[0]
assert seen[-1] == (len(payload), len(payload)), seen[-1]
assert all(b[0] >= a[0] for a, b in zip(seen, seen[1:])), "progress went backwards"
assert all(t == len(payload) for _, t in seen), "total changed mid-upload"

# 3. Empty file still frames correctly and reports 0/0 once.
seen = []
out, wire = run(b"", progress_cb=lambda s, t: seen.append((s, t)))
assert out["code"] == 200
assert seen == [(0, 0)], seen

# 4. Bridge-side percent maths, including the divide-by-zero guard.
bridge_src = (DIR / "kobrax_moonraker_bridge.py").read_text()
start = bridge_src.index("    def _set_upload_progress(")
end = bridge_src.index("    def _upload_to_printer(")
ns = types.SimpleNamespace(_state={})
fn_src = "\n".join(line[4:] for line in bridge_src[start:end].splitlines())
scope: dict = {}
exec(fn_src, scope)
set_progress = scope["_set_upload_progress"]

set_progress(ns, "a.gcode", 50, 200, "sending")
assert ns._state["upload_progress"]["percent"] == 25
assert ns._state["upload_progress"]["active"] is True

set_progress(ns, "a.gcode", 0, 0, "done")
assert ns._state["upload_progress"]["percent"] == 0
assert ns._state["upload_progress"]["active"] is False

set_progress(ns, "a.gcode", 0, 0, "error", "boom")
assert ns._state["upload_progress"]["phase"] == "error"
assert ns._state["upload_progress"]["error"] == "boom"
assert ns._state["upload_progress"]["active"] is False

# 5. Multi-printer sends run in parallel. Never load each 200+ MB file fully
# into RAM, and never allow a stalled printer socket to block forever.
client_src = (DIR / "kobrax_client.py").read_text()
u0 = client_src.index("    def upload_gcode(")
u1 = client_src.index("\n    def ", u0 + 10)
upload_src = client_src[u0:u1]
assert "file_data = f.read()" not in upload_src, "upload_gcode must stream from disk, not allocate one full file per printer"
assert "settimeout(None)" not in upload_src, "printer upload socket must have a finite I/O timeout"
assert run.last_sock and None not in run.last_sock.timeouts, run.last_sock.timeouts
run(payload, require_bounded_reads=True)

print("upload progress: 5/5 checks passed")
