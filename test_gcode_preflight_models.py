#!/usr/bin/env python3
"""Preflight limits must follow official per-model slicer behavior."""
from gcode_preflight import scan_bytes


def fixture(model: str) -> bytes:
    commands = "\n".join("SET_VELOCITY_LIMIT ACCEL=6000 ACCEL_TO_DECEL=3000" for _ in range(3339))
    return (f"""; EXECUTABLE_BLOCK_START
{commands}
; EXECUTABLE_BLOCK_END
; CONFIG_BLOCK_START
; printer_model = {model}
; printer_settings_id = {model} 0.4 nozzle
; print_settings_id = 0.20mm Standard @{model} 0.4 nozzle
; resolution = 0.012
; accel_to_decel_enable = 1
; emit_machine_limits_to_gcode = 1
; estimated printing time (normal mode) = 30m 32s
; CONFIG_BLOCK_END
""").encode()


k4 = scan_bytes(fixture("Anycubic Kobra 4"), "k4.gcode")
assert k4["source_model_id"] == "20028"
assert k4["set_velocity_limit_per_hour"] > 6000
assert k4["safe"], k4["reasons"]

kx = scan_bytes(fixture("Anycubic Kobra X"), "kx.gcode")
assert kx["source_model_id"] == "20030"
assert any("resolution=0.012" in reason for reason in kx["reasons"])
assert any("SET_VELOCITY_LIMIT rate" in reason for reason in kx["reasons"])

print("model-aware gcode preflight: all checks passed")
