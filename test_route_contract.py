#!/usr/bin/env python3
"""HTTP route contract: containment, honest status codes, no secret logging.

Three proven defects this guards:

1. `/kx/ui/lib/{name}` validated only the file extension, so
   `lib/../../../../etc/shadow.css` passed the check and resolved outside the
   theme directory. aiohttp preserves encoded dot-segments in match_info, so the
   handler - not the router - has to enforce containment.

2. The catch-all answered every unknown path and every wrong-method request with
   HTTP 200 `{"result": {}}`. A GET against a POST-only control endpoint looked
   like success, which hides client bugs and defeats aiohttp's native 405.

3. That same catch-all logged up to 200 bytes of request body at WARNING. A
   settings POST carries the printer password, and the log ring buffer is served
   by an unauthenticated /api/log/download.
"""
import pathlib
import sys

SRC = pathlib.Path(__file__).resolve().parent / "kobrax_moonraker_bridge.py"
source = SRC.read_text()

failures = []


def check(ok, msg):
    if not ok:
        failures.append(msg)


def body_of(marker, code_only=False):
    start = source.index(marker)
    nxt = source.find("\n    async def ", start + 1)
    alt = source.find("\n    def ", start + 1)
    ends = [e for e in (nxt, alt) if e != -1]
    text = source[start:min(ends)] if ends else source[start:]
    if code_only:
        # Comments describe the OLD behaviour on purpose; assert against code.
        text = "\n".join(l for l in text.splitlines()
                         if not l.lstrip().startswith("#"))
    return text


# 1. Static asset containment.
asset = body_of("async def handle_kx_ui_asset(")
check(".resolve()" in asset,
      "lib/ asset path must be resolved before use")
check("relative_to(" in asset,
      "resolved lib/ path must be proven inside the theme's lib directory")
check("HTTPNotFound" in asset,
      "an escaping path must 404, not serve the file")

# 2. Honest status codes.
catchall = body_of("async def handle_catchall(", code_only=True)
check("status=404" in catchall,
      "unknown routes must return 404, not a fake 200 result")
check('"result": {}' not in catchall,
      "catch-all must not fabricate an empty success payload")

# 3. No request bodies in logs.
check("await request.read()" not in catchall,
      "catch-all must not read request bodies into the log")
check("body=" not in catchall,
      "catch-all must not log request bodies (settings POST carries the password)")
check("request.path_qs" not in catchall,
      "catch-all must log the path without the query string")

# 4. Printer-file deletion: validated input, and cache evicted on success.
pdel = body_of("async def handle_kx_printer_file_delete(", code_only=True)
check("isinstance(filenames, list)" in pdel,
      "a bare string filenames value would iterate character-by-character")
check("_printer_thumbnail_cache.pop" in pdel,
      "deleting a printer file must evict its cached thumbnail")

# 5. The uploader must offer exactly what the backend accepts.
APP_JS = (SRC.parent / "web" / "themes" / "default" / "app.js").read_text()
upload_handler = source[source.index("async def handle_file_upload("):]
upload_handler = upload_handler[:upload_handler.index("\n    @staticmethod", 1)]
check('_allowed_ext = (".gcode", ".bgcode")' in upload_handler,
      "backend upload extension set changed - re-check the UI filter")
check(r"/\.(gcode|bgcode)$/" in APP_JS,
      "UI must reject the same extensions the backend rejects (.3mf gave an optimistic UI then HTTP 400)")

# 6. Upload ingestion must stay OFF the shared event loop. Hashing/parsing/
#    writing a 200MB G-code inline froze all six printers for the duration.
check("run_in_executor" in upload_handler,
      "upload hashing/parsing/write must run in an executor")
ingest_start = upload_handler.index("def _ingest(")
ingest_end = upload_handler.index("file_size = len(file_data)")
ingest = upload_handler[ingest_start:ingest_end]
for op in ("hashlib.md5", "_extract_thumbnail", "self._store.save_file"):
    check(op in ingest, f"{op} must happen inside the executor, not on the loop")

# 7. Compatibility progress is a separate read-only endpoint so the long
#    compatibility request can stay backward-compatible while UI polls status.
check('r.add_get("/kx/files/{file_id}/compatibility/progress"' in source,
      "compatibility progress route must remain registered")
progress_handler = body_of("async def handle_kx_file_compatibility_progress(", code_only=True)
check("run_in_executor" in progress_handler,
      "progress lookup must not put SQLite/file stat work on the shared event loop")

# 8. Partial profile-delete must be rejected BEFORE the empty-store shortcut.
#    Validating after it made malformed requests report success.
pdelete = body_of("async def handle_kx_filament_profiles_user_delete(", code_only=True)
guard_at = pdelete.find("status=400")
shortcut_at = pdelete.find("os.path.isfile(path)")
check(guard_at != -1, "partial profile-delete must be rejected with 400")
check(guard_at < shortcut_at,
      "profile-delete validation must run before the empty-store early return")
check("wipe_all" in pdelete,
      "bulk profile wipe must require an explicit ?all=true")

if failures:
    print("route contract FAILED:")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("route contract: 21/21 checks passed")
