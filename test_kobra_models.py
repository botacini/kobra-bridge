#!/usr/bin/env python3
"""Supported Kobra model registry and fail-closed discovery."""
import importlib.util, pathlib, sys
SRC=pathlib.Path(__file__).parent/'kobra_models.py'
spec=importlib.util.spec_from_file_location('kobra_models',SRC)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
expected={
 '20028':('Anycubic Kobra 4',(260,260,260),300,100,0,8),
 '20030':('Anycubic Kobra X',(260,260,260),300,100,0,19),
 '20025':('Anycubic Kobra S1',(250,250,250),320,120,0,8),
 '20029':('Anycubic Kobra S1 Max',(350,350,350),350,120,65,16),
}
for mid,(name,volume,nozzle,bed,chamber,colors) in expected.items():
 x=m.model_for_id(mid);assert x and x.name==name and x.build_volume_mm==volume
 assert (x.max_nozzle_c,x.max_bed_c,x.max_chamber_c,x.max_colors)==(nozzle,bed,chamber,colors)
 assert m.model_for_name(name.lower())==x
 assert m.discover_model({'modelId':mid,'modelName':name},{})==x
 assert m.discover_model({}, {'mode_id':mid,'model':name})==x
assert m.model_for_name('kobra s1 max')==m.model_for_id('20029')
assert m.model_for_name('S1')==m.model_for_id('20025')
assert m.model_for_name('Kobra X')==m.model_for_id('20030')
assert m.model_for_name('Kobra 4')==m.model_for_id('20028')
assert m.discover_model({'modelId':'99999','modelName':'Unknown Printer'},{}) is None
assert m.model_for_id('') is None and m.model_for_name('') is None
# Cross-model dispatch always requires an exact configured nozzle match.
for x in m.MODELS.values():
 assert 0.4 in x.nozzle_diameters_mm
 assert x.supports_nozzle(0.4) and not x.supports_nozzle(1.0)
print('kobra models: 4/4 passed')
