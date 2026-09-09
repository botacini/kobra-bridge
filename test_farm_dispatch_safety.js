// Farm print dispatch safety. Runs the real dispatch/assignment functions from
// app.js against a stub DOM. Guards the cases where a wrong or partial job
// could reach a printer:
//   1. No G-code channel metadata -> dispatch is blocked, never auto-mapped.
//   2. A selected printer that vanished from _printers is reported, not thrown.
//   3. A rejected results handler still balances the transfer counter.
//   4. Reopening the dialog clears stale per-printer slot data.
const fs=require('fs');
const vm=require('vm');
const path=require('path');

const src=fs.readFileSync(path.join(__dirname,'web/themes/default/app.js'),'utf8');
const start=src.indexOf('var _farmPrintSlots={};');
const end=src.indexOf('\nfunction openStorePrintDialog(',start);
if(start<0||end<start)throw new Error('farm print block not found in app.js');
const block=src.slice(start,end);

const assert=(c,m)=>{if(!c)throw new Error(m)};

function makeSandbox(opts){
  const calls=[],logs=[];
  let transfers=0;
  const checked=opts.checked||[];
  const cards=opts.cards||{};
  // Minimal element factory: enough surface for querySelector/querySelectorAll.
  function el(html){return {innerHTML:html,textContent:'',classList:{add(){},remove(){}},onclick:null};}
  const fpList=el(''),fpTitle=el(''),fpConfirm=el(''),dlg=el('');
  dlg.classList={add(){},remove(){}};
  const sandbox={
    _printers:opts.printers,
    _gcodeFilaments:opts.gcodeFilaments||[],
    _farmStateCache:opts.stateCache||{},
    _farmStatus:(s)=>{const st=String((s&&s.print_state)||'').toLowerCase();if(!st)return 'offline';if(st==='printing'||st==='paused')return 'printing';if(st==='error')return 'error';return 'idle';},
    _materialsCompatible:(a,b)=>String(a||'').toUpperCase()===String(b||'').toUpperCase(),
    _swatchEmoji:()=>'●',
    _escAttr:(s)=>String(s||''),
    _kxEsc:(s)=>String(s||''),
    clog:(m,c)=>logs.push({m,c}),
    kxTransferStart:()=>{transfers++;},
    kxTransferEnd:()=>{transfers--;},
    // Throws only for the synchronous results-handler call, not for the
    // 300ms kick timer, whose rejection is irrelevant to these assertions.
    refreshFarmState:()=>{if(opts.refreshThrows&&sandbox._inResults)throw new Error('refresh boom');},
    CSS:{escape:(s)=>s},
    fetch:(url,o)=>{calls.push({url,body:o&&o.body?JSON.parse(o.body):null});
      if(url.endsWith('/kx/filament/slots')){
        const port=url.match(/:(\d+)\//);const p=port?port[1]:'';
        if(opts.slotFail&&opts.slotFail[p])return Promise.resolve({ok:false,status:502,json:()=>Promise.resolve({})});
        return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({result:(opts.slots&&opts.slots[p])||[]})});
      }
      if(url.endsWith('/compatibility')){
        const port=url.match(/:(\d+)\//);const p=port?port[1]:'';
        return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({result:(opts.compat&&opts.compat[p])||{decision:'native'}})});
      }
      return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({result:'ok'})});},
    document:{
      getElementById:(id)=>({'fp-list':fpList,'fp-title':fpTitle,'fp-confirm':fpConfirm,'farm-print-dialog':dlg})[id]||null,
      querySelectorAll:(sel)=>{if(sel==='.fp-target:checked')return checked.map(v=>({value:v}));return [];},
      querySelector:(sel)=>{const m=sel.match(/data-printer="([^"]+)"/);if(!m)return null;return cards[m[1]]||null;},
      createElement:()=>el(''),
      body:{appendChild(){}},
    },
    parseInt,String,Number,Object,Array,Promise,Error,JSON,Math,Date,setTimeout,clearTimeout,
    localStorage:{getItem:()=>null},
  };
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(block,sandbox);
  return {sandbox,calls,logs,transfers:()=>transfers,fpList};
}

const P=[
  {id:'1',name:'Kobra X',bridge_url:'http://nas:7125'},
  {id:'2',name:'Kobra X 2',bridge_url:'http://nas:7126'},
];
// A card whose single mapping select points at slot 0.
function card(selVal){return {querySelectorAll:(s)=>s==='.fp-map'?[{dataset:{channel:'0'},value:selVal}]:[]};}

