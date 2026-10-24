#!/usr/bin/env python3
"""Official Kobra 4 profile sync is flattened, filtered and reversible."""
from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile


BASE = pathlib.Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    "sync_kobra4_orca_profiles", BASE / "scripts" / "sync_kobra4_orca_profiles.py")
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


machine = {
    "type": "machine", "from": "system", "setting_id": "machine-id",
    "instantiation": "true", "name": sync.SOURCE_MACHINE_NAME,
    "inherits": "", "version": "asn", "printer_settings_id": sync.SOURCE_MACHINE_NAME,
    "printer_model": "Anycubic Kobra 4", "printer_variant": "0.4",
    "nozzle_diameter": ["0.4"], "printable_area": ["0x0", "260x0", "260x260", "0x260"],
    "printable_height": "260", "gcode_flavor": "klipper",
    "machine_start_gcode": "G9111 official", "machine_end_gcode": "M84 official",
    "change_filament_gcode": "T[next_extruder]", "machine_max_speed_x": ["600"],
    "machine_max_speed_y": ["600"], "machine_max_acceleration_x": ["20000"],
    "machine_max_acceleration_y": ["20000"], "retraction_length": ["0.8"],
    "retraction_speed": ["30"], "single_extruder_multi_material": "1",
    "default_print_profile": "0.20mm Standard @Anycubic Kobra 4 0.4 nozzle",
    "default_filament_profile": ["Anycubic PLA @Anycubic Kobra 4 0.4 nozzle"],
    "bed_custom_model": "", "bed_custom_texture": "", "host_type": "octoprint",
    "asn_only_field": "drop me",
}
filament = {
    "type": "filament", "from": "system", "name": "Anycubic PLA @Anycubic Kobra 4 0.4 nozzle",
    "inherits": "", "version": "asn", "filament_settings_id": ["Anycubic PLA"],
    "filament_type": ["PLA"], "filament_vendor": ["Anycubic"],
    "nozzle_temperature": ["205"], "nozzle_temperature_initial_layer": ["215"],
    "hot_plate_temp": ["60"], "hot_plate_temp_initial_layer": ["60"],
    "filament_flow_ratio": ["0.98"], "filament_max_volumetric_speed": ["12"],
    "compatible_printers": [sync.SOURCE_MACHINE_NAME],
}
process = {
    "type": "process", "from": "system", "name": "0.20mm Standard @Anycubic Kobra 4 0.4 nozzle",
    "inherits": "", "version": "asn", "print_settings_id": "0.20mm Standard",
    "layer_height": "0.2", "resolution": "0.012", "default_acceleration": "6000",
    "travel_acceleration": "10000", "enable_prime_tower": "1",
    "compatible_printers": [sync.SOURCE_MACHINE_NAME],
}

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    asn = root / "asn"
    orca = root / "orca"
    user = orca / "user" / "profile-id"
    for kind in ("machine", "filament", "process"):
        (asn / kind).mkdir(parents=True, exist_ok=True)
        (user / kind).mkdir(parents=True, exist_ok=True)
    (asn / "machine" / sync.MACHINE_SOURCE).write_text(json.dumps(machine), encoding="utf-8")
    (asn / "filament" / f"{filament['name']}.json").write_text(json.dumps(filament), encoding="utf-8")
    (asn / "process" / f"{process['name']}.json").write_text(json.dumps(process), encoding="utf-8")
    for asset in sync.ASSETS:
        (asn / asset).write_bytes(("asset:" + asset).encode())
    (orca / "OrcaSlicer.conf").write_text(
        json.dumps({"app": {"preset_folder": "profile-id"}}), encoding="utf-8")
    old = user / "machine" / f"{sync.MACHINE_TARGETS[0]}.json"
    old.write_text('{"inherits":"Anycubic Kobra X 0.4 nozzle"}', encoding="utf-8")

    keys = set().union(machine, filament, process) - {"asn_only_field"}
    dll = root / "OrcaSlicer.dll"
    dll.write_bytes(b"\0".join(key.encode() for key in keys))
    result = sync.install(asn, orca, dll)

    installed = json.loads(old.read_text(encoding="utf-8"))
    official = user / "machine" / f"{sync.MACHINE_TARGETS[0]}.json"
    assert official.is_file()
    assert json.loads(official.read_text(encoding="utf-8"))["name"] == sync.MACHINE_TARGETS[0]
    assert installed["printer_model"] == "Anycubic Kobra 4"
    assert installed["inherits"] == "" and "Kobra X" not in json.dumps(installed)
    assert installed["change_filament_gcode"] == "T[next_extruder]"
    assert "asn_only_field" not in installed and "setting_id" not in installed
    backup = pathlib.Path(result["backup"])
    saved = backup / "profiles" / "machine" / old.name
    assert saved.is_file() and "Kobra X" in saved.read_text(encoding="utf-8")
    assert (backup / "manifest.json").is_file()
    assert len(list((user / "filament").glob("*Kobra 4*.json"))) == 1
    assert len(list((user / "process").glob("*Kobra 4*.json"))) == 1
    assert all(name in json.loads((user / "filament" / f"{filament['name']}.json").read_text(encoding="utf-8"))["compatible_printers"] for name in sync.MACHINE_TARGETS)
    assert all((user / "machine" / "Anycubic Kobra 4 assets" / a).is_file()
               for a in sync.ASSETS)

print("Orca Kobra 4 profile sync: all checks passed")
