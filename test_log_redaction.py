#!/usr/bin/env python3
"""Printer credentials and signed URLs must never enter the log ring.

info/report contains fileUploadurl?s=<session-token>. The root logger feeds the
browser-visible /api/log/download ring, so redaction belongs before log.info.
"""
import importlib.util, json, logging, pathlib, sys, types
DIR=pathlib.Path(__file__).parent
sys.modules.setdefault('env_loader',types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('kxclient',DIR/'kobrax_client.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

raw={
 'ip':'192.168.1.24',
 'urls':{'fileUploadurl':'http://192.168.1.24:18910/gcode_upload?s=SECRET_SESSION',
         'rtspUrl':'http://192.168.1.24:18088/live/SECRET_STREAM'},
 'password':'SECRET_PASSWORD','token':'SECRET_TOKEN',
 'username':'SECRET_USERNAME','deviceId':'SECRET_DEVICE_ID',
 'nested':[{'api_key':'SECRET_KEY','safe':'ok'}],
}
out=m._redact_log_data(raw)
encoded=json.dumps(out)
for secret in ('SECRET_SESSION','SECRET_STREAM','SECRET_PASSWORD','SECRET_TOKEN','SECRET_KEY',
               'SECRET_USERNAME','SECRET_DEVICE_ID'):
 assert secret not in encoded,secret
assert out['ip']=='192.168.1.24' and out['nested'][0]['safe']=='ok'
assert raw['urls']['fileUploadurl'].endswith('SECRET_SESSION'),'redaction must not mutate runtime payload'

# Prove the actual _dispatch logging path uses the redacted copy.
class Capture(logging.Handler):
 def __init__(self):super().__init__();self.lines=[]
 def emit(self,r):self.lines.append(r.getMessage())
h=Capture();m.log.addHandler(h);m.log.setLevel(logging.INFO)
c=m.KobraXClient.__new__(m.KobraXClient);c._last_rx_hash={};c._pending_report={};c._pending_msgid={};c.callbacks={}
c._dispatch('any/x/info/report',{'state':'done','data':raw})
joined='\n'.join(h.lines);m.log.removeHandler(h)
assert 'SECRET_' not in joined,joined
assert '192.168.1.24' in joined,'safe diagnostics should remain'
assert '0123456789abcdef' not in m._redact_topic(
 'anycubic/anycubicCloud/v1/printer/public/20028/0123456789abcdef/#')
h.lines.clear();m.log.addHandler(h)
c._dispatch('any/x/0123456789abcdef/response', {'code':0, 'data':None})
joined='\n'.join(h.lines);m.log.removeHandler(h)
assert '0123456789abcdef' not in joined,joined
print('log redaction: all checks passed')
