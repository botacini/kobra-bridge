// Flow farm view: filament-fit computation and the Start safety path. Runs the
// real functions from app.js against a stub DOM; nothing reaches a printer.
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'web/themes/default/app.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
function slice(a,b){const i=src.indexOf(a);const j=src.indexOf(b,i);assert(i>=0&&j>i,'slice not found: '+a);return src.slice(i,j);}
const block=slice('// ── Flow farm view','\nfunction loadPrinterTab(){')
  +'\n'+slice('var _farmPrintSlots={};','\nfunction _farmPrintAssignments(')
  +'\n'+slice('function _normalizeMaterialKey(','\nfunction _slotProfileLabel(')
  +'\n'+slice('function _farmPrintAssignments(printerId){','\nfunction _renderFarmPrintPrinter(')
  +'\n'+slice('function closeFarmPrintDialog(){','\nfunction openStorePrintDialog(');

let posted=[],confirmed=true,logs=[];
const els={};
function el(id){return els[id]||(els[id]={id,innerHTML:'',textContent:'',classList:{add(){},remove(){},contains(){return false}},querySelector(){return null},querySelectorAll(){return []},scrollIntoView(){}});}
const sb={
  storeFiles:[],_farmLastStates:{printers:[]},_farmSelected:{},_activePrinter:null,currentPanel:'printers',
  _gcodeFilaments:[],encodeURIComponent,
  FARM_SERVICE_HOURS:500,
  _kxEsc:s=>String(s==null?'':s),_apiUrl:p=>p,formatDur:s=>s+'s',_farmFmtTime:s=>s+'s',
  _farmSeverity:()=>0,_farmNotifyFinished(){},_farmNotify(){},_farmAlerts:()=>[],_farmUpdateBulkBar(){},
  maybeGateWebUpload:(f,cb)=>cb(),_setGcodeFilamentsFromFileObj(f){sb._gcodeFilaments=f.gcode_filaments||[];},
  clog:(m,c)=>logs.push({m,c}),kxTransferStart(){},kxTransferEnd(){},refreshFarmState(){},
  confirm:()=>confirmed,setTimeout:(fn)=>{},CSS:{escape:s=>s},
  fetch:(url,o)=>{if(url.endsWith('/compatibility'))return Promise.resolve({ok:true,json:()=>Promise.resolve({result:{decision:'native'}})});posted.push({url,body:o&&o.body?JSON.parse(o.body):null});return Promise.resolve({ok:true,json:()=>Promise.resolve({result:'ok'})});},
  _printers:[],
  document:{getElementById:el,querySelectorAll:(s)=>{ if(s==='.fp-target:checked')return sb.__checked||[]; return [];},querySelector:(s)=>{const m=s.match(/data-printer="([^"]+)"/);return m&&sb.__cards&&sb.__cards[m[1]]||null;},addEventListener(){},activeElement:{tagName:'BODY'}},
  parseInt,String,Number,Object,Array,Promise,Error,JSON,Math,Date,console,
  localStorage:{getItem:()=>null},
};
sb.window=sb;vm.createContext(sb);vm.runInContext(block,sb);

const P=(id,name,state,slots,extra)=>Object.assign({id,name,kobra_state:state,slots,progress:0,remain_time:0},extra||{});
const L=(i,mat,hex,loaded=true)=>({slot_index:i,material:mat,color_hex:hex,status:loaded?'loaded':'empty'});
const twoColour={id:'f1',filename:'logo.gcode',has_thumbnail:true,gcode_filaments:[{material:'PLA',color_hex:'#212721',is_used:true},{material:'PLA',color_hex:'#F2A900',is_used:true}]};
const petg={id:'f2',filename:'rail.gcode',gcode_filaments:[{material:'PETG',color_hex:'#75787B',is_used:true}]};
const noMeta={id:'f3',filename:'old.gcode',gcode_filaments:[]};

const ready=P('5','Kobra X 5','free',[L(0,'PLA','#EF60A3'),L(1,'PLA','#212721',false),L(2,'PLA','#FFFFFF'),L(3,'PLA','#003594')]);
const busy=P('3','Kobra X 3','printing',[L(0,'PLA','#FFFFFF'),L(1,'PLA','#212721'),L(2,'PLA','#F2A900'),L(3,'PLA','#009639')],{progress:.5,remain_time:3600});
const offline=P('1','Kobra X','offline',[],{connection_error:'no route'});

// 1. Fit: two PLA channels need two DISTINCT loaded PLA slots; empty slot must not count.
let ft=sb._flowFit(busy,twoColour);
assert(ft.ok&&ft.map.length===2&&ft.map[0]!==ft.map[1],'two channels map to two distinct slots: '+JSON.stringify(ft));
assert(ft.map[0]===1&&ft.map[1]===2,'nearest colour wins (black->slot2, yellow->slot3): '+JSON.stringify(ft.map));
ft=sb._flowFit(ready,twoColour);
assert(ft.ok&&!ft.map.includes(1),'empty slot never selected: '+JSON.stringify(ft.map));
// 2. Material mismatch: PETG file, PLA-only printer -> no fit.
assert(sb._flowFit(ready,petg).ok===false,'PETG on PLA-only printer must not fit');
// 3. No metadata -> not ok (blocks dispatch rather than auto-mapping).
assert(sb._flowFit(ready,noMeta).ok===false,'file without filament metadata must not fit');

const tick=()=>new Promise(r=>setImmediate(r));
async function pick(id){sb.flowPick(id);await tick();await tick();await tick();}
(async()=>{
// 4. flowPick auto-targets only READY printers whose filament fits.
sb.storeFiles=[twoColour,petg,noMeta];sb._farmLastStates={printers:[offline,busy,ready]};sb._printers=[{id:'1',name:'Kobra X',bridge_url:'http://nas:7125'},{id:'3',name:'Kobra X 3',bridge_url:'http://nas:7127'},{id:'5',name:'Kobra X 5',bridge_url:'http://nas:7129'}];
await pick('f1');
assert(sb._flowTargets['5']===true&&!sb._flowTargets['3']&&!sb._flowTargets['1'],'auto-target ready+fits only: '+JSON.stringify(sb._flowTargets));
await pick('f2');
assert(Object.keys(sb._flowTargets).length===0,'PETG picks nobody');

// 5. flowStart routes through dispatchFarmPrint with real assignments; cancel = no POST.
await pick('f1');
sb.__checked=[{value:'5'}];
sb.__cards={'5':{querySelectorAll:(s)=>s==='.fp-map'?[{dataset:{channel:'0'},value:'0'},{dataset:{channel:'1'},value:'2'}]:[]}};
confirmed=false;sb.flowStart();
assert(posted.length===0,'cancelled confirm must not POST');
confirmed=true;await pick('f1');sb.flowStart();
assert(posted.length===1&&posted[0].url.endsWith('/kx/print'),'confirmed start POSTs /kx/print once');
const a=posted[0].body.filament_assignments;
assert(a.length===2&&a[0].slot_index===0&&a[1].slot_index===2&&a.every(x=>x.is_used),'manual slot mapping carried into payload: '+JSON.stringify(a));

// 6. Rendering: thumbnails use the existing per-file endpoint; no-metadata file cannot be started.
sb._flowSel='f1';sb.renderFlowFiles();
assert(el('flow-files').innerHTML.includes('/kx/files/f1/thumbnail'),'file list uses /kx/files/{id}/thumbnail');
await pick('f3');sb.renderFlowJob();
assert(el('flow-job').innerHTML.includes('Start on 0')&&el('flow-job').innerHTML.includes('disabled'),'no-metadata file: Start disabled');
assert(el('flow-job').innerHTML.includes('no filament metadata'),'no-metadata reason shown');

console.log('kx flow farm ui: 6/6 checks passed');

// 7. Detailed status: pre-print phases are not "Ready", and the detail line names the phase + temps.
const heating=P('6','Kobra X 6','preheating',[],{bed_temp:31,bed_target:60,nozzle_temp:25,nozzle_target:0,filename:'a.gcode'});
assert(sb._flowState(heating)==='printing','preheating must count as busy, not ready');
assert(sb._farmBadge(heating)==='Preheating','badge shows the raw Kobra phase: '+sb._farmBadge(heating));
assert(sb._farmDetail(heating)==='Preheating · a.gcode · Bed 31/60° · Nozzle 25/0°','detail line: '+sb._farmDetail(heating));
assert(/^Printing 50% · Layer 0\/0 · 3600s left · Bed/.test(sb._farmDetail(busy)),'printing detail: '+sb._farmDetail(busy));
assert(sb._farmDetail(offline)==='Offline · no route','offline detail: '+sb._farmDetail(offline));
assert(sb._farmDetail(ready)==='Idle','idle detail: '+sb._farmDetail(ready));
sb._farmQueue={'5':{phase:'queued',on:['Kobra X 6']}};
assert(sb._farmDetail(ready)==='Queued · waiting for Kobra X 6 to heat up'&&sb._farmBadge(ready)==='Queued','queue state wins over idle');
sb._farmQueue={};
console.log('kx flow farm ui: detail status check passed');

})().catch(e=>{console.error(e.message);process.exit(1);});
