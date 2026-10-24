#!/usr/bin/env python3
"""S1 reports status=5 on empty ACE slots; empty type is never printable."""
import ast,pathlib,types
SRC=pathlib.Path(__file__).parent/'kobrax_moonraker_bridge.py'
tree=ast.parse(SRC.read_text());cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='KobraXBridge')
fns={n.name:n for n in cls.body if isinstance(n,ast.FunctionDef)}
ns={}
for name in ('_aggregate_slots','_global_to_box_slot','_slot_to_print_ams_index',
             '_slot_usable_for_print','_loaded_slots_for_print','_slot_color_rgba',
             '_build_assigned_ams_box_mapping','_build_print_payload','_new_tip_form_events'):
 exec(ast.unparse(fns[name]),ns)
class B:
 _aggregate_slots=staticmethod(ns['_aggregate_slots']);_global_to_box_slot=ns['_global_to_box_slot']
 _slot_to_print_ams_index=ns['_slot_to_print_ams_index'];_slot_usable_for_print=ns['_slot_usable_for_print']
 _loaded_slots_for_print=ns['_loaded_slots_for_print'];_slot_color_rgba=staticmethod(ns['_slot_color_rgba'])
 _build_assigned_ams_box_mapping=ns['_build_assigned_ams_box_mapping'];_build_print_payload=ns['_build_print_payload']
 _new_tip_form_events=ns['_new_tip_form_events']
 _filament_mode='ace_direct'
b=B();b._ams_slots=[
 {'global_index':0,'box_id':0,'status':5,'type':'','color':[0,0,0]},
 {'global_index':1,'box_id':0,'status':5,'type':'PLA','color':[255,0,0]},
 {'global_index':2,'box_id':0,'status':4,'type':'PETG','color':[0,255,0]},
]
assert not b._slot_usable_for_print(0),'S1 empty status=5 slot was accepted'
assert b._slot_usable_for_print(1)
assert not b._slot_usable_for_print(2)
assert [i for i,_ in b._loaded_slots_for_print()]==[1]

# Kobra 4 reports one direct ACE box. Slicer paint/tool indices are independent
# from physical slots: T0 can map to slot 2 and T1 to slot 0.
ace_slots=[
 {'index':0,'status':5,'type':'PLA','color':[10,20,30]},
 {'index':1,'status':5,'type':'PETG','color':[40,50,60]},
 {'index':2,'status':5,'type':'PLA','color':[70,80,90]},
 {'index':3,'status':5,'type':'PLA','color':[100,110,120]},
]
b._ams_slots,_=b._aggregate_slots([{'id':0,'slots':ace_slots,'loaded_slot':-1}],'ace_direct')
mapping,unused,invalid=b._build_assigned_ams_box_mapping([
 {'paint_index':0,'slot_index':2,'paint_color':[1,2,3,255],'material':'PLA','is_used':True},
 {'paint_index':1,'slot_index':0,'paint_color':[4,5,6,255],'material':'PLA','is_used':True},
])
assert not unused and not invalid
assert [(x['paint_index'],x['ams_index']) for x in mapping]==[(0,2),(1,0)],mapping
b._args=types.SimpleNamespace(vibration_compensation=0)
payload=b._build_print_payload('native-k4.gcode','http://bridge/native-k4.gcode','',1234,mapping,0)
assert payload['ams_settings']['use_ams'] is True
assert payload['ams_settings']['ams_box_mapping']==mapping
assert payload['task_settings']['auto_leveling']==0

# feed_status is a level in periodic getInfo replies, not a one-shot event.
# Establish the startup baseline silently, then send type=3 only on transitions
# into terminal status 10/11.
b._last_feed_status={}
box=lambda st,typ=1:{'id':0,'feed_status':{'type':typ,'current_status':st,'slot_index':2}}
assert b._new_tip_form_events([box(10)])==[], 'stale startup status must not send type=3'
assert b._new_tip_form_events([box(10)])==[], 'unchanged status must not resend type=3'
assert b._new_tip_form_events([box(5)])==[]
assert b._new_tip_form_events([box(10)])==[(0,2,10)], 'a new transition must fire once'
assert b._new_tip_form_events([{'id':0,'slots':[]}])==[], 'partial slot update is not a feed transition'
assert b._new_tip_form_events([box(10)])==[], 'partial slot update must not reset feed status'
assert b._new_tip_form_events([box(10,3)])==[], 'completion of type=3 must not recursively send type=3'
assert b._new_tip_form_events([box(5,2)])==[]
assert b._new_tip_form_events([box(11,2)])==[(0,2,11)]
print('s1 slots: all checks passed')
