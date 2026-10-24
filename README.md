# Kobra Bridge

A local Moonraker-compatible bridge for **Anycubic Kobra 4, Kobra X, Kobra S1, and Kobra S1 Max** printers.

**Kobra Bridge is based on [KX-Bridge by viewit](https://gitea.it-drui.de/viewit/KX-Bridge-Release).** It remains GPLv3 and retains the upstream copyright and NOTICE. The Kobra Bridge modifications add model-aware S1/S1 Max support, multi-printer farm behavior, persistent dispatch state, and fail-closed cross-model G-code adaptation.

> Experimental software controlling real machinery. Keep it on a trusted LAN. Verify the target printer, nozzle, filament, and generated G-code before printing.

## What works

- Kobra 4 (`modelId 20028`), Kobra X (`20030`), Kobra S1 (`20025`), and Kobra S1 Max (`20029`)
- Signed Anycubic LAN discovery (`/info` → `/ctrl`), MQTT/TLS status and control, HTTP G-code upload
- One process and dashboard for multiple printers, one HTTP port per printer
- Print, pause, resume, cancel, temperatures, fans, lights, file library, history, camera and ACE state where supported
- S1/S1 Max chamber/fan fields and 1–4 ACE units
- Automatic per-target G-code compatibility checks before dispatch
- Immutable derived G-code for safe single-tool cross-model jobs

Hardware note: Kobra S1 Max model/status/chamber/fans/ACE were validated against a real `modelId 20029` printer. Kobra S1 support follows the same verified protocol family and upstream S1 reports, but has not been exercised on this maintainer's hardware.

## Cross-model G-code safety

Kobra Bridge does **not** scale, translate, or reshape a sliced toolpath.

For a single-tool file it can, when proven safe:

1. validate source model, nozzle diameter, X/Y/Z bounds, temperatures, chamber requirements, tool count and motion limits;
2. replace only the verified machine-owned start, end, first-layer purge, and printer metadata blocks;
3. clamp speed/acceleration to the target profile;
4. store an immutable derived copy keyed by source, target model and converter version.

It blocks unknown models, ambiguous motion, out-of-volume geometry, nozzle/temperature mismatch, unsupported chamber heat, and cross-model multicolour choreography. Kobra X, S1 and S1 Max have different off-bed cutter/wipe coordinates; guessing would be unsafe.

## Requirements

- Docker Engine on Linux with host networking, or Python 3.11+
- Printer and bridge host on the same trusted LAN
- LAN mode enabled on each printer
- Anycubic slicer TLS client certificate/key (not distributed here; see [docs/CERTIFICATES.md](docs/CERTIFICATES.md))

## Windows quick start (Kobra 4 / Kobra X / S1 / S1 Max)

1. Install [Python 3.11 or later](https://www.python.org/downloads/windows/). Git is optional: either download this branch as a ZIP from GitHub and extract it, or clone it with:
   ```powershell
   git clone -b feature/kobra4-support https://github.com/botacini/kobra-bridge.git
   ```
2. Open the extracted `kobra-bridge` folder and double-click **`install.bat`**. This creates a local `.venv`, installs `requirements.txt`, and creates `config/config.ini` if absent. It does **not** overwrite an existing configuration.
3. Download `anycubic-certs.zip` from the [upstream KX-Bridge releases](https://gitea.it-drui.de/viewit/KX-Bridge-Release/releases) and extract `anycubic_slicer.crt` and `anycubic_slicer.key` into `certs/`. These TLS credentials are required and cannot be bundled with the project.
4. Enable **LAN mode** on the printer. The Windows PC and printer must be on the same trusted local network.
5. Double-click **`start.bat`**; keep its terminal window open. In a browser open **http://localhost:7125**, select **Add printer**, and enter the printer's LAN IPv4 address. The bridge performs local signed `/info` → `/ctrl` discovery to retrieve the printer's connection credentials automatically.
6. In OrcaSlicer, select **Moonraker** as the printer network connection and set the host to `http://localhost:7125`. If OrcaSlicer runs on a different machine, substitute the Windows bridge PC's LAN address (and allow TCP port 7125 through its firewall if needed).

**Anycubic Slicer Next (ASN) login:** **not required by Kobra Bridge**. The local discovery does not access the Anycubic cloud account. If LAN mode setup on a particular printer/firmware asks for the official app or account, complete that device-specific setup first; it is separate from bridge authentication.

**Networking:** The bridge normally detects the PC's LAN address from the route to the printer when preparing print requests. Do not set `BRIDGE_HOST_IP` for typical installations; it is an optional override for unusual network configurations. Cloud functions in the official Anycubic app are independent from this local bridge, subject to the printer firmware's LAN/cloud mode behavior.

**Troubleshooting:** If the dashboard cannot add the printer, verify its IP, LAN mode, host firewall and that port 18910 is reachable. If MQTT authentication fails, confirm both TLS files are present in `certs/`. On Windows, run the scripts from an extracted local directory, not from inside a ZIP. `start.bat` must remain running to use OrcaSlicer/Mobileraker.

## Quick start (Docker)

```sh
git clone https://github.com/cluzl/kobra-bridge.git
cd kobra-bridge
cp config/config.ini.example config/config.ini
# Put anycubic_slicer.crt and anycubic_slicer.key in ./certs first.
BRIDGE_HOST_IP=192.168.1.100 docker compose up -d --build
```

Open `http://192.168.1.100:7125`, choose **Add printer**, and enter only the printer IP. The bridge discovers model ID and LAN credentials. Additional printers use ports 7126, 7127, and so on.

For an existing `[connection]` or `[printer_N]` entry with an IP but missing LAN credentials, startup performs the same local `/info` → `/ctrl` discovery and saves the result atomically to the gitignored `config/config.ini`.

Connect OrcaSlicer using Moonraker and the matching bridge URL, for example `http://192.168.1.100:7125`.

Uploads received on Moonraker's `/server/files/upload` (and OrcaSlicer's
`/api/files/local` alias) are saved in the bridge library, transferred through
the printer's `/gcode_upload` endpoint, and accepted only after an MQTT
`file/listLocal` response confirms the same filename and size. An upload never
starts a print, even when the slicer sends `print=true`.

## Python

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp config/config.ini.example config/config.ini
export KOBRA_CERT_DIR="$PWD/certs"
export BRIDGE_HOST_IP=192.168.1.100
python kobrax_moonraker_bridge.py
```

## Tests

```sh
./test.sh
```

The tests are dependency-light, perform no printer actions, and cover model detection, S1 state/ACE parsing, MQTT framing, streaming uploads, deterministic conversion, concurrency, blocked targets, and farm UI dispatch safety.

## Compatibility names

The Python module names and `/kx/*` routes remain for compatibility with KX-Bridge clients and existing installations. The product and public project are Kobra Bridge.

## Security

This bridge has printer-control endpoints and is designed for a trusted LAN. Do not expose it directly to the internet. `config/config.ini` contains printer credentials; `certs/` contains authentication material. Both are gitignored. See [SECURITY.md](SECURITY.md).

## Attribution and license

Copyright for the original KX-Bridge work remains with **viewit and KX-Bridge contributors**. Kobra Bridge modifications were made in 2026 and are distributed under **GNU GPL v3.0**.

- Upstream: https://gitea.it-drui.de/viewit/KX-Bridge-Release
- License: [LICENSE](LICENSE)
- Upstream and third-party notices: [NOTICE.md](NOTICE.md)
- Bundled UI dependencies: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)

Kobra Bridge is not affiliated with or endorsed by Anycubic. All trademarks belong to their owners.
