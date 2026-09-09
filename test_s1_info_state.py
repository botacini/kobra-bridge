#!/usr/bin/env python3
"""Kobra S1/S1 Max info/report capability parsing; no network or printer."""
import ast,pathlib,sys,time,types
DIR=pathlib.Path(__file__).parent;SRC=DIR/'kobrax_moonraker_bridge.py'
sys.path.insert(0,str(DIR))
from kobra_models import model_for_id, model_for_name
text=SRC.read_text();tree=ast.parse(text);cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='KobraXBridge')
fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='_on_info')
ns={'env_loader':types.SimpleNamespace(get=lambda *a,**k:''),'KOBRA_TO_KLIPPER_STATE':{'busy':'printing','printing':'printing','free':'standby','finished':'complete','stoped':'cancelled','canceled':'cancelled'},'CAMERA_ENABLED':True,'time':time,'log':types.SimpleNamespace(info=lambda *a:None,warning=lambda *a:None),'model_for_name':model_for_name,'model_for_id':model_for_id}
exec(ast.unparse(fn),ns)
class Cache:
 def set_url(s,u):s.url=u
class B:
 _on_info=ns['_on_info']
 def __init__(s):
  s._state={'printer_name':'old','firmware_version':'','filename':'','progress':0,'print_duration':0,'remain_time':0,'curr_layer':0,'total_layers':0,'nozzle_temp':0,'nozzle_target':0,'bed_temp':0,'bed_target':0,'chamber_temp':0,'chamber_target':0,'upload_url':'','camera_url':'','fan_speed':0,'aux_fan_speed':0,'box_fan_speed':0,'print_speed_mode':2,'print_state':'standby','kobra_state':'free'}
  s._args=types.SimpleNamespace(mode_id='20029',model_id='20029',camera_on_print=0);s._model=model_for_id('20029');s._name_locked=False;s._history_reconciled=True;s._camera_autostarted=False;s._camera_user_stopped=False;s.camera_cache=Cache();s.client=types.SimpleNamespace(start_camera=lambda:None)
 def _clear_print_pending(s):pass
 def _claim_history_job(s,*a,**k):return ''
 def _finish_history_jobs(s,*a,**k):return ''
 def _reset_terminal_state(s):pass
 def _push_status_update(s):pass
b=B();b._on_info({'state':'done','data':{'printerName':'Anycubic Kobra S1 Max','model':'Anycubic Kobra S1 Max','version':'2.7.1.4','state':'busy','project':{'state':'printing','filename':'part.gcode','progress':62,'print_time':12,'remain_time':7,'curr_layer':10,'total_layers':20},'temp':{'curr_nozzle_temp':255,'target_nozzle_temp':255,'curr_hotbed_temp':75,'target_hotbed_temp':75,'curr_chamber_temp':44,'target_chamber_temp':60},'fan_speed_pct':74,'aux_fan_speed_pct':100,'box_fan_level':80,'urls':{'fileUploadurl':'http://printer/upload','rtspUrl':'http://printer/flv'}}})
assert b._model.model_id=='20029' and b._state['model_id']=='20029' and b._state['model_name']=='Anycubic Kobra S1 Max'
assert (b._state['chamber_temp'],b._state['chamber_target'])==(44,60)
assert (b._state['fan_speed'],b._state['aux_fan_speed'],b._state['box_fan_speed'])==(74,100,80)
assert b._state['filename']=='part.gcode' and b._state['progress']==.62 and b._state['print_state']=='printing'
assert b.camera_cache.url=='http://printer/flv'
print('s1 info state: all checks passed')
