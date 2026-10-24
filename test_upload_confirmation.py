#!/usr/bin/env python3
"""A printer HTTP 200 is insufficient without MQTT storage confirmation."""
import pathlib
import tempfile
import types

from kobrax_moonraker_bridge import KobraXBridge


class Client:
    def __init__(self):
        self.published = []

    def upload_gcode(self, path, filename, upload_url, progress_cb=None):
        total = pathlib.Path(path).stat().st_size
        if progress_cb:
            progress_cb(total, total)
        return {"code": 200, "message": "accepted"}

    def publish(self, *args, **kwargs):
        self.published.append((args, kwargs))


def make_bridge(records):
    bridge = KobraXBridge.__new__(KobraXBridge)
    bridge.client = Client()
    bridge._state = {"upload_url": "http://printer/upload?s=redacted"}
    bridge._wait_for_file_action = lambda action, send, timeout: (
        send() or {"data": {"records": records}}
    )
    return bridge


with tempfile.TemporaryDirectory() as tmp:
    path = pathlib.Path(tmp) / "probe.gcode"
    path.write_bytes(b"G90\nM84\n")
    expected_size = path.stat().st_size

    bridge = make_bridge([{"filename": path.name, "size": expected_size}])
    result = bridge._upload_to_printer(str(path), path.name)
    assert result["code"] == 200 and result["confirmed"] is True
    assert result["stored_size"] == expected_size
    assert bridge._state["upload_progress"]["phase"] == "done"
    assert bridge.client.published, "confirmation must issue file/listLocal"

    bridge = make_bridge([])
    bridge._confirm_printer_file = types.MethodType(
        lambda self, filename, size: None, bridge)
    try:
        bridge._upload_to_printer(str(path), path.name)
    except RuntimeError as exc:
        assert "did not confirm" in str(exc)
    else:
        raise AssertionError("HTTP 200 without file/listLocal confirmation was accepted")
    assert bridge._state["upload_progress"]["phase"] == "error"

source = (pathlib.Path(__file__).parent / "kobrax_moonraker_bridge.py").read_text(encoding="utf-8")
handler = source[source.index("async def _handle_file_upload_buffered"):source.index("@staticmethod", source.index("async def _handle_file_upload_buffered"))]
assert "_ensure_gcode_on_printer" in handler, "Moonraker upload must transfer to the printer"
assert "_serve_url" not in handler, "Moonraker upload must not require BRIDGE_HOST_IP"
assert '"stage": "printer_transfer"' in handler, "transfer failures need a diagnostic stage"

print("upload confirmation: all checks passed")
