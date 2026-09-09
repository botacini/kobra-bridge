#!/usr/bin/env python3
"""MQTT fixed-header fragmentation must not discard a partial packet.

TCP may split after the first continuation byte of Remaining Length. The old
parser treated [PUBLISH, 0x80] as a complete zero-length packet, consumed it,
and the next recv began mid-header; state/ACK messages then vanished.
"""
import importlib.util, json, pathlib, sys, types
DIR=pathlib.Path(__file__).parent
sys.modules.setdefault('env_loader',types.SimpleNamespace())
spec=importlib.util.spec_from_file_location('kxclient',DIR/'kobrax_client.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

c=m.KobraXClient.__new__(m.KobraXClient)
c._buf=b'';c._pending_report={};c._pending_msgid={};c._last_rx_hash={};seen=[]
c.callbacks={'info/report':lambda payload:seen.append(payload)}
topic='any/a/info/report'
# Find a payload whose Remaining Length is exactly 256, encoded [0x80,0x02].
for n in range(100,400):
 payload={'state':'done','data':{'pad':'x'*n}}
 frame=m._build_publish(topic,json.dumps(payload))
 if frame[1:3]==b'\x80\x02': break
else: raise AssertionError('could not build exact-256-byte Remaining Length fixture')
assert frame[1:3]==b'\x80\x02'

# The critical split: only PUBLISH byte + first (continuation) length byte.
c._buf=frame[:2];c._drain()
assert c._buf==frame[:2] and seen==[],f'partial fixed header was consumed: buf={c._buf!r} seen={seen}'
c._buf+=frame[2:];c._drain()
assert c._buf==b'' and seen==[payload],(len(c._buf),seen)

# Every split across the frame must deliver exactly one message, never corrupt.
for split in range(1,len(frame)):
 c._buf=frame[:split];seen.clear();c._drain();c._buf+=frame[split:];c._drain()
 assert seen==[payload] and c._buf==b'',f'split {split}: seen={len(seen)} remaining={len(c._buf)}'
print('mqtt framing: all checks passed')
