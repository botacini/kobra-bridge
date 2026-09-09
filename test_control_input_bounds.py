#!/usr/bin/env python3
"""Printer control endpoints must clamp/reject out-of-range or malformed input.

The web UI only constrains temperatures via HTML min/max; the bridge is the
trust boundary for every LAN client, so it must refuse 900 C or NaN itself.
"""
import ast, asyncio, json, pathlib, types
SRC=pathlib.Path(__file__).parent/'kobrax_moonraker_bridge.py'
text=SRC.read_text();tree=ast.parse(text)
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='KobraXBridge')
fns={n.name:n for n in cls.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
names=('_bounded','handle_api_temperature','handle_api_fan','handle_api_axis','handle_api_speed','_exec_gcode_script','handle_printer_gcode_script')
missing=[n for n in names if n not in fns];assert not missing,missing
class Resp:
    def __init__(s,data,status=200):s.data=data;s.status=status
web=types.SimpleNamespace(json_response=lambda data,status=200:Resp(data,status))
ns={'asyncio':asyncio,'web':web,'log':types.SimpleNamespace(**{k:(lambda *a,**k:None) for k in('info','warning','error','debug')})}
for n in names: exec(ast.unparse(fns[n]),ns)
class Client:
    def __init__(s):s.sent=[]
    def publish(s,*a,**k):s.sent.append(('publish',)+a);return {'code':200}
    def publish_web(s,*a,**k):s.sent.append(('web',)+a);return {'code':200}
class Fake:
    CONTROL_LIMITS={"nozzle":(0,300),"bed":(0,120),"fan":(0,100),"axis_distance":(-300,300)}
    _bounded=ns['_bounded']
    handle_api_temperature=ns['handle_api_temperature'];handle_api_fan=ns['handle_api_fan']
    handle_api_axis=ns['handle_api_axis'];handle_api_speed=ns['handle_api_speed'];_exec_gcode_script=ns['_exec_gcode_script'];handle_printer_gcode_script=ns['handle_printer_gcode_script']
    def __init__(s,print_state='standby',model=None):
        s.client=Client();s._state={'print_state':print_state,'taskid':'7','light_brightness':50};s._model=model
class Req:
    def __init__(s,body):s.body=body
    async def json(s):
        if isinstance(s.body,Exception):raise s.body
        return s.body
def call(b,handler,body):return asyncio.run(handler(b,Req(body)))
def rejected(r):return r.status==400 and 'error' in r.data

for state in ('standby','printing'):
    for body in ({'nozzle':900},{'bed':250},{'nozzle':-5},{'nozzle':'abc'},{'nozzle':float('nan')}):
        b=Fake(state);r=call(b,Fake.handle_api_temperature,body)
        assert rejected(r) and b.client.sent==[],(state,body,r.status,r.data,b.client.sent)
    b=Fake(state);r=call(b,Fake.handle_api_temperature,{'nozzle':215,'bed':60})
    assert r.status==200 and b.client.sent,(state,r.data)
for body in ({'speed':150},{'speed':-1},{'speed':'x'}):
    b=Fake();r=call(b,Fake.handle_api_fan,body);assert rejected(r) and b.client.sent==[],body
b=Fake();assert call(b,Fake.handle_api_fan,{'speed':100}).status==200 and b.client.sent
for body in ({'axis':1,'move_type':1,'distance':5000},{'axis':9,'move_type':1,'distance':1},{'axis':1,'move_type':1,'distance':'x'}):
    b=Fake();r=call(b,Fake.handle_api_axis,body);assert rejected(r) and b.client.sent==[],body
b=Fake();assert call(b,Fake.handle_api_axis,{'axis':1,'move_type':1,'distance':-10}).status==200 and b.client.sent
b=Fake();assert call(b,Fake.handle_api_axis,{'action':'turnoff'}).status==200 and b.client.sent
for body in ({'mode':9},{'mode':'x'}):
    b=Fake();r=call(b,Fake.handle_api_speed,body);assert rejected(r) and b.client.sent==[],body
b=Fake();assert call(b,Fake.handle_api_speed,{'mode':3}).status==200 and b.client.sent

# Moonraker HTTP/WS gcode.script must use the same trust-boundary limits.
for script in ('M104 S900','M140 S250','SET_HEATER_TEMPERATURE HEATER=extruder TARGET=900','SET_HEATER_TEMPERATURE HEATER=heater_bed TARGET=250'):
    b=Fake()
    try: asyncio.run(b._exec_gcode_script(script))
    except ValueError: pass
    else: raise AssertionError(f'unsafe script accepted: {script}')
    assert b.client.sent==[],(script,b.client.sent)
b=Fake();assert asyncio.run(b._exec_gcode_script('M104 S300'))=='ok' and b.client.sent
# S1 Max advertises 350 C, so its real model capability replaces the Kobra X fallback.
b=Fake(model=types.SimpleNamespace(max_nozzle_c=350,max_bed_c=120))
assert asyncio.run(b._exec_gcode_script('M104 S350'))=='ok' and b.client.sent
class ScriptReq:
    method='POST';rel_url=types.SimpleNamespace(query={})
    async def json(self):return {'script':'M104 S900'}
b=Fake();r=asyncio.run(b.handle_printer_gcode_script(ScriptReq()))
assert r.status==400 and r.data.get('error') and b.client.sent==[],(r.status,r.data,b.client.sent)
print('control input bounds: all checks passed')
