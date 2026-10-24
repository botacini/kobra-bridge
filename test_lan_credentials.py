#!/usr/bin/env python3
"""LAN credential crypto, validation, and atomic persistence."""
import asyncio
import configparser
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
from types import SimpleNamespace

ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))
import kobrax_moonraker_bridge as bridge
import config_loader
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

token = "0123456789abcdefFEDCBA9876543210"
iv = "abcdef0123456789"
payload = {
    "username": "fake-user", "password": "fake-password",
    "deviceId": "0" * 32, "modeId": "20028",
}
encrypted = AES.new(token[16:32].encode(), AES.MODE_CBC, iv.encode()).encrypt(
    pad(json.dumps(payload).encode(), AES.block_size)
)
import base64
decoded = bridge._kx_decrypt_info(base64.b64encode(encrypted).decode(), token[16:32], iv)
assert decoded == payload
assert len(bridge._kx_generate_signature(token, 123, "abc123")) == 32
assert bridge._kx_credentials_missing(SimpleNamespace(
    username="", password="x", device_id="x", mode_id="20028"))
assert not bridge._kx_credentials_missing(SimpleNamespace(
    username="x", password="x", device_id="x", mode_id="20028"))
assert "HTTP 403" in bridge._kx_discovery_error(
    bridge.aiohttp.ClientResponseError(None, (), status=403))

with tempfile.TemporaryDirectory() as tmp:
    old_base = config_loader._BASE
    old_env = {key: os.environ.get(key) for key in config_loader.CONFIG_ENV_MAPPING}
    try:
        config_loader._BASE = pathlib.Path(tmp)
        path = pathlib.Path(tmp) / "config" / "config.ini"
        path.parent.mkdir()
        path.write_text("[bridge]\npoll_interval = 7\nprinter_name = Anycubic Kobra X\n", encoding="utf-8")
        config_loader.save_discovered_credentials("connection", {
            "printer_ip": "192.0.2.1", "username": "fake-user",
            "password": "fake-password", "device_id": "0" * 32,
            "mode_id": "20028", "model_id": "20028", "model": "Anycubic Kobra 4",
        })
        cfg = configparser.ConfigParser(); cfg.read(path, encoding="utf-8")
        assert cfg.get("connection", "username") == "fake-user"
        assert cfg.get("connection", "model_id") == "20028"
        assert cfg.get("bridge", "poll_interval") == "7"
        assert cfg.get("bridge", "printer_name") == "Anycubic Kobra 4"
        assert not list(path.parent.glob(".config.*.tmp"))
    finally:
        config_loader._BASE = old_base
        for key, value in old_env.items():
            if value is None: os.environ.pop(key, None)
            else: os.environ[key] = value

print("LAN credentials: all checks passed")
