"""
kobrax_client.py – Anycubic Kobra X LAN-MQTT-Client

Protocol fully reconstructed via sniffer 2026-04-17 (953 messages).

Voraussetzungen:
  - /tmp/anycubic_slicer.crt and .key (from cloud_mqtt.dll @ 0x2ed5b0 / 0x2edce0)
  - Drucker im LAN-Modus erreichbar auf Port 9883

Verwendung:
  client = KobraXClient(env_loader.PRINTER_IP, mode_id=env_loader.MODE_ID,
                        device_id=env_loader.DEVICE_ID)
  client.connect()
  info = client.query_info()
  print(info["data"]["temp"])
  client.disconnect()

────────────────────────────────────────────────────────────────────────────
Copyright (C) 2026 viewit (KX-Bridge contributors)
Modified in 2026 by Kobra Bridge contributors (streaming uploads, protocol
framing/reconnect hardening, redaction, and S1-family compatibility).

Licensed under GPLv3 — see LICENSE in the project root.
Protocol reverse-engineered for interoperability (§69e UrhG / EU Software
Directive Art. 6). Not affiliated with Anycubic. See NOTICE.md.
"""

import hashlib
import json
import logging
import os
import select
import socket
import ssl
import sys
import threading
import time
import uuid
from datetime import datetime
from urllib.parse import urlsplit, urlunsplit

import env_loader

log = logging.getLogger("kobrax.mqtt")

_LOG_SECRET_KEYS = {"password", "token", "secret", "api_key", "apikey", "authorization"}


