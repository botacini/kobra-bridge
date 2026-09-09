#!/usr/bin/env python3
# Copyright (C) 2026 Kobra Bridge contributors
# SPDX-License-Identifier: GPL-3.0-only
"""Capabilities for Anycubic Kobra models supported by Kobra Bridge."""
from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class KobraModel:
    model_id: str
    name: str
    aliases: tuple[str, ...]
    build_volume_mm: tuple[int, int, int]
    nozzle_diameters_mm: tuple[float, ...]
    max_nozzle_c: int
    max_bed_c: int
    max_chamber_c: int
    max_colors: int
    max_ace_units: int
    enclosed: bool
    camera_transport: str
    orca_profile: str
    max_xy_speed_mm_s: int
    max_xy_accel_mm_s2: int

    def supports_nozzle(self, diameter_mm: float, tolerance: float = 0.001) -> bool:
        try:
            value = float(diameter_mm)
        except (TypeError, ValueError):
            return False
        return any(abs(value - supported) <= tolerance for supported in self.nozzle_diameters_mm)


MODELS: dict[str, KobraModel] = {
    "20030": KobraModel(
        model_id="20030", name="Anycubic Kobra X",
        aliases=("kobra x", "anycubic kobra x"),
        build_volume_mm=(260, 260, 260),
        nozzle_diameters_mm=(0.25, 0.4, 0.6, 0.8),
        max_nozzle_c=300, max_bed_c=100, max_chamber_c=0,
        max_colors=19, max_ace_units=4, enclosed=False,
        camera_transport="anycubic-lan", orca_profile="Anycubic Kobra X 0.4 nozzle",
        max_xy_speed_mm_s=450, max_xy_accel_mm_s2=10000,
    ),
    "20025": KobraModel(
        model_id="20025", name="Anycubic Kobra S1",
        aliases=("s1", "kobra s1", "anycubic kobra s1"),
        build_volume_mm=(250, 250, 250),
        nozzle_diameters_mm=(0.2, 0.4, 0.6, 0.8),
        max_nozzle_c=320, max_bed_c=120, max_chamber_c=0,
        max_colors=8, max_ace_units=2, enclosed=True,
        camera_transport="anycubic-flv", orca_profile="Anycubic Kobra S1 0.4 nozzle",
        max_xy_speed_mm_s=600, max_xy_accel_mm_s2=20000,
    ),
    "20029": KobraModel(
        model_id="20029", name="Anycubic Kobra S1 Max",
        aliases=("s1 max", "kobra s1 max", "anycubic kobra s1 max"),
        build_volume_mm=(350, 350, 350),
        nozzle_diameters_mm=(0.25, 0.4, 0.6, 0.8),
        max_nozzle_c=350, max_bed_c=120, max_chamber_c=65,
        max_colors=16, max_ace_units=4, enclosed=True,
        camera_transport="anycubic-flv", orca_profile="Anycubic Kobra S1 Max 0.4 nozzle",
        max_xy_speed_mm_s=600, max_xy_accel_mm_s2=20000,
    ),
}


def _key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


_NAME_INDEX = {
    _key(alias): model
    for model in MODELS.values()
    for alias in (model.name, *model.aliases)
}


def model_for_id(model_id: object) -> KobraModel | None:
    return MODELS.get(str(model_id or "").strip())


def model_for_name(name: object) -> KobraModel | None:
    key = _key(name)
    if not key:
        return None
    exact = _NAME_INDEX.get(key)
    if exact:
        return exact
    # Accept harmless product suffixes ("Combo", nozzle description) while
    # preferring the longest alias so "S1 Max" can never collapse to "S1".
    matches = [
        (len(alias), model) for alias, model in _NAME_INDEX.items()
        if re.search(rf"(?:^| ){re.escape(alias)}(?: |$)", key)
    ]
    return max(matches, default=(0, None), key=lambda item: item[0])[1]


def discover_model(info: dict | None, credentials: dict | None) -> KobraModel | None:
    info = info or {}
    credentials = credentials or {}
    for value in (info.get("modelId"), info.get("modeId"), credentials.get("model_id"),
                  credentials.get("mode_id")):
        model = model_for_id(value)
        if model:
            return model
    for value in (info.get("modelName"), info.get("deviceName"), info.get("model"),
                  credentials.get("model"), credentials.get("model_name")):
        model = model_for_name(value)
        if model:
            return model
    return None
