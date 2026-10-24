#!/usr/bin/env python3
"""Install flattened official Anycubic Kobra 4 profiles into OrcaSlicer.

The Anycubic Slicer Next installation is read-only. Existing Orca user files
are copied to a timestamped backup before atomic replacement. Only settings
known by the installed OrcaSlicer binary are retained.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile


MACHINE_SOURCE = "Anycubic Kobra 4 0.4 nozzle.json"
MACHINE_TARGETS = (
    "Anycubic Kobra 4 Official - 0.4 nozzle",
    "Anycubic Kobra 4 - 0.4 nozzle",
    "Anycubic Kobra 4 - 0.4 nozzle - fil change alter",
)
SOURCE_MACHINE_NAME = "Anycubic Kobra 4 0.4 nozzle"
PROFILE_GLOB = "* @Anycubic Kobra 4 0.4 nozzle.json"
SYSTEM_ONLY_KEYS = {"type", "setting_id", "instantiation"}
METADATA_KEYS = {
    "name", "from", "inherits", "version", "is_custom_defined",
    "printer_settings_id", "print_settings_id", "filament_settings_id",
    "filament_id", "filament_vendor", "filament_type",
    "compatible_printers", "compatible_printers_condition",
    "compatible_prints", "compatible_prints_condition",
}
CRITICAL_KEYS = {
    "machine": {
        "printer_model", "printer_variant", "nozzle_diameter",
        "printable_area", "printable_height", "gcode_flavor",
        "machine_start_gcode", "machine_end_gcode", "change_filament_gcode",
        "machine_max_speed_x", "machine_max_speed_y",
        "machine_max_acceleration_x", "machine_max_acceleration_y",
        "retraction_length", "retraction_speed",
        "single_extruder_multi_material", "default_print_profile",
        "default_filament_profile",
    },
    "filament": {
        "filament_settings_id", "filament_type", "filament_vendor",
        "nozzle_temperature", "nozzle_temperature_initial_layer",
        "hot_plate_temp", "hot_plate_temp_initial_layer",
        "filament_flow_ratio", "filament_max_volumetric_speed",
    },
    "process": {
        "print_settings_id", "layer_height", "resolution",
        "default_acceleration", "travel_acceleration", "enable_prime_tower",
    },
}
ASSETS = (
    "Anycubic Kobra 4_buildplate_model.stl",
    "Anycubic Kobra 4_buildplate_texture.svg",
    "Anycubic Kobra 4_cover.png",
)


def _read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"profile is not a JSON object: {path}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _find_value(value, key: str):
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            found = _find_value(child, key)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_value(child, key)
            if found not in (None, ""):
                return found
    return None


def discover_user_dir(orca_root: Path) -> Path:
    config = orca_root / "OrcaSlicer.conf"
    folder = None
    if config.is_file():
        try:
            folder = _find_value(_read_json(config), "preset_folder")
        except (OSError, ValueError, json.JSONDecodeError):
            # Orca may append a small second JSON document during migration,
            # making the whole file invalid to json.load even though the main
            # configuration is intact. Read only this non-secret scalar.
            try:
                match = re.search(r'"preset_folder"\s*:\s*"([^"\\]+)"',
                                  config.read_text(encoding="utf-8-sig", errors="replace"))
                folder = match.group(1) if match else None
            except OSError:
                folder = None
    if folder:
        candidate = orca_root / "user" / str(folder)
        if candidate.is_dir():
            return candidate
    candidates = [p for p in (orca_root / "user").iterdir()
                  if p.is_dir() and (p / "machine").is_dir()]
    if len(candidates) != 1:
        raise RuntimeError("could not identify the active OrcaSlicer user profile directory")
    return candidates[0]


def _source_profiles(asn_root: Path) -> dict[str, list[tuple[Path, dict]]]:
    machine_path = asn_root / "machine" / MACHINE_SOURCE
    if not machine_path.is_file():
        raise FileNotFoundError(machine_path)
    result = {"machine": [(machine_path, _read_json(machine_path))]}
    for kind in ("filament", "process"):
        items = [(path, _read_json(path))
                 for path in sorted((asn_root / kind).glob(PROFILE_GLOB))]
        if not items:
            raise RuntimeError(f"no official Kobra 4 0.4 mm {kind} profiles found")
        result[kind] = items
    return result


def _supported_keys(orca_dll: Path, profiles: dict[str, list[tuple[Path, dict]]]) -> set[str]:
    if not orca_dll.is_file():
        raise FileNotFoundError(orca_dll)
    binary = orca_dll.read_bytes()
    keys = {key for items in profiles.values() for _, profile in items for key in profile}
    return METADATA_KEYS | {key for key in keys if key.encode("ascii", "ignore") in binary}


def _convert(profile: dict, kind: str, supported: set[str]) -> tuple[dict, list[str]]:
    dropped = sorted(key for key in profile if key not in supported or key in SYSTEM_ONLY_KEYS)
    converted = {key: value for key, value in profile.items()
                 if key in supported and key not in SYSTEM_ONLY_KEYS}
    converted["from"] = "User"
    converted["inherits"] = ""
    converted["version"] = "2.5.0.0"
    missing = sorted(CRITICAL_KEYS[kind] - set(converted))
    if missing:
        raise RuntimeError(f"OrcaSlicer does not expose required {kind} fields: {', '.join(missing)}")
    return converted, dropped


def build_profiles(asn_root: Path, orca_dll: Path, bridge_url: str,
                   asset_dir: Path) -> tuple[dict[Path, dict], dict[str, list[str]]]:
    sources = _source_profiles(asn_root)
    supported = _supported_keys(orca_dll, sources)
    output: dict[Path, dict] = {}
    dropped: dict[str, list[str]] = {}

    official_machine, removed = _convert(sources["machine"][0][1], "machine", supported)
    dropped[str(sources["machine"][0][0])] = removed
    for target_name in MACHINE_TARGETS:
        machine = dict(official_machine)
        machine["name"] = target_name
        machine["printer_settings_id"] = target_name
        machine["printer_model"] = "Anycubic Kobra 4"
        machine["print_host"] = bridge_url
        machine["host_type"] = "octoprint"
        machine["bed_custom_model"] = str(asset_dir / ASSETS[0])
        machine["bed_custom_texture"] = str(asset_dir / ASSETS[1])
        output[Path("machine") / f"{target_name}.json"] = machine

    for kind in ("filament", "process"):
        for source_path, source in sources[kind]:
            converted, removed = _convert(source, kind, supported)
            converted["compatible_printers"] = list(MACHINE_TARGETS)
            output[Path(kind) / source_path.name] = converted
            dropped[str(source_path)] = removed
    return output, dropped


def _atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=4)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def _atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=destination.parent,
                                    prefix=f".{destination.name}.", suffix=".tmp")
    os.close(fd)
    try:
        shutil.copy2(source, tmp_name)
        os.replace(tmp_name, destination)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def install(asn_root: Path, orca_root: Path, orca_dll: Path,
            bridge_url: str = "127.0.0.1:7125") -> dict:
    user_dir = discover_user_dir(orca_root)
    asset_dir = user_dir / "machine" / "Anycubic Kobra 4 assets"
    profiles, dropped = build_profiles(asn_root, orca_dll, bridge_url, asset_dir)

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = orca_root / "kobra4-profile-backups" / stamp
    counter = 1
    while backup.exists():
        backup = backup.with_name(f"{stamp}-{counter}")
        counter += 1
    backup.mkdir(parents=True)

    backed_up = []
    for relative in profiles:
        destination = user_dir / relative
        if destination.is_file():
            copy_to = backup / "profiles" / relative
            copy_to.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(destination, copy_to)
            backed_up.append({
                "path": str(relative),
                "sha256": _sha256(destination),
            })

    installed = []
    for relative, profile in profiles.items():
        destination = user_dir / relative
        _atomic_json(destination, profile)
        installed.append({"path": str(relative), "sha256": _sha256(destination)})

    for asset in ASSETS:
        source = asn_root / asset
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = asset_dir / asset
        _atomic_copy(source, destination)
        installed.append({
            "path": str(destination.relative_to(user_dir)),
            "sha256": _sha256(destination),
        })

    manifest = {
        "created_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "asn_profile_root": str(asn_root),
        "orca_user_dir": str(user_dir),
        "bridge_url": bridge_url,
        "backed_up": backed_up,
        "installed": installed,
        "dropped_unsupported_fields": dropped,
    }
    _atomic_json(backup / "manifest.json", manifest)
    validate_install(user_dir, profiles)
    return {"backup": str(backup), "user_dir": str(user_dir), **manifest}


def validate_install(user_dir: Path, expected: dict[Path, dict]) -> None:
    for relative, wanted in expected.items():
        actual = _read_json(user_dir / relative)
        if actual != wanted:
            raise RuntimeError(f"installed profile differs from generated profile: {relative}")
        if actual.get("inherits"):
            raise RuntimeError(f"unresolved inheritance in {relative}: {actual['inherits']}")
    for name in MACHINE_TARGETS:
        machine = _read_json(user_dir / "machine" / f"{name}.json")
        if machine.get("printer_model") != "Anycubic Kobra 4":
            raise RuntimeError(f"wrong printer model in {name}")
        if "Kobra X" in json.dumps(machine, ensure_ascii=False):
            raise RuntimeError(f"legacy Kobra X dependency remains in {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asn-root", type=Path, default=Path(
        r"C:\Program Files\AnycubicSlicerNext\resources\profiles\Anycubic"))
    parser.add_argument("--orca-root", type=Path,
                        default=Path(os.environ.get("APPDATA", "")) / "OrcaSlicer")
    parser.add_argument("--orca-dll", type=Path,
                        default=Path(r"C:\Program Files\OrcaSlicer\OrcaSlicer.dll"))
    parser.add_argument("--bridge-url", default="127.0.0.1:7125")
    parser.add_argument("--install", action="store_true")
    args = parser.parse_args()

    user_dir = discover_user_dir(args.orca_root)
    asset_dir = user_dir / "machine" / "Anycubic Kobra 4 assets"
    profiles, dropped = build_profiles(args.asn_root, args.orca_dll,
                                       args.bridge_url, asset_dir)
    if args.install:
        result = install(args.asn_root, args.orca_root, args.orca_dll, args.bridge_url)
    else:
        result = {
            "dry_run": True,
            "user_dir": str(user_dir),
            "profiles": {kind: sum(1 for path in profiles if path.parts[0] == kind)
                         for kind in ("machine", "filament", "process")},
            "dropped_unsupported_fields": dropped,
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
