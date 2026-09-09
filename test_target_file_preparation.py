#!/usr/bin/env python3
"""Shared store prepares one immutable model-specific file per target."""
from __future__ import annotations
import ast,concurrent.futures,hashlib,json,os,pathlib,sqlite3,tempfile,threading,time,uuid,sys
BASE=pathlib.Path(__file__).parent;sys.path.insert(0,str(BASE))
from kobra_models import model_for_id
from kobra_gcode_compat import inspect_gcode,check_compatibility,derive_gcode,CONVERTER_VERSION
SRC=BASE/'kobrax_moonraker_bridge.py';tree=ast.parse(SRC.read_text())
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='GCodeStore')
ns=dict(sqlite3=sqlite3,threading=threading,tempfile=tempfile,os=os,json=json,time=time,uuid=uuid,hashlib=hashlib,
        inspect_gcode=inspect_gcode,check_compatibility=check_compatibility,derive_gcode=derive_gcode,CONVERTER_VERSION=CONVERTER_VERSION)
exec(compile(ast.fix_missing_locations(ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),cls],type_ignores=[])),str(SRC),'exec'),ns)
Store=ns['GCodeStore']
raw=b'''; HEADER_BLOCK_START\n; max_z_height: 20\n; HEADER_BLOCK_END\n; EXECUTABLE_BLOCK_START\n;TYPE:Custom\nG9111 bedTemp=60 extruderTemp=220\nM117\n; print_bed_min = 0,0\n; print_bed_max = 260,260\n; print_bed_size = 260,260\n; first_layer_print_min = 10,10\n; first_layer_print_max = 100,100\n; first_layer_print_size = 90,90\nG90\nG21\nM83\n; filament start gcode\n;LAYER_CHANGE\n;Z:0.2\n;HEIGHT:0.2\n; AFTER_LAYER_CHANGE 0 @ 0.2mm\nG1 X10 Y10 Z0.2 F3000\nG1 X100 Y100 E1\nG1 Z20\n;TYPE:Custom\n; filament end gcode\nM400\nM140 S0\nM104 S0\nM107\nM84\nM73 P100 R0\n; EXECUTABLE_BLOCK_END\n; CONFIG_BLOCK_START\n; printer_model = Anycubic Kobra X\n; printer_settings_id = Anycubic Kobra X 0.4 nozzle\n; printable_area = 0x0,260x0,260x260,0x260\n; printable_height = 260\n; nozzle_diameter = 0.4\n; machine_start_gcode = old\n; machine_end_gcode = old\n; before_layer_change_gcode = old\n; nozzle_temperature = 220\n; hot_plate_temp = 60\n; chamber_temperature = 0\n; CONFIG_BLOCK_END\n'''
with tempfile.TemporaryDirectory() as d:
 store=Store(d);fid=hashlib.md5(raw).hexdigest();store.save_file(fid,'part.gcode',raw);row=store.get_file(fid)
 native,nr=store.gcode_for_model(row,model_for_id('20030'),target_nozzle_mm=.4,available_ace_slots=1)
 assert nr.decision=='native' and native['path']==row['path'] and not native.get('converted')
 converted,cr=store.gcode_for_model(row,model_for_id('20029'),target_nozzle_mm=.4,available_ace_slots=1)
 again,_=store.gcode_for_model(row,model_for_id('20029'),target_nozzle_mm=.4,available_ace_slots=1)
 assert cr.decision=='convertible' and converted['converted'] is True
 assert converted['path']==again['path'] and pathlib.Path(converted['path']).is_file()
 assert pathlib.Path(row['path']).read_bytes()==raw
 assert converted['filename']=='part.gcode' and converted['size_bytes']==os.path.getsize(converted['path'])
 # Six printers dispatching the same file concurrently must share one derivation
 # and never observe a partially written derived file.
 calls=[0];orig=derive_gcode
 def counting(*a,**k):calls[0]+=1;time.sleep(0.05);return orig(*a,**k)
 store2=Store(d);ns['derive_gcode']=counting
 try:
  with concurrent.futures.ThreadPoolExecutor(6) as ex:
   outs=list(ex.map(lambda _:store2.gcode_for_model(row,model_for_id('20025'),target_nozzle_mm=.4,available_ace_slots=1),range(6)))
 finally:ns['derive_gcode']=orig
 assert calls[0]==1,calls
 sizes={os.path.getsize(o[0]['path']) for o in outs};assert len(sizes)==1 and outs[0][0]['size_bytes']==sizes.pop()
 # Compatibility requests from every printer share one streaming source scan.
 scans=[0];orig_inspect=inspect_gcode
 def counting_inspect(*a,**k):scans[0]+=1;time.sleep(0.05);return orig_inspect(*a,**k)
 store3=Store(d);ns['inspect_gcode']=counting_inspect
 try:
  with concurrent.futures.ThreadPoolExecutor(6) as ex:list(ex.map(lambda _:store3.gcode_facts(row),range(6)))
 finally:ns['inspect_gcode']=orig_inspect
 assert scans[0]==1,scans
print('target file preparation: all checks passed')
