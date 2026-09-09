// Regression check: filenames cannot break out of generated onclick attributes,
// printer-file thumbnail caches are evicted on delete, and UI/backend extensions agree.
const fs=require('fs');
const src=fs.readFileSync('web/themes/default/app.js','utf8');
const assert=(c,m)=>{if(!c)throw new Error(m);};

// Bridge-library cards: JS-string escape THEN HTML-attribute escape.
assert(src.includes("_kxEsc(f.filename.replace(/'/g,\"\\\\'\"))"),
  'bridge file filename is not escaped for the HTML attribute');

// Printer-storage cards use the same two-stage escaping.
assert(src.includes("var jsName=_kxEsc(f.filename.replace(/'/g,\"\\\\'\"));"),
  'printer file filename is not escaped for the HTML attribute');
assert(!src.includes("var jsName=f.filename.replace(/'/g"),
  'old quote-only printer filename escaping returned');

// Printer-local cards start the existing file directly; they must not upload it
// back through the bridge, and leveling is fail-safe off for this path.
assert(src.includes("onclick=\"event.stopPropagation();printerFilePrint("),
  'printer-local file card has no Print action');
const p0=src.indexOf('function printerFilePrint(');
const p1=src.indexOf('\nfunction _printerFilesDeleteRequest(',p0);
const localStart=src.slice(p0,p1);
assert(localStart.includes("'/kx/printer-files/start'"),
  'printer-local Print does not use the dedicated endpoint');
assert(localStart.includes('auto_leveling:0'),
  'printer-local Print must default auto-leveling off');
assert(src.includes("String(S.model_id)==='20029'?false"),
  'S1 Max print dialog must default auto-leveling off');

// Both single and bulk delete route through this helper, so one eviction covers both.
const d0=src.indexOf('function _printerFilesDeleteRequest(');
const d1=src.indexOf('\nfunction printerFileDelete(',d0);
const del=src.slice(d0,d1);
assert(del.includes('delete _printerThumbCache[fn]'),
  'printer thumbnail cache is not evicted after deletion');
assert(del.includes('if(r.ok)'),
  'thumbnail cache must only be evicted after a successful delete');

// UI file filter must agree with backend (.gcode/.bgcode only).
assert(src.includes("if(!/\\.(gcode|bgcode)$/.test(_fn))"),
  'UI still advertises an upload extension the backend rejects');
assert(!src.includes('gcode\\.3mf|3mf'),
  'unsupported 3mf upload filter returned');

// The bridge library is local SQLite; the printer list is an independent MQTT
// round trip that can take 8s. A healthy library must render before it finishes.
const l0=src.indexOf('function loadStore(){');
const l1=src.indexOf('\nfunction _renderBrowserPrinterLabel',l0);
const loadStore=src.slice(l0,l1);
const firstRender=loadStore.indexOf('renderStore();');
const join=loadStore.indexOf('Promise.all([filesReq,printerReq])');
assert(l0>=0&&l1>l0&&loadStore.includes('filesReq.then(function(d){'),
  'loadStore must render from /kx/files independently');
assert(firstRender>=0&&join>firstRender,
  'printer MQTT listing still gates the bridge library render');

// Every remaining innerHTML sink fed by server/printer data must escape.
assert(src.includes("'<span style=\"word-break:break-all\">'+_kxEsc(label)+'</span>'+\n      '</label>'"),
  'print-objects dialog label is not escaped');
assert(src.includes("'<span style=\"word-break:break-all\">'+_kxEsc(label)+'</span>'+note"),
  'skip-objects dialog label is not escaped');
assert(!/\+'<span>★ '\+label\+'<\/span>'/.test(src),
  'filament profile label is not escaped');
assert(src.includes("'<span>'+_kxEsc(p.name)+'</span></a>'"),
  'printer dropdown name is not escaped');

console.log('file browser safety: 14/14 checks passed');