def _redact_log_data(value):
    """Copy printer payloads with credentials/signed URL queries removed."""
    if isinstance(value, dict):
        return {
            k: ("***" if str(k).lower() in _LOG_SECRET_KEYS else _redact_log_data(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_redact_log_data(v) for v in value]
    if isinstance(value, str) and "://" in value:
        try:
            u = urlsplit(value)
            return urlunsplit((u.scheme, u.netloc, "/…", "", ""))
        except ValueError:
            return "***"
    return value


_SCRIPT_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
# Anycubic's slicer client certificate is third-party material (see NOTICE.md);
# Kobra Bridge does not ship it. Point KOBRA_CERT_DIR at a directory holding
# anycubic_slicer.crt / anycubic_slicer.key, or place them next to this file.
_CERT_DIR = os.environ.get("KOBRA_CERT_DIR") or _SCRIPT_DIR
CERT_FILE = os.path.join(_CERT_DIR, "anycubic_slicer.crt")
KEY_FILE  = os.path.join(_CERT_DIR, "anycubic_slicer.key")


# ---------------------------------------------------------------------------
# Low-level MQTT framing
# ---------------------------------------------------------------------------

def _enc_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return len(b).to_bytes(2, "big") + b


def _enc_len(n: int) -> bytes:
    out = bytearray()
    while True:
        d = n % 128
        n //= 128
        if n > 0:
            d |= 0x80
        out.append(d)
        if n == 0:
            break
    return bytes(out)


def _build_connect(client_id: str, username: str, password: str) -> bytes:
    proto = b"\x00\x04MQTT\x04"
    ka    = b"\x00\x3c"           # keepalive = 60s
    flags = 0xC2                  # username + password, clean session
    payload = _enc_str(client_id) + _enc_str(username) + _enc_str(password)
    body = proto + bytes([flags]) + ka + payload
    return bytes([0x10]) + _enc_len(len(body)) + body


def _build_subscribe(topic: str, pid: int) -> bytes:
    p = pid.to_bytes(2, "big") + _enc_str(topic) + b"\x00"
    return bytes([0x82]) + _enc_len(len(p)) + p


def _build_publish(topic: str, payload: str) -> bytes:
    body = _enc_str(topic) + payload.encode("utf-8")
    return bytes([0x30]) + _enc_len(len(body)) + body


def _build_pingreq() -> bytes:
    return bytes([0xC0, 0x00])


def _parse_publish(pkt: bytes):
    if len(pkt) < 2:
        return None, None
    tlen = (pkt[0] << 8) | pkt[1]
    if 2 + tlen > len(pkt):
        return None, None
    topic   = pkt[2:2 + tlen].decode("utf-8", errors="replace")
    payload = pkt[2 + tlen:]
    return topic, payload


# ---------------------------------------------------------------------------
# KobraXClient
# ---------------------------------------------------------------------------

class KobraXClient:
    def __init__(self, host: str, username: str, password: str,
                 mode_id: str, device_id: str,
                 port: int = 9883, client_id: str = "kobrax_py"):
        self.host      = host
        self.port      = port
        self.username  = username
        self.password  = password
        self.mode_id   = mode_id
        self.device_id = device_id
        self.client_id = client_id

        self._sock    = None
        self._buf     = b""
        self._pid     = 1
        self._lock    = threading.Lock()
        # Single-flight guard for _reconnect(): several threads (poll loop,
        # reader, HTTP handlers) can notice the same dead socket at once.
        # Without this they tear down each other's freshly built socket and
        # publish() lands on self._sock = None ("'NoneType' object has no
        # attribute 'sendall'").
        self._reconnect_lock = threading.Lock()
        self._last_send_error = None
        # Generation marker: incremented on every socket swap/close so the
        # reader thread notices when _reconnect/_do_connect swapped the socket
        # underneath it (Issue #53). Protects against recv on a stale fd.
        self._sock_gen = 0
        self._running = False

        # Pending requests by msgid (for response ACK)
        self._pending_msgid: dict[str, dict] = {}
        # Pending requests by msg_type/report topic suffix
        self._pending_report: dict[str, dict] = {}

        # Optional callbacks: topic_suffix → callable(payload_dict)
        self.callbacks: dict[str, callable] = {}

        # Dedup: last hash per topic suffix to suppress repeated identical messages
        self._last_rx_hash: dict[str, str] = {}
        # Fields that change every tick and should be stripped before dedup-hashing
        _VOLATILE = {"timestamp", "msgid", "progress", "curr_layer",
                     "curr_nozzle_temp", "curr_hotbed_temp",
                     "target_nozzle_temp", "target_hotbed_temp"}

    # -- Topics --------------------------------------------------------------

    def _pub_topic(self, msg_type: str) -> str:
        return (f"anycubic/anycubicCloud/v1/slicer/printer/"
                f"{self.mode_id}/{self.device_id}/{msg_type}")

    def _web_topic(self, msg_type: str) -> str:
        return (f"anycubic/anycubicCloud/v1/web/printer/"
                f"{self.mode_id}/{self.device_id}/{msg_type}")

    def _sub_topic(self) -> str:
        return (f"anycubic/anycubicCloud/v1/printer/public/"
                f"{self.mode_id}/{self.device_id}/#")

    # -- Connection ----------------------------------------------------------

    def _do_connect(self):
        if not os.path.exists(CERT_FILE) or not os.path.exists(KEY_FILE):
            raise FileNotFoundError(
                f"TLS client certificate missing: anycubic_slicer.crt + anycubic_slicer.key "
                f"expected in {_CERT_DIR}/ (or set KOBRA_CERT_DIR). Kobra Bridge does not "
                f"ship Anycubic's certificate; see docs/CERTIFICATES.md for how to obtain it."
            )
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode    = ssl.CERT_NONE
        ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
        ctx.load_cert_chain(CERT_FILE, KEY_FILE)

        # Build the socket as a local variable - the handshake (connect + CONNACK)
        # runs WITHOUT holding the lock so a slow connect does not freeze
        # senders. Only the finished socket is swapped in under the lock (#53).
        _ai      = socket.getaddrinfo(self.host, self.port, socket.AF_INET, socket.SOCK_STREAM)
        raw      = socket.create_connection(_ai[0][4], timeout=5)
        new_sock = ctx.wrap_socket(raw)
        log.info("TLS connected  cipher=%s", new_sock.cipher()[0])

        new_sock.sendall(_build_connect(self.client_id, self.username, self.password))
        new_sock.settimeout(3)
        r = new_sock.recv(64)
        if len(r) < 4 or r[0] != 0x20 or r[3] != 0:
            try:
                new_sock.close()
            except Exception:
                pass
            raise RuntimeError(f"CONNACK failed: {r.hex()}")
        log.info("CONNACK rc=0")

        new_sock.settimeout(0.2)
        with self._lock:
            self._sock = new_sock
            self._sock_gen += 1
            self._buf = b""
        self._subscribe(self._sub_topic())  # takes the lock itself - do not nest
        log.debug("MQTT connected to %s:%s", self.host, self.port)

    def connect(self):
        self._do_connect()
        self._running = True
        self._ensure_reader()
        time.sleep(0.3)

    def _ensure_reader(self):
        """Ensures the reader thread is alive. If the reader died after a
        previous disconnect/reconnect sequence or an unhandled error,
        received replies would never arrive - publish()
        would still send but wait for replies forever."""
        if not self._running:
            return  # gewollter disconnect
        t = getattr(self, "_reader_thread", None)
        if t is not None and t.is_alive():
            return
        self._reader_thread = threading.Thread(
            target=self._read_loop, daemon=True, name="kobrax-mqtt-reader",
        )
        self._reader_thread.start()

    def disconnect(self):
        self._running = False
        with self._lock:
            try:
                if self._sock is not None:
                    self._sock.close()
            except Exception:
                pass
            self._sock = None
            self._sock_gen += 1

    def _send(self, frame: bytes) -> bool:
        """Send one MQTT frame on the current socket.

        Single choke point for every sender (publish, publish_web, subscribe,
        ping). Reads self._sock under the lock instead of dereferencing the
        attribute directly, so a concurrent _reconnect() that momentarily sets
        it to None can never raise AttributeError on NoneType. Returns False
        when there is no usable socket or the write failed; callers decide
        whether to reconnect/retry.
        """
        with self._lock:
            sock = self._sock
            self._last_send_error = None
            if sock is None:
                return False
            try:
                sock.sendall(frame)
                return True
            except Exception as e:
                self._last_send_error = e
                return False

    def _reconnect(self):
        """Persistent reconnect: keeps retrying forever until the printer is
        responds or disconnect() was called. Backoff caps at 60 s. The
        first 5 attempts log as WARNING (acute connection issue), afterwards
        only DEBUG to avoid log spam during long printer outages (e.g. switched
        ausgeschaltet) zu vermeiden.

        Single-flight: concurrent callers do not each rebuild the socket.
        Losers of the race wait for the winner and reuse its result, so a
        healthy socket is never torn down by a second thread mid-handshake.
        """
        if not self._reconnect_lock.acquire(blocking=False):
            # Another thread is already reconnecting - wait for it to finish
            # and report on the socket it produced.
            with self._reconnect_lock:
                with self._lock:
                    return self._sock is not None
        try:
            return self._reconnect_locked()
        finally:
            self._reconnect_lock.release()

    def _reconnect_locked(self):
        """Persistent reconnect: keeps retrying forever until the printer is
        responds or disconnect() was called. Backoff caps at 60 s. The
        first 5 attempts log as WARNING (acute connection issue), afterwards
        only DEBUG to avoid log spam during long printer outages (e.g. switched
        ausgeschaltet) zu vermeiden."""
        log.warning("Connection lost - reconnecting...")
        # Close + invalidation under the lock so no sender is mid-sendall
        # auf den gerade geschlossenen Socket trifft (Issue #53).
        with self._lock:
            try:
                if self._sock is not None:
                    self._sock.close()
            except Exception:
                pass
            self._sock = None
            self._sock_gen += 1
        delays = [2, 4, 8, 15, 30, 60]
        attempt = 0
        while self._running:
            delay = delays[min(attempt, len(delays) - 1)]
            try:
                self._do_connect()
                log.info("Reconnect successful (after %d attempts)", attempt + 1)
                return True
            except Exception as e:
                attempt += 1
                lvl = log.warning if attempt <= 5 else log.debug
                lvl("Reconnect fehlgeschlagen (%s, Versuch %d), warte %ss…", e, attempt, delay)
                # Split sleep so disconnect() breaks the loop faster.
                slept = 0.0
                while slept < delay and self._running:
                    time.sleep(min(0.5, delay - slept))
                    slept += 0.5
        return False  # only when disconnect() was called

    def _subscribe(self, topic: str):
        with self._lock:
            pid = self._pid
            self._pid += 1
        if not self._send(_build_subscribe(topic, pid)):
            raise ConnectionError(f"MQTT subscribe send failed: {self._last_send_error or 'not connected'}")
        log.info("SUB %s", topic)

    # -- Read loop -----------------------------------------------------------

    def _read_loop(self):
        last_ping = time.time()
        _empty_count = 0
        while self._running:
            if time.time() - last_ping > 30:
                ping_ok = self._send(_build_pingreq())
                # Call _reconnect() OUTSIDE the lock - it takes the lock
                # itself, and threading.Lock is not reentrant (deadlock otherwise).
                if not ping_ok:
                    if self._running and not self._reconnect():
                        break
                last_ping = time.time()
            # Grab the current socket + generation under the lock so a
            # parallel _reconnect/_do_connect swap does not leave us polling
            # a stale fd (Issue #53).
            with self._lock:
                sock = self._sock
                gen  = self._sock_gen
            if sock is None:
                time.sleep(0.05)
                continue

            # Idle wait WITHOUT the lock - select only probes readiness, so
            # the reader never blocks the shared lock while idle.
            try:
                ready, _, _ = select.select([sock], [], [], 0.2)
            except (OSError, ValueError):
                # fd closed/invalid (reconnect or disconnect mid-select)
                if not self._running:
                    break
                time.sleep(0.05)
                continue
            if not ready:
                continue  # idle, no lock held

            # Data pending: briefly take the lock for the single recv, serialized
            # against all sendall callers. recv does not block long (select said
            # ready, socket timeout is 0.2s).
            try:
                with self._lock:
                    # The socket could have been swapped between select and here.
                    if self._sock_gen != gen or self._sock is not sock:
                        continue
                    data = sock.recv(65536)
                if not data:
                    # Windows SSL can briefly return b"" without a real EOF
                    _empty_count += 1
                    if _empty_count >= 5:
                        raise ConnectionResetError("EOF")
                    continue
                _empty_count = 0
                self._buf += data
                self._drain()  # outside the lock - dispatch/event.set() stays prompt
            except ssl.SSLWantReadError:
                continue
            except socket.timeout:
                continue
            except Exception as e:
                if self._running:
                    log.warning("reader error: %s", e)
                    if not self._reconnect():
                        break
                    last_ping = time.time()
                else:
                    break

    def _drain(self):
        buf = self._buf
        idx = 0
        while idx < len(buf):
            ptype = buf[idx] & 0xF0
            i = idx + 1
            mul = 1
            rem = 0
            remaining_len_done = False
            while i < len(buf):
                b = buf[i]
                rem += (b & 0x7F) * mul
                i += 1
                if not (b & 0x80):
                    remaining_len_done = True
                    break
                if mul >= 128 ** 3:
                    raise ValueError("malformed MQTT Remaining Length")
                mul *= 128
            # TCP can split inside the variable-length header. Keep the whole
            # packet from idx until another recv supplies its terminating byte.
            if not remaining_len_done or i + rem > len(buf):
                break
            pkt = buf[i:i + rem]
            idx = i + rem

            if ptype == 0x30:
                topic, raw_payload = _parse_publish(pkt)
                if topic is None:
                    continue
                try:
                    payload = json.loads(raw_payload)
                except Exception:
                    payload = {"_raw": raw_payload.decode("utf-8", errors="replace")}
                self._dispatch(topic, payload)

        self._buf = buf[idx:]

    def _dedup_hash(self, suffix: str, payload: dict) -> str:
        """Hash payload ignoring volatile per-tick fields for dedup check."""
        stable = {k: v for k, v in payload.items()
                  if k not in {"timestamp", "msgid", "progress", "curr_layer",
                               "curr_nozzle_temp", "curr_hotbed_temp",
                               "target_nozzle_temp", "target_hotbed_temp"}}
        return hashlib.md5(json.dumps(stable, sort_keys=True).encode(), usedforsecurity=False).hexdigest()

    def _dispatch(self, topic: str, payload: dict):
        suffix = "/".join(topic.split("/")[-2:])

        # Structured RX log with dedup suppression
        h = self._dedup_hash(suffix, payload)
        is_dup = self._last_rx_hash.get(suffix) == h
        self._last_rx_hash[suffix] = h
        if is_dup:
            log.debug("RX [dup] %-25s  state=%-12s", suffix, payload.get("state", ""))
        else:
            data = payload.get("data") or {}
            state = payload.get("state", "")
            if "progress" in data:
                log.info("RX %-25s  state=%-12s  progress=%s%%  layer=%s/%s",
                         suffix, state, data["progress"],
                         data.get("curr_layer", "?"), data.get("total_layers", "?"))
            elif "curr_nozzle_temp" in data:
                log.info("RX %-25s  nozzle=%s°C/%s°C  bed=%s°C/%s°C",
                         suffix,
                         data["curr_nozzle_temp"], data.get("target_nozzle_temp", 0),
                         data.get("curr_hotbed_temp", "?"), data.get("target_hotbed_temp", 0))
            else:
                log.info("RX %-25s  state=%-12s  data=%s",
                         suffix, state,
                         json.dumps(_redact_log_data(payload.get("data")), ensure_ascii=False))

        # Resolve by report topic suffix (e.g. "info/report")
        if suffix in self._pending_report:
            entry = self._pending_report[suffix]
            entry["result"] = payload
            entry["event"].set()

        # `/response` first acknowledges MQTT transport with the request msgid,
        # but its all-empty code=0 envelope is not the command result. The real
        # business reply follows on `<type>/report` and may use another msgid.
        # Waking here made print/start report a false rejection immediately.
        empty_ack = (suffix.endswith("/response")
                     and payload.get("code") == 0
                     and payload.get("data") is None
                     and not any(payload.get(k) for k in ("action", "state", "type", "msg")))
        msgid = payload.get("msgid")
        if not empty_ack and msgid and msgid in self._pending_msgid:
            entry = self._pending_msgid[msgid]
            entry["result"] = payload
            entry["event"].set()

        # User callbacks by topic suffix (last two path components)
        if suffix in self.callbacks:
            try:
                self.callbacks[suffix](payload)
            except Exception as e:
                log.error("callback error for %s: %s", suffix, e)

        # Generic wildcard callback
        if "*" in self.callbacks:
            try:
                self.callbacks["*"](topic, payload)
            except Exception as e:
                log.error("wildcard callback error: %s", e)

    # -- Publish + request/response ------------------------------------------

    def publish(self, msg_type: str, action: str, data=None, timeout: float = 5.0) -> dict | None:
        # If the reader thread is dead for historical reasons, revive it -
        # otherwise replies would never arrive and event.wait() would time out.
        self._ensure_reader()
        msgid   = str(uuid.uuid4())
        payload = json.dumps({
            "type":      msg_type,
            "action":    action,
            "msgid":     msgid,
            "timestamp": int(time.time() * 1000),
            "data":      data,
        }, separators=(",", ":"))

        # Wait by msgid only — avoids collisions when multiple threads
        # call publish() for the same msg_type concurrently.
        # Also register by report topic as fallback for responses without msgid.
        report_key = f"{msg_type}/report"
        event  = threading.Event()
        entry  = {"event": event, "result": None}
        self._pending_msgid[msgid] = entry
        # Only register report-key waiter if nobody else is waiting on it
        report_registered = False
        if report_key not in self._pending_report:
            self._pending_report[report_key] = entry
            report_registered = True

        topic = self._pub_topic(msg_type)
        # Status poll TX (query/getInfo) is pure noise (every few seconds) ->
        # auf DEBUG. Aktions-TX (start/set/control/move/…) bleibt INFO sichtbar.
        _tx_level = logging.DEBUG if action in ("query", "getInfo") else logging.INFO
        log.log(_tx_level, "TX %-25s  action=%-12s  data=%s",
                f"{msg_type}/request", action,
                json.dumps(data, ensure_ascii=False) if data else "null")
        if not self._send(_build_publish(topic, payload)):
            log.warning("send failed: %s, reconnecting…",
                        self._last_send_error or "not connected")
            self._pending_msgid.pop(msgid, None)
            if report_registered:
                self._pending_report.pop(report_key, None)
            if not self._reconnect():
                return None
            # retry once after reconnect
            if not self._send(_build_publish(topic, payload)):
                return None
            self._pending_msgid[msgid] = entry
            if report_registered:
                self._pending_report[report_key] = entry

        if timeout <= 0:
            self._pending_msgid.pop(msgid, None)
            if report_registered:
                self._pending_report.pop(report_key, None)
            return None

        received = event.wait(timeout)
        self._pending_msgid.pop(msgid, None)
        if report_registered:
            self._pending_report.pop(report_key, None)
        if not received:
            return None
        return entry["result"]

    def publish_web(self, msg_type: str, action: str, data=None) -> None:
        """Fire-and-forget publish on the web/printer topic (used for runtime updates during print)."""
        self._ensure_reader()
        msgid   = str(uuid.uuid4())
        payload = json.dumps({
            "type":      msg_type,
            "action":    action,
            "msgid":     msgid,
            "timestamp": int(time.time() * 1000),
            "data":      data,
        }, separators=(",", ":"))
        topic = self._web_topic(msg_type)
        log.info("TX(web) %-23s  action=%-12s  data=%s",
                 f"{msg_type}/request", action,
                 json.dumps(data, ensure_ascii=False) if data else "null")
        if not self._send(_build_publish(topic, payload)):
            log.warning("web send failed: %s, reconnecting…",
                        self._last_send_error or "not connected")
            # Trigger a reconnect (like publish()); no retry because it is
            # fire-and-forget - the next call will hit the fresh socket
            # treffen.
            try:
                self._reconnect()
            except Exception:
                pass

    # -- High-level commands -------------------------------------------------

    def query_info(self) -> dict | None:
        return self.publish("info", "query")

    def query_status(self) -> dict | None:
        return self.publish("status", "query")

    def query_multicolor_box(self) -> dict | None:
        return self.publish("multiColorBox", "getInfo")

    def set_temperature(self, nozzle: int, bed: int) -> dict | None:
        return self.publish("tempature", "set",
                            {"target_nozzle_temp": nozzle, "target_hotbed_temp": bed})

    def set_fan(self, pct: int) -> dict | None:
        return self.publish("fan", "set", {"fan_speed_pct": pct})

    def set_light(self, on: bool, brightness: int = 80) -> dict | None:
        return self.publish("light", "control",
                            {"type": 2, "status": 1 if on else 0, "brightness": brightness})

    def start_camera(self) -> dict | None:
        return self.publish("video", "startCapture")

    def stop_camera(self) -> dict | None:
        return self.publish("video", "stopCapture")

    def pause_print(self, taskid: str = "-1") -> dict | None:
        return self.publish("print", "pause", {"taskid": taskid})

    def resume_print(self, taskid: str = "-1") -> dict | None:
        return self.publish("print", "resume", {"taskid": taskid})

    def stop_print(self, taskid: str = "-1") -> dict | None:
        return self.publish("print", "stop", {"taskid": taskid})

    # -- Part-Skip ("Exclude Object") ---------------------------------------

    def query_skip_objects(self) -> dict | None:
        """Asks the printer for the current object/skip list."""
        return self.publish("skip", "query_obj")

    def skip_objects(self, names: list[str]) -> dict | None:
        """Skips the named objects - also possible mid-print.

        Names correspond to the EXCLUDE_OBJECT_DEFINE NAME=... entries
        im GCode-Header bzw. file_details.objects_skip_parts.
        """
        return self.publish("skip", "start", {"objects_skip_parts": list(names)})

    # -- G-Code Upload -------------------------------------------------------

    def upload_gcode(self, filepath: str, remote_filename: str | None = None,
                     upload_url: str | None = None, progress_cb=None) -> dict:
        """Upload a G-Code or .3mf file via HTTP POST to port 18910.

        ``progress_cb(sent_bytes, total_bytes)`` is optional and called after
        each 256 KiB socket write. The total is the file bytes, not multipart
        overhead, so UI percentages stay intuitive.

        Returns the parsed JSON response from the printer.
        Raises RuntimeError on HTTP or connection errors.

        Protocol captured via Wireshark 2026-04-18:
          POST /gcode_upload?s={session_token}
          Multipart fields: 'filename' (text) + 'gcode' (file bytes)
          Required headers: X-File-Length, X-BBL-* (BambuLab heritage)
        """
        if not upload_url:
            info = self.query_info()
            if not info:
                raise RuntimeError("Could not get info/report for upload URL")
            upload_url = info["data"]["urls"]["fileUploadurl"]
        # parse token from URL query string
        token = upload_url.split("?s=")[1] if "?s=" in upload_url else ""

        total = os.path.getsize(filepath)

        if remote_filename is None:
            remote_filename = os.path.basename(filepath)

        boundary = "------------------------a3a050b927d92a4c"
        sep = f"--{boundary}\r\n".encode()
        end = f"--{boundary}--\r\n".encode()

        part_filename = (
            sep +
            f'Content-Disposition: form-data; name="filename"\r\n\r\n'.encode() +
            remote_filename.encode() + b"\r\n"
        )
        # The gcode part is streamed chunk-wise below, so only its framing is
        # materialised here. Building the whole multipart body would hold a
        # second (and via concatenation briefly a third) copy of a file that is
        # routinely >200 MB.
        gcode_prefix = (
            sep +
            f'Content-Disposition: form-data; name="gcode"; filename="{remote_filename}"\r\n'
            f'Content-Type: application/octet-stream\r\n\r\n'.encode()
        )
        gcode_suffix = b"\r\n"
        body_len = (len(part_filename) + len(gcode_prefix) + total
                    + len(gcode_suffix) + len(end))

        headers = (
            f"POST /gcode_upload?s={token} HTTP/1.1\r\n"
            f"Host: {self.host}:18910\r\n"
            f"User-Agent: AnycubicSlicerNext/1.3.9.4\r\n"
            f"Accept: */*\r\n"
            f"X-BBL-Client-Name: AnycubicSlicerNext\r\n"
            f"X-BBL-Client-Type: slicer\r\n"
            f"X-BBL-Client-Version: 01.03.09.04\r\n"
            f"X-BBL-Device-ID: {str(uuid.uuid4())}\r\n"
            f"X-BBL-Language: de-DE\r\n"
            f"X-BBL-OS-Type: windows\r\n"
            f"X-BBL-OS-Version: 10.0.26200\r\n"
            f"X-File-Length: {total}\r\n"
            f"Content-Type: multipart/form-data; boundary={boundary}\r\n"
            f"Content-Length: {body_len}\r\n"
            f"Connection: close\r\n\r\n"
        ).encode()

        # Short connect timeout (LAN), bounded per-I/O timeout afterwards. A
        # stalled printer must not strand an executor thread and a permanent
        # "Uploading" state forever; 180 s is per socket operation, not total.
        _ai  = socket.getaddrinfo(self.host, 18910, socket.AF_INET, socket.SOCK_STREAM)
        sock = socket.create_connection(_ai[0][4], timeout=10)
        response = b""
        try:
            sock.settimeout(180)
            sock.sendall(headers + part_filename)
            sent = 0
            sock.sendall(gcode_prefix)
            if progress_cb:
                progress_cb(0, total)
            with open(filepath, "rb") as fh:
                while True:
                    chunk = fh.read(256 * 1024)
                    if not chunk:
                        break
                    sock.sendall(chunk)
                    sent += len(chunk)
                    if progress_cb:
                        progress_cb(sent, total)
            sock.sendall(gcode_suffix + end)
            try:
                while True:
                    chunk = sock.recv(65536)
                    if not chunk:
                        break
                    response += chunk
            except socket.timeout:
                pass
        finally:
            sock.close()

        # parse HTTP response body
        if b"\r\n\r\n" in response:
            body_start = response.index(b"\r\n\r\n") + 4
            resp_body = response[body_start:]
        else:
            resp_body = response
        try:
            return json.loads(resp_body)
        except Exception:
            raise RuntimeError(f"Upload: unerwartete Antwort: {resp_body[:200]}")

    def move_axis(self, axis: int, move_type: int = 2, distance: int = 0) -> dict | None:
        return self.publish("axis", "move",
                            {"axis": axis, "move_type": move_type, "distance": distance})

    def home_all(self) -> dict | None:
        # axis=4 move_type=2 = Home all axes (~4-15s)
        return self.publish("axis", "move", {"axis": 4, "move_type": 2, "distance": 0}, timeout=30.0)

    def home_axis(self, axis: int) -> dict | None:
        # axis: 1=Y, 2=X, 3=Z
        return self.publish("axis", "move", {"axis": axis, "move_type": 2, "distance": 0}, timeout=30.0)

    def jog(self, axis: int, direction: int, distance_mm: int = 1) -> dict | None:
        # axis: 1=Y, 2=X, 3=Z  direction: 0=neg, 1=pos
        return self.move_axis(axis=axis, move_type=direction, distance=distance_mm)


# ---------------------------------------------------------------------------
# CLI Demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Anycubic Kobra X LAN-Client")
    parser.add_argument("--ip",        default=env_loader.PRINTER_IP)
    parser.add_argument("--port",      type=int, default=env_loader.MQTT_PORT)
    parser.add_argument("--username",  default=env_loader.USERNAME)
    parser.add_argument("--password",  default=env_loader.PASSWORD)
    parser.add_argument("--mode-id",   default=env_loader.MODE_ID)
    parser.add_argument("--device-id", default=env_loader.DEVICE_ID)
    parser.add_argument("--monitor",   action="store_true",
                        help="Listen continuously and print all reports")
    args = parser.parse_args()

    client = KobraXClient(
        host=args.ip, port=args.port,
        username=args.username, password=args.password,
        mode_id=args.mode_id, device_id=args.device_id,
    )

    if args.monitor:
        def on_msg(topic, payload):
            suffix = "/".join(topic.split("/")[-2:])
            ts = datetime.now().strftime("%H:%M:%S")
            state = payload.get("state", "")
            data  = payload.get("data") or {}
            if "progress" in data:
                print(f"[{ts}] {suffix:25}  state={state:12}  progress={data['progress']}%  layer={data.get('curr_layer','?')}/{data.get('total_layers','?')}")
            elif "curr_nozzle_temp" in data:
                print(f"[{ts}] {suffix:25}  nozzle={data['curr_nozzle_temp']}°C/{data.get('target_nozzle_temp',0)}°C  bed={data['curr_hotbed_temp']}°C/{data.get('target_hotbed_temp',0)}°C")
            else:
                print(f"[{ts}] {suffix:25}  state={state}")

        client.callbacks["*"] = on_msg
        client.connect()
        print("[kobrax] Monitor mode active (Ctrl-C to stop)")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        client.disconnect()
    else:
        client.connect()

        print("\n--- query_info ---")
        info = client.query_info()
        if info:
            d = info.get("data", {})
            print(f"  Printer:  {d.get('printerName')}  FW {d.get('version')}")
            print(f"  Status:   {d.get('state')}")
            t = d.get("temp", {})
            print(f"  Nozzle:   {t.get('curr_nozzle_temp')}°C → {t.get('target_nozzle_temp')}°C")
            print(f"  Bett:     {t.get('curr_hotbed_temp')}°C → {t.get('target_hotbed_temp')}°C")
            urls = d.get("urls", {})
            print(f"  Upload:   {urls.get('fileUploadurl')}")
            print(f"  Kamera:   {urls.get('rtspUrl')}")
        else:
            print("  No response")

        client.disconnect()
