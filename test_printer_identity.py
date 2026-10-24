#!/usr/bin/env python3
"""Detected model names must not be replaced by the legacy Kobra X default."""
import os
from types import SimpleNamespace

import config_loader
from kobrax_moonraker_bridge import _kx_printer_display_name


old = os.environ.get("BRIDGE_PRINTER_NAME")
try:
    os.environ.pop("BRIDGE_PRINTER_NAME", None)
    assert _kx_printer_display_name(SimpleNamespace(model_id="20028", mode_id="20028")) == "Anycubic Kobra 4"
    assert _kx_printer_display_name(SimpleNamespace(model_id="20025", mode_id="20025")) == "Anycubic Kobra S1"
    os.environ["BRIDGE_PRINTER_NAME"] = "Workshop Printer"
    assert _kx_printer_display_name(SimpleNamespace(model_id="20028", mode_id="20028")) == "Workshop Printer"
    os.environ["BRIDGE_PRINTER_NAME"] = "Anycubic Kobra X"
    assert _kx_printer_display_name(SimpleNamespace(model_id="20028", mode_id="20028")) == "Anycubic Kobra 4"
    assert _kx_printer_display_name(SimpleNamespace(model_id="20030", mode_id="20030")) == "Anycubic Kobra X"
finally:
    if old is None:
        os.environ.pop("BRIDGE_PRINTER_NAME", None)
    else:
        os.environ["BRIDGE_PRINTER_NAME"] = old

index = (config_loader._BASE / "web" / "themes" / "default" / "index.html").read_text(encoding="utf-8")
app = (config_loader._BASE / "web" / "themes" / "default" / "app.js").read_text(encoding="utf-8")
assert index.count("__PRINTER_NAME__") >= 2
assert "printer_name:'Kobra X'" not in app
assert "s.firmware_version" in app
assert "replace(/Anycubic Kobra X/g,_pn" in app
source = (config_loader._BASE / "kobrax_moonraker_bridge.py").read_text(encoding="utf-8")
assert '"", "Kobra X", "Anycubic Kobra X", "Anycubic Kobra"' in source

print("printer identity: all checks passed")
