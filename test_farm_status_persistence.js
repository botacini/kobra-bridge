// Farm status must survive a tab close/reopen. The queue (_farmQueue) lives in
// the closed page's memory, so a fresh page must derive "Sending/Starting" from
// the bridge's own upload_progress and pending-start state, not from the DOM
// that started the dispatch.
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'web/themes/default/app.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
function slice(a,b){const i=src.indexOf(a);const j=src.indexOf(b,i);assert(i>=0&&j>i,'slice not found: '+a);return src.slice(i,j);}
const block=slice('// ── Flow farm view','\nfunction loadPrinterTab(){')
  +'\n'+slice('var _farmPrintSlots={};','\nfunction _farmPrintAssignments(')
  +'\n'+slice('function _normalizeMaterialKey(','\nfunction _slotProfileLabel(')
  +'\n'+slice('var _farmQueue={};','\nfunction openStorePrintDialog(');
const sb={storeFiles:[],_farmLastStates:{printers:[]},_farmStateCache:{},_farmSelected:{},_activePrinter:null,
  _kxEsc:s=>String(s==null?'':s),_apiUrl:p=>p,formatDur:s=>s+'s',_farmFmtTime:s=>s+'s',FARM_SERVICE_HOURS:500,
  _farmSeverity:()=>0,_farmNotifyFinished(){},_farmNotify(){},_farmAlerts:()=>[],_farmUpdateBulkBar(){},
  document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
  parseInt,String,Number,Object,Array,JSON,Math,Date,console,setTimeout:(fn,ms)=>{if(ms<100)setImmediate(fn);return 0;},localStorage:{getItem:()=>null}};
sb.window=sb;vm.createContext(sb);vm.runInContext(block,sb);

// Fresh page: _farmQueue is empty (it died with the old tab). Bridge state says
// the file is still being pushed to this printer.
const sending={id:'4',name:'Kobra X 4',kobra_state:'free',slots:[],
  upload_progress:{active:true,filename:'a.gcode',sent:50,total:100,percent:50,phase:'sending'}};
assert(sb._flowState(sending)!=='ready','a printer receiving a file is not Ready (got '+sb._flowState(sending)+')');
assert(sb._farmBadge(sending)==='Sending','badge must say Sending, got '+sb._farmBadge(sending));
assert(/Uploading a\.gcode · 50%/.test(sb._farmDetail(sending)),'detail: '+sb._farmDetail(sending));

// Upload finished, print/start sent, printer has not yet reported a busy state.
const starting={id:'5',name:'Kobra X 5',kobra_state:'free',slots:[],
  upload_progress:{active:false,filename:'a.gcode',phase:'done'},print_pending:'a.gcode'};
assert(sb._flowState(starting)!=='ready','a printer with a pending print/start is not Ready (got '+sb._flowState(starting)+')');
assert(sb._farmBadge(starting)==='Starting','badge must say Starting, got '+sb._farmBadge(starting));
assert(/File sent · waiting for printer/.test(sb._farmDetail(starting)),'detail: '+sb._farmDetail(starting));

// Once the printer reports a busy phase, the printer's own state wins.
const leveling={id:'5',name:'Kobra X 5',kobra_state:'auto_leveling',slots:[],print_pending:'a.gcode'};
assert(sb._farmBadge(leveling)==='Bed leveling','printer phase wins over pending flag');

// Truly idle stays Ready (done upload, nothing pending).
const idle={id:'6',name:'Kobra X 6',kobra_state:'free',slots:[],upload_progress:{active:false,phase:'done'}};
assert(sb._flowState(idle)==='ready'&&sb._farmBadge(idle)==='Ready','idle printer stays Ready');

// A pending printer must not be auto-targeted for another dispatch.
const f={id:'f1',filename:'x.gcode',gcode_filaments:[{material:'PLA',color_hex:'#fff',is_used:true}]};
sb.storeFiles=[f];
sb._farmLastStates={printers:[Object.assign({},starting,{slots:[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]}),
  Object.assign({},idle,{slots:[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]})]};
sb.maybeGateWebUpload=(x,cb)=>cb();
sb.fetch=()=>Promise.resolve({ok:true,json:()=>Promise.resolve({result:{decision:'native'}})});
sb.encodeURIComponent=encodeURIComponent;
sb.flowPick('f1');
assert(!sb._flowTargets['5'],'pending printer must not be auto-targeted: '+JSON.stringify(sb._flowTargets));
// Compatibility is fetched asynchronously; only the idle printer becomes eligible.
setTimeout(()=>{assert(sb._flowTargets['6']===true&&!sb._flowTargets['5'],'pending printer must stay excluded after compat load: '+JSON.stringify(sb._flowTargets));
console.log('farm status persistence (client): all checks passed');},20);
