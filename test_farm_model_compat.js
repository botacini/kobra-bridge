// Fleet dispatch must show and enforce cross-model G-code compatibility per
// printer: convertible files stay selectable with a visible "adjusted" note,
// blocked files are never auto-targeted or startable.
const fs=require('fs'),vm=require('vm'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'web/themes/default/app.js'),'utf8');
const assert=(c,m)=>{if(!c)throw new Error(m)};
function slice(a,b){const i=src.indexOf(a);const j=src.indexOf(b,i);assert(i>=0&&j>i,'slice not found: '+a);return src.slice(i,j);}
const block=slice('// ── Flow farm view','\nfunction loadPrinterTab(){')
  +'\n'+slice('var _farmPrintSlots={};','\nfunction _farmPrintAssignments(')
  +'\n'+slice('function _normalizeMaterialKey(','\nfunction _slotProfileLabel(')
  +'\n'+slice('var _farmQueue={};','\nfunction openStorePrintDialog(');
const html={};
const sb={storeFiles:[],_farmLastStates:{printers:[]},_farmStateCache:{},_farmSelected:{},_activePrinter:null,
  _kxEsc:s=>String(s==null?'':s),_apiUrl:p=>p,formatDur:s=>s+'s',_farmFmtTime:s=>s+'s',FARM_SERVICE_HOURS:500,
  _farmSeverity:()=>0,_farmNotifyFinished(){},_farmNotify(){},_farmAlerts:()=>[],_farmUpdateBulkBar(){},_farmHeatBatch:()=>0,
  document:{getElementById:id=>({set innerHTML(v){html[id]=v;},scrollIntoView(){},classList:{contains:()=>false,add(){},remove(){}},getAttribute:()=>null,querySelectorAll:()=>[],style:{}}),querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},
  parseInt,String,Number,Object,Array,JSON,Math,Date,console,localStorage:{getItem:()=>null},setTimeout:()=>0};
sb.window=sb;vm.createContext(sb);vm.runInContext(block,sb);
assert(typeof sb._flowCompat==='function','app.js must expose _flowCompat(p,f)');
const slot=[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}];
const f={id:'f1',filename:'x.gcode',gcode_filaments:[{material:'PLA',color_hex:'#fff',is_used:true}]};
sb.storeFiles=[f];
sb._farmLastStates={printers:[
  {id:'1',name:'Kobra X 1',kobra_state:'free',slots:slot,model_id:'20030'},
  {id:'7',name:'S1 Max',kobra_state:'free',slots:slot,model_id:'20029'},
  {id:'8',name:'S1',kobra_state:'free',slots:slot,model_id:'20025'}]};
sb._flowCompatCache={f1:{'1':{decision:'native'},'7':{decision:'convertible',warnings:['motion speed will be clamped to 600 mm/s']},'8':{decision:'blocked',reasons:['toolpath exceeds target build volume (250, 250, 250)']}}};
assert(sb._flowCompat(sb._farmLastStates.printers[0],f).decision==='native');
sb.maybeGateWebUpload=(x,cb)=>cb();
sb._flowLoadCompat=()=>{};
sb.flowPick('f1');
assert(sb._flowTargets['1']===true&&sb._flowTargets['7']===true,'native and convertible printers auto-target: '+JSON.stringify(sb._flowTargets));
assert(!sb._flowTargets['8'],'blocked printer must not be auto-targeted');
sb.renderFlowJob();
const job=html['flow-job']||'';
assert(/adjusted for Anycubic Kobra S1 Max|G-code adjusted/i.test(job),'convertible target must say the G-code will be adjusted: '+job.slice(0,400));
assert(/exceeds target build volume/.test(job),'blocked reason must be visible');
assert(/value="8"[^>]*disabled/.test(job),'blocked printer checkbox must be disabled');
console.log('farm cross-model compatibility (client): all checks passed');
