#!/usr/bin/env python3
"""An empty Anycubic /response ACK must not finish a business request."""
import importlib.util, pathlib, sys, threading, types
DIR=pathlib.Path(__file__).parent
sys.modules.setdefault('env_loader',types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('kxclient',DIR/'kobrax_client.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

c=m.KobraXClient.__new__(m.KobraXClient)
c._pending_report={};c._pending_msgid={};c._last_rx_hash={};c.callbacks={}
entry={'event':threading.Event(),'result':None}
msgid='18168166-0214-4ec9-8cab-2dfa97dd78e7'
c._pending_msgid[msgid]=entry
c._pending_report['print/report']=entry

# Real Kobra transport ACK observed by the user: correlation ID only, no
# business result. The old client woke publish() here and called code=0 a
# printer rejection before the following print/report arrived.
ack={'action':'','code':0,'data':None,'msg':'','msgid':msgid,'state':'','timestamp':0,'type':''}
c._dispatch('anycubic/anycubicCloud/v1/printer/public/20030/device/response',ack)
assert not entry['event'].is_set() and entry['result'] is None,entry

# A populated correlated error is a real result and must still wake immediately.
error_entry={'event':threading.Event(),'result':None};c._pending_msgid['err']=error_entry
error={'action':'start','code':10101,'data':None,'msg':'already printing','msgid':'err','state':'failed','timestamp':1,'type':'print'}
c._dispatch('anycubic/anycubicCloud/v1/printer/public/20030/device/response',error)
assert error_entry['event'].is_set() and error_entry['result']==error,error_entry

report={'action':'start','code':200,'data':{'filename':'safe.gcode'},'msg':'done','msgid':'different','state':'done','timestamp':1,'type':'print'}
c._dispatch('anycubic/anycubicCloud/v1/printer/public/20030/device/print/report',report)
assert entry['event'].is_set() and entry['result']==report,entry
print('mqtt empty ACK correlation: all checks passed')
