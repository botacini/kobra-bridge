#!/usr/bin/env python3
"""S1-family cameras prefer a live Rinkhals webcam over unavailable Anycubic FLV."""
import ast, asyncio, json, pathlib, types
from urllib.parse import urlsplit

DIR = pathlib.Path(__file__).parent
SRC = DIR / "patched" / "kobrax_moonraker_bridge.py"
if not SRC.exists():
    SRC = DIR / "kobrax_moonraker_bridge.py"
tree = ast.parse(SRC.read_text())
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "KobraXBridge")
methods = {n.name: n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
selected = [methods[name] for name in ("_resolve_camera_url", "handle_api_camera_start", "handle_api_camera_stop")]

class Response:
    def __init__(self, url): self.url = url; self.content = self
    async def json(self):
        return {"result": {"webcams": [{"enabled": True, "stream_url": "/webcam/?action=stream", "snapshot_url": "/webcam/?action=snapshot"}]}}
    async def read(self, size=-1): return b"\xff\xd8" if self.status == 200 else b""

    @property
    def status(self):
        return Session.snapshot_status if "snapshot" in self.url else Session.list_status
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass

class Session:
    list_status = 200
    snapshot_status = 200
    async def __aenter__(self): return self
    async def __aexit__(self, *args): pass
    def get(self, url, **kwargs): return Response(url)

class JsonResponse:
    def __init__(self, data): self.text = json.dumps(data)

ns = {
    "CAMERA_ENABLED": True,
    "aiohttp": types.SimpleNamespace(ClientTimeout=lambda **kwargs: None, ClientSession=Session),
    "asyncio": asyncio,
    "urlsplit": urlsplit,
    "log": types.SimpleNamespace(info=lambda *args: None, warning=lambda *args: None),
    "web": types.SimpleNamespace(json_response=lambda data: JsonResponse(data)),
}
exec(compile(ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[])), str(SRC), "exec"), ns)

class Cache:
    def __init__(self): self.url = ""
    def set_url(self, url): self.url = url
    def reset(self): pass

class Client:
    def __init__(self): self.calls = []
    def publish(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return {"state": "initSuccess"}

class Request:
    async def json(self): return {}

class Bridge:
    _resolve_camera_url = ns["_resolve_camera_url"]
    handle_api_camera_start = ns["handle_api_camera_start"]
    handle_api_camera_stop = ns["handle_api_camera_stop"]
    def __init__(self):
        self._model = types.SimpleNamespace(camera_transport="rinkhals-or-anycubic")
        self._args = types.SimpleNamespace(printer_ip="192.168.1.34")
        self._state = {"camera_url": "http://192.168.1.34:18088/flv"}
        self._camera_anycubic_url = self._state["camera_url"]
        self._camera_source = "anycubic"
        self._camera_user_stopped = False
        self.camera_cache = Cache()
        self.client = Client()

async def main():
    bridge = Bridge()
    started = json.loads((await bridge.handle_api_camera_start(Request())).text)
    assert started["result"] == "ok" and started["source"] == "rinkhals"
    assert bridge._state["camera_url"] == "http://192.168.1.34/webcam/?action=stream"
    assert bridge.camera_cache.url == bridge._state["camera_url"]
    assert not bridge.client.calls, "Rinkhals camera must not start Anycubic gkcam"

    await bridge.handle_api_camera_stop(Request())
    assert not bridge.client.calls, "Rinkhals camera must not stop Anycubic gkcam"

    Session.snapshot_status = 503
    fallback = Bridge()
    started = json.loads((await fallback.handle_api_camera_start(Request())).text)
    assert started["source"] == "anycubic"
    assert fallback._state["camera_url"] == "http://192.168.1.34:18088/flv"
    assert len(fallback.client.calls) == 1, "stock firmware must retain Anycubic startCapture"

asyncio.run(main())
print("s1 camera source: all checks passed")
