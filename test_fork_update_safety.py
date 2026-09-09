#!/usr/bin/env python3
"""Fork safety: the in-app self-update must never pull upstream KX-Bridge files
over Kobra Bridge modules (would drop kobra_models/kobra_gcode_compat imports
and crash on restart). Check may report upstream; apply must refuse."""
import ast,asyncio,pathlib,types
SRC=pathlib.Path(__file__).parent/'kobrax_moonraker_bridge.py'
tree=ast.parse(SRC.read_text());cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='KobraXBridge')
fns={n.name:n for n in cls.body if isinstance(n,ast.AsyncFunctionDef)}
fn=fns['handle_api_update_apply']
check_fn=fns['handle_api_update_check']
class Resp:
    def __init__(self,data,status=200):self.data=data;self.status=status
ns={'web':types.SimpleNamespace(json_response=Resp),'sys':__import__('sys'),'pathlib':pathlib,'log':types.SimpleNamespace(info=print,warning=print),'asyncio':asyncio,'os':__import__('os')}
exec(ast.unparse(fn),ns)
exec(ast.unparse(check_fn),ns)
class Req:
    async def json(self):return {'tag':'v9.9.9'}
class B:
    handle_api_update_apply=ns['handle_api_update_apply'];handle_api_update_check=ns['handle_api_update_check']
    def _read_version(self):return '0.9.30'
    def _restart_bridge(self):raise AssertionError('must not restart')
b=B();r=asyncio.run(b.handle_api_update_apply(Req()))
assert r.status==400 and 'Kobra Bridge' in r.data.get('error',''),(r.status,r.data)
c=asyncio.run(b.handle_api_update_check(Req()))
assert c.status==200 and c.data.get('update_available') is False and c.data.get('repository')=='https://github.com/cluzl/kobra-bridge',c.data
assert 'aiohttp.ClientSession()' not in ast.unparse(fn),'apply must not download anything'
assert 'aiohttp.ClientSession()' not in ast.unparse(check_fn),'check must not advertise upstream KX releases as fork updates'
print('fork update safety: all checks passed')
