#!/usr/bin/env python3
"""Cross-origin printer control is limited to sibling bridge ports.

KX-Bridge has no auth. A wildcard CORS policy let any website an operator
visited read state and issue POST/DELETE commands to a guessed LAN IP. The farm
UI legitimately needs cross-port access on one NAS (7125 -> 7126...), so same
hostname origins are reflected while foreign origins are denied. OrcaSlicer
and CLI clients send no Origin and are unaffected.
"""
import ast
import asyncio
import pathlib
import types

SRC = pathlib.Path(__file__).resolve().parent / "kobrax_moonraker_bridge.py"
tree = ast.parse(SRC.read_text())
nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
         and n.name in ("_cors_origin_for", "cors_middleware")]
module = ast.Module(body=[ast.ImportFrom(module="urllib.parse", names=[ast.alias(name="urlsplit")], level=0), *nodes], type_ignores=[])
ast.fix_missing_locations(module)

class Response:
    def __init__(self, status=200, headers=None, text=""):
        self.status = status
        self.headers = dict(headers or {})
        self.text = text

web = types.SimpleNamespace(Response=Response, middleware=lambda f: f)
ns = {"web": web}
exec(compile(module, str(SRC), "exec"), ns)
origin_for = ns["_cors_origin_for"]
middleware = ns["cors_middleware"]

class URL:
    def __init__(self, host): self.host = host

class Request:
    def __init__(self, method="GET", origin=None, host="198.51.100.10", path="/"):
        self.method = method
        self.headers = {} if origin is None else {"Origin": origin}
        self.url = URL(host)
        self.path = path

calls = 0
async def handler(_):
    global calls
    calls += 1
    # Simulate a legacy handler that still tries to set the old wildcard.
    return Response(headers={"Access-Control-Allow-Origin": "*"})

def run(coro):
    loop = asyncio.new_event_loop()
    try: return loop.run_until_complete(coro)
    finally: loop.close()

# 1. Sibling bridge port is allowed and reflected exactly.
r = Request(origin="http://198.51.100.10:7125")
assert origin_for(r) == "http://198.51.100.10:7125"
out = run(middleware(r, handler))
assert out.headers["Access-Control-Allow-Origin"] == r.headers["Origin"]
assert out.headers["Vary"] == "Origin"

# 2. A website on the public internet cannot read or command the bridge.
for hostile in ("https://evil.example", "http://192.168.1.99:8080", "not a url"):
    r = Request(origin=hostile)
    assert origin_for(r) == "", hostile
    out = run(middleware(r, handler))
    assert "Access-Control-Allow-Origin" not in out.headers, (hostile, out.headers)

# 3. Foreign state-changing requests must be rejected BEFORE the handler.
# Merely omitting Access-Control-Allow-Origin blocks JavaScript from reading the
# response, but a simple cross-site HTML form still executes the POST.
for method in ("POST", "DELETE"):
    before = calls
    r = Request(method=method, origin="https://evil.example")
    out = run(middleware(r, handler))
    assert out.status == 403, (method, out.status)
    assert calls == before, f"hostile {method} reached the printer-control handler"

# WebSocket upgrades are GET requests but carry mutating JSON-RPC methods after
# upgrade. A foreign Origin must be rejected before the handler/upgrade.
before = calls
r = Request(method="GET", origin="https://evil.example", path="/websocket")
out = run(middleware(r, handler))
assert out.status == 403 and calls == before

# Same-host state changes and WebSocket upgrades remain available to sibling farm ports.
before = calls
r = Request(method="POST", origin="http://198.51.100.10:7130")
out = run(middleware(r, handler))
assert out.status == 200 and calls == before + 1
before = calls
r = Request(method="GET", origin="http://198.51.100.10:7130", path="/websocket")
out = run(middleware(r, handler))
assert out.status == 200 and calls == before + 1

# 4. Cross-port OPTIONS works for the real farm UI.
r = Request(method="OPTIONS", origin="http://198.51.100.10:7130")
out = run(middleware(r, handler))
assert out.status == 204
assert out.headers["Access-Control-Allow-Origin"] == r.headers["Origin"]
assert "POST" in out.headers["Access-Control-Allow-Methods"]

# 4. Foreign preflight gets no permission header.
r = Request(method="OPTIONS", origin="https://evil.example")
out = run(middleware(r, handler))
assert out.status == 204
assert "Access-Control-Allow-Origin" not in out.headers

# 5. No-Origin clients (OrcaSlicer/curl/obico) still reach the handler; CORS is
# a browser response policy, not endpoint authentication.
r = Request()
out = run(middleware(r, handler))
assert out.status == 200
assert "Access-Control-Allow-Origin" not in out.headers

print("same-host CORS policy: 10/10 checks passed")