(async function(){
  // 1. No channel metadata: dispatch must not send anything.
  let t=makeSandbox({printers:P,gcodeFilaments:[],checked:['1'],cards:{'1':card('0')}});
  t.sandbox._farmPrintSlots={'1':[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]};
  t.sandbox.dispatchFarmPrint('file-1');
  assert(t.calls.filter(c=>c.url.endsWith('/kx/print')).length===0,'empty channels must never POST /kx/print');
  assert(t.logs.some(l=>l.c==='msg-err'),'empty channels must log an error');
  // The printer card itself must render its checkbox disabled.
  const html=t.sandbox._renderFarmPrintPrinter(P[0]);
  assert(/class="fp-target"[^>]*disabled/.test(html),'checkbox must be disabled when no channels exist');

  // 2. Selected printer vanished: report, do not throw, do not send to others.
  t=makeSandbox({printers:[P[0]],gcodeFilaments:[{material:'PLA',color_hex:'#fff',is_used:true}],checked:['1','2'],cards:{'1':card('0')}});
  t.sandbox._farmPrintSlots={'1':[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]};
  let threw=false;
  try{t.sandbox.dispatchFarmPrint('file-2');}catch(e){threw=true;}
  assert(!threw,'vanished printer must not throw');
  assert(t.calls.filter(c=>c.url.endsWith('/kx/print')).length===0,'invalid selection must abort whole dispatch');
  assert(t.logs.some(l=>/no longer configured/.test(l.m)),'vanished printer must be named in the error');

  // 3. Happy path sends once with the manual mapping, and balances transfers
  //    even when the results handler throws.
  t=makeSandbox({printers:[P[0]],gcodeFilaments:[{material:'PLA',color_hex:'#fff',is_used:true}],checked:['1'],cards:{'1':card('0')},refreshThrows:true});
  t.sandbox._farmPrintSlots={'1':[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]};
  t.sandbox._farmPrintCompatibility={'1':{decision:'native'}};
  t.sandbox._inResults=true;
  t.sandbox.dispatchFarmPrint('file-3');
  await new Promise(r=>setTimeout(r,0));
  await new Promise(r=>setTimeout(r,0));
  const prints=t.calls.filter(c=>c.url.endsWith('/kx/print'));
  assert(prints.length===1,'exactly one print POST');
  assert(prints[0].url==='http://nas:7125/kx/print','print goes to the selected printer port');
  assert(prints[0].body.filament_assignments.length===1&&prints[0].body.filament_assignments[0].slot_index===0,'manual mapping carried in payload');
  assert(t.transfers()===0,'transfer counter must return to 0 even if results handler throws');
  t.sandbox._inResults=false;  // the 300ms refresh kick must not re-throw after assertions

  // 4. Reopen clears stale slots; failed fetch shows unavailable, not old data.
  t=makeSandbox({printers:P,gcodeFilaments:[{material:'PLA',color_hex:'#fff',is_used:true}],
    slots:{'7125':[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]},slotFail:{'7126':true}});
  t.sandbox._farmPrintSlots={'2':[{slot_index:3,material:'PETG',color_hex:'#000',status:'loaded'}]}; // stale from a previous file
  t.sandbox.openFarmPrintDialog('file-4','a.gcode');
  assert(Object.keys(t.sandbox._farmPrintSlots).length===0,'opening must clear stale slot cache synchronously');
  await new Promise(r=>setTimeout(r,0));
  await new Promise(r=>setTimeout(r,0));
  assert(t.sandbox._farmPrintSlots['2'].length===0,'failed slot fetch must not resurrect stale slots');
  assert(/Slots unavailable/.test(t.fpList.innerHTML),'failed slot fetch must be shown as unavailable');

  // 5. Cross-model verdicts: no verdict or a blocked verdict never POSTs;
  //    a convertible verdict dispatches and is labelled as adjusted.
  t=makeSandbox({printers:[P[0]],gcodeFilaments:[{material:'PLA',color_hex:'#fff',is_used:true}],checked:['1'],cards:{'1':card('0')}});
  t.sandbox._farmPrintSlots={'1':[{slot_index:0,material:'PLA',color_hex:'#fff',status:'loaded'}]};
  t.sandbox.dispatchFarmPrint('file-5');
  assert(t.calls.filter(c=>c.url.endsWith('/kx/print')).length===0,'missing compatibility verdict must block dispatch');
  t.sandbox._farmPrintCompatibility={'1':{decision:'blocked',reasons:['toolpath exceeds target build volume']}};
  t.sandbox.dispatchFarmPrint('file-5');
  assert(t.calls.filter(c=>c.url.endsWith('/kx/print')).length===0,'blocked verdict must never POST /kx/print');
  assert(t.logs.some(l=>/exceeds target build volume/.test(l.m)),'blocked reason must be surfaced');
  assert(/fp-target"[^>]*disabled/.test(t.sandbox._renderFarmPrintPrinter(P[0])),'blocked printer checkbox disabled');
  t.sandbox._farmPrintCompatibility={'1':{decision:'convertible',target_model_name:'Anycubic Kobra S1 Max'}};
  assert(/adjusted for Anycubic Kobra S1 Max/.test(t.sandbox._renderFarmPrintPrinter(P[0])),'convertible printer shows adjustment note');
  t.sandbox.dispatchFarmPrint('file-5');
  await new Promise(r=>setTimeout(r,0));
  assert(t.calls.filter(c=>c.url.endsWith('/kx/print')).length===1,'convertible verdict dispatches once');

  console.log('kx farm dispatch safety: 5/5 checks passed');
})().catch(e=>{console.error(e.message);process.exit(1);});
