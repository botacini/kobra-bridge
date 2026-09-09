# NOTICE

This repository contains code licensed under the **GNU General Public License
v3.0** (see [LICENSE](LICENSE)) and material that is **not** covered by that
license. Read this file before forking, distributing, or building from source.

## What is GPLv3-licensed

The original work in this repository:

- `bridge/` — Bridge daemon, MQTT client, web UI, configuration loader,
  protocol implementation
- `tools/` — `extract_credentials`, `fetch_credentials` utilities
- `_archive/tools/kx_printer_emulator.py` — printer emulator
- `Dockerfile`, `docker-compose.yml`, `release.sh`, build scripts
- Documentation files (`README*`, `CHANGELOG*`, `_archive/RE/06_docs/*`)
- `kobra_x_orcaslicer_preset.zip` — slicer profile derived from public OrcaSlicer
  presets, adapted for the Kobra X

You are free to use, modify and redistribute this code under the terms of
GPLv3 — including for commercial purposes — provided downstream forks remain
under GPLv3 and source is made available to recipients.

## What is **not** GPLv3-licensed

The following items are **third-party material**, included here only for
**interoperability purposes** as permitted under §69e UrhG (German Copyright
Act; equivalent: EU Software Directive Art. 6, US fair-use for reverse
engineering for interoperability):

- **`bridge/anycubic_slicer.crt`** and **`bridge/anycubic_slicer.key`** —
  TLS client certificate and private key extracted from Anycubic Slicer Next
  binaries. Copyright remains with Anycubic / their respective authors.
  Included solely to enable the bridge to authenticate against the LAN MQTT
  broker that runs on a Kobra X printer the end-user already owns. No
  ownership claim is made.

- **MQTT protocol structures, payload formats and signature algorithms** —
  reverse-engineered from `Workbench.dll` / `cloud_mqtt.dll` of the Anycubic
  Slicer Next application. The protocol itself is documented in
  `_archive/RE/06_docs/` for transparency. Any reproduction of code or
  protocol details serves interoperability only.

- **AMS material naming, slot numbering, GCode markers (`EXCLUDE_OBJECT_*`)**
  — follow conventions established by Anycubic and the wider Klipper
  ecosystem; usage here is purely interoperability-driven.

## What this means for forks

If you fork KX-Bridge:

1. **You must keep this `NOTICE.md` and `LICENSE` file** in your fork.
2. Your modifications and additions to the bridge code, UI, tools and docs
   inherit GPLv3 — they must be made available under the same license if you
   distribute them.
3. The third-party material listed above is **not** something you can
   relicense; it stays under the original (implicit) rights of its owners.
4. Removing the certificates and rebuilding them from your own Anycubic
   Slicer installation is the safest path for redistribution if you are
   unsure about the §69e situation in your jurisdiction.

## Disclaimer

This project is independent, non-commercial reverse-engineering work. It is
**not** affiliated with, endorsed by, or supported by Anycubic Technology
Co., Ltd. or any of their subsidiaries.

All trademarks are property of their respective owners.

## Kobra Bridge modified work notice

This repository is a modified work based on KX-Bridge by viewit:
https://gitea.it-drui.de/viewit/KX-Bridge-Release

Modifications made in 2026 include Kobra S1 and Kobra S1 Max model support,
model-aware capabilities, fail-closed cross-model G-code inspection and derived
files, multi-printer farm reliability/security fixes, and Kobra Bridge branding.
The modifications remain licensed under GNU GPL v3.0. Original KX-Bridge
copyright notices are retained in the source.

Kobra Bridge deliberately does not include `anycubic_slicer.crt` or
`anycubic_slicer.key`. Users supply that third-party interoperability material
locally; see `docs/CERTIFICATES.md`.
