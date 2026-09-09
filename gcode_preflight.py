#!/usr/bin/env python3
# Copyright (C) 2026 Kobra Bridge contributors
# SPDX-License-Identifier: GPL-3.0-only
"""Reject G-code known to starve the Kobra X GoKlipper host.

The gate is intentionally profile-aware. File size alone is useless: a 168 MB
straight-line file can be easier than a 25 MB Arachne/support file. Orca writes
its effective settings in the G-code tail, so inspect those plus command churn.
"""
from __future__ import annotations

import os
import io
import re
from collections import Counter
from pathlib import Path

SETTING_RE = re.compile(rb"^;\s*([a-z_0-9]+)\s*=\s*(.*?)\s*$", re.M)
TIME_RE = re.compile(rb";\s*estimated printing time \(normal mode\)\s*=\s*([^\r\n]+)", re.I)
DURATION_RE = re.compile(r"(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?")

# The user's crashing profile versus Anycubic's official Kobra X profile.
LIMITS = {
    "resolution": (0.03, "min"),
    "travel_speed": (350.0, "max"),
    "travel_acceleration": (10000.0, "max"),
    "sparse_infill_acceleration": (7500.0, "max"),
    "internal_solid_infill_acceleration": (7500.0, "max"),
    "max_volumetric_extrusion_rate_slope": (0.0, "max"),
}


def _duration_seconds(raw: str) -> int:
    m = DURATION_RE.search(raw.strip())
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def _settings_from_tail(data: bytes) -> dict[str, str]:
    return {k.decode(): v.decode(errors="replace").strip() for k, v in SETTING_RE.findall(data)}


OBJECT_RE = re.compile(rb"\bNAME=(\S+)")


def _scan_lines(lines) -> tuple[Counter, int, list[str]]:
    counts = Counter()
    total = 0
    objects: list[str] = []
    for raw in lines:
        line = raw.lstrip()
        if not line or line.startswith(b";"):
            continue
        total += 1
        command = line.split(None, 1)[0].decode(errors="replace").upper()
        counts[command] += 1
        if command == "EXCLUDE_OBJECT_DEFINE":
            m = OBJECT_RE.search(line)
            if m:
                objects.append(m.group(1).decode(errors="replace"))
    return counts, total, objects


def _analyse(settings: dict[str, str], counts: Counter, total: int,
             duration: int, filename: str, size: int, objects: list[str] = ()) -> dict:
    reasons: list[str] = []

    if settings.get("wall_generator", "").lower() == "arachne":
        reasons.append("wall_generator=arachne creates dense variable-width segments")
    if settings.get("sparse_infill_pattern", "").lower() in {"gyroid", "honeycomb", "3dhoneycomb"}:
        reasons.append(f"sparse_infill_pattern={settings['sparse_infill_pattern']} is curve/segment heavy")
    if settings.get("accel_to_decel_enable") == "0":
        reasons.append("accel_to_decel_enable=0 removes the official Kobra X short-move margin")

    for key, (limit, direction) in LIMITS.items():
        raw = settings.get(key)
        if raw is None:
            continue
        try:
            value = float(raw.split(",", 1)[0])
        except ValueError:
            continue
        bad = value < limit if direction == "min" else value > limit
        if bad:
            op = "below" if direction == "min" else "above"
            reasons.append(f"{key}={value:g} is {op} safe limit {limit:g}")

    overhang = settings.get("overhang_fan_threshold", "")
    try:
        threshold = float(overhang.split(",", 1)[0].rstrip("%"))
        if threshold < 50:
            reasons.append(f"overhang_fan_threshold={threshold:g}% causes excessive M106 transitions")
    except ValueError:
        pass

    hours = duration / 3600 if duration else 0
    cmd_s = total / duration if duration else 0
    fan_h = counts["M106"] / hours if hours else 0
    velocity_h = counts["SET_VELOCITY_LIMIT"] / hours if hours else 0

    # Command-rate gates catch risky files even if metadata was stripped.
    if duration and cmd_s > 120:
        reasons.append(f"average command rate {cmd_s:.1f}/s exceeds 120/s")
    if duration and fan_h > 1200:
        reasons.append(f"M106 rate {fan_h:.0f}/hour exceeds 1200/hour")
    if duration and velocity_h > 6000:
        reasons.append(f"SET_VELOCITY_LIMIT rate {velocity_h:.0f}/hour exceeds 6000/hour")

    return {
        "safe": not reasons,
        "filename": filename,
        "size_bytes": size,
        "estimated_seconds": duration,
        "commands": total,
        "commands_per_second": round(cmd_s, 2),
        "m106": counts["M106"],
        "m106_per_hour": round(fan_h, 1),
        "set_velocity_limit": counts["SET_VELOCITY_LIMIT"],
        "set_velocity_limit_per_hour": round(velocity_h, 1),
        "settings": {key: settings.get(key) for key in (
            "print_settings_id", "filament_settings_id", "printer_settings_id",
            "resolution", "wall_generator", "sparse_infill_pattern",
            "travel_speed", "travel_acceleration", "sparse_infill_acceleration",
            "internal_solid_infill_acceleration", "accel_to_decel_enable",
            "max_volumetric_extrusion_rate_slope", "overhang_fan_threshold")},
        "reasons": reasons,
        "objects": list(objects),
    }


def scan_bytes(data: bytes, filename: str = "upload.gcode") -> dict:
    tail = data[-1_000_000:]
    settings = _settings_from_tail(tail)
    match = TIME_RE.search(data[-2_000_000:])
    duration = _duration_seconds(match.group(1).decode(errors="replace")) if match else 0
    counts, total, objects = _scan_lines(io.BytesIO(data))
    return _analyse(settings, counts, total, duration, filename, len(data), objects)


def scan_file(path: str | os.PathLike, filename: str | None = None) -> dict:
    path = Path(path)
    size = path.stat().st_size
    with path.open("rb") as fh:
        fh.seek(max(0, size - 2_000_000))
        tail = fh.read()
    settings = _settings_from_tail(tail[-1_000_000:])
    match = TIME_RE.search(tail)
    duration = _duration_seconds(match.group(1).decode(errors="replace")) if match else 0
    with path.open("rb") as fh:
        counts, total, objects = _scan_lines(fh)
    return _analyse(settings, counts, total, duration, filename or path.name, size, objects)
