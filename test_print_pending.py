#!/usr/bin/env python3
"""Bridge-owned print-pending state survives tabs but never lies or races."""
from __future__ import annotations
import ast, asyncio, os, pathlib, threading, time, types, uuid, sys

BASE = pathlib.Path(__file__).parent
sys.path.insert(0, str(BASE))
from kobra_models import model_for_id, model_for_name
SRC = BASE / "kobrax_moonraker_bridge.py"
text = SRC.read_text(); tree = ast.parse(text)
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "KobraXBridge")
fns = {n.name: n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
needed = ("_set_print_pending", "_clear_print_pending", "_pending_active", "_model_payload", "_reset_terminal_state",
          "_on_print", "_on_info", "handle_kx_print", "handle_kx_printer_file_start",
          "_farm_printer_entry", "handle_api_state")
missing = [n for n in needed if n not in fns]
assert not missing, f"missing print-pending API: {missing}"

future = ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations", asname=None)], level=0)
ns = {
    "asyncio": asyncio, "os": os, "time": time, "uuid": uuid, "PRINT_PENDING_TTL": 180.0,
    "CAMERA_ENABLED": False, "model_for_id": model_for_id, "model_for_name": model_for_name,
    "env_loader": types.SimpleNamespace(get=lambda *a, **k: ""),
    "KOBRA_TO_KLIPPER_STATE": {
        "free":"standby","busy":"printing","printing":"printing","preheating":"printing",
        "auto_leveling":"printing","checking":"printing","updated":"printing","init":"printing",
        "pausing":"paused","pause":"paused","paused":"paused","resuming":"printing",
        "resumed":"printing","stopping":"printing","stoped":"standby","finished":"complete",
        "failed":"error","canceled":"standby",
    },
    "log": types.SimpleNamespace(**{k: (lambda *a, **kw: None) for k in ("info","warning","error","debug")}),
}
for name in needed:
    mod=ast.Module(body=[future,fns[name]],type_ignores=[]);ast.fix_missing_locations(mod)
    exec(compile(mod,str(SRC),"exec"),ns)

class Fake:
    _set_print_pending=ns["_set_print_pending"];_clear_print_pending=ns["_clear_print_pending"]
    _pending_active=ns["_pending_active"];_model_payload=ns["_model_payload"];_reset_terminal_state=ns["_reset_terminal_state"]
    _on_print=ns["_on_print"];_on_info=ns["_on_info"]
    handle_kx_print=ns["handle_kx_print"];handle_kx_printer_file_start=ns["handle_kx_printer_file_start"]
    def __init__(self,publish_result=None):
        self._state={"print_state":"standby","kobra_state":"free","filename":"","print_pending":None,
          "printer_name":"P","firmware_version":"","progress":0.0,"print_duration":0,"remain_time":0,
          "curr_layer":0,"total_layers":0,"slicer_time":0,"layer_height":0.0,"first_layer_height":0.0,
          "supplies_usage":0,"file_ready":"","error_code":0,"pause_msg":"","taskid":"-1","print_speed_mode":2,
          "nozzle_temp":0.0,"nozzle_target":0.0,"bed_temp":0.0,"bed_target":0.0,"chamber_temp":0.0,"chamber_target":0.0,
          "model_id":"20030","model_name":"Anycubic Kobra X","upload_url":"","camera_url":"",
          "fan_speed":0,"aux_fan_speed":0,"box_fan_speed":0,"light_on":False,"light_brightness":0,"upload_progress":{"active":False,"phase":"idle"},
          "filament_mode":"toolhead","ace_drying":{}}
        self._args=types.SimpleNamespace(camera_on_print=0,auto_leveling=1,vibration_compensation=0,device_id="dev",mode_id="20030",model_id="20030")
        self._model=model_for_id("20030")
        self._print_pending_lock=threading.Lock()
        self._printer_id="1";self._filament_mode="toolhead";self._ams_slots=[];self._ams_loaded_slot=-1
        self._ace_box_ids=[];self._ace_auto_feed={};self._ace_dry_presets={};self._camera_autostarted=False
        self._camera_user_stopped=False;self._current_job_id="";self._thumbnail_b64=""
        self._pending_preprint_skip=[];self._pending_preprint_skip_deadline=0.0
        self._spoolman_slot_usage={};self._spoolman_slot_reported={};self._spoolman_last_usage=0.0;self._spoolman_last_sync=0.0
        self.store_calls=0;self.ensure_calls=0;self.publish_result=publish_result;self.last_publish=None;self.built_auto=None
        self._store=types.SimpleNamespace(
          get_file=lambda fid:{"id":"f1","filename":"a.gcode","path":"/tmp/a","size_bytes":1},
          get_file_by_name=lambda *a:None,
          start_job=lambda **k:self._start_job(),finish_job=lambda *a,**k:None,
          get_maintenance=lambda *a:{},printer_totals=lambda *a,**k:{"jobs":0,"print_hours":0})
        self.client=types.SimpleNamespace(publish=self._publish,start_camera=lambda:None)
        self.camera_cache=types.SimpleNamespace(set_url=lambda u:None)
    def _start_job(self):self.store_calls+=1;return "j"
    def _publish(self,*a,**k):
        self.last_publish=a
        if isinstance(self.publish_result,Exception):raise self.publish_result
        return self.publish_result
    def _json_cors(self,data,status=200):return status,data
    def _build_auto_ams_box_mapping(self):return []
    def _build_assigned_ams_box_mapping(self,a):return [],0,0
    def _wait_for_file_action(self,action,send_fn,timeout=8):
        send_fn();return {"code":200,"data":{"records":[{"filename":"local.gcode","is_dir":False}]}}
    def _prepare_gcode_for_target(self,gf):return gf,types.SimpleNamespace(decision="native")
    def _ensure_gcode_on_printer(self,gf):self.ensure_calls+=1;return False
    def _serve_url(self,p):return "http://x/serve/a"
    def _build_print_payload(self,*a,**k):self.built_auto=k.get("auto_leveling");return {}
    def _reset_skip_state(self,*a):pass
    def _apply_preprint_skip_after_start(self,*a):pass
    def _push_status_update(self):pass
    def _spoolman_notify_end(self):pass
    def _claim_history_job(self,*a,**k):self.store_calls+=1;return "j"
    def _finish_history_jobs(self,*a,**k):return ""

class Req:
    def __init__(self,body=None):self.body=body or {"file_id":"f1"}
    async def json(self):return self.body

# Reservation is single-flight. After request 1 releases and request 2 reserves,
# a delayed cleanup from request 1 cannot erase request 2's state.
b=Fake();t1=b._set_print_pending("a.gcode")
assert b._set_print_pending("b.gcode")=="", "concurrent second dispatch must be rejected"
assert b._clear_print_pending(t1) is True
t2=b._set_print_pending("b.gcode")
assert t1!=t2 and b._pending_active()=="b.gcode"
assert b._clear_print_pending(t1) is False and b._pending_active()=="b.gcode"
assert b._clear_print_pending(t2) is True and not b._pending_active()

# TTL bounds stale state.
b=Fake();b._state["print_pending"]={"filename":"a.gcode","token":"x","ts":time.time()-181}
assert not b._pending_active() and not b._state["print_pending"]

# Delayed ACK/free/terminal reports from the previous job must not clear a NEW dispatch.
for event,payload in (("print",{"state":"done","data":{}}),("print",{"state":"free","data":{}}),
                      ("print",{"state":"finished","data":{}}),("info",{"state":"free","data":{"project":None}})):
    b=Fake();b._set_print_pending("new.gcode")
    (b._on_print if event=="print" else b._on_info)(payload)
    assert b._pending_active()=="new.gcode", f"stale {event} {payload} cleared new pending"
# A real active phase proves pickup and clears pending.
for phase in ("busy","auto_leveling","preheating","printing"):
    b=Fake();b._set_print_pending("a.gcode");b._on_info({"state":phase,"data":{"project":{"state":phase}}})
    assert not b._pending_active(), phase

# Handler failure/success cases.
def run(b):return asyncio.run(b.handle_kx_print(Req()))
b=Fake({"code":500,"state":"failed","msg":"rejected"});status,data=run(b)
assert status==502 and data.get("error") and not b._pending_active() and b.store_calls==0
b=Fake(RuntimeError("mqtt down"));status,data=run(b)
assert status==502 and not b._pending_active() and b.store_calls==0
b=Fake({"code":200,"state":"done"});status,data=run(b)
assert status==200 and data["result"]=="ok" and b._pending_active()=="a.gcode" and b.store_calls==1, (status,data,b._pending_active(),b.store_calls)
# S1 Max bridge-store starts honor the configured default after the persisted
# LeviQ3 temperature is repaired; callers can still explicitly disable it.
b=Fake({"code":200,"state":"done"});b._model=model_for_id("20029");b._args.model_id="20029";status,data=run(b)
assert status==200 and b.built_auto==1
b=Fake({"code":200,"state":"done"});b._model=model_for_id("20029");b._args.model_id="20029";status,data=asyncio.run(b.handle_kx_print(Req({"file_id":"f1","auto_leveling":0})))
assert status==200 and b.built_auto==0

# _serve_url fails before ownership is set: structured error, no stuck pending.
b=Fake();b._serve_url=lambda p:(_ for _ in ()).throw(RuntimeError("bad BRIDGE_HOST_IP"))
status,data=run(b);assert status==500 and not b._pending_active() and b.ensure_calls==0

# Printer-local starts use the printer's own file identity and .acm mapping:
# no bridge copy/upload, with normal auto-leveling unless explicitly disabled.
def run_local(b,body):return asyncio.run(b.handle_kx_printer_file_start(Req(body)))
b=Fake({"code":200,"state":"done"});status,data=run_local(b,{"filename":"local.gcode"})
assert status==200 and data["result"]=="ok" and b.ensure_calls==0 and b._pending_active()=="local.gcode"
assert b.last_publish[0:2]==("print","start")
payload=b.last_publish[2]
assert payload["filename"]=="local.gcode" and payload["filepath"]=="/" and payload["task_mode"]==1
assert payload["task_settings"]["auto_leveling"]==1 and "url" not in payload
assert "ams_settings" not in payload, "existing printer-side .acm mapping must remain authoritative"
b=Fake({"code":200,"state":"done"});status,data=run_local(b,{"filename":"../bad.gcode"})
assert status==400 and not b._pending_active()
b=Fake({"code":200,"state":"done"});status,data=run_local(b,{"filename":"local.gcode","auto_leveling":1})
assert status==200 and b.last_publish[2]["task_settings"]["auto_leveling"]==1

# Double-submit is rejected before it can upload or publish.
b=Fake();b._set_print_pending("first.gcode");status,data=run(b)
assert status==409 and b.ensure_calls==0 and b._pending_active()=="first.gcode"

# Terminal info/report often still carries the just-finished project. It must
# not repopulate filename/progress/time/layers after cleanup.
b=Fake();b._state.update(filename="old.gcode",progress=.9,print_duration=600,remain_time=10,curr_layer=9,total_layers=10)
b._on_info({"state":"done","data":{"project":{"state":"finished","filename":"old.gcode","progress":100,
  "print_time":10,"remain_time":0,"curr_layer":10,"total_layers":10}}})
assert b._state["filename"]=="" and b._state["progress"]==0 and b._state["print_duration"]==0
assert b._state["curr_layer"]==0 and b._state["total_layers"]==0

# Both public state endpoints must use the bounded helper, never raw state.
for name in ("handle_api_state","_farm_printer_entry"):
    body=ast.get_source_segment(text,fns[name]);assert "_pending_active()" in body,name
print("print pending lifecycle: all checks passed")
