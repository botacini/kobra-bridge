#!/usr/bin/env python3
"""S1 reports status=5 on empty ACE slots; empty type is never printable."""
import ast,pathlib,types
SRC=pathlib.Path(__file__).parent/'kobrax_moonraker_bridge.py'
tree=ast.parse(SRC.read_text());cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='KobraXBridge')
fns={n.name:n for n in cls.body if isinstance(n,ast.FunctionDef)}
ns={}
for name in ('_slot_usable_for_print','_loaded_slots_for_print'):
 exec(ast.unparse(fns[name]),ns)
class B:
 _slot_usable_for_print=ns['_slot_usable_for_print'];_loaded_slots_for_print=ns['_loaded_slots_for_print']
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
print('s1 slots: all checks passed')
