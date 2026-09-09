#!/usr/bin/env python3
"""Every Moonraker print-start route must delegate to the canonical safe path."""
import ast,asyncio,json,pathlib,types
SRC=pathlib.Path(__file__).parent/'kobrax_moonraker_bridge.py'
tree=ast.parse(SRC.read_text())
body_cls=next((n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='_JsonBodyRequest'),None)
bridge_cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='KobraXBridge')
fns={n.name:n for n in bridge_cls.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
assert body_cls is not None and all(n in fns for n in ('handle_print_start','_handle_ws_rpc')),'canonical route adapter missing'
class Resp:
 def __init__(self,data,status=200):self.status=status;self.body=json.dumps(data).encode();self.data=data
web=types.SimpleNamespace(json_response=lambda d,status=200:Resp(d,status),WebSocketResponse=object)
log=types.SimpleNamespace(info=lambda *a:None,error=lambda *a:None,debug=lambda *a:None)
ns={'json':json,'asyncio':asyncio,'web':web,'log':log,'time':types.SimpleNamespace(time=lambda:1),'os':__import__('os')}
exec(compile(ast.fix_missing_locations(ast.Module(body=[body_cls,fns['handle_print_start'],fns['_handle_ws_rpc']],type_ignores=[])),str(SRC),'exec'),ns)
class Store:
 def get_file_by_name(self,name):return {'id':'safe-id','filename':'part.gcode'} if name=='part.gcode' else None
class Fake:
 handle_print_start=ns['handle_print_start'];_handle_ws_rpc=ns['_handle_ws_rpc']
 def __init__(self):self._store=Store();self._last_uploaded_file='';self.calls=[]
 async def handle_kx_print(self,request):
  body=await request.json();self.calls.append(body)
  return Resp({'result':'ok','compatibility':'convertible','converted':True})
class Req:
 rel_url=types.SimpleNamespace(query={})
 async def json(self):return {'filename':'part.gcode','auto_leveling':0}
class WS:
 def __init__(self):self.sent=[]
 async def send_str(self,data):self.sent.append(json.loads(data))

b=Fake();r=asyncio.run(b.handle_print_start(Req()))
assert r.status==200 and b.calls==[{'filename':'part.gcode','auto_leveling':0,'file_id':'safe-id'}],b.calls
b=Fake();w=WS();asyncio.run(b._handle_ws_rpc(w,json.dumps({'jsonrpc':'2.0','id':9,'method':'printer.print.start','params':{'filename':'part.gcode'}})))
assert b.calls and b.calls[0]['file_id']=='safe-id',b.calls
assert w.sent[0].get('result',{}).get('compatibility')=='convertible',w.sent
print('print route compatibility: all checks passed')
