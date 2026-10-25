#!/usr/bin/env python3
"""Regression: Moonraker webcam discovery includes a stable identity."""
import ast
from pathlib import Path

source = Path(__file__).with_name("kobrax_moonraker_bridge.py").read_text(encoding="utf-8")
root = ast.parse(source)
functions = [
    node for cls in root.body if isinstance(cls, ast.ClassDef)
    for node in cls.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    and node.name == "_moonraker_webcams"
]
assert len(functions) == 1, "expected a single shared webcam serializer"
function = functions[0]
module = ast.Module(body=[function], type_ignores=[])
ast.fix_missing_locations(module)
namespace = {"CAMERA_ENABLED": True}
exec(compile(module, "<webcam schema>", "exec"), namespace)

class Fake:
    pass

camera = namespace["_moonraker_webcams"](Fake(), "http://192.168.1.64:7125")
assert len(camera) == 1
entry = camera[0]
assert entry["uid"] and entry["source"] == "config"
assert entry["service"] == "mjpegstreamer" and entry["enabled"] is True
assert entry["stream_url"] == "http://192.168.1.64:7125/api/camera/stream"
assert entry["snapshot_url"] == "http://192.168.1.64:7125/api/camera/snapshot"
assert entry["extra_data"] == {}
assert namespace["_moonraker_webcams"](Fake(), "http://192.168.1.64:7125")[0]["uid"] == entry["uid"]
namespace["CAMERA_ENABLED"] = False
assert namespace["_moonraker_webcams"](Fake(), "http://192.168.1.64:7125") == []
assert "self._moonraker_webcams(" in source
print("Moonraker webcam schema: all checks passed")
