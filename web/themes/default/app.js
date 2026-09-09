// ── State ──
var S={nozzle_temp:0,nozzle_target:0,bed_temp:0,bed_target:0,
  print_state:'standby',filename:'',progress:0,print_duration:0,remain_time:0,
  curr_layer:0,total_layers:0,z_mm:0,printer_name:'Kobra X',firmware_version:'–',
  camera_url:'',fan_speed:0,print_speed_mode:2,light_on:false,light_brightness:80,
  ams_slots:[],filament_mode:'toolhead',ace_units:[],ace_dry_presets:null,ace_drying:{status:0,target_temp:0,duration:0,remain_time:0,humidity:null,current_temp:null,units:[]},web_upload_warning:1};
var tempHistory={n:[],b:[]};
var camOn=false;
var camUserStopped=false; // user stopped camera manually — suppress auto-restart for this print
var _camPollInterval=null; // snapshot-polling interval for Android (no MJPEG support)
var _lastLoadedFile=null;  // zuletzt geladene/gedruckte Datei für Progress-Karten-Aktionen (Issue #55)
var _idleCleared=false;    // User hat idle-Datei explizit „geleert" → kein Nachladen von s.filename (Issue #57)
var _fdDialogOpen=false;          // Dialog ist gerade offen
var _fdAutoOpenedFile=sessionStorage.getItem('fdAutoOpenedFile')||null;
var _fdUserCancelled=sessionStorage.getItem('fdUserCancelled')==='1';
var currentStep=1;
var currentPanel='dashboard';
var aceAutoRefillPrefs=(function(){
  try{return JSON.parse(localStorage.getItem('aceAutoRefillPrefs')||'{}')||{};}catch(_){return {};}
})();
var aceDryProfiles=(function(){
  try{return JSON.parse(localStorage.getItem('aceDryProfiles')||'{}')||{};}catch(_){return {};}
})();
var _aceDryDialogAceId=-1;
var _aceDryDialogPresetKey='';
var _aceDryDialogPresetOriginals={};
var ACE_DRY_PRESET_DEFAULTS={
  pla:{temp:45,duration_sec:4*3600},
  pla_plus:{temp:45,duration_sec:4*3600},
  petg:{temp:50,duration_sec:4*3600},
  tpu:{temp:55,duration_sec:4*3600},
  abs_asa:{temp:45,duration_sec:8*3600},
  pa_pc:{temp:55,duration_sec:12*3600}
};
var ACE_DRY_PRESETS={
  pla:{temp:45,duration_sec:4*3600},
  pla_plus:{temp:45,duration_sec:4*3600},
  petg:{temp:50,duration_sec:4*3600},
  tpu:{temp:55,duration_sec:4*3600},
  abs_asa:{temp:45,duration_sec:8*3600},
  pa_pc:{temp:55,duration_sec:12*3600},
  custom_1:{name:'Custom 1',temp:45,duration_sec:4*3600},
  custom_2:{name:'Custom 2',temp:45,duration_sec:4*3600},
  custom_3:{name:'Custom 3',temp:45,duration_sec:4*3600}
};

// Spoolman state
var _spoolmanStatus={configured:false,reachable:false,server:'',sync_rate:0,slot_spools:{}};
var _spoolmanSpools=[];
var _slotSpoolMap={};  // {String(global_index): spoolman_spool_id} — last committed assignment

function _loadSpoolmanStatus(){
  fetch(_apiUrl('/kx/spoolman/status')).then(function(r){return r.json();}).then(function(d){
    _spoolmanStatus=d;
    _slotSpoolMap=d.slot_spools||{};
    _updateSpoolmanStatusDot();
    _buildSpoolmanSection();
    renderSpoolmanSlotCard();
    if(d.configured){
      fetch(_apiUrl('/kx/spoolman/spools')).then(function(r){return r.json();}).then(function(sd){
        _spoolmanSpools=sd.spools||[];
      });
    }
  }).catch(function(){});
}
function _updateSpoolmanStatusDot(){
  var dot=document.getElementById('spoolman-status-dot');
  var lbl=document.getElementById('spoolman-status-lbl');
  if(!dot||!lbl)return;
  if(!_spoolmanStatus.configured){
    dot.style.color='var(--txt2)';lbl.textContent='not configured';
  } else if(_spoolmanStatus.reachable){
    dot.style.color='var(--ok)';lbl.textContent=_spoolmanStatus.server||'verbunden';
  } else {
    dot.style.color='var(--err)';lbl.textContent=(_spoolmanStatus.server||'')+' (unreachable)';
  }
}

function _buildSpoolmanSection(){
  var sec=document.getElementById('fd-spoolman-section');
  var rows=document.getElementById('fd-spoolman-rows');
  var loading=document.getElementById('fd-spoolman-loading');
  if(!sec||!rows)return;
  if(!_spoolmanStatus.configured){sec.style.display='none';return;}
  sec.style.display='';
  rows.innerHTML='';
  if(loading)loading.style.display='';

  var usedSlots={};
  (_amsSlots||[]).forEach(function(slot){
    usedSlots[slot.slot_index]=slot;
  });

  fetch(_apiUrl('/kx/spoolman/spools')).then(function(r){return r.json();}).then(function(d){
    if(loading)loading.style.display='none';
    _spoolmanSpools=d.spools||[];
    var slotKeys=Object.keys(usedSlots).map(Number).sort(function(a,b){return a-b;});
    if(!slotKeys.length){rows.innerHTML='<span style="font-size:11px;color:var(--txt2)">–</span>';return;}
    rows.innerHTML=slotKeys.map(function(idx){
      var slot=usedSlots[idx];
      var col=(slot.color_hex||'#888');
      var currentSpool=_slotSpoolMap[String(idx)]||'';
      var opts='<option value="">–</option>'+_spoolmanSpools.map(function(sp){
        var rem=sp.remaining_weight!=null?' ('+sp.remaining_weight.toFixed(0)+'g)':'';
        var vendor=sp.filament&&sp.filament.vendor?sp.filament.vendor.name+' ':'';
        var name=sp.filament&&sp.filament.name?sp.filament.name:'Spool';
        return '<option value="'+sp.id+'"'+(sp.id==currentSpool?' selected':'')+'>'+
               escHtml('#'+sp.id+' '+vendor+name+rem)+'</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:8px;font-size:12px">'+
        '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:'+col+';border:1px solid var(--border);flex-shrink:0"></span>'+
        '<span style="color:var(--txt2);min-width:46px">Slot '+(idx+1)+'</span>'+
        '<select data-spool-slot="'+idx+'" style="flex:1;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--txt);font-size:12px">'+
        opts+'</select></div>';
    }).join('');
  }).catch(function(){if(loading)loading.style.display='none';});
}

function _aceAutoRefillGet(aceId){return !!aceAutoRefillPrefs[String(aceId)];}
function _aceAutoRefillSet(aceId,on){
  aceAutoRefillPrefs[String(aceId)]=!!on;
  localStorage.setItem('aceAutoRefillPrefs',JSON.stringify(aceAutoRefillPrefs));
}
function _aceDryProfileGet(aceId){
  var p=aceDryProfiles[String(aceId)]||{};
  var temp=parseInt(p.temp,10);
  var dur=parseInt(p.duration_sec,10);
  if(!Number.isFinite(temp))temp=45;
  if(!Number.isFinite(dur))dur=4*3600;
  temp=Math.max(30,Math.min(80,temp));
  dur=Math.max(10*60,Math.min(24*3600,dur));
  return {temp:temp,duration_sec:dur,preset:p.preset||''};
}
function _aceDryProfileSet(aceId,temp,durationSec,preset){
  aceDryProfiles[String(aceId)]={
    temp:Math.max(30,Math.min(80,parseInt(temp,10)||45)),
    duration_sec:Math.max(10*60,Math.min(24*3600,parseInt(durationSec,10)||4*3600)),
    preset:preset||''
  };
  localStorage.setItem('aceDryProfiles',JSON.stringify(aceDryProfiles));
}
function _aceDryDurationMinFromSec(sec){
  var minutes=Math.round((parseInt(sec,10)||0)/60);
  return Math.max(10,Math.min(1440,minutes));
}
function _syncAceDryPresetsFromServer(raw){
  if(!raw||typeof raw!=='object')return;
  Object.keys(ACE_DRY_PRESETS).forEach(function(k){
    var p=raw[k];
    if(!p||typeof p!=='object')return;
    var t=parseInt(p.temp,10);
    var d=parseInt(p.duration_sec,10);
    if(Number.isFinite(t))ACE_DRY_PRESETS[k].temp=Math.max(30,Math.min(80,t));
    if(Number.isFinite(d))ACE_DRY_PRESETS[k].duration_sec=Math.max(10*60,Math.min(24*3600,d));
    if(/^custom_[123]$/.test(k)&&typeof p.name==='string'){
      var n=p.name.trim();
      ACE_DRY_PRESETS[k].name=n||('Custom '+k.slice(-1));
    }
  });
}

// ── Theme ──
function toggleTheme(){
  var h=document.documentElement;
  h.setAttribute('data-theme',h.getAttribute('data-theme')==='dark'?'light':'dark');
  localStorage.setItem('theme',h.getAttribute('data-theme'));
}
(function(){var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t)})();

// ── i18n ──
var currentLang='de';
var T={};
var _langCache={};

function tr(key,fallback){
  var v=T&&T[key];
  return (typeof v==='string'&&v.length)?v:(fallback!==undefined?fallback:'');
}

function _langToggleLabel(lang){
  if(lang==='de')return 'Deutsch';
  if(lang==='en')return 'English';
  if(lang==='fr')return 'Français';
  if(lang==='it')return 'Italiano';
  if(lang==='zh-cn')return '简体中文';
  return 'Espanol';
}

function _mapSupportedLang(lang){
  if(!lang)return '';
  var l=String(lang).toLowerCase().replace(/_/g,'-').trim();
  if(l==='de'||l==='en'||l==='es'||l==='fr'||l==='it'||l==='zh-cn')return l;

  var base=l.split('-')[0];
  if(base==='de'||base==='en'||base==='es'||base==='fr'||base==='it')return base;

  if(base==='zh'){
    if(l.indexOf('cn')>=0||l.indexOf('hans')>=0||l==='zh')return 'zh-cn';
  }
  return '';
}

function _normalizeLang(lang){
  return _mapSupportedLang(lang)||'de';
}

function _detectBrowserLanguage(){
  var prefs=[];
  if(Array.isArray(navigator.languages)&&navigator.languages.length)prefs=navigator.languages;
  else if(navigator.language)prefs=[navigator.language];
  for(var i=0;i<prefs.length;i++){
    var mapped=_mapSupportedLang(prefs[i]);
    if(mapped)return mapped;
  }
  return '';
}

function _resolveInitialLanguage(){
  var saved=localStorage.getItem('lang');
  var mappedSaved=_mapSupportedLang(saved);
  if(mappedSaved)return mappedSaved;
  return _detectBrowserLanguage()||'de';
}

async function _loadLanguage(lang){
  var l=_normalizeLang(lang);
  if(_langCache[l])return _langCache[l];
  var res=await fetch('/kx/ui/translations/'+l+'.json');
  if(!res.ok)throw new Error('failed to load translations: '+l);
  var data=await res.json();
  _langCache[l]=data||{};
  return _langCache[l];
}

async function setLanguage(lang){
  var l=_normalizeLang(lang);
  try{
    T=await _loadLanguage(l);
  }catch(_){
    var fb=(l==='de')?'en':'de';
    T=await _loadLanguage(fb);
    l=fb;
  }
  currentLang=l;
  localStorage.setItem('lang',l);
  var langSel=document.getElementById('lang-select');
  if(langSel)langSel.value=l;
  var sLangSel=document.getElementById('s-lang-select');
  if(sLangSel)sLangSel.value=l;
  document.documentElement.setAttribute('lang',l);
  applyLang();
}

function setLanguageFromSelect(){
  var langSel=document.getElementById('lang-select');
  var next=langSel?langSel.value:'de';
  setLanguage(next).catch(function(){});
}
// Multi-Printer: BASE_URL aus Pathname (/printer2 → andere Bridge-Instanz)
var _printers=[];
var _activePrinter=null;
var _farmStateCache={};
var _farmRefreshBusy=false;
function _farmStatus(s){
  var state=String((s&&s.print_state)||'').toLowerCase();
  var up=(s&&s.upload_progress)||{};
  if((s&&s.connection_error)||state==='error'||state==='failed')return 'error';
  // Backend-owned transfer/start state survives closing and reopening the tab.
  if(up.active||(s&&s.print_pending))return 'printing';
  if(state==='printing'||state==='paused')return 'printing';
  if(!state)return 'offline';
  return 'idle';
}
function renderFarmQuickSwitch(){
  var bar=document.getElementById('farm-quick-switch');
  if(!bar)return;
  bar.innerHTML=_printers.map(function(p){
    var s=_farmStateCache[String(p.id)]||{};
    var state=_farmStatus(s), active=_activePrinter&&String(p.id)===String(_activePrinter.id);
    var up=s.upload_progress||{};
    var detail=up.active?' · Uploading '+Math.round(up.percent||0)+'%':
      (s.print_pending?' · Starting':(state==='printing'?' · '+Math.round((Number(s.progress)||0)*100)+'%':''));
    var qt=typeof _farmQueueText==='function'&&_farmQueueText(p);if(qt)detail=' · '+qt;
    else if(typeof _KOBRA_PHASE!=='undefined'&&_KOBRA_PHASE[String(s.kobra_state||'').toLowerCase()])detail=' · '+_KOBRA_PHASE[String(s.kobra_state||'').toLowerCase()];
    var tip=typeof _farmDetail==='function'?_farmDetail(s):String(s.print_state||state);
    return '<button class="farm-printer '+state+(active?' active':'')+'" onclick="selectPrinter(\''+_escAttr(String(p.id))+'\')" title="'+_escAttr(tip)+'" aria-label="'+_escAttr((p.name||('Printer '+p.id))+' '+state)+'"><span class="farm-dot"></span><span>'+_kxEsc(p.name||('Printer '+p.id))+detail+'</span></button>';
  }).join('');
}
function refreshFarmState(){
  if(_farmRefreshBusy)return Promise.resolve(_farmStateCache);
  _farmRefreshBusy=true;
  return fetch('/kx/farm/overview',{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){
    var printers=(d.result&&d.result.printers)||[];
    printers.forEach(function(s){_farmStateCache[String(s.id)]=s;});
    renderFarmQuickSwitch();
    // Farm tab shares this poll: one request drives header, cards and cache.
    if(currentPanel==='printers'&&typeof renderFarmOverview==='function')renderFarmOverview({printers:printers});
    // The bridge->printer transfer bar. /api/state polls at 10s (printer-host
    // protection floor), which made the bar step once per 10s. The farm
    // overview is served from bridge memory with no printer query, so it can
    // drive the bar at the fast cadence for the active printer.
    var mine=_activePrinter&&_farmStateCache[String(_activePrinter.id)];
    if(mine&&mine.upload_progress){S.upload_progress=mine.upload_progress;renderPrinterUploadProgress(S.upload_progress);}
    _farmScheduleNext();
    return _farmStateCache;
  }).catch(function(){_farmScheduleNext();return _farmStateCache;}).then(function(v){_farmRefreshBusy=false;return v;});
}
// Adaptive farm cadence: 1s while any bridge is pushing a file to a printer,
// 5s otherwise. Both hit only bridge memory, never printer firmware.
var _farmNextTimer=null;
function _farmTransferActive(){
  return Object.keys(_farmStateCache).some(function(k){var up=_farmStateCache[k].upload_progress;return !!(up&&up.active);});
}
function _farmScheduleNext(){
  if(_farmNextTimer)clearTimeout(_farmNextTimer);
  _farmNextTimer=setTimeout(refreshFarmState,_farmTransferActive()?1000:5000);
}
(function(){
  var path=window.location.pathname.replace(/\/+$/,'');
  var m=path.match(/^\/printer(\d+)$/);
  // No /printerN in the path means "whatever printer this bridge port serves",
  // not printer 1 - each instance answers on its own port.
  var idx=m?parseInt(m[1]):null;
  window._printerIndex=idx;
})();
function _apiUrl(path){
  if(_activePrinter&&_activePrinter.bridge_url){
    return _activePrinter.bridge_url.replace(/\/+$/,'')+path;
  }
  return path;
}
function initPrinters(){
  return fetch('/kx/printers').then(function(r){return r.json()}).then(function(d){  // immer lokale Instanz für Drucker-Liste
    _printers=d.result||[];
    var idx=window._printerIndex;
    // Resolve in order: explicit /printerN, then the printer this bridge port
    // actually serves, then the first configured one. Without the port match a
    // root URL on :7126 would silently drive printer 1's data.
    _activePrinter=_printers.find(function(p){return String(p.id)===String(idx)})||
      _printers.find(function(p){
        try{return new URL(p.bridge_url).port===location.port;}catch(_){return false;}
      })||_printers[0]||null;
    if(_activePrinter)window._printerIndex=parseInt(_activePrinter.id,10);
    renderPrinterDropdown();
    renderFarmQuickSwitch();
    refreshFarmState();
    // initPrinters is the one startup /kx/printers request. The old separate
    // DOMContentLoaded check fetched it twice on every page load.
    if(!_printers.length)showPanel('printers');
    return _activePrinter;
  }).catch(function(){});
}

// Switching printers is one state change, not a page load: point _activePrinter
// at the new bridge, drop every cached per-printer file list, and re-render
// whatever the operator is currently looking at. Reloading the page instead
// (the old dropdown links) lost the panel, the browser tab and the scroll
// position, and left printerFiles showing the previous printer's contents.
//
// The pushed URL must carry the SELECTED printer's own origin, not the origin
// the page happens to be served from. pushState('/printer4') while sitting on
// :7125 produced http://<nas>:7125/printer4 - the header said "Kobra X 4" and
// _apiUrl() correctly targeted :7128, but the URL claimed a printer that port
// does not serve. Copying that link, reloading, or hitting back landed on a
// page whose origin and selection disagreed, and any same-origin asset (camera
// media, /serve/) resolved against the wrong printer. pushState cannot change
// origin, so a cross-origin selection needs a real navigation to that bridge.
// Every modal captures per-printer context (_slotEditIndex, _storeFileId,
// _skipObjects, ACE id, send/farm targets) and resolves _apiUrl() only at
// confirm time. Left open across a switch, "Save" on printer A's slot 3 dialog
// would POST to printer B. Close all of them before the selection changes.
function _closePrinterScopedUI(){
  var closers=[
    ['slot-edit-modal',closeSlotEdit],['filament-dialog',closeFilamentDialog],
    ['skip-dialog',closeSkipDialog],['ace-dry-dialog',closeAceDryDialog],
    ['send-dialog',closeSendDialog],['farm-print-dialog',closeFarmPrintDialog]];
  closers.forEach(function(c){
    var el=document.getElementById(c[0]);
    if(el&&el.classList.contains('open')){try{c[1]();}catch(_){}}
  });
  if(typeof closeFlowDrawer==='function')closeFlowDrawer();
  // The stream URL and /api/camera/stop are both per bridge; a running stream
  // would keep showing A while the header says B. Do not set camUserStopped:
  // that flag suppresses camera_on_print auto-start for the *new* printer.
  if(camOn){try{camStop();}catch(_){}}
  camUserStopped=false;
  tempHistory.n.length=0;tempHistory.b.length=0;
}
function selectPrinter(id){
  var next=_printers.find(function(p){return String(p.id)===String(id);});
  if(!next||(_activePrinter&&String(_activePrinter.id)===String(next.id)))return;
  _closePrinterScopedUI();
  _activePrinter=next;
  window._printerIndex=parseInt(next.id,10);
  try{history.replaceState({printer:next.id},'','/printer'+next.id);}catch(_){}
  _printerFilesLoaded=false;
  printerFiles=[];
  _printerThumbCache={};
  _printerFilesSelected={};
  _printerFilesSelectMode=false;
  renderPrinterDropdown();
  renderFarmQuickSwitch();
  _setPrinterDropdown(false);
  var cached=_farmStateCache[String(next.id)];
  if(cached){Object.assign(S,cached);applyState();}
  poll();
  if(currentPanel==='store')refreshBrowser();
  if(currentPanel==='printers')loadPrinterTab();
  // The settings form was filled from the previous bridge; saving it would push
  // A's IP/MQTT identity into B's config.ini and restart B.
  if(currentPanel==='settings')openSettings();
  _loadSpoolmanStatus();
}
function _currentOrigin(){
  return location.protocol+'//'+location.host;
}
// "" bridge_url means single-printer/same-origin, which is never a cross-bridge
// hop - return "" so the caller keeps the in-page path.
function _printerOrigin(p){
  var u=(p&&p.bridge_url||'').replace(/\/+$/,'');
  if(!u)return '';
  try{return new URL(u).origin;}catch(_){return '';}
}
function renderPrinterDropdown(){
  var wrap=document.getElementById('printer-dropdown-wrap');
  var single=document.getElementById('h-pname-single');
  var name=_printers.length===0?'–':(_activePrinter?(_activePrinter.name||'Kobra X'):'Kobra X');
  var pname=document.getElementById('h-pname');
  if(pname)pname.textContent=name;
  if(single)single.textContent=name;
  if(_printers.length>1){
    if(wrap)wrap.style.display='';
    if(single)single.style.display='none';
    var menu=document.getElementById('printer-dropdown-menu');
    if(menu){
      menu.innerHTML=_printers.map(function(p){
        var active=_activePrinter&&String(p.id)===String(_activePrinter.id);
        var num=p.id;
        // The active marker lives in a fixed-width gutter. Inserting "▶ " inline
        // shifted the selected row's text right of every other row, so the list
        // had no common left edge.
        return '<a href="'+((p.bridge_url||'').replace(/\/+$/,''))+'/printer'+num+'" onclick="event.preventDefault();selectPrinter(\''+num+'\')" style="display:flex;align-items:center;gap:8px;padding:10px 14px;color:'+(active?'var(--accent)':'var(--txt)')+';text-decoration:none;font-size:13px;border-bottom:1px solid var(--border);'+(active?'font-weight:600;':'')+'">'+
          '<span style="width:10px;flex:none;text-align:center">'+(active?'▸':'')+'</span>'+
          '<span>'+_kxEsc(p.name)+'</span></a>';
      }).join('');
    }
  } else {
    if(wrap)wrap.style.display='none';
    if(single)single.style.display='';
  }
}
function _setPrinterDropdown(open){
  var menu=document.getElementById('printer-dropdown-menu');
  if(menu)menu.style.display=open?'block':'none';
  // Caret must track the real menu state, so both the toggle and the
  // outside-click handler route through here instead of setting display alone.
  var caret=document.getElementById('printer-dropdown-caret');
  if(caret)caret.textContent=open?'▴':'▾';
  var btn=document.getElementById('printer-dropdown-btn');
  if(btn)btn.setAttribute('aria-expanded',open?'true':'false');
}
function togglePrinterDropdown(){
  var menu=document.getElementById('printer-dropdown-menu');
  _setPrinterDropdown(!!menu&&menu.style.display==='none');
}
// selectPrinter() pushes /printerN, so back/forward must move the selection
// with it instead of leaving the URL and the shown printer disagreeing.
window.addEventListener('popstate',function(){
  var m=location.pathname.replace(/\/+$/,'').match(/^\/printer(\d+)$/);
  if(!m)return;
  var id=m[1];
  if(_activePrinter&&String(_activePrinter.id)===id)return;
  window._printerIndex=parseInt(id,10);
  _activePrinter=_printers.find(function(p){return String(p.id)===id;})||_activePrinter;
  _printerFilesLoaded=false;
  printerFiles=[];
  _printerThumbCache={};
  renderPrinterDropdown();
  poll();
  if(currentPanel==='store')refreshBrowser();
});
document.addEventListener('click',function(e){
  var wrap=document.getElementById('printer-dropdown-wrap');
  if(wrap&&!wrap.contains(e.target)){
    _setPrinterDropdown(false);
  }
});
function applyLang(){
  ensureAceDryCards();
  // Nav
  var nb=document.getElementById('nb-dashboard');if(nb)nb.querySelector('.nav-text').textContent=T.nav_dashboard;
  nb=document.getElementById('nb-console');if(nb)nb.querySelector('.nav-text').textContent=T.nav_console;
  nb=document.getElementById('nb-printers');if(nb)nb.querySelector('.nav-text').textContent=T.nav_printers;
  nb=document.getElementById('nb-store');if(nb)nb.querySelector('.nav-text').textContent=T.nav_browser;
  // Bottom nav
  var bnb=document.getElementById('bnb-dashboard');if(bnb)bnb.lastChild.textContent=T.nav_dashboard;
  bnb=document.getElementById('bnb-console');if(bnb)bnb.lastChild.textContent=T.nav_console;
  bnb=document.getElementById('bnb-printers');if(bnb)bnb.lastChild.textContent=T.nav_printers;
  bnb=document.getElementById('bnb-store');if(bnb)bnb.lastChild.textContent=T.nav_browser;
  // Browser panel
  setText('printers-panel-title',T.nav_printers);
  setText('add-printer-btn-label',T.add_printer);
  setText('apd-title',T.add_printer);
  setText('skip-title',T.skip_title);
  setText('skip-hint',T.skip_hint);
  setText('d-btn-skip-label',T.skip_btn_label);
  setText('fd-objects-toggle-lbl',T.fd_objects_toggle);
  setText('apd-lbl-ip',T.apd_lbl_ip);
  setText('apd-lbl-name',T.apd_lbl_name);
  var apn=document.getElementById('apd-name');if(apn)apn.setAttribute('placeholder',T.apd_placeholder_name);
  setText('apd-cancel',T.apd_cancel);
  setText('apd-confirm',T.apd_confirm);
  setText('fd-slots-hint',T.fd_slots_hint);
  setText('fd-cancel',T.fd_cancel);
  setText('fd-print',T.fd_print);
  setText('store-panel-title','🗂 '+T.panel_browser_title);
  var srb=document.getElementById('store-refresh-btn');if(srb)srb.textContent=T.store_refresh;
  var ssp=document.getElementById('store-search');if(ssp)ssp.setAttribute('placeholder',T.store_search_placeholder);
  setText('store-upload-label-prefix',T.store_upload_label_prefix);
  setText('store-upload-label-browse',T.store_upload_label_browse);
  setText('store-empty',T.store_empty);
  setText('sf-all',T.sf_all);setText('sf-ok',T.sf_ok);setText('sf-err',T.sf_err);setText('sf-new',T.sf_new);
  setText('ss-date',T.ss_date);setText('ss-name',T.ss_name);setText('ss-dur',T.ss_dur);
  setText('store-web-verify-title',T.store_web_verify_title);
  setText('store-web-verify-msg',T.store_web_verify_msg);
  setText('store-web-verify-confirm',T.store_web_verify_confirm);
  setText('store-web-verify-abort',T.store_web_verify_abort);
  setText('store-lbl-select-all',T.store_select_all||'Select All');
  setText('store-lbl-delete-selected',T.store_delete_selected||'Delete Selected');
  setText('store-lbl-exit-select',T.store_exit_select||'Cancel');
  setText('btab-lbl-uploaded',T.browser_tab_uploaded||'Uploaded');
  setText('btab-lbl-printer',T.browser_tab_printer||'On Printer');
  setText('printer-store-lbl-select-all',T.store_select_all||'Select All');
  setText('printer-store-lbl-delete-selected',T.store_delete_selected||'Delete Selected');
  setText('printer-store-lbl-exit-select',T.store_exit_select||'Cancel');
  // Dashboard card titles
  setText('d-card-progress',T.card_progress);
  setText('d-card-temps',T.card_temps);
  setText('d-card-lightfan',T.card_light_fan);
  setText('d-card-speed',T.card_speed);
  setText('d-card-cam',T.card_cam);
  setText('d-card-ams',T.panel_ams_title);
  setText('d-lbl-elapsed',T.lbl_elapsed);
  setText('d-lbl-remain',T.lbl_remaining);
  setText('d-slicer-label',T.lbl_slicer_time);
  setText('d-lbl-layers',T.lbl_layers);
  setText('d-lbl-zpos',T.lbl_zpos);
  setText('d-lbl-light',T.lbl_light);
  setText('d-lbl-nozzle',T.label_nozzle);
  setText('d-lbl-bed',T.label_bed);
  // Dashboard buttons — Pause-Button wird zur Toggle-Action; Resume-Beschriftung
  // wird in updatePauseResumeBtn() je nach Druckerzustand gesetzt.
  updatePauseResumeBtn();
  setText('d-btn-cancel',T.btn_cancel);
  setText('cam-toggle-btn',camOn?T.btn_cam_stop:T.btn_cam_start);
  setText('cam-placeholder-txt',T.cam_placeholder);
  // Temp labels
  document.querySelectorAll('.lbl-set').forEach(e=>e.textContent=T.label_set);
  document.querySelectorAll('.lbl-off').forEach(e=>e.textContent=T.label_off);
  setText('d-chart-label',T.panel_temps_chart);
  // Axis labels
  setText('ptitle-motion-xy',T.panel_motion_xy);
  document.querySelectorAll('.lbl-home-z').forEach(e=>e.textContent=T.btn_home_z);
  document.querySelectorAll('.lbl-home-xy').forEach(e=>e.textContent=T.btn_home_xy);
  document.querySelectorAll('.lbl-home-all').forEach(e=>e.textContent=T.btn_home_all);
  document.querySelectorAll('.lbl-disable-motors').forEach(e=>e.textContent=T.btn_disable_motors);
  document.querySelectorAll('.temp-input').forEach(e=>e.setAttribute('placeholder',T.label_target_c.replace(':','')));
  // Console
  setText('ptitle-console',T.panel_console_title);
  // Settings-Panel
  setText('modal-sec-connection',T.settings_connection);
  setText('modal-sec-print',T.settings_print);
  setText('modal-sec-version',T.settings_version);
  // Nav + Kategorie-Labels (mit Fallback falls i18n-Key noch fehlt)
  setText('nav-settings',T.nav_settings||'Einstellungen');
  setText('setcat-lbl-connection',T.settings_connection||'Connection');
  setText('setcat-lbl-printer',T.settings_print||'Printer');
  setText('setcat-lbl-display',T.settings_cat_display||'Display');
  setText('setcat-lbl-display2',T.settings_cat_display||'Display');
  setText('setcat-lbl-filament',T.settings_cat_filament||'Filament');
  setText('setcat-lbl-integrations',T.settings_integrations||'Integrationen');
  setText('modal-sec-spoolman',T.modal_sec_spoolman||'Spoolman');
  setText('lbl-spoolman-url',T.lbl_spoolman_url||'Server URL');
  setText('lbl-spoolman-sync-rate',T.lbl_spoolman_sync_rate||'Sync rate (s, 0=off)');
  setText('modal-sec-obico',T.modal_sec_obico||'Obico');
  setText('setcat-lbl-system',T.settings_version||'System');
  setText('lbl-set-lang',T.settings_cat_language||'Language');
  setText('lbl-set-theme',T.settings_cat_theme||'Toggle light / dark');
  setText('lbl-poll-interval',T.settings_poll||'Poll interval (seconds)');
  setText('lbl-verbose-http-log',T.settings_verbose_http_log||'Log every HTTP request (verbose)');
  var dashLbl=document.getElementById('dash-lbl-edit');
  if(dashLbl)dashLbl.textContent=_dashEditing?(T.dash_done||'Done'):(T.dash_edit||'Customize dashboard');
  setText('dash-lbl-reset',T.dash_reset||'Reset');
  setText('dash-lbl-save-preset',T.dash_save_preset||'Save as preset');
  var dashPresetStd=document.getElementById('dash-preset-standard');
  if(dashPresetStd)dashPresetStd.textContent=T.dash_preset_standard||'Standard';
  var dashPresetWide=document.getElementById('dash-preset-wide89');
  if(dashPresetWide)dashPresetWide.textContent=T.dash_preset_wide89||'Wide desktop';
  if(document.getElementById('dash-hidden-bar'))_dashRenderHiddenBar();
  setText('lbl-filament-mapping',T.settings_filament_mapping||'Filament profile mapping (per slot)');
  setText('lbl-filament-mapping-save',T.settings_filament_mapping_save||'Save mapping');
  setText('lbl-visible-vendors',T.settings_visible_vendors||'Visible vendors (profile dropdown)');
  setText('visible-vendors-hint',T.settings_visible_vendors_hint||'Only these vendors appear in the slot profile dropdown. Nothing selected = show all. "Generic" and your own profiles are always visible.');
  setText('lbl-visible-vendors-save',T.settings_visible_vendors_save||'Save selection');
  // Custom-Profile-Import (Issue #41)
  setText('modal-sec-orca-profiles',T.orca_profile_section);
  setText('orca-profiles-hint',T.orca_profile_hint);
  setText('lbl-orca-profiles-import',T.orca_profile_import_btn);
  setText('lbl-slot-profile-import',T.orca_profile_import_link);
  setText('profile-import-title',T.orca_profile_import_title);
  setText('profile-import-dropmsg',T.orca_profile_dropmsg);
  setText('profile-import-list-label',T.orca_profile_list_label);
  // Hilfe-Text mit Inline-HTML — innerHTML statt setText
  var helpEl=document.getElementById('profile-import-help');
  if(helpEl && T.orca_profile_help_html) helpEl.innerHTML=T.orca_profile_help_html;
  setText('btn-save-settings',T.settings_save);
  setText('lbl-printer-name',T.settings_printer_name);
  setText('lbl-printer-ip',T.settings_printer_ip);
  setText('lbl-mqtt-port',T.settings_mqtt_port);
  setText('lbl-username',T.settings_username);
  setText('lbl-password',T.settings_password);
  setText('lbl-device-id',T.settings_device_id);
  setText('lbl-mode-id',T.settings_mode_id);
  setText('lbl-default-slot',T.settings_default_slot);
  setText('opt-slot-auto',T.settings_slot_auto);
  setText('lbl-auto-leveling',T.settings_auto_leveling);
  setText('lbl-vibration-compensation',T.settings_vibration_compensation);
  setText('lbl-file-ready-mode',T.settings_file_ready_mode);
  setText('opt-file-ready-dialog',T.settings_file_ready_dialog);
  setText('opt-file-ready-banner',T.settings_file_ready_banner);
  setText('lbl-camera-on-print',T.settings_camera_on_print);
  setText('lbl-web-upload-warning',T.settings_web_upload_warning);
  setText('fd-options-title',T.fd_options_title);
  setText('fd-lbl-auto-leveling',T.print_auto_leveling);

  setText('lbl-update-check',T.update_check);
  setText('lbl-update-apply',T.update_apply);
  // Progress-Karten-Aktionen für geladene/idle Datei (Issue #55)
  setText('d-idle-print-lbl',T.progress_action_print||'Print');
  setText('d-idle-slots-lbl',T.progress_action_slots||'Assign slots');
  setText('d-idle-clear-lbl',T.progress_action_clear||'Leeren');
  // Speed buttons
  setText('d-spd-lbl-1',T.speed_silent.replace(/^\S+\s/,''));
  setText('d-spd-lbl-2',T.speed_normal.replace(/^\S+\s/,''));
  setText('d-spd-lbl-3',T.speed_sport.replace(/^\S+\s/,''));
  // AMS feed/unload
  document.querySelectorAll('.lbl-feed').forEach(e=>e.textContent=T.lbl_feed);
  document.querySelectorAll('.lbl-unload').forEach(e=>e.textContent=T.lbl_unload);
  for(var i=0;i<4;i++){
      setText('d-card-ace-dry-'+i,'ACE '+(i+1)+' - '+tr('ace_dry_dryer'));
      setText('d-ace-auto-refill-label-'+i,tr('ace_dry_auto_refill'));
      setText('d-ace-drying-enable-label-'+i,tr('ace_dry_enable'));
      setText('d-ace-dry-humidity-label-'+i,tr('ace_dry_humidity')+':');
      setText('d-ace-dry-current-temp-label-'+i,tr('ace_dry_current_temp')+':');
      setText('d-ace-dry-target-label-'+i,tr('ace_dry_temp_line')+':');
      setText('d-ace-dry-time-label-'+i,tr('ace_dry_time_line')+':');
      setText('d-ace-dry-chart-label-'+i,tr('ace_dry_chart'));
    var adTemp=document.getElementById('ace-dry-temp-'+i);if(adTemp)adTemp.setAttribute('placeholder',T.ace_dry_temp);
    var adDur=document.getElementById('ace-dry-duration-'+i);if(adDur)adDur.setAttribute('placeholder',T.ace_dry_duration);
  }
  setText('ace-dry-dialog-title',tr('ace_dry_dialog_title'));
  setText('ace-dry-dialog-temp-label',tr('ace_dry_dialog_temp'));
  setText('ace-dry-dialog-time-label',tr('ace_dry_dialog_time'));
  setText('ace-dry-dialog-custom-name-label',tr('ace_dry_dialog_custom_name'));
  setText('ace-dry-dialog-cancel',tr('ace_dry_dialog_cancel'));
  setText('ace-dry-dialog-confirm',tr('ace_dry_dialog_confirm'));
  setText('ace-dry-dialog-reset-default',tr('ace_dry_dialog_reset_default'));
  setText('ace-dry-dialog-save-preset',tr('ace_dry_dialog_save_restart'));
  aceDryDialogSyncCustomButtonNames();
  // conn-btn text (nur wenn nicht im Übergangszustand)
  updateConnBtn();
  // Slot-Edit-Dialog
  setText('lbl-slot-color',T.slot_edit_color);
  setText('lbl-slot-material',T.slot_edit_material);
  setText('lbl-slot-profile',T.slot_edit_profile);
  setText('slot-profile-hint',T.slot_edit_profile_hint);
  var defOpt=document.getElementById('slot-profile-default-opt');
  if(defOpt) defOpt.textContent=T.slot_edit_profile_default;
  setText('btn-slot-edit-save',T.slot_edit_save);
  updateSlotEditFeedButton();
  var mi=document.getElementById('slot-edit-mat');if(mi)mi.setAttribute('placeholder',T.slot_edit_custom);
  setText('logdir-all',T.log_dir_all);
  setText('loglvl-all',T.log_dir_all);
  setText('log-lbl-level',T.log_lvl_label);
  setText('file-ready-btn',T.file_ready_btn);
  setText('file-slots-btn',T.file_slots_btn);
  setText('file-cancel-btn',T.file_cancel_btn);
  // GCode-Browser-Karten: Texte sind via innerHTML eingebacken,
  // bei Sprachwechsel komplett neu rendern.
  if(typeof renderStore==='function' && typeof storeFiles!=='undefined'){
    try{ renderStore(); }catch(e){}
  }
}
function setText(id,txt){var el=document.getElementById(id);if(el)el.textContent=txt;}

function ensureAceDryCards(){
  var grid=document.getElementById('d-ace-dry-grid');
  if(!grid||grid.getAttribute('data-init')==='1')return;
  var html='';
  for(var i=0;i<4;i++){
    html+='<div class="card" id="d-ace-dry-card-'+i+'" style="display:none">'
      +'<div class="card-title"><span>♨</span> <span id="d-card-ace-dry-'+i+'">ACE '+(i+1)+' - Dryer</span></div>'
      +'<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--txt2);margin-bottom:10px">'
        +'<span><span id="d-ace-dry-current-temp-label-'+i+'">Temperature:</span> <span id="d-ace-dry-current-temp-'+i+'" style="font-size:30px;font-weight:700;color:#ff8c2f;line-height:1">-</span></span>'
        +'<span><span id="d-ace-dry-humidity-label-'+i+'">Humidity:</span> <span id="d-ace-dry-humidity-'+i+'" style="font-size:30px;font-weight:700;color:#3aa8ff;line-height:1">-</span></span>'
      +'</div>'
      +'<div style="height:1px;background:var(--border);margin-bottom:10px"></div>'
      +'<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;color:var(--txt2);margin-bottom:10px">'
        +'<span><span id="d-ace-dry-target-label-'+i+'">Drying Temperature:</span> <span id="d-ace-dry-target-'+i+'" style="font-size:30px;font-weight:700;color:#ff8c2f;line-height:1">-</span></span>'
        +'<span><span id="d-ace-dry-time-label-'+i+'">Drying Time:</span> <span id="d-ace-dry-time-'+i+'" style="font-size:30px;font-weight:700;color:#fff;line-height:1">-</span></span>'
      +'</div>'
      +'<div style="margin-bottom:10px">'
        +'<button onclick="openAceDryDialog('+i+')" title="Edit Dryer Temp/Time Settings" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#000;cursor:pointer;font-size:13px;font-weight:600;line-height:1.2">Set Temp/Time</button>'
      +'</div>'
      +'<div style="height:1px;background:var(--border);margin-bottom:10px"></div>'
      +'<div class="toggle-row" style="margin-bottom:10px">'
        +'<span class="toggle-label" id="d-ace-auto-refill-label-'+i+'">Auto Refill</span>'
        +'<label class="toggle">'
          +'<input type="checkbox" id="ace-auto-refill-toggle-'+i+'" onchange="aceAutoRefillToggle('+i+')">'
          +'<span class="toggle-track"></span>'
          +'<span class="toggle-thumb"></span>'
        +'</label>'
      +'</div>'
      +'<div class="toggle-row" style="margin-bottom:8px">'
        +'<span class="toggle-label" id="d-ace-drying-enable-label-'+i+'">Enable Drying</span>'
        +'<label class="toggle">'
          +'<input type="checkbox" id="ace-dry-enable-toggle-'+i+'" onchange="aceDryToggle('+i+',this.checked)">'
          +'<span class="toggle-track"></span>'
          +'<span class="toggle-thumb"></span>'
        +'</label>'
      +'</div>'
      +'</div>';
  }
  grid.innerHTML=html;
  grid.setAttribute('data-init','1');
}
(function(){
  var l=_resolveInitialLanguage();
  currentLang=_normalizeLang(l);
  var langSel=document.getElementById('lang-select');
  if(langSel)langSel.value=currentLang;
  document.documentElement.setAttribute('lang',currentLang);
  // defer until DOM ready
  window.addEventListener('DOMContentLoaded',function(){
    setLanguage(currentLang).catch(function(){});
    _loadSpoolmanStatus();
  });
})();

// ── Panel nav ──
function showPanel(id){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+id).classList.add('active');
  document.querySelectorAll('.nav-btn,.bnav-btn').forEach(b=>b.classList.remove('active'));
  var nb=document.getElementById('nb-'+id);if(nb)nb.classList.add('active');
  var bnb=document.getElementById('bnb-'+id);if(bnb)bnb.classList.add('active');
  currentPanel=id;
  if(id==='settings')openSettings();
  // Log renders are skipped while the Console is hidden; catch up once now.
  if(id==='console')renderLog();
  // The farm view only auto-refreshes while it is the visible panel, so a
  // background tab never adds load to the printer hosts.
  if(typeof _farmPanelChanged==='function')_farmPanelChanged(id);
}

// Settings-Kategorie umschalten (Master-Detail)
function showSettingsCat(name){
  document.querySelectorAll('.set-group').forEach(g=>g.classList.remove('active'));
  document.querySelectorAll('.set-cat').forEach(b=>b.classList.remove('active'));
  var g=document.getElementById('setgrp-'+name);if(g)g.classList.add('active');
  var c=document.getElementById('setcat-'+name);if(c)c.classList.add('active');
}

// Browser-Sub-Tab umschalten: hochgeladene Dateien (Bridge-Store) vs. Dateien
// auf dem Drucker selbst (interner Speicher, via listLocal MQTT).
var _printerFilesLoaded=false;
function showBrowserTab(name){
  document.querySelectorAll('.browser-group').forEach(g=>g.classList.remove('active'));
  document.querySelectorAll('.browser-tab').forEach(b=>b.classList.remove('active'));
  var g=document.getElementById('browser-group-'+name);if(g)g.classList.add('active');
  var t=document.getElementById('btab-'+name);if(t)t.classList.add('active');
  if(name==='printer'&&!_printerFilesLoaded)loadPrinterFiles();
  if(name==='uploaded'){
    if(!storeFiles.length)loadStore();
    else renderStore();
  }
}

// Refresh whichever browser sub-tab is actually visible. The refresh button
// used to always reload the bridge store, so pressing it on the "On printer"
// tab appeared to do nothing.
function refreshBrowser(){
  var printerTab=document.getElementById('btab-printer');
  if(printerTab&&printerTab.classList.contains('active'))loadPrinterFiles();
  else loadStore();
}

// ── Console log ──
var consoleLogs=[];
var logAutoScroll=true;
var logBadgeCount=0;
var logDirFilter='all';   // 'all'|'rx'|'tx'
var logLevelFilter='all'; // 'all'|'err'|'warn'
var logTopicFilter='';    // '' = no topic filter

function clog(msg,cls){
  cls=cls||'msg-info';
  var ts=new Date().toLocaleTimeString('de',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  _appendLog({ts:ts,lvl:'',name:'ui',msg:msg},cls);
}
function _lvlCls(lvl){
  if(lvl==='ERROR'||lvl==='CRITICAL')return'msg-err';
  if(lvl==='WARNING')return'msg-warn';
  if(lvl==='DEBUG')return'msg-info';
  return'msg-ok';
}
var _logRenderPending=false;
function _scheduleLogRender(){
  // The SSE starts by replaying up to 500 records. Rebuilding the hidden
  // Console DOM for each record caused 508 renders / 105 ms of main-thread
  // work on every page load (and every reconnect). Keep the data hot, paint
  // once per frame only while the Console is actually visible.
  if(currentPanel!=='console'||_logRenderPending)return;
  _logRenderPending=true;
  requestAnimationFrame(function(){_logRenderPending=false;renderLog();});
}
function _appendLog(entry,forceCls){
  var cls=forceCls||_lvlCls(entry.lvl);
  var label=entry.name?'['+entry.name+'] ':'';
  var fullMsg=label+entry.msg;
  // Wiederholungen als Zähler zusammenfassen (×N) statt N identische Zeilen.
  var last=consoleLogs[consoleLogs.length-1];
  if(last&&last.msg===fullMsg&&last.cls===cls){
    last.count=(last.count||1)+1;
    last.ts=entry.ts; // letzte Sichtung
    _scheduleLogRender();
    return;
  }
  consoleLogs.push({ts:entry.ts,msg:fullMsg,cls:cls,count:1});
  if(consoleLogs.length>500)consoleLogs.shift();
  // Badge + Toast wenn Tab nicht aktiv und Fehler/Warnungen
  if(currentPanel!=='console'&&(cls==='msg-err'||cls==='msg-warn')){
    logBadgeCount++;
    var bc=logBadgeCount>99?'99+':logBadgeCount;
    ['log-badge','log-badge-bot'].forEach(function(id){var b=document.getElementById(id);if(b){b.style.display='inline';b.textContent=bc;}});
  }
  if(cls==='msg-err')showToast(entry.msg.split('\n')[0]);
  _scheduleLogRender();
}
// Kurze rote Snackbar bei Fehlern (auch wenn Konsole-Tab nicht offen).
var _toastTimer=null;
function showToast(msg){
  var t=document.getElementById('kx-toast');
  if(!t){
    t=document.createElement('div'); t.id='kx-toast';
    t.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--err);color:#fff;padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;max-width:90vw;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer';
    t.onclick=function(){showPanel('console');t.style.display='none';};
    document.body.appendChild(t);
  }
  t.textContent='⚠ '+msg;
  t.style.display='block';
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(function(){t.style.display='none';},6000);
}
function setLogDir(dir){
  logDirFilter=dir;
  document.querySelectorAll('.log-dir-btn').forEach(function(b){
    b.style.background=b.id==='logdir-'+dir?'var(--accent)':'var(--raised)';
    b.style.color=b.id==='logdir-'+dir?'#fff':'var(--txt2)';
  });
  renderLog();
}
function setLogLevel(lvl){
  logLevelFilter=lvl;
  document.querySelectorAll('.log-lvl-btn').forEach(function(b){
    b.style.background=b.id==='loglvl-'+lvl?'var(--accent)':'var(--raised)';
    b.style.color=b.id==='loglvl-'+lvl?'#fff':'var(--txt2)';
  });
  renderLog();
}
function setLogTopic(topic){
  var inp=document.getElementById('log-filter');
  var active=inp.value===topic;
  inp.value=active?'':topic;
  document.querySelectorAll('.log-topic-btn').forEach(function(b){
    var on=!active&&b.getAttribute('data-topic')===topic;
    b.style.background=on?'var(--accent)':'var(--raised)';
    b.style.color=on?'#fff':'var(--txt2)';
  });
  renderLog();
}
function renderLog(){
  var el=document.getElementById('console-log');
  if(!el)return;
  var filter=(document.getElementById('log-filter')||{}).value||'';
  var fl=filter.toLowerCase();
  var rows=consoleLogs.filter(function(l){
    var m=l.msg;
    if(logDirFilter==='rx'&&!/ RX[ (]/.test(m))return false;
    if(logDirFilter==='tx'&&!/ TX[ (]/.test(m))return false;
    if(logLevelFilter==='err'&&l.cls!=='msg-err')return false;
    if(logLevelFilter==='warn'&&l.cls!=='msg-err'&&l.cls!=='msg-warn')return false;
    if(fl&&!m.toLowerCase().includes(fl))return false;
    return true;
  });
  var savedScroll=logAutoScroll?null:el.scrollTop;
  el.innerHTML=rows.map(function(l){
    var cnt=(l.count&&l.count>1)?' <span style="opacity:.7">(×'+l.count+')</span>':'';
    return '<div><span class="ts">'+l.ts+'</span><span class="'+l.cls+'">'+escHtml(l.msg)+'</span>'+cnt+'</div>';
  }).join('');
  if(logAutoScroll)el.scrollTop=el.scrollHeight;
  else if(savedScroll!==null)el.scrollTop=savedScroll;
}
function onLogScroll(){
  var el=document.getElementById('console-log');
  if(!el)return;
  var atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<30;
  if(!atBottom&&logAutoScroll){setAutoScroll(false);}
}
function toggleAutoScroll(){
  setAutoScroll(!logAutoScroll);
  if(logAutoScroll){var el=document.getElementById('console-log');if(el)el.scrollTop=el.scrollHeight;}
}
function setAutoScroll(on){
  logAutoScroll=on;
  var btn=document.getElementById('btn-autoscroll');
  if(btn){btn.style.background=on?'var(--accent)':'var(--raised)';btn.style.color=on?'#fff':'var(--txt2)';}
}
function clearLogBadge(){
  logBadgeCount=0;
  ['log-badge','log-badge-bot'].forEach(function(id){var b=document.getElementById(id);if(b)b.style.display='none';});
}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
// SSE server-log stream
(function(){
  function connect(){
    var es=new EventSource('/api/log/stream');
    es.onmessage=function(e){try{_appendLog(JSON.parse(e.data));}catch(_){}};
    es.onerror=function(){es.close();setTimeout(connect,3000);};
  }
  window.addEventListener('DOMContentLoaded',connect);
})();

// ── Helpers ──
function fmtTime(s){if(!s||s<0)return'–';var m=Math.floor(s/60),h=Math.floor(m/60);m%=60;return h>0?h+'h '+m+'m':m+'m'}
function fmtHmsFromSec(total){
  total=Math.max(0,parseInt(total||0,10));
  var h=Math.floor(total/3600);
  var mm=Math.floor((total%3600)/60);
  var ss=total%60;
  return h+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0');
}
function post(url,body){return fetch(_apiUrl(url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
function clamp(v,lo,hi){return Math.min(hi,Math.max(lo,v))}

// Bridge -> printer transfer indicator. The bridge publishes byte counts in
// /api/state.upload_progress, which the existing poll already fetches; no
// extra endpoint or socket is needed.
function renderPrinterUploadProgress(up){
  var box=document.getElementById('printer-upload-progress');
  if(!box)return;
  if(!up||(!up.active&&up.phase!=='error')){box.style.display='none';return;}
  var pct=Math.max(0,Math.min(100,parseInt(up.percent||0,10)));
  var isErr=up.phase==='error';
  box.style.display='block';
  box.classList.toggle('is-error',isErr);
  var label=document.getElementById('printer-upload-label');
  var pctEl=document.getElementById('printer-upload-percent');
  var fill=document.getElementById('printer-upload-fill');
  var fileEl=document.getElementById('printer-upload-file');
  var de=(typeof currentLang!=='undefined'&&currentLang==='de');
  if(label)label.textContent=isErr
    ? (de?'Übertragung zum Drucker fehlgeschlagen':'Transfer to printer failed')
    : (de?'Übertragung zum Drucker':'Transferring to printer');
  if(pctEl)pctEl.textContent=isErr?'—':(pct+'%');
  if(fill)fill.style.width=(isErr?100:pct)+'%';
  if(fileEl){
    var mb=up.total?(' · '+(up.sent/1048576).toFixed(1)+' / '+(up.total/1048576).toFixed(1)+' MB'):'';
    fileEl.textContent=isErr?(up.error||''):((up.filename||'')+mb);
  }
}

// ── Apply state to DOM ──
function applyState(){
  var s=S;
  _syncAceDryPresetsFromServer(s.ace_dry_presets);
  // connection error banner – nur wenn überhaupt ein Drucker konfiguriert ist
  var banner=document.getElementById('conn-error-banner');
  if(banner){if(s.connection_error&&_printers.length>0){banner.textContent='⚠ '+tr('lbl_conn_error')+' '+s.connection_error;banner.style.display='block';}else{banner.style.display='none';}}
  var pauseBanner=document.getElementById('pause-msg-banner');
  if(pauseBanner){
    if(s.pause_msg && s.print_state==='paused'){
      // pause_msg and error_code come from printer MQTT payloads, so neither
      // may reach innerHTML raw. error_code is additionally forced to digits
      // before it is interpolated into the wiki URL.
      var code=String(s.error_code==null?0:s.error_code).replace(/[^0-9]/g,'');
      var codePart=(!code||code==='0') ? ' ' :
        ' [<a href="https://wiki.anycubic.com/en/error-codes/'+code+'-code" target="_blank" rel="noopener noreferrer">'+code+'</a>] ';
      pauseBanner.innerHTML=_kxEsc(tr('lbl_pause_reason'))+codePart+_kxEsc(s.pause_msg);
      pauseBanner.style.display='block';
    }else{
      pauseBanner.style.display='none';
    }
  }
  var bannerVisible=false;
  renderPrinterUploadProgress(s.upload_progress);
  var frb=document.getElementById('file-ready-banner');
  if(frb){
    var shouldAutoOpen=(s.print_start_dialog===undefined?true:!!s.print_start_dialog);
    if(s.file_ready&&s.print_state==='standby'){
      document.getElementById('file-ready-name').textContent=s.file_ready;
      // Neue Datei → Abbruch-Sperre aufheben
      if(_fdAutoOpenedFile&&_fdAutoOpenedFile!==s.file_ready){
        _fdUserCancelled=false;
        sessionStorage.removeItem('fdUserCancelled');
        sessionStorage.removeItem('fdAutoOpenedFile');
      }
      if(shouldAutoOpen){
        // Dialog-Modus: Banner niemals anzeigen.
        frb.style.display='none';
        if(!_fdDialogOpen&&!_fdUserCancelled&&_fdAutoOpenedFile!==s.file_ready){
          _fdAutoOpenedFile=s.file_ready;
          startReadyFileWithSlots(s.file_ready,true,s.filament_mismatch||null);
        }
      } else {
        frb.style.display='flex';
        bannerVisible=true;
      }
    }else{frb.style.display='none';}
  }
  // skip-button (mid-print) – nur sichtbar wenn aktuell gedruckt wird
  var printing=(s.print_state==='printing'||s.print_state==='paused');
  var skipBtn=document.getElementById('d-btn-skip');
  if(skipBtn) skipBtn.style.display=printing?'':'none';
  // Pause/Stopp-Buttons nur bei aktivem Druck zeigen (sonst verwirrend wenn
  // der Drucker idle ist). Pause-Button rendert sich passend zum State um.
  var ctrlBtns=document.getElementById('d-ctrl-btns');
  if(ctrlBtns) ctrlBtns.style.display=printing?'':'none';
  updatePauseResumeBtn();
  // Zuletzt geladene Datei merken (Issue #55): solange sie über den State
  // sichtbar ist. Beim Druckende/Abbruch leert die Bridge file_ready+filename
  // (Issue #29) — die gemerkte Referenz bleibt für die Karten-Aktionen.
  // Echte ready-Datei oder laufender Druck hebt einen vorherigen „Clear" auf.
  if(s.file_ready||printing) _idleCleared=false;
  if(s.file_ready) _lastLoadedFile=s.file_ready;
  else if(s.filename && !_idleCleared) _lastLoadedFile=s.filename;
  else if(_idleCleared) _lastLoadedFile=null;
  // Idle-Aktionen (Drucken/Slots/Leeren) nur wenn nicht gedruckt wird, eine
  // Datei bekannt ist und der grüne Banner nicht ohnehin schon dieselbe Aktion
  // anbietet.
  var idleBtns=document.getElementById('d-idle-btns');
  if(idleBtns){
    var showIdle=(!printing && _lastLoadedFile && !bannerVisible);
    idleBtns.style.display=showIdle?'':'none';
    if(showIdle){
      var dfn=document.getElementById('d-fname');
      if(dfn && (!dfn.textContent || dfn.textContent==='–')){
        dfn.textContent=_lastLoadedFile;dfn.title=_lastLoadedFile;
      }
    }
  }

  // header
  var b=document.getElementById('h-badge');
  b.className='hbadge '+s.print_state;
  document.getElementById('h-state').textContent=T['kobra_'+s.kobra_state]||s.kobra_state||T.header_status_standby;
  var _pn=_printers.length===0?'–':((_activePrinter&&_activePrinter.name)||s.printer_name);
  var _el=document.getElementById('h-pname');if(_el)_el.textContent=_pn;
  var _el2=document.getElementById('h-pname-single');if(_el2)_el2.textContent=_pn;
  var hv=document.getElementById('h-version');if(hv&&s.version)hv.textContent='v'+s.version;


  // temps
  var nt=document.getElementById('d-nt');if(nt)nt.textContent=s.nozzle_temp.toFixed(1);
  var ntt=document.getElementById('d-nt-t');if(ntt)ntt.textContent=s.nozzle_target.toFixed(0);
  var bt=document.getElementById('d-bt');if(bt)bt.textContent=s.bed_temp.toFixed(1);
  var btt=document.getElementById('d-bt-t');if(btt)btt.textContent=s.bed_target.toFixed(0);

  // temp bars (dashboard)
  var nb=document.getElementById('d-ntbar');if(nb)nb.style.width=clamp(s.nozzle_temp/300*100,0,100)+'%';
  var bb=document.getElementById('d-btbar');if(bb)bb.style.width=clamp(s.bed_temp/120*100,0,100)+'%';

  // progress
  var pct=Math.round(s.progress*100);
  var dpct=document.getElementById('d-pct');if(dpct)dpct.textContent=pct;
  var dpbar=document.getElementById('d-pbar');if(dpbar)dpbar.style.width=pct+'%';

  var layers=s.curr_layer&&s.total_layers?'L '+s.curr_layer+' / '+s.total_layers:'–';
  var dlayers=document.getElementById('d-layers');if(dlayers)dlayers.textContent=layers;
  var dzpos=document.getElementById('d-zpos');if(dzpos)dzpos.textContent=s.z_mm>0?s.z_mm.toFixed(2)+' mm':'–';

  var delapsed=document.getElementById('d-elapsed');if(delapsed)delapsed.textContent=fmtTime(s.print_duration);
  var dremain=document.getElementById('d-remain');if(dremain)dremain.textContent=s.remain_time>0?fmtTime(s.remain_time):'–';
  var dslrow=document.getElementById('d-slicer-row');
  var dsltime=document.getElementById('d-slicer-time');
  if(dslrow&&dsltime){
    if(s.slicer_time>0){dslrow.style.display='';dsltime.textContent=fmtTime(s.slicer_time);}
    else{dslrow.style.display='none';}
  }

  var fn=s.filename||'–';
  var dfname=document.getElementById('d-fname');if(dfname){dfname.textContent=fn;dfname.title=fn};
  var pfname=document.getElementById('p-fname');if(pfname){pfname.textContent=fn;pfname.title=fn};
  var cfo=document.getElementById('cam-fname');if(cfo)cfo.textContent=fn!=='–'?fn:'';

  // thumbnail
  var thumb=document.getElementById('d-thumbnail');
  if(thumb){
    if(s.thumbnail){
      thumb.src='data:image/png;base64,'+s.thumbnail;
      thumb.style.display='block';
    } else {
      thumb.style.display='none';
      thumb.src='';
    }
  }

  // light/fan sync
  document.getElementById('d-light-toggle').checked=s.light_on;
  var dfan=document.getElementById('d-fan');if(dfan)dfan.value=s.fan_speed;
  var dfanval=document.getElementById('d-fan-val');if(dfanval)dfanval.textContent=s.fan_speed;

  // speed mode buttons
  var spdWidths={1:25,2:55,3:90};
  [1,2,3].forEach(function(m){
    var b=document.getElementById('d-spd-'+m);
    if(b) b.classList.toggle('spd-active', s.print_speed_mode===m);
  });
  var spdBar=document.getElementById('d-spd-bar');
  if(spdBar) spdBar.style.width=(spdWidths[s.print_speed_mode]||55)+'%';

  var amsTitle=document.getElementById('d-card-ams');
  if(amsTitle){
    var baseTitle=tr('card_ams');
    var modeMap={toolhead:'Toolhead',ace_direct:'ACE Direct',ace_hub:'ACE Hub'};
    var modeTxt=modeMap[s.filament_mode]||'';
    amsTitle.textContent=modeTxt?(baseTitle+' - '+modeTxt):baseTitle;
  }

  ensureAceDryCards();
  var dry=s.ace_drying||{status:0,target_temp:0,duration:0,remain_time:0,humidity:null,current_temp:null,units:[]};
  var units=(dry.units||[]);
  var unitMap={};
  units.forEach(function(u){var id=Number(u.id);if(id>=0&&id<=3)unitMap[id]=u;});
  var aceMode=s.filament_mode==='ace_direct'||s.filament_mode==='ace_hub';
  var detected=(s.ace_units||[]).filter(function(id){return id>=0&&id<=3;});
  if(!detected.length){
    Object.keys(unitMap).forEach(function(k){detected.push(Number(k));});
  }
  if(!detected.length){
    (s.ams_slots||[]).forEach(function(sl){var id=Number(sl.box_id);if(id>=0&&id<=3&&detected.indexOf(id)<0)detected.push(id);});
  }
  detected.sort(function(a,b){return a-b;});
  var aceWrap=document.getElementById('d-ace-dry-wrap');
  if(aceWrap)aceWrap.style.display=(aceMode&&detected.length)?'contents':'none';
  for(var i=0;i<4;i++){
    var card=document.getElementById('d-ace-dry-card-'+i);
    if(!card)continue;
    var show=aceMode&&detected.indexOf(i)>=0;
    card.style.display=show?'':'none';
    if(!show)continue;
    var ud=unitMap[i]||dry;
    var refillToggle=document.getElementById('ace-auto-refill-toggle-'+i);
    var autoFeedMap=s.ace_auto_feed||{};
    if(refillToggle&&!_aceAutoFeedPending[i]){
      var afVal=autoFeedMap.hasOwnProperty(String(i))?Number(autoFeedMap[String(i)]):(_aceAutoRefillGet(i)?1:0);
      refillToggle.checked=afVal===1;
    }
    var dryToggle=document.getElementById('ace-dry-enable-toggle-'+i);
    if(dryToggle)dryToggle.checked=Number(ud.status||0)>0;
    var hh=document.getElementById('d-ace-dry-humidity-'+i);
    if(hh){
      var hv=(ud.humidity===null||ud.humidity===undefined||ud.humidity==='')?null:Number(ud.humidity);
      hh.textContent=(hv===null||Number.isNaN(hv))?'-':(Math.round(hv)+'%');
    }
    var ht=document.getElementById('d-ace-dry-current-temp-'+i);
    if(ht){
      var ct=(ud.current_temp===null||ud.current_temp===undefined||ud.current_temp==='')?null:Number(ud.current_temp);
      ht.textContent=(ct===null||Number.isNaN(ct))?'-':(ct.toFixed(1)+'°C');
    }
    var prof=_aceDryProfileGet(i);
    var useSec=(Number(ud.status||0)>0&&Number(ud.remain_time)>0)
      ?Number(ud.remain_time||0)*60
      :prof.duration_sec;
    var showTemp=(Number(ud.status||0)>0&&Number(ud.target_temp)>0)?Number(ud.target_temp):prof.temp;
    var dryTempEl=document.getElementById('d-ace-dry-target-'+i);
    if(dryTempEl)dryTempEl.textContent=showTemp+'°C';
    var dryTimeEl=document.getElementById('d-ace-dry-time-'+i);
    if(dryTimeEl)dryTimeEl.textContent=fmtHmsFromSec(useSec);
  }

  // AMS
  if(s.ams_slots&&s.ams_slots.length){
    window._amsSlots=s.ams_slots;
    // Group by box_id (-1=Toolhead, 0=ACE 1, 1=ACE 2, ...)
    var boxMap={};
    s.ams_slots.forEach(function(slot,i){
      var bid=slot.box_id!=null?slot.box_id:-1;
      if(!boxMap[bid])boxMap[bid]=[];
      boxMap[bid].push({slot:slot,arrIdx:i});
    });
    var boxIds=Object.keys(boxMap).map(Number).sort(function(a,b){return a-b});
    var acePresent=boxIds.some(function(b){return b>=0;});
    var html='';
    boxIds.forEach(function(bid){
      var entries=boxMap[bid];
      var label=bid===-1
        ?(acePresent?'Toolhead (Slots 1–3)':'Toolhead')
        :('ACE '+(bid+1));
      html+='<div class="ams-box-group">'
        +'<div class="ams-box-label">'+label+'</div>'
        +'<div class="ams-box-slots">';
      entries.forEach(function(e){
        var slot=e.slot;var i=e.arrIdx;
        var empty=slot.status!==5;
        var rgb=empty?[80,80,80]:(Array.isArray(slot.color)?slot.color:[128,128,128]);
        var col='rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
        var globalIdx=slot.global_index!=null?slot.global_index:i;
        var active=slot.status===1||slot.active;
        var loaded=(s.ams_loaded_slot!=null&&s.ams_loaded_slot>=0&&globalIdx===s.ams_loaded_slot);
        var activity=(slot.activity||'');
        var pct=empty?T.ams_empty:(slot.consumables_percent!=null?slot.consumables_percent+'%':'–');
        var slotLabel=T.label_slot+' '+(globalIdx+1);
        // Gemapptes Profil nur für belegte Slots verwenden — sonst zeigt ein
        // verwaistes Mapping (Slot wurde geleert) ein „Geister"-Profil (Issue #57).
        var profile=empty?null:(window._slotProfileMap||{})[globalIdx];
        var genericType=(slot.type||slot.material_type||'–');
        // Material-Label: bei belegtem Slot mit Mapping den konkreten Profilnamen
        // (z.B. „eSUN PLA+") statt nur des generischen Typs zeigen (Issue #57 Punkt 4).
        var materialLabel=empty?'–':((profile&&profile.name)?profile.name:genericType);
        var vendorBadge='';
        if(!empty && profile && profile.vendor){
          var tt=(profile.name||'')+(profile.id?' ('+profile.id+')':'');
          vendorBadge='<div class="slot-label" style="font-size:9px;color:var(--accent);font-weight:600;margin-top:1px" title="'+_escAttr(tt)+'">'+_kxEsc(profile.vendor)+'</div>';
        }
        var spoolSel='';
        if(_spoolmanStatus.configured&&!empty&&_spoolmanSpools.length){
          var curSpool=_slotSpoolMap[String(globalIdx)]||'';
          var spoolOpts='<option value="">–</option>'+_spoolmanSpools.map(function(sp){
            var vendor=sp.filament&&sp.filament.vendor?sp.filament.vendor.name+' ':'';
            var name=sp.filament?sp.filament.name:'#'+sp.id;
            var rem=sp.remaining_weight!=null?' '+sp.remaining_weight.toFixed(0)+'g':'';
            return '<option value="'+sp.id+'"'+(String(sp.id)==String(curSpool)?' selected':'')+'>'+
                   escHtml(vendor+name+rem)+'</option>';
          }).join('');
          spoolSel='<div onclick="event.stopPropagation()" style="margin-top:6px;border-top:1px solid rgba(255,255,255,.07);padding-top:5px">'
            +'<div style="font-size:8px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">🧵 Spoolman</div>'
            +'<select data-spool-slot="'+globalIdx+'" onchange="onAmsSpoolChange(this)" '
            +'style="width:100%;padding:3px 5px;font-size:10px;border-radius:5px;border:1px solid var(--border);background:var(--card);color:var(--txt);cursor:pointer">'+spoolOpts+'</select>'
            +'</div>';
        }
        html+='<div class="ams-slot'+(active?' active':'')+(loaded?' loaded':'')+(activity?' '+activity:'')+(empty?' empty':'')
          +'" style="--slot-color:'+col+';opacity:'+(empty?0.4:1)+';cursor:pointer" onclick="openSlotEdit('+i+')">'
          +'<div class="slot-circle" style="background:'+col+'"></div>'
          +'<div class="slot-material" title="'+(empty?'':genericType)+'">'+materialLabel+'</div>'
          +vendorBadge
          +'<div class="slot-label">'+slotLabel+'</div>'
          +'<div class="slot-label" style="font-size:10px;color:var(--txt2)">'+pct+'</div>'
          +spoolSel
          +'<div style="font-size:9px;color:var(--txt2);margin-top:2px">✏</div>'
          +'</div>';
      });
      if(bid===-1&&acePresent){
        html+='<div class="ams-slot ams-slot-bridge" aria-label="'+T.label_slot+' 4">'
          +'<div class="bridge-chip">ACE</div>'
          +'</div>';
      }
      html+='</div></div>';
    });
  // Nicht rendern wenn ein Spool-Dropdown gerade offen ist (verhindert Schließen beim Poll)
  var activeEl=document.activeElement;
  var spoolOpen=activeEl&&activeEl.tagName==='SELECT'&&activeEl.dataset.spoolSlot!=null;
  if(!spoolOpen) document.getElementById('ams-slots').innerHTML=html;
  }

  // camera is a hard feature gate, not merely an auto-start preference.
  // Only hide when the backend explicitly reports the camera disabled; an old
  // backend without this field must keep the camera visible.
  setCameraUIEnabled(s.camera_enabled!==0);
  var co=document.getElementById('cam-overlay');
  if(co)co.style.display=(s.camera_enabled!==0&&s.print_state==='printing'&&camOn)?'block':'none';

  // auto-start camera during print (unless user explicitly stopped it)
  if(s.camera_enabled!==0&&s.print_state==='printing'&&!camOn&&s.camera_url&&!camUserStopped&&s.camera_on_print){
    camStart();
  }
  // reset user-stopped flag when print ends so next print auto-starts again
  if(s.print_state!=='printing'){
    camUserStopped=false;
  }

  updateConnBtn();
}

// ── Camera master switch + idle auto-close ───────────────────────────────
// The Kobra X serves its own camera and runs the Klipper host on one weak
// core, so the camera card is removed entirely when the bridge disables it.
function setCameraUIEnabled(on){
  window._cameraEnabled=!!on;
  var card=document.getElementById('card-camera');
  if(card){
    var host=card.closest('.grid-stack-item')||card;
    if(!on&&typeof _dashGrid!=='undefined'&&_dashGrid&&host.classList.contains('grid-stack-item')){
      _dashGrid.removeWidget(host,false);
    }
    host.style.display=on?'':'none';
  }
  if(!on&&typeof camOn!=='undefined'&&camOn){
    try{camStop();}catch(_){}
  }
}

// Counts in-flight browser->bridge transfers. Auto-close must never fire while
// a file is being pushed, or the request dies with the page.
window._kxTransfers=0;
function kxTransferStart(){window._kxTransfers++;}
function kxTransferEnd(){window._kxTransfers=Math.max(0,window._kxTransfers-1);}

// True when nothing is moving data or waiting on the printer.
function kxIsIdle(){
  if(window._kxTransfers>0)return false;
  var up=S.upload_progress;
  if(up&&(up.active||up.phase==='sending'||up.phase==='processing'))return false;
  var dlg=document.getElementById('filament-dialog');
  if(dlg&&dlg.classList.contains('open'))return false;
  var skip=document.getElementById('skip-dialog');
  if(skip&&skip.classList.contains('open'))return false;
  if(document.getElementById('store-upload-status')){
    var st=document.getElementById('store-upload-status');
    if(st&&st.style.display!=='none'&&st.className==='upload-status-busy')return false;
  }
  return true;
}

// Navigating away is the only reliable way to stop *every* timer, stream and
// fetch this page owns; clearing known intervals would miss any added later.
function closeBridgeUI(reason){
  try{sessionStorage.setItem('kxCloseReason',reason||'manual');}catch(_){}
  // Blob navigation replaces the whole document and execution context, killing
  // every interval/fetch/stream even if the backend has not restarted yet.
  // An absolute reopen URL survives the blob: origin.
  var reopen=location.origin+'/';
  var html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Kobra Bridge closed</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16181b;color:#e6e8ea;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}.b{width:min(420px,calc(100vw - 32px));border:1px solid #2c3136;background:#1c1f23;padding:24px;border-radius:5px}h1{margin:0 0 8px;font-size:18px}p{margin:0 0 18px;color:#9aa2aa;line-height:1.5}a{display:inline-flex;min-height:44px;align-items:center;padding:0 14px;border:1px solid #456684;background:#31465c;color:#dce8f2;border-radius:4px;text-decoration:none}</style>'+
    '<main class="b"><h1>Kobra Bridge closed</h1><p>Polling, camera, timers and dashboard activity are stopped while the printer runs.</p><a href="'+reopen+'">Reopen Kobra Bridge</a></main>';
  location.replace(URL.createObjectURL(new Blob([html],{type:'text/html'})));
}

var KX_IDLE_CLOSE_MS=10000;
var _kxIdleSince=0;
function kxAutoCloseTick(){
  // Auto-close is OFF by default; the UI only self-closes when explicitly
  // opted in with localStorage kxAutoClose=1. The manual "✕ Close" button
  // still works and calls closeBridgeUI('manual') directly.
  if(localStorage.getItem('kxAutoClose')!=='1')return;
  // Wait for the new backend with the camera kill switch. Older backends omit
  // this field; auto-closing their UI would leave camera ffmpeg workers alive.
  if(S.camera_enabled!==0){_kxIdleSince=0;return;}
  var printing=(S.print_state==='printing'||S.kobra_state==='printing');
  if(!printing||!kxIsIdle()){_kxIdleSince=0;return;}
  var now=Date.now();
  if(!_kxIdleSince){_kxIdleSince=now;return;}
  if(now-_kxIdleSince>=KX_IDLE_CLOSE_MS)closeBridgeUI('idle');
}

function updateConnBtn(){
  var btn=document.getElementById('conn-btn');
  if(!btn)return;
  var offline=S.kobra_state==='offline';
  if(offline){
    btn.className='conn-btn disconnected';
    btn.textContent=tr('btn_connect');
  } else {
    btn.className='conn-btn connected';
    btn.textContent=tr('btn_disconnect');
  }
}

function toggleConnection(){
  var btn=document.getElementById('conn-btn');
  var offline=S.kobra_state==='offline';
  btn.disabled=true;
  btn.textContent='…';
  var url=offline?'/api/connect':'/api/disconnect';
  post(url,{}).then(function(r){return r.json()}).then(function(r){
    btn.disabled=false;
    if(r.error)addLog('Error: '+r.error);
  }).catch(function(){btn.disabled=false;});
}

// ── Temp history + chart ──
function updateHistory(){
  tempHistory.n.push(S.nozzle_temp);
  tempHistory.b.push(S.bed_temp);
  if(tempHistory.n.length>60)tempHistory.n.shift();
  if(tempHistory.b.length>60)tempHistory.b.shift();
  drawChart('d-chart',tempHistory,[{data:tempHistory.n,color:'#00c8ff',max:300},{data:tempHistory.b,color:'#ff6b35',max:120}]);
}
function drawChart(id,_,series){
  var canvas=document.getElementById(id);if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var W=canvas.offsetWidth*window.devicePixelRatio||canvas.width;
  var H=canvas.offsetHeight*window.devicePixelRatio||canvas.height;
  canvas.width=W;canvas.height=H;
  ctx.clearRect(0,0,W,H);
  series.forEach(function(s){
    var data=s.data;if(!data.length)return;
    var max=s.max;
    ctx.beginPath();ctx.strokeStyle=s.color;ctx.lineWidth=2;ctx.lineJoin='round';
    data.forEach(function(v,i){
      var x=i/(Math.max(data.length-1,1))*(W-4)+2;
      var y=H-4-(v/max)*(H-8);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    ctx.stroke();
  });
}

// ── Settings Modal ──
var _updateTag='';
var _updateUrl='';
function openSettings(){
  fetch(_apiUrl('/api/settings')).then(function(r){return r.json()}).then(function(d){
    document.getElementById('s-printer-name').value=d.printer_name||'';
    document.getElementById('s-printer-ip').value=d.printer_ip||'';
    document.getElementById('s-mqtt-port').value=d.mqtt_port||9883;
    document.getElementById('s-username').value=d.username||'';
    document.getElementById('s-password').value=d.password||'';
    document.getElementById('s-device-id').value=d.device_id||'';
    document.getElementById('s-mode-id').value=d.mode_id||'';
    document.getElementById('s-default-slot').value=d.default_ams_slot||'auto';
    document.getElementById('s-auto-leveling').checked=(d.auto_leveling===undefined?true:!!d.auto_leveling);
    var vc=document.getElementById('s-vibration-compensation');if(vc)vc.checked=!!d.vibration_compensation;
    var cop=document.getElementById('s-camera-on-print');
    if(cop){
      cop.checked=!!d.camera_on_print&&d.camera_enabled!==0;
      cop.disabled=d.camera_enabled===0;
      var row=cop.closest('.modal-field');if(row&&d.camera_enabled===0)row.style.display='none';
    }
    setCameraUIEnabled(d.camera_enabled!==0);
    var frm=document.getElementById('s-file-ready-mode');if(frm)frm.value=(d.print_start_dialog===undefined?'1':String(d.print_start_dialog?1:0));
    var wuw=document.getElementById('s-web-upload-warning');if(wuw)wuw.checked=(d.web_upload_warning===undefined?true:!!d.web_upload_warning);
    // Poll-Intervall (Sekunden) — Backend hat Vorrang vor localStorage
    var pi=document.getElementById('s-poll-interval');
    if(pi){
      var sec=d.poll_interval||Math.round((parseInt(localStorage.getItem('pollInterval')||'2000'))/1000)||3;
      pi.value=sec;
      setPoll(sec*1000);
    }
    var vhl=document.getElementById('s-verbose-http-log');if(vhl)vhl.checked=!!d.verbose_http_log;
    renderFilamentMapping(d.filament_profiles||{});
    renderSpoolmanSlotCard();
    // Spoolman
    var su=document.getElementById('s-spoolman-url');if(su)su.value=d.spoolman_server||'';
    var sr=document.getElementById('s-spoolman-sync-rate');if(sr)sr.value=(d.spoolman_sync_rate!==undefined?d.spoolman_sync_rate:30);
    _updateSpoolmanStatusDot();
  });
  // Sprach-Select im Settings-Panel mit aktueller Sprache spiegeln
  var ls=document.getElementById('s-lang-select');
  if(ls)ls.value=(localStorage.getItem('lang')||document.documentElement.lang||'de');
  document.getElementById('s-version-label').textContent='v'+('__VERSION__'||'?');
  document.getElementById('update-status').textContent='';
  document.getElementById('btn-update-apply').style.display='none';
  var cl=document.getElementById('update-changelog');if(cl)cl.style.display='none';
  _updateTag='';_updateUrl='';
  // Custom-Profile-Liste laden (Issue #41)
  refreshUserProfileList();
  // Vendor-Sichtbarkeitsfilter (Issue #41 Option A)
  loadVendorChecklist();
}
function closeSettings(){
  // Panel-Variante: zurück zum Dashboard
  showPanel('dashboard');
}

// Poll-Intervall-Feld → Live-Poll sofort übernehmen (Persistenz erst beim Speichern)
function onPollIntervalInput(){
  var pi=document.getElementById('s-poll-interval');
  if(!pi)return;
  var sec=parseInt(pi.value,10);
  if(sec>=1&&sec<=60)setPoll(sec*1000);
}

// ── Filament-Profil-Mapping pro Slot ([filament_profiles]) ──
// Pro Slot ein einzelnes Profil-Dropdown (vendor+name gemeinsam, gekeyt per
// _profileKey). Kein Freitext mehr → das (vendor,name)→id-Matching kann nicht
// mehr durch manuelle Eingabe brechen (Issue #57 Punkt 1). Optionen werden aus
// /kx/filament/profiles geladen, nach Vendor gruppiert, User-Profile zuerst,
// mit demselben Vendor-Sichtbarkeitsfilter wie das Slot-Edit-Dropdown.
function renderFilamentMapping(map){
  var el=document.getElementById('filament-mapping-list');
  if(!el)return;
  var rows='';
  for(var i=0;i<4;i++){
    var m=map[i]||map[String(i)]||{};
    var idHint=m.id?' <span style="color:var(--txt2);font-size:11px">('+_kxEsc(m.id)+')</span>':'';
    rows+='<div class="modal-field" style="margin-bottom:8px">'
      +'<label>Slot '+(i+1)+idHint+'</label>'
      +'<select id="fmap-'+i+'" data-vendor="'+_escAttr(m.vendor||'')+'" data-name="'+_escAttr(m.name||'')+'" style="width:100%"></select>'
      +'</div>';
  }
  el.innerHTML=rows;
  // Dropdowns befüllen (async, geteilter Profil-Cache + Vendor-Filter)
  for(var j=0;j<4;j++){ _fillMappingDropdown(j); }
}
function _fillMappingDropdown(slot){
  var sel=document.getElementById('fmap-'+slot);
  if(!sel) return;
  var wantKey=_profileKey(sel.dataset.vendor, sel.dataset.name);
  _loadOrcaFilaments(function(profiles){
    sel.innerHTML='<option value="">'+(tr('slot_edit_profile_default')||'Generic (Standard)')+'</option>';
    var userProfs=profiles.filter(function(p){return p.is_user;});
    var systemProfs=profiles.filter(function(p){return !p.is_user;});
    function _opt(g,p){
      var o=document.createElement('option');
      o.value=_profileKey(p.vendor,p.name);
      o.dataset.vendor=p.vendor; o.dataset.name=p.name; o.dataset.id=p.id||'';
      o.textContent=(p.is_user?'★ ':'')+p.name+(p.vendor?' — '+p.vendor:'');
      if(o.value===wantKey)o.selected=true;
      g.appendChild(o);
    }
    if(userProfs.length){
      var gUser=document.createElement('optgroup');
      gUser.label='★ '+(tr('orca_profile_user_label')||'My profiles');
      userProfs.forEach(function(p){_opt(gUser,p);});
      sel.appendChild(gUser);
    }
    _loadVisibleVendors(function(vis){
      var filtered=systemProfs;
      if(vis&&vis.length){
        var allow={};vis.forEach(function(v){allow[v]=1;});allow['Generic']=1;
        filtered=systemProfs.filter(function(p){return allow[p.vendor];});
      }
      var byVendor={};
      filtered.forEach(function(p){(byVendor[p.vendor]=byVendor[p.vendor]||[]).push(p);});
      Object.keys(byVendor).sort().forEach(function(v){
        var g=document.createElement('optgroup');g.label=v;
        byVendor[v].forEach(function(p){_opt(g,p);});
        sel.appendChild(g);
      });
    });
  });
}
function saveFilamentMapping(){
  // Nutzt den per-Slot-Endpoint (vendor,name → ID-Lookup im Backend).
  // Leere Auswahl ("") = Mapping entfernen.
  var chain=Promise.resolve();
  for(var i=0;i<4;i++){
    (function(slot){
      var sel=document.getElementById('fmap-'+slot);
      var opt=sel?sel.options[sel.selectedIndex]:null;
      var vendor=(opt&&opt.dataset.vendor)||'';
      var name=(opt&&opt.dataset.name)||'';
      chain=chain.then(function(){
        return fetch(_apiUrl('/kx/filament/slots/'+slot+'/profile'),
          {method:'POST',headers:{'Content-Type':'application/json'},
           body:JSON.stringify({vendor:vendor,name:name})});
      });
    })(i);
  }
  chain.then(function(){
    clog(tr('log_filament_mapping_saved')||'Filament mapping saved','msg-ok');
    openSettings(); // neu laden → ID-Hints aktualisieren
  }).catch(function(e){clog('Mapping error: '+e,'msg-err');});
}

// ── Vendor-Sichtbarkeitsfilter (Issue #41 Option A) ──
var _vendorChecklistSel={};  // {vendor:true} — laufende Auswahl im UI
function loadVendorChecklist(){
  // aktuelle Auswahl aus Backend, dann alle verfügbaren Vendoren rendern
  _visibleVendors=null; // Cache invalidieren
  _loadVisibleVendors(function(vis){
    _vendorChecklistSel={};
    (vis||[]).forEach(function(v){_vendorChecklistSel[v]=true;});
    renderVendorChecklist();
  });
}
function renderVendorChecklist(){
  var el=document.getElementById('visible-vendors-list');
  if(!el)return;
  _loadOrcaFilaments(function(profiles){
    // alle System-Vendoren (ohne Generic — der ist immer sichtbar) sammeln
    var set={};
    profiles.forEach(function(p){ if(!p.is_user && p.vendor && p.vendor!=='Generic') set[p.vendor]=1; });
    var vendors=Object.keys(set).sort();
    var q=((document.getElementById('vendor-filter-search')||{}).value||'').toLowerCase();
    if(q)vendors=vendors.filter(function(v){return v.toLowerCase().indexOf(q)>=0;});
    el.innerHTML=vendors.map(function(v){
      var ck=_vendorChecklistSel[v]?'checked':'';
      var safe=_escAttr(v);
      return '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;font-size:13px">'
        +'<input type="checkbox" data-vendor="'+safe+'" '+ck+' onchange="_vendorCheck(this)" style="width:auto;margin:0"> '+_kxEsc(v)+'</label>';
    }).join('')||'<i style="color:var(--txt2)">–</i>';
  });
}
function _vendorCheck(cb){
  var v=cb.getAttribute('data-vendor');
  if(cb.checked)_vendorChecklistSel[v]=true; else delete _vendorChecklistSel[v];
}
function renderSpoolmanSlotCard(){
  var card=document.getElementById('spoolman-slot-card');
  var rows=document.getElementById('spoolman-slot-rows');
  if(!card||!rows)return;
  if(!_spoolmanStatus.configured){card.style.display='none';return;}
  card.style.display='';
  Promise.all([
    fetch(_apiUrl('/kx/spoolman/spools')).then(function(r){return r.json();}),
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();})
  ]).then(function(res){
    var spools=res[0].spools||[];
    var slots=(res[1].result||[]).sort(function(a,b){return a.slot_index-b.slot_index;});
    if(!slots.length){rows.innerHTML='<span style="font-size:11px;color:var(--txt2)">No AMS slots known.</span>';return;}
    rows.innerHTML=slots.map(function(slot){
      var idx=parseInt(slot.slot_index);
      var col=_safeHex(slot.color_hex||'#888');
      var mat=slot.material||'';
      var current=_slotSpoolMap[String(idx)]||'';
      var opts='<option value="">–</option>'+spools.map(function(sp){
        var rem=sp.remaining_weight!=null?' ('+sp.remaining_weight.toFixed(0)+'g)':'';
        var vendor=sp.filament&&sp.filament.vendor?sp.filament.vendor.name+' ':'';
        var name=sp.filament?sp.filament.name:'Spool #'+sp.id;
        var mat2=sp.filament&&sp.filament.material?' · '+sp.filament.material:'';
        return '<option value="'+sp.id+'"'+(String(sp.id)==String(current)?' selected':'')+'>'+
               escHtml('#'+sp.id+' '+vendor+name+mat2+rem)+'</option>';
      }).join('');
      return '<div style="display:flex;align-items:center;gap:8px;font-size:12px">'+
        '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:'+col+';border:1px solid var(--border);flex-shrink:0"></span>'+
        '<span style="color:var(--txt2);min-width:60px">Slot '+(idx+1)+' <span style="color:var(--txt2);font-size:10px">'+escHtml(mat)+'</span></span>'+
        '<select data-spool-slot="'+idx+'" style="flex:1;padding:3px 6px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--txt);font-size:12px">'+opts+'</select></div>';
    }).join('');
  }).catch(function(){rows.innerHTML='<span style="font-size:11px;color:var(--err)">Spoolman unreachable</span>';});
}

function onAmsSpoolChange(sel){
  var idx=sel.getAttribute('data-spool-slot');
  var val=sel.value;
  if(val) _slotSpoolMap[String(idx)]=parseInt(val);
  else delete _slotSpoolMap[String(idx)];
  var mapping={};
  Object.keys(_slotSpoolMap).forEach(function(k){mapping[k]=_slotSpoolMap[k];});
  fetch(_apiUrl('/kx/spoolman/active-spool'),{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({slot_spools:mapping})});
}

function saveSpoolmanSlots(){
  var mapping={};
  document.querySelectorAll('#spoolman-slot-rows select[data-spool-slot]').forEach(function(sel){
    var idx=sel.getAttribute('data-spool-slot');
    var val=sel.value;
    if(val)mapping[idx]=parseInt(val);
  });
  fetch(_apiUrl('/kx/spoolman/active-spool'),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({slot_spools:mapping})}).then(function(r){return r.json();}).then(function(d){
    _slotSpoolMap=d.slot_spools||{};
  });
}

function saveVisibleVendors(){
  var vendors=Object.keys(_vendorChecklistSel);
  fetch(_apiUrl('/kx/filament/visible_vendors'),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({vendors:vendors})}).then(function(r){return r.json();}).then(function(){
    _visibleVendors=vendors.slice(); // Dropdown-Cache aktualisieren
    clog(tr('log_visible_vendors_saved')||'Vendor selection saved','msg-ok');
  }).catch(function(e){clog('Vendor filter error: '+e,'msg-err');});
}

// ── Custom Filament Profile Import (Issue #41) ──
function refreshUserProfileList(){
  var listEl=document.getElementById('orca-profiles-list');
  if(!listEl) return;
  fetch(_apiUrl('/kx/filament/profiles/user')).then(function(r){return r.json();}).then(function(d){
    var profs=(d && d.result)||[];
    if(!profs.length){
      listEl.innerHTML='<i style="color:var(--txt2)">'+(tr('orca_profile_user_empty')||'– keine –')+'</i>';
      return;
    }
    listEl.innerHTML=profs.map(function(p){
      var label=p.vendor+' / '+p.name+' ('+p.type+')';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--border)">'
        +'<span>★ '+_kxEsc(label)+'</span>'
        +'<button onclick="deleteUserProfile(\''+encodeURIComponent(p.vendor)+'\',\''+encodeURIComponent(p.name)+'\')" '
        +'style="background:none;border:none;color:var(--err);cursor:pointer;font-size:14px" title="delete">🗑</button>'
        +'</div>';
    }).join('');
  }).catch(function(){});
}
function deleteUserProfile(vendor, name){
  fetch(_apiUrl('/kx/filament/profiles/user?vendor='+vendor+'&name='+name), {method:'DELETE'})
    .then(function(r){return r.json();})
    .then(function(){
      _orcaFilamentCache=null;
      refreshUserProfileList();
      // Falls Import-Dialog offen ist, dort auch refreshen
      refreshImportDialogList();
    });
}
function openProfileImport(){
  document.getElementById('profile-import-status').textContent='';
  refreshImportDialogList();
  document.getElementById('profile-import-modal').classList.add('open');
}
function closeProfileImport(){
  document.getElementById('profile-import-modal').classList.remove('open');
}
function refreshImportDialogList(){
  var el=document.getElementById('profile-import-list');
  if(!el) return;
  fetch(_apiUrl('/kx/filament/profiles/user')).then(function(r){return r.json();}).then(function(d){
    var profs=(d && d.result)||[];
    if(!profs.length){
      el.innerHTML='<i style="color:var(--txt2)">'+(tr('orca_profile_user_empty')||'– keine –')+'</i>';
      return;
    }
    el.innerHTML=profs.map(function(p){
      var label=p.vendor+' / '+p.name+' ('+p.type+')';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-bottom:1px solid var(--border)">'
        +'<span>★ '+_kxEsc(label)+'</span>'
        +'<button onclick="deleteUserProfile(\''+encodeURIComponent(p.vendor)+'\',\''+encodeURIComponent(p.name)+'\')" '
        +'style="background:none;border:none;color:var(--err);cursor:pointer;font-size:14px" title="delete">🗑</button>'
        +'</div>';
    }).join('');
  }).catch(function(){});
}
function doProfileImportUpload(files){
  if(!files || !files.length) return;
  var status=document.getElementById('profile-import-status');
  status.textContent=(tr('orca_profile_uploading')||'Uploading…');
  status.style.color='var(--txt2)';
  var done=0, totalAdded=0, totalSkipped=0;
  function _one(idx){
    if(idx>=files.length){
      status.textContent=(tr('orca_profile_done')||'Imported')+': '+totalAdded
        +(totalSkipped?' / '+totalSkipped+' '+(tr('orca_profile_skipped')||'skipped'):'');
      status.style.color='var(--ok)';
      _orcaFilamentCache=null;
      refreshImportDialogList();
      refreshUserProfileList();
      // Vendor-Checkliste neu aufbauen — ein Import kann einen bisher
      // unbekannten System-Vendor mitbringen (Issue #41).
      if(document.getElementById('visible-vendors-list')) renderVendorChecklist();
      // Wenn Slot-Edit offen ist, Dropdown gleich neu befüllen
      var mat=document.getElementById('slot-edit-mat');
      if(mat && document.getElementById('slot-edit-modal').classList.contains('open')){
        _fillSlotProfileDropdown(mat.value, '', '');
      }
      return;
    }
    var fd=new FormData();
    fd.append('file', files[idx]);
    fetch(_apiUrl('/kx/filament/profiles/user'), {method:'POST', body:fd})
      .then(function(r){return r.json();})
      .then(function(d){
        totalAdded += (d.added||0);
        totalSkipped += (d.skipped||0);
        done++;
        _one(idx+1);
      })
      .catch(function(e){
        status.textContent='Error: '+e;
        status.style.color='var(--err)';
      });
  }
  _one(0);
}

// ── AMS Slot Edit ──
var _slotEditIndex=-1;
var _slotEditLoaded=false;
var _MAT_PRESETS=['PLA','PLA+','PLA SILK','PLA MATTE','PETG','ABS','ASA','TPU','PA','PC','HIPS'];
function _normalizeMat(m){
  var s=m.toUpperCase().trim().replace(/-/g,' ').replace(/_/g,' ');
  var aliases={'PLAPLUS':'PLA+','PLA PLUS':'PLA+','SILK PLA':'PLA SILK','PLASILK':'PLA SILK',
    'PLA MATTE':'PLA','PLA MARBLE':'PLA','PLA WOOD':'PLA','TPE':'TPU',
    'PETG PLUS':'PETG+','PA6':'PA','PA12':'PA','PA66':'PA'};
  return aliases[s]||s;
}
var _BASE_MATERIAL_TYPES=['PLA','PETG','ABS','ASA','TPU','TPE','PA','PC','HIPS','PEI','PEEK'];
function updateSlotEditFeedButton(){
  var btn=document.getElementById('btn-slot-edit-feed');
  if(!btn)return;
  if(_slotEditIndex<0){
    btn.style.display='none';
    return;
  }
  btn.style.display='';
  btn.textContent=_slotEditLoaded?tr('slot_edit_unload'):tr('slot_edit_load');
}
var _orcaFilamentCache=null;  // [{id,name,vendor,type,color}, …]
var _visibleVendors=null;     // Vendor-Sichtbarkeitsfilter (Issue #41); [] = alle
function _loadVisibleVendors(cb){
  if(_visibleVendors!==null){ cb(_visibleVendors); return; }
  fetch(_apiUrl('/kx/filament/visible_vendors')).then(function(r){return r.json();}).then(function(d){
    _visibleVendors=d.result||[];
    cb(_visibleVendors);
  }).catch(function(){ _visibleVendors=[]; cb([]); });
}
function _loadOrcaFilaments(cb){
  if(_orcaFilamentCache){ cb(_orcaFilamentCache); return; }
  fetch(_apiUrl('/kx/filament/profiles')).then(function(r){return r.json();}).then(function(d){
    _orcaFilamentCache=d.result||[];
    cb(_orcaFilamentCache);
  }).catch(function(){ cb([]); });
}
function _profileKey(vendor, name){
  // Eindeutiger Selector: (vendor, name). IDs aus orca_filaments.json sind
  // NICHT eindeutig (z.B. 136 Profile mit OGFL99). Wir kodieren beide in den
  // <option>-Value-String mit | als Trenner.
  return (vendor||'')+'|'+(name||'');
}
function _fillSlotProfileDropdown(material, currentVendor, currentName){
  var sel=document.getElementById('slot-edit-profile');
  if(!sel) return;
  var wantKey=_profileKey(currentVendor, currentName);
  _loadOrcaFilaments(function(profiles){
    // Type-Filter: nur Profile vom passenden material zeigen (z.B. PLA → alle PLA-Varianten)
    var matU=(material||'').toUpperCase().trim();
    // PLA-Varianten: Drucker meldet "PLA SILK"/"PLA+"/"PLA MATTE", OrcaSlicer
    // speichert alle unter type=PLA — Namens-Keyword als Zusatzfilter.
    var _PLA_VARIANT_KW={'PLA SILK':'silk','PLA+':'pla+','PLA MATTE':'matte',
      'PLA MARBLE':'marble','PLA WOOD':'wood'};
    var variantKw=_PLA_VARIANT_KW[matU]||null;
    var baseMat=variantKw?'PLA':matU;
    var matched=profiles.filter(function(p){
      var pt=(p.type||'').toUpperCase();
      var nameL=(p.name||'').toLowerCase();
      // Basis-Typ muss passen
      var typeOk=baseMat===''||pt===baseMat||pt.startsWith(baseMat+'-')||pt.startsWith(baseMat+' ');
      if(!typeOk) return false;
      // Bei Variante: Name muss Keyword enthalten (z.B. "silk", "matte", "pla+")
      if(variantKw) return nameL.indexOf(variantKw)!==-1;
      return true;
    });
    sel.innerHTML='<option value="">'+tr('slot_edit_profile_default')+'</option>';
    // User-Profile (is_user) zuerst — eigene Optgroup '★ Eigene' an erster Stelle.
    var userProfs=matched.filter(function(p){return p.is_user;});
    var systemProfs=matched.filter(function(p){return !p.is_user;});
    function _appendOption(g, p){
      var o=document.createElement('option');
      o.value=_profileKey(p.vendor, p.name);
      o.dataset.vendor=p.vendor;
      o.dataset.name=p.name;
      o.dataset.id=p.id || '';
      o.textContent=(p.is_user?'★ ':'')+p.name;
      if(o.value===wantKey) o.selected=true;
      g.appendChild(o);
    }
    if(userProfs.length){
      var gUser=document.createElement('optgroup');
      gUser.label='★ '+(tr('orca_profile_user_label')||'My profiles');
      userProfs.forEach(function(p){ _appendOption(gUser, p); });
      sel.appendChild(gUser);
    }
    // Vendor-Sichtbarkeitsfilter (Issue #41 Option A): nur gewählte Vendoren +
    // Generic. Leere Liste = alle (rückwärtskompatibel). Eigene Profile (is_user)
    // sind oben bereits unkonditional drin.
    _loadVisibleVendors(function(vis){
      var filtered=systemProfs;
      if(vis&&vis.length){
        var allow={};vis.forEach(function(v){allow[v]=1;});
        allow['Generic']=1;
        filtered=systemProfs.filter(function(p){return allow[p.vendor];});
      }
      var byVendor={};
      filtered.forEach(function(p){ (byVendor[p.vendor]=byVendor[p.vendor]||[]).push(p); });
      Object.keys(byVendor).sort().forEach(function(v){
        var g=document.createElement('optgroup'); g.label=v;
        byVendor[v].forEach(function(p){ _appendOption(g, p); });
        sel.appendChild(g);
      });
    });
  });
}
// ── Pickr color picker ──────────────────────────────────────────────────────
var _pickr=null;

function _initPickr(hex){
  // destroy previous instance if exists
  if(_pickr){ try{ _pickr.destroyAndRemove(); }catch(e){} _pickr=null; }
  var anchor=document.getElementById('slot-pickr-anchor');
  if(!anchor||typeof Pickr==='undefined') return;
  // fresh button element so Pickr can mount
  anchor.innerHTML='<div id="slot-pickr-btn"></div>';
  _pickr=Pickr.create({
    el:'#slot-pickr-btn',
    theme:'nano',
    default: hex||'#808080',
    inline: true,
    showAlways: true,
    components:{
      preview:true, opacity:false, hue:true,
      interaction:{ hex:true, rgba:false, input:true, save:false, clear:false }
    }
  });
  _pickr.on('change',function(color){
    var h=color.toHEXA().toString().slice(0,7);
    document.getElementById('slot-edit-color').value=h;
    document.getElementById('slot-edit-preview').style.background=h;
  });
  // Theme anpassen: Pickr benutzt eigene CSS-Variablen, wir überschreiben via style
  requestAnimationFrame(function(){
    var el=anchor.querySelector('.pickr');
    if(el) el.style.cssText='width:100%';
    var app=anchor.querySelector('.pcr-app');
    if(app){
      app.style.cssText='position:relative;width:100%;box-shadow:none;background:transparent';
      var btn=app.querySelector('.pcr-result');
      if(btn) btn.style.cssText='background:var(--raised);border:1px solid var(--border);color:var(--txt);border-radius:6px;font-size:12px';
    }
  });
}

// ── Color swatches (localStorage, max 16) ──────────────────────────────────
var _SWATCH_KEY='kxb_color_swatches';
var _SWATCH_MAX=16;

function _loadSwatches(){
  try{ return JSON.parse(localStorage.getItem(_SWATCH_KEY)||'[]'); }catch(e){ return []; }
}
function _saveSwatches(arr){ try{ localStorage.setItem(_SWATCH_KEY, JSON.stringify(arr)); }catch(e){} }

function _addSwatch(hex){
  var arr=_loadSwatches().filter(function(c){ return c.toLowerCase()!==hex.toLowerCase(); });
  arr.unshift(hex);
  if(arr.length>_SWATCH_MAX) arr=arr.slice(0,_SWATCH_MAX);
  _saveSwatches(arr);
}

function _renderSwatches(){
  var el=document.getElementById('slot-color-swatches');
  if(!el) return;
  var arr=_loadSwatches();
  if(!arr.length){ el.style.display='none'; return; }
  el.style.display='flex';
  el.innerHTML=arr.map(function(c){
    return '<div title="'+c+'" onclick="slotPickSwatch(\''+c+'\')" style="width:22px;height:22px;border-radius:4px;background:'+c+
      ';border:2px solid rgba(255,255,255,.2);cursor:pointer;flex-shrink:0"></div>';
  }).join('');
}

function slotPickSwatch(hex){
  if(_pickr){ _pickr.setColor(hex); }
  var ci=document.getElementById('slot-edit-color');
  if(ci) ci.value=hex;
  document.getElementById('slot-edit-preview').style.background=hex;
}

// ── Copy color from other slot ──────────────────────────────────────────────
function _renderCopyFromSlot(currentGlobalIdx){
  var slots=(window._amsSlots||[]).filter(function(s){
    return s.global_index!==currentGlobalIdx && s.status==5 && Array.isArray(s.color);
  });
  var row=document.getElementById('slot-copy-row');
  var sel=document.getElementById('slot-copy-select');
  if(!row||!sel) return;
  if(!slots.length){ row.style.display='none'; return; }
  row.style.display='';
  var ph=document.getElementById('lbl-slot-copy-from');
  var phTxt=ph?ph.textContent:(T.slot_copy_from||'Copy color from slot…');
  sel.innerHTML='<option value="">'+phTxt+'</option>'+slots.map(function(s){
    var rgb=s.color;
    var hex='#'+rgb.map(function(v){return('0'+Math.min(255,v).toString(16)).slice(-2)}).join('');
    return '<option value="'+hex+'">Slot '+(s.global_index+1)+' — '+_kxEsc(s.type||'?')+' '+hex+'</option>';
  }).join('');
}

function slotCopyColor(sel){
  if(!sel.value) return;
  var ci=document.getElementById('slot-edit-color');
  if(!ci) return;
  ci.value=sel.value;
  document.getElementById('slot-edit-preview').style.background=sel.value;
  sel.selectedIndex=0;
}

// ───────────────────────────────────────────────────────────────────────────

function openSlotEdit(i){
  var slot=(window._amsSlots||[])[i]||{};
  var globalIdx=slot.global_index!=null?slot.global_index:(slot.index!=null?slot.index:i);
  _slotEditIndex=globalIdx;
  _slotEditLoaded=(S.ams_loaded_slot!=null&&S.ams_loaded_slot===globalIdx);
  document.getElementById('slot-edit-title').textContent=T.slot_edit_title+' '+(globalIdx+1);
  var rgb=Array.isArray(slot.color)?slot.color:[128,128,128];
  var hex='#'+rgb.map(function(v){return('0'+Math.min(255,v).toString(16)).slice(-2)}).join('');
  var ci=document.getElementById('slot-edit-color');
  ci.value=hex;
  document.getElementById('slot-edit-preview').style.background=hex;
  _initPickr(hex);
  _renderSwatches();
  _renderCopyFromSlot(globalIdx);
  var mat=(slot.type||'PLA').toUpperCase();
  document.getElementById('slot-edit-mat').value=mat;
  // Normalisieren für Button-Highlighting: PLA-Varianten auf nächsten Preset mappen
  var matNorm=_normalizeMat(mat);
  var btns=document.getElementById('slot-mat-btns');
  btns.innerHTML=_MAT_PRESETS.map(function(m){
    var active=m===mat||m===matNorm;
    return '<button class="mat-preset-btn" data-mat="'+m+'" onclick="selectMatPreset(\''+m+'\')" '
      +'style="padding:4px 10px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:12px;'
      +(active?'background:var(--accent);color:#fff':'background:var(--raised);color:var(--txt2)')+'">'+m+'</button>';
  }).join('');
  // OrcaSlicer-Profil-Dropdown: aktuellen User-Override für diesen Slot
  // aus /kx/filament/slots holen (enthält vendor+name+id).
  fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();}).then(function(d){
    var arr=d.result||[];
    var entry=arr.find(function(x){return x.slot_index===globalIdx;})||{};
    window._slotProfileMap=window._slotProfileMap||{};
    window._slotProfileMap[globalIdx]={
      id:    entry.filament_id||'',
      vendor:entry.filament_vendor||'',
      name:  entry.filament_name||'',
    };
    _fillSlotProfileDropdown(mat, entry.filament_vendor||'', entry.filament_name||'');
  }).catch(function(){ _fillSlotProfileDropdown(mat,'',''); });
  updateSlotEditFeedButton();
  document.getElementById('slot-edit-modal').classList.add('open');
}
function closeSlotEdit(){
  _slotEditIndex=-1;
  document.getElementById('slot-edit-modal').classList.remove('open');
}
function slotEditFeed(){
  if(_slotEditIndex<0)return;
  var type=_slotEditLoaded?2:1;
  amsFeed(type,_slotEditIndex)
    .then(function(){
      _slotEditLoaded=!_slotEditLoaded;
      updateSlotEditFeedButton();
      poll();
    })
    .catch(function(){});
}
function startReadyFile(filename){
  var fn=filename||S.file_ready;
  function _doStartReadyFile(){
    var btn=document.getElementById('file-ready-btn');
    if(btn){btn.disabled=true;btn.textContent='…';}
    post('/printer/print/start',{filename:fn})
      .then(function(r){return r.json();})
      .then(function(){
        document.getElementById('file-ready-banner').style.display='none';
        if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
      })
      .catch(function(e){
        clog(tr('log_error')+' '+e,'msg-err');
        if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
      });
  }
  function _gateAndStart(fileObj){
    if(fileObj && fileObj.web_unverified && webUploadWarningEnabled()){
      maybeGateWebUpload(fileObj, function(){ startReadyFile(fn); });
      return;
    }
    _doStartReadyFile();
  }
  var currentFile=(storeFiles||[]).find(function(f){return f.filename===fn;});
  if(currentFile){
    _gateAndStart(currentFile);
    return;
  }
  fetch(_apiUrl('/kx/files')).then(function(r){return r.json();}).then(function(d){
    storeFiles=d.result||[];
    var refreshed=(storeFiles||[]).find(function(f){return f.filename===fn;})||null;
    _gateAndStart(refreshed);
  }).catch(function(){
    _doStartReadyFile();
  });
}
function cancelReadyFile(){
  post('/api/file_ready/clear',{})
    .then(function(){document.getElementById('file-ready-banner').style.display='none';});
}

// ── Aktionen für geladene/idle Datei in der Progress-Karte (Issue #55) ──
function startIdleFile(){
  if(_lastLoadedFile) startReadyFile(_lastLoadedFile);
}
function startIdleFileWithSlots(){
  if(_lastLoadedFile) startReadyFileWithSlots(_lastLoadedFile);
}
function clearIdleFile(){
  _lastLoadedFile=null;
  _idleCleared=true;  // verhindert Nachladen von s.filename im nächsten poll() (Issue #57)
  _fdAutoOpenedFile=null;  // nächster Upload derselben Datei soll Dialog wieder öffnen
  _fdUserCancelled=false;
  _fdDialogOpen=false;
  sessionStorage.removeItem('fdAutoOpenedFile');
  sessionStorage.removeItem('fdUserCancelled');
  sessionStorage.removeItem('webVerifyCancelledFileId');
  S.file_ready=''; S.filename=''; S.thumbnail='';  // sofort lokal leeren, kein Warten auf nächsten Poll
  var ib=document.getElementById('d-idle-btns');if(ib)ib.style.display='none';
  var fn=document.getElementById('d-fname');if(fn){fn.textContent='–';fn.title='';}
  var thumb=document.getElementById('d-thumbnail');if(thumb){thumb.style.display='none';thumb.src='';}
  post('/api/file_ready/clear',{}).catch(function(){});
}
function selectMatPreset(m){
  document.getElementById('slot-edit-mat').value=m;
  highlightMatBtn(m);
  // Filament-Profile-Dropdown an neues Material anpassen
  // (vorherige Selektion zurücksetzen — andere Material-Profile passen nicht)
  _fillSlotProfileDropdown(m, '', '');
}
function highlightMatBtn(val){
  document.querySelectorAll('.mat-preset-btn').forEach(function(b){
    var on=b.getAttribute('data-mat')===val.toUpperCase();
    b.style.background=on?'var(--accent)':'var(--raised)';
    b.style.color=on?'#fff':'var(--txt2)';
  });
  // Auch bei manueller Eingabe ins Material-Textfeld: Dropdown refreshen.
  if(val) _fillSlotProfileDropdown(val, '', '');
}
function hexToRgb(hex){
  var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return[r,g,b];
}
function saveSlotEdit(){
  var hex=document.getElementById('slot-edit-color').value;
  _addSwatch(hex);
  var mat=document.getElementById('slot-edit-mat').value.trim().toUpperCase()||'PLA';
  var color=hexToRgb(hex);
  var slotIdx=_slotEditIndex;
  var profSel=document.getElementById('slot-edit-profile');
  var sel=profSel && profSel.selectedOptions && profSel.selectedOptions[0];
  // Primärer Selector: (vendor, name). id ist nur Hint (aus dem JSON-data-attr
  // mitgegeben — Backend lookt sie nochmal selber nach um veraltete Hints zu
  // korrigieren).
  var newProfVendor=sel?(sel.dataset.vendor||''):'';
  var newProfName  =sel?(sel.dataset.name  ||''):'';
  var newProfId    =sel?(sel.dataset.id    ||''):'';
  // Sequenziell speichern: erst Profil-Override (config.ini), dann Material/Farbe
  // (MQTT zum Drucker). Sonst können beide Pfade sich überholen und der Slot-State
  // ist beim nächsten Re-Open inkonsistent.
  fetch(_apiUrl('/kx/filament/slots/'+slotIdx+'/profile'),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({vendor:newProfVendor, name:newProfName, id:newProfId})
  })
  .then(function(r){return r.json();})
  .then(function(){
    window._slotProfileMap=window._slotProfileMap||{};
    if(newProfVendor && newProfName){
      window._slotProfileMap[slotIdx]={id:newProfId, vendor:newProfVendor, name:newProfName};
    } else {
      delete window._slotProfileMap[slotIdx];
    }
    return post('/api/ams/set_slot',{index:slotIdx,type:mat,color:color});
  })
  .then(function(r){return r?r.json():null;})
  .then(function(){
    // Slot-Map refreshen damit die Karte sofort den Vendor zeigt.
    return fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();});
  })
  .then(function(d){
    var arr=(d && d.result)||[];
    window._slotProfileMap={};
    arr.forEach(function(e){
      if(e.filament_vendor && e.filament_name){
        window._slotProfileMap[e.slot_index]={
          id:    e.filament_id||'',
          vendor:e.filament_vendor,
          name:  e.filament_name,
        };
      }
    });
    closeSlotEdit();
    var profSuffix=newProfName?(' ['+newProfVendor+' '+newProfName+']'):'';
    clog(tr('slot_edit_ok')+' '+(slotIdx+1)+': '+mat+' '+hex+profSuffix,'msg-ok');
    // Sofortiges Re-Render mit aktuellem _slotProfileMap (poll() ist async
    // und re-rendert beim nächsten Tick — wir wollen aber dass die Vendor-
    // Badge JETZT direkt sichtbar wird).
    if(typeof applyState==='function') applyState();
    if(typeof poll==='function') poll();
  })
  .catch(function(e){clog('Error: '+e,'msg-err');});
}
document.addEventListener('DOMContentLoaded',function(){
  document.getElementById('s-printer-ip').addEventListener('input',function(){
    var hint=document.getElementById('lbl-ip-hint');
    if(this.value.includes(':')){hint.textContent=T.hint_ip_no_port;hint.style.display='block';}
    else{hint.style.display='none';}
  });
});
function setPoll(ms){
  ms=Math.max(10000,parseInt(ms,10)||10000);
  localStorage.setItem('pollInterval',ms);
  clearInterval(pollTimer);
  pollTimer=setInterval(poll,ms);
}
function saveSettings(){
  var btn=document.getElementById('btn-save-settings');
  btn.disabled=true;btn.textContent='…';
  var webUploadWarning=(document.getElementById('s-web-upload-warning')||{}).checked?1:0;
  S.web_upload_warning=webUploadWarning;
  // Start-Print-Behavior-Wechsel könnte den Auto-Open sonst dauerhaft blockieren
  // (alter _fdUserCancelled bei gleicher file_ready) → Dialog-State zurücksetzen (Issue #57).
  _fdUserCancelled=false;_fdAutoOpenedFile=null;
  sessionStorage.removeItem('fdUserCancelled');sessionStorage.removeItem('fdAutoOpenedFile');
  sessionStorage.removeItem('webVerifyCancelledFileId');
  post('/api/settings',{
    printer_name:     document.getElementById('s-printer-name').value,
    printer_ip:       document.getElementById('s-printer-ip').value,
    mqtt_port:        parseInt(document.getElementById('s-mqtt-port').value)||9883,
    username:         document.getElementById('s-username').value,
    password:         document.getElementById('s-password').value,
    device_id:        document.getElementById('s-device-id').value,
    mode_id:          document.getElementById('s-mode-id').value,
    default_ams_slot: document.getElementById('s-default-slot').value,
    auto_leveling:           document.getElementById('s-auto-leveling').checked?1:0,
    vibration_compensation:  (document.getElementById('s-vibration-compensation')||{}).checked?1:0,
    camera_on_print:         (document.getElementById('s-camera-on-print')||{}).checked?1:0,
    print_start_dialog: parseInt((document.getElementById('s-file-ready-mode')||{}).value||'1',10),
    web_upload_warning:webUploadWarning,
    poll_interval:    Math.min(60,Math.max(1,parseInt((document.getElementById('s-poll-interval')||{}).value,10)||3)),
    verbose_http_log: (document.getElementById('s-verbose-http-log')||{}).checked?1:0,
    spoolman_server:  (document.getElementById('s-spoolman-url')||{}).value||'',
    spoolman_sync_rate: Math.max(0,parseInt((document.getElementById('s-spoolman-sync-rate')||{}).value||'30',10)),
  }).then(function(){
    btn.textContent=T.update_restarting;
    setTimeout(function(){
      btn.disabled=false;
      setText('btn-save-settings',T.settings_save);
      closeSettings();
      _loadSpoolmanStatus();
      poll();
    },4000);
  }).catch(function(e){
    btn.disabled=false;setText('btn-save-settings',T.settings_save);
    clog('Settings error: '+e,'msg-err');
  });
}
var _updateDockerOnly=false;
function checkUpdate(){
  var sb=document.getElementById('update-status');
  sb.textContent=T.update_checking;
  document.getElementById('btn-update-apply').style.display='none';
  _updateTag='';_updateUrl='';_updateDockerOnly=false;
  fetch(_apiUrl('/api/update/check')).then(function(r){return r.json()}).then(function(d){
    if(d.error){sb.textContent=T.update_error+': '+d.error;return;}
    var cl=document.getElementById('update-changelog');
    if(d.changelog&&d.changelog.trim()){
      // Changelog als Markdown-Text (pre-formatiert) anzeigen
      cl.textContent=d.changelog;cl.style.display='block';
    } else {cl.style.display='none';}
    _updateDockerOnly=!!d.docker_only;
    if(d.update_available){
      sb.textContent=d.latest+' '+T.update_available;
      sb.style.color='var(--ok)';
      _updateTag=d.tag;_updateUrl=d.download_url||'';
      var btn=document.getElementById('btn-update-apply');
      if(_updateDockerOnly){
        btn.textContent=T.update_docker||'docker compose pull';
        btn.title='docker compose pull && docker compose up -d';
      } else {
        btn.textContent=T.update_apply;
        btn.title='';
      }
      btn.style.display='inline-block';
    } else {
      sb.textContent=T.update_none;
      sb.style.color='var(--txt2)';
    }
  }).catch(function(e){sb.textContent=T.update_error+': '+e;});
}
function applyUpdate(){
  var sb=document.getElementById('update-status');
  var btn=document.getElementById('btn-update-apply');
  if(_updateDockerOnly){
    // Nightly: kein Self-Update, Docker-Befehl in Zwischenablage kopieren
    var cmd='docker compose pull && docker compose up -d';
    if(navigator.clipboard){
      navigator.clipboard.writeText(cmd).then(function(){
        sb.textContent=T.update_docker_copied||'Command copied: '+cmd;
      });
    } else {
      sb.textContent=cmd;
    }
    return;
  }
  if(!_updateUrl)return;
  btn.disabled=true;sb.textContent=T.update_applying;
  post('/api/update/apply',{download_url:_updateUrl,tag:_updateTag}).then(function(){
    sb.textContent=T.update_restarting;
    closeSettings();
    setTimeout(function(){poll();},5000);
  }).catch(function(e){
    btn.disabled=false;sb.textContent=T.update_error+': '+e;
  });
}

// ── Poll ──
var _pollGeneration=0;
async function poll(){
  var generation=++_pollGeneration;
  var printerId=_activePrinter?String(_activePrinter.id):'';
  try{
    var r=await fetch(_apiUrl('/api/state'));
    if(!r.ok)return;
    var d=await r.json();
    // setInterval and action callbacks can overlap. A slower old response must
    // never roll progress, temperatures or button state backward after a newer
    // poll (or after an in-page same-origin printer selection).
    if(generation!==_pollGeneration)return;
    if(printerId!==(_activePrinter?String(_activePrinter.id):''))return;
    Object.assign(S,d);
    applyState();
    updateHistory();
    kxAutoCloseTick();
  }catch(e){clog(T.log_poll_error+' '+e,'msg-err')}
}
var pollTimer;
(function(){
  // Default 10s to match the bridge's own poll_interval. A stored value is
  // honoured but never allowed below 10s: faster UI polling multiplies the
  // /api/state load and, on the Kobra X, printer-host wakeups.
  var ms=Math.max(10000,parseInt(localStorage.getItem('pollInterval')||'10000')||10000);
  // Poll only after the active printer is resolved, so the very first
  // /api/state and slot fetch already carry the right bridge_url.
  initPrinters().then(function(){
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json();}).then(function(d){
      var arr=(d && d.result)||[];
      window._slotProfileMap={};
      arr.forEach(function(e){
        if(e.filament_vendor && e.filament_name){
          window._slotProfileMap[e.slot_index]={
            id:    e.filament_id||'',
            vendor:e.filament_vendor,
            name:  e.filament_name,
          };
        }
      });
    }).catch(function(){});
    poll();
    pollTimer=setInterval(poll,ms);
    // refreshFarmState() self-schedules (1s during transfers, 5s idle).
    refreshFarmState();
  });
  // Dedicated 2s ticker: the state poll is 10s, so relying on it alone would
  // make the "close after 10s idle" rule fire up to a poll late.
  setInterval(kxAutoCloseTick,2000);
  setInterval(_loadSpoolmanStatus,30000);
  // initDashGrid() is called at the very end of the file, after all the
  // DASH_* var declarations below have executed (they are hoisted but not yet
  // assigned at this point in the IIFE).
})();

// ── Dashboard Free Grid (Issue #89) ────────────────────────────────────────
// User-customizable dashboard powered by GridStack (v10, docs: gridstack.js).
// Cards move + resize on a 12-column snap grid; layout persisted per browser
// in localStorage. Built on documented APIs only:
//   - float:false (default)  -> compact packing, no holes between cards
//   - staticGrid:true        -> locked by default, setStatic(false) in edit mode
//   - grid.save(false)/load(layout,false) -> serialize/restore by gs-id
//   - draggable.cancel       -> inputs/buttons/img excluded from drag start
//   - columnOpts.breakpoints -> 1-column below 700px GRID width (sidebar-aware)
var DASH_STORAGE_KEY='dashLayout';
var DASH_LAYOUT_VERSION=4;   // v1/v2 = older editors; v3 = camera-above-controls
                             // (put Stop below the fold), so discard those too.
var DASH_CARD_KEYS=['camera','progress','temps','motion','speed','fan','ams'];
// Layout arrays in GridStack save()/load() format. cellHeight=60px.
// Progress goes FIRST: it carries Pause/Objects/Stop. With the camera on top
// (its old y:0, h:7 = 420px) the progress card started at y=527 on a 1280x720
// screen, so the stop button rendered at y=896 - below the fold, mid-print.
// Observe-then-act still reads correctly: status and controls, then the camera.
var DASH_DEFAULT_LAYOUT=[
  {id:'progress',x:0,y:0, w:12,h:6},
  {id:'camera',  x:0,y:6, w:12,h:7},
  {id:'temps',   x:0,y:13,w:6, h:7},
  {id:'motion',  x:6,y:13,w:6, h:7},
  {id:'speed',   x:0,y:20,w:6, h:3},
  {id:'fan',     x:6,y:20,w:6, h:3},
  {id:'ams',     x:0,y:23,w:12,h:4},
];
// "Wide desktop" preset (Blaim, Issue #89): big camera left, settings center,
// motion right.
var DASH_PRESET_WIDE=[
  {id:'progress',x:0, y:0, w:12,h:4},
  {id:'camera',  x:0, y:4, w:6, h:11},
  {id:'temps',   x:6, y:4, w:3, h:7},
  {id:'speed',   x:6, y:11,w:3, h:2},
  {id:'fan',     x:6, y:13,w:3, h:2},
  {id:'motion',  x:9, y:4, w:3, h:11},
  {id:'ams',     x:0, y:15,w:12,h:4},
];
var _dashGrid=null;
var _dashEditing=false;
var _dashHidden=[];   // [{id,x,y,w,h}] cards currently hidden (position kept for re-show)

// GridStack requires .grid-stack-item > .grid-stack-item-content around each
// card — wrap the existing .card elements in place (IDs/event handlers survive,
// appendChild moves nodes without recreating them).
function _dashWrapCards(){
  var grid=document.getElementById('dash-grid');
  if(!grid)return;
  DASH_CARD_KEYS.forEach(function(key){
    var card=grid.querySelector('[data-card="'+key+'"]');
    if(!card||card.parentNode.classList.contains('grid-stack-item-content'))return;
    var item=document.createElement('div');
    item.className='grid-stack-item';
    item.setAttribute('gs-id',key);
    var content=document.createElement('div');
    content.className='grid-stack-item-content';
    grid.insertBefore(item,card);
    item.appendChild(content);
    content.appendChild(card);
  });
}

function _dashItem(key){
  return document.querySelector('#dash-grid .grid-stack-item[gs-id="'+key+'"]');
}

function _dashLoadState(){
  try{
    var raw=localStorage.getItem(DASH_STORAGE_KEY);
    if(!raw)return null;
    var s=JSON.parse(raw);
    if(!s||s.version!==DASH_LAYOUT_VERSION||!Array.isArray(s.layout))return null;
    return s;
  }catch(e){return null;}
}
function _dashSaveState(){
  if(!_dashGrid)return;
  localStorage.setItem(DASH_STORAGE_KEY,JSON.stringify({
    version:DASH_LAYOUT_VERSION,
    layout:_dashGrid.save(false),   // [{id,x,y,w,h},…] — visible widgets only
    hidden:_dashHidden.slice(),
  }));
}

function initDashGrid(){
  var el=document.getElementById('dash-grid');
  if(!el||typeof GridStack==='undefined')return;
  _dashWrapCards();
  _dashGrid=GridStack.init({
    cellHeight:60,
    margin:8,
    staticGrid:true,   // locked by default; setStatic(false) enables drag+resize
    columnOpts:{breakpoints:[{w:700,c:1}]},  // grid-width based (sidebar-aware)
    draggable:{cancel:'input,textarea,button,select,option,img,.slider'},
  },el);
  var state=_dashLoadState();
  if(state){
    _dashHidden=Array.isArray(state.hidden)?state.hidden:[];
    _dashGrid.load(state.layout,false);       // update matching ids, no add/remove
    _dashHidden.forEach(function(n){
      var item=_dashItem(n.id);
      if(item){_dashGrid.removeWidget(item,false);item.style.display='none';}
    });
  }else{
    _dashGrid.load(DASH_DEFAULT_LAYOUT,false);
  }
  _dashGrid.on('change',function(){if(_dashEditing)_dashSaveState();});
  _dashRefreshPresetDropdown();
}

function toggleDashEdit(){
  if(!_dashGrid)return;
  _dashEditing=!_dashEditing;
  _dashGrid.setStatic(!_dashEditing);
  document.getElementById('dash-grid').classList.toggle('editing',_dashEditing);
  document.getElementById('dash-lbl-edit').textContent=_dashEditing?(T.dash_done||'Done'):(T.dash_edit||'Customize dashboard');
  document.getElementById('dash-reset-btn').style.display=_dashEditing?'':'none';
  document.getElementById('dash-preset').style.display=_dashEditing?'':'none';
  document.getElementById('dash-preset-save-btn').style.display=_dashEditing?'':'none';
  _dashUpdatePresetDeleteBtn();
  if(_dashEditing)_dashInjectControls(); else _dashRemoveControls();
  _dashRenderHiddenBar();
  if(!_dashEditing)_dashSaveState();
}

// ── Custom presets (user-saved layouts) ────────────────────────────────────
var DASH_CUSTOM_PRESETS_KEY='dashCustomPresets';
var DASH_BUILTIN_PRESET_IDS=['standard','wide89'];

function _dashLoadCustomPresets(){
  try{
    var raw=localStorage.getItem(DASH_CUSTOM_PRESETS_KEY);
    var obj=raw?JSON.parse(raw):{};
    return (obj&&typeof obj==='object')?obj:{};
  }catch(e){return {};}
}
function _dashSaveCustomPresets(presets){
  localStorage.setItem(DASH_CUSTOM_PRESETS_KEY,JSON.stringify(presets));
}

function _dashRefreshPresetDropdown(){
  var sel=document.getElementById('dash-preset');
  if(!sel)return;
  var current=sel.value;
  var customs=_dashLoadCustomPresets();
  // Remove previously-rendered custom <option>s, keep the two built-ins.
  Array.prototype.slice.call(sel.querySelectorAll('option')).forEach(function(o){
    if(DASH_BUILTIN_PRESET_IDS.indexOf(o.value)===-1)sel.removeChild(o);
  });
  Object.keys(customs).sort().forEach(function(name){
    var opt=document.createElement('option');
    opt.value='custom:'+name;
    opt.textContent=name;
    sel.appendChild(opt);
  });
  if(Array.prototype.some.call(sel.options,function(o){return o.value===current;}))sel.value=current;
  _dashUpdatePresetDeleteBtn();
}

function _dashUpdatePresetDeleteBtn(){
  var sel=document.getElementById('dash-preset');
  var delBtn=document.getElementById('dash-preset-delete-btn');
  if(!sel||!delBtn)return;
  var isCustom=sel.value.indexOf('custom:')===0;
  delBtn.style.display=(_dashEditing&&isCustom)?'':'none';
}

function saveCurrentAsDashPreset(){
  if(!_dashGrid)return;
  var name=(prompt(T.dash_preset_name_prompt||'Preset name:')||'').trim();
  if(!name)return;
  var customs=_dashLoadCustomPresets();
  customs[name]=_dashGrid.save(false);
  _dashSaveCustomPresets(customs);
  _dashRefreshPresetDropdown();
  var sel=document.getElementById('dash-preset');
  if(sel)sel.value='custom:'+name;
  _dashUpdatePresetDeleteBtn();
}

function deleteCurrentDashPreset(){
  var sel=document.getElementById('dash-preset');
  if(!sel||sel.value.indexOf('custom:')!==0)return;
  var name=sel.value.slice(7);
  if(!confirm((T.dash_preset_delete_confirm||'Delete preset "{name}"?').replace('{name}',name)))return;
  var customs=_dashLoadCustomPresets();
  delete customs[name];
  _dashSaveCustomPresets(customs);
  sel.value='standard';
  _dashRefreshPresetDropdown();
  resetDashLayout();
}

function _dashInjectControls(){
  DASH_CARD_KEYS.forEach(function(key){
    if(_dashHidden.some(function(n){return n.id===key;}))return;
    var content=document.querySelector('#dash-grid .grid-stack-item[gs-id="'+key+'"] .grid-stack-item-content');
    if(!content||content.querySelector('.dash-card-controls'))return;
    var ctrl=document.createElement('div');
    ctrl.className='dash-card-controls';
    var hideBtn=document.createElement('button');
    hideBtn.className='dash-card-ctrl-btn';
    hideBtn.title=T.dash_hide||'Hide';
    hideBtn.textContent='👁';
    hideBtn.addEventListener('click',function(e){e.stopPropagation();dashHideCard(key);});
    ctrl.appendChild(hideBtn);
    content.appendChild(ctrl);
  });
}
function _dashRemoveControls(){
  var nodes=document.querySelectorAll('#dash-grid .dash-card-controls');
  Array.prototype.forEach.call(nodes,function(n){n.parentNode&&n.parentNode.removeChild(n);});
}

function _dashCardLabel(key){
  var card=document.querySelector('[data-card="'+key+'"]');
  if(!card)return key;
  var t=card.querySelector('.card-title');
  return t?t.textContent.trim():key;
}

function _dashRenderHiddenBar(){
  var bar=document.getElementById('dash-hidden-bar');
  if(!bar)return;
  bar.innerHTML='';
  if(!_dashEditing||!_dashHidden.length){bar.classList.remove('show');return;}
  bar.classList.add('show');
  var label=document.createElement('span');
  label.textContent=(T.dash_hidden_cards||'Hidden cards')+': ';
  bar.appendChild(label);
  _dashHidden.forEach(function(n){
    var chip=document.createElement('span');
    chip.className='dash-hidden-chip';
    chip.appendChild(document.createTextNode(_dashCardLabel(n.id)+' '));
    var btn=document.createElement('button');
    btn.textContent='👁';
    btn.title=T.dash_show||'Show';
    btn.addEventListener('click',function(){dashShowCard(n.id);});
    chip.appendChild(btn);
    bar.appendChild(chip);
  });
}

function dashHideCard(key){
  if(_dashHidden.some(function(n){return n.id===key;}))return;
  var item=_dashItem(key);
  if(!item||!_dashGrid)return;
  // Remember position/size so re-show can restore it.
  var n=item.gridstackNode||{};
  _dashHidden.push({id:key,x:n.x,y:n.y,w:n.w,h:n.h});
  _dashGrid.removeWidget(item,false);   // keep DOM element, drop the widget
  item.style.display='none';
  _dashSaveState();
  _dashRenderHiddenBar();
}
function dashShowCard(key){
  var entry=null;
  _dashHidden=_dashHidden.filter(function(n){if(n.id===key){entry=n;return false;}return true;});
  var item=_dashItem(key);
  if(item&&_dashGrid){
    item.style.display='';
    _dashGrid.makeWidget(item);
    if(entry&&entry.w)_dashGrid.update(item,{x:entry.x,y:entry.y,w:entry.w,h:entry.h});
    if(_dashEditing)_dashInjectControls();
  }
  _dashSaveState();
  _dashRenderHiddenBar();
}

function _dashShowAllHidden(){
  _dashHidden.slice().forEach(function(n){dashShowCard(n.id);});
  _dashHidden=[];
}

function resetDashLayout(){
  if(!_dashGrid)return;
  localStorage.removeItem(DASH_STORAGE_KEY);
  var sel=document.getElementById('dash-preset');if(sel)sel.value='standard';
  _dashShowAllHidden();
  _dashGrid.load(DASH_DEFAULT_LAYOUT,false);
  if(_dashEditing){_dashInjectControls();_dashSaveState();}
  _dashRenderHiddenBar();
}
function applyDashPreset(name){
  if(name==='standard'){resetDashLayout();return;}
  if(!_dashGrid)return;
  var layout=null;
  if(name==='wide89'){
    layout=DASH_PRESET_WIDE;
  }else if(name.indexOf('custom:')===0){
    var customs=_dashLoadCustomPresets();
    layout=customs[name.slice(7)];
  }
  if(!layout)return;
  var sel=document.getElementById('dash-preset');
  if(sel)sel.value=name;   // keep the dropdown in sync even when called directly
  _dashShowAllHidden();
  _dashGrid.load(layout,false);
  _dashUpdatePresetDeleteBtn();
  if(_dashEditing)_dashInjectControls();
  _dashSaveState();
  _dashRenderHiddenBar();
}

// Init now — all DASH_* declarations above have run, and app.js loads at
// </body>, so the DOM is ready.
initDashGrid();
// ── Print actions ──
function printAction(a){
  post('/printer/print/'+a,{}).then(function(){clog('Print: '+a,'msg-ok');poll()})
    .catch(function(e){clog('Error: '+e,'msg-err')});
}
function togglePauseResume(){
  // Druckt → pause; Pausiert → resume. Status kommt aus dem zuletzt gepollten
  // print_state in S; bei Unklarheit (kein State) Pause als Default.
  var state=(S && S.print_state)||'';
  if(state==='paused') printAction('resume');
  else                 printAction('pause');
}
function updatePauseResumeBtn(){
  var btn=document.getElementById('d-btn-pause');
  if(!btn) return;
  var state=(S && S.print_state)||'';
  if(state==='paused'){
    btn.textContent=T.btn_resume||'Resume';
    btn.classList.add('btn-resume');
    btn.classList.remove('btn-pause');
  } else {
    btn.textContent=T.btn_pause||'Pause';
    btn.classList.add('btn-pause');
    btn.classList.remove('btn-resume');
  }
}
function confirmCancel(){if(confirm(T.confirm_cancel||'Really cancel the print?'))printAction('cancel')}

// ── Axis motion ──
// axis codes: 0=X, 1=Y, 2=Z
// move_type 1=relative, distance positive/negative
function getStep(){return currentStep}
function setStep(btn,v){
  currentStep=v;
  document.querySelectorAll('.step-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  var ci=document.getElementById('step-custom');
  if(ci)ci.value='';
}
function setStepCustom(inp){
  var v=parseFloat(inp.value);
  if(!isNaN(v)&&v>0){
    currentStep=v;
    document.querySelectorAll('.step-btn').forEach(b=>b.classList.remove('active'));
  }
}
function move(axis,dir,dist){
  // axis: 0=X,1=Y,2=Z → printer axis codes: 1=X,2=Y,3=Z
  var axisMap={0:1,1:2,2:3};
  post('/api/axis',{axis:axisMap[axis],move_type:1,distance:dir*dist})
    .then(function(){clog('Axis '+(axis===0?'X':axis===1?'Y':'Z')+' '+(dir>0?'+':'')+dir*dist+'mm','msg-ok')})
    .catch(function(e){clog('Axis error: '+e,'msg-err')});
}
function homeAll(){
  post('/api/axis',{axis:5,move_type:2,distance:0})
    .then(function(){clog('Home All','msg-ok')})
    .catch(function(e){clog('Home error: '+e,'msg-err')});
}
function homeXY(){
  post('/api/axis',{axis:4,move_type:2,distance:0})
    .then(function(){clog('Home XY','msg-ok')})
    .catch(function(e){clog('Home error: '+e,'msg-err')});
}
function homeZ(){
  post('/api/axis',{axis:3,move_type:2,distance:0})
    .then(function(){clog('Home Z','msg-ok')})
    .catch(function(e){clog('Home error: '+e,'msg-err')});
}
function disableMotors(){
  post('/api/axis',{action:'turnOff'})
    .then(function(){clog('Motors Off','msg-ok')})
    .catch(function(e){clog('Motors error: '+e,'msg-err')});
}

// ── Temperature ──
function setNozzle(){
  var v=parseFloat(document.getElementById('p-nozzle-inp').value||0);
  post('/api/temperature',{nozzle:v,bed:S.bed_target})
    .then(function(){clog('Nozzle → '+v+'°C','msg-ok')})
    .catch(function(e){clog('Temperature error: '+e,'msg-err')});
}
function setBed(){
  var v=parseFloat(document.getElementById('p-bed-inp').value||0);
  post('/api/temperature',{nozzle:S.nozzle_target,bed:v})
    .then(function(){clog(T.label_bed+' → '+v+'°C','msg-ok')})
    .catch(function(e){clog('Temperature error: '+e,'msg-err')});
}

// ── Light ──
function setLight(){
  var on=document.getElementById('d-light-toggle').checked;
  post('/api/light',{on:on,brightness:80})
    .then(function(){clog('Light '+(on?'on, 80%':'off'),'msg-ok')})

    .catch(function(e){clog('Light error: '+e,'msg-err')});
}

// ── Print Speed ──
function setSpeed(mode){
  S.print_speed_mode=mode;
  [1,2,3].forEach(function(m){
    var b=document.getElementById('d-spd-'+m);
    if(b) b.classList.toggle('spd-active',m===mode);
  });
  post('/api/speed',{mode:mode})
    .catch(function(e){clog('Speed error: '+e,'msg-err')});
}

// ── Fan ──
function setFan(){
  var v=parseInt(document.getElementById('d-fan').value);
  document.getElementById('d-fan-val').textContent=v;
  post('/api/fan',{speed:v})
    .then(function(){clog('Fan → '+v+'%','msg-ok')})
    .catch(function(e){clog('Fan error: '+e,'msg-err')});
}
function quickFan(v){
  document.getElementById('d-fan').value=v;
  document.getElementById('d-fan-val').textContent=v;
  post('/api/fan',{speed:v})
    .then(function(){clog('Fan → '+v+'%','msg-ok')})
    .catch(function(e){clog('Fan error: '+e,'msg-err')});
}

// ── AMS ──
function amsFeed(type,slotIndex){
  var globalIdx;
  if(typeof slotIndex==='number'&&slotIndex>=0){
    globalIdx=slotIndex;
  }else{
    var i=parseInt(document.getElementById('ams-slot-sel').value);
    var slot=(window._amsSlots||[])[i]||{};
    globalIdx=slot.global_index!=null?slot.global_index:i;
  }
  return post('/api/ams/feed',{slot_index:globalIdx,type:type})
    .then(function(){clog((type===1?T.lbl_feed:T.lbl_unload)+' Slot '+(globalIdx+1),'msg-ok')})
    .catch(function(e){clog('AMS error: '+e,'msg-err');throw e;});
}

// ── Camera ──
function camStart(){
  // Explicit OK before anything opens a camera connection. The printer's RV1106
  // serves the stream from the same host that feeds the MCUs, so a camera start
  // is real load on a machine that may be mid-print - never implicit.
  if(!confirm(tr('cam_start_confirm','Start the camera for this printer now?')))return;
  var img=document.getElementById('cam-img');
  var ph=document.getElementById('cam-placeholder');
  var sp=document.getElementById('cam-spinner');
  ph.style.display='none';
  img.style.display='none';
  sp.style.display='block';
  post('/api/camera/start',{}).then(function(){
    camOn=true;
    document.getElementById('cam-toggle-btn').textContent=tr('btn_cam_stop');
    var rb=document.getElementById('cam-reset-btn');if(rb)rb.style.display='';
    clog(tr('log_cam_start'),'msg-ok');
    setTimeout(function(){ sp.style.display='none'; img.style.display='block'; },1200);
    if(/Android/i.test(navigator.userAgent)){
      // Android browsers don't support multipart/x-mixed-replace (MJPEG) — poll snapshots instead
      // Must go through _apiUrl: on a cross-printer selection an origin-relative
      // URL streams THIS port's printer while the UI shows another one.
      _camPollInterval=setInterval(function(){ img.src=_apiUrl('/api/camera/snapshot')+'?t='+Date.now(); },200);
    } else {
      img.onerror=function(){
        sp.style.display='none';
        img.style.display='none';
        ph.style.display='flex';
        camOn=false;
        document.getElementById('cam-toggle-btn').textContent=tr('btn_cam_start');
        clog(tr('log_error')+' '+tr('cam_stream_unavailable'),'msg-err');
      };
      img.src=_apiUrl('/api/camera/stream')+'?t='+Date.now();
    }
  }).catch(function(e){
    sp.style.display='none';
    ph.style.display='flex';
    clog(tr('log_error')+' '+e,'msg-err');
  });
}

function camStop(){
  var img=document.getElementById('cam-img');
  if(_camPollInterval){clearInterval(_camPollInterval);_camPollInterval=null;}
  img.onerror=null; // deregister error handler before clearing src to avoid spurious error toast
  post('/api/camera/stop',{}).catch(function(){});
  img.src='';
  img.style.display='none';
  document.getElementById('cam-placeholder').style.display='flex';
  camOn=false;
  camUserStopped=true; // suppress auto-restart for remainder of this print
  document.getElementById('cam-toggle-btn').textContent=tr('btn_cam_start');
  var rb=document.getElementById('cam-reset-btn');if(rb)rb.style.display='none';
  clog(tr('log_cam_stop'),'msg-ok');
}

function aceDryStart(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  var prof=_aceDryProfileGet(aceId);
  var t=parseInt(prof.temp,10);
  var d=_aceDryDurationMinFromSec(prof.duration_sec);
  t=Math.max(30,Math.min(80,t));
  d=Math.max(10,Math.min(1440,d));
  return post('/api/ace/dry',{action:'start',target_temp:t,duration:d,ace_id:aceId})
    .then(function(r){return r.json();})
    .then(function(r){
      if(r.error){throw new Error(r.error);}
      clog('ACE '+(aceId+1)+' - '+tr('ace_dry_dryer')+': '+tr('ace_dry_start')+' ('+t+'°C, '+d+' min)','msg-ok');
      poll();
    })
    .catch(function(e){clog('ACE error: '+e,'msg-err');});
}

var _aceAutoFeedPending={};
function aceAutoRefillToggle(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  var on=!!((document.getElementById('ace-auto-refill-toggle-'+aceId)||{}).checked);
  _aceAutoFeedPending[aceId]=true;
  // _apiUrl, not a bare path: every sibling ACE/print control routes through the
  // selected printer's bridge_url, and an origin-relative POST here would toggle
  // auto-refill on whichever printer owns this port instead.
  fetch(_apiUrl('/api/ace/auto_feed'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ace_id:aceId,on:on?1:0})})
    .then(function(r){return r.json();})
    .then(function(d){
      delete _aceAutoFeedPending[aceId];
      if(d.error){clog('Auto Refill error: '+d.error,'msg-err');var t=document.getElementById('ace-auto-refill-toggle-'+aceId);if(t)t.checked=!on;return;}
      clog('ACE '+(aceId+1)+' - '+tr('ace_dry_auto_refill')+': '+(on?'ON':'OFF'),'msg-ok');
    })
    .catch(function(e){delete _aceAutoFeedPending[aceId];clog('Auto Refill error: '+e,'msg-err');var t=document.getElementById('ace-auto-refill-toggle-'+aceId);if(t)t.checked=!on;});
}

function openAceDryDialog(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  _aceDryDialogAceId=aceId;
  _syncAceDryPresetsFromServer(S.ace_dry_presets);
  _aceDryDialogPresetOriginals=JSON.parse(JSON.stringify(ACE_DRY_PRESETS));
  aceDryDialogSyncCustomButtonNames();
  var hasStored=Object.prototype.hasOwnProperty.call(aceDryProfiles,String(aceId));
  var prof=_aceDryProfileGet(aceId);
  if(hasStored&&prof.preset&&ACE_DRY_PRESETS[prof.preset]){
    aceDryDialogPreset(prof.preset);
  }else if(hasStored){
    var sec=prof.duration_sec;
    document.getElementById('ace-dry-dialog-temp').value=prof.temp;
    document.getElementById('ace-dry-dialog-h').value=Math.floor(sec/3600);
    document.getElementById('ace-dry-dialog-m').value=Math.floor((sec%3600)/60);
    document.getElementById('ace-dry-dialog-s').value=sec%60;
    aceDryDialogHighlightPreset('');
  }else{
    aceDryDialogPreset('pla');
  }
  aceDryDialogUpdateSaveButton();
  aceDryDialogUpdateResetButton();
  var sb=document.getElementById('ace-dry-dialog-save-preset');
  if(sb){sb.disabled=false;sb.textContent=tr('ace_dry_dialog_save_restart');}
  document.getElementById('ace-dry-dialog').classList.add('open');
}

function closeAceDryDialog(){
  _aceDryDialogAceId=-1;
  _aceDryDialogPresetOriginals={};
  var sb=document.getElementById('ace-dry-dialog-save-preset');
  if(sb)sb.style.display='none';
  var rb=document.getElementById('ace-dry-dialog-reset-default');
  if(rb)rb.style.display='none';
  document.getElementById('ace-dry-dialog').classList.remove('open');
}

function aceDryDialogIsCustomPreset(key){
  return /^custom_[123]$/.test(String(key||''));
}

function aceDryDialogSyncCustomButtonNames(){
  ['custom_1','custom_2','custom_3'].forEach(function(k){
    var b=document.querySelector('.ace-dry-preset-btn[data-preset="'+k+'"]');
    if(b)b.textContent=(ACE_DRY_PRESETS[k]&&ACE_DRY_PRESETS[k].name)||('Custom '+k.slice(-1));
  });
}

function aceDryDialogUpdateCustomNameUi(){
  var row=document.getElementById('ace-dry-dialog-custom-name-row');
  var input=document.getElementById('ace-dry-dialog-custom-name');
  if(!row||!input)return;
  if(!aceDryDialogIsCustomPreset(_aceDryDialogPresetKey)){
    row.style.display='none';
    return;
  }
  row.style.display='flex';
  input.value=(ACE_DRY_PRESETS[_aceDryDialogPresetKey]&&ACE_DRY_PRESETS[_aceDryDialogPresetKey].name)||'';
}

function aceDryDialogCurrentValues(){
  var t=parseInt(document.getElementById('ace-dry-dialog-temp').value||45,10);
  var h=parseInt(document.getElementById('ace-dry-dialog-h').value||0,10);
  var m=parseInt(document.getElementById('ace-dry-dialog-m').value||0,10);
  var s=parseInt(document.getElementById('ace-dry-dialog-s').value||0,10);
  t=Math.max(30,Math.min(80,t));
  h=Math.max(0,Math.min(24,h));
  m=Math.max(0,Math.min(59,m));
  s=Math.max(0,Math.min(59,s));
  var totalSec=(h*3600)+(m*60)+s;
  totalSec=Math.max(10*60,Math.min(24*3600,totalSec));
  return {temp:t,duration_sec:totalSec};
}

function aceDryDialogUpdateSaveButton(){
  var btn=document.getElementById('ace-dry-dialog-save-preset');
  if(!btn)return;
  var key=_aceDryDialogPresetKey||'';
  if(!key||!ACE_DRY_PRESETS[key]){btn.style.display='none';return;}
  var p=_aceDryDialogPresetOriginals[key]||ACE_DRY_PRESETS[key];
  var cur=aceDryDialogCurrentValues();
  var changed=(cur.temp!==Number(p.temp)||cur.duration_sec!==Number(p.duration_sec));
  if(aceDryDialogIsCustomPreset(key)){
    var nameInp=document.getElementById('ace-dry-dialog-custom-name');
    var n=((nameInp&&nameInp.value)||'').trim();
    var old=(p&&p.name?String(p.name):('Custom '+key.slice(-1))).trim();
    if((n||old)!==old)changed=true;
  }
  btn.style.display=changed?'':'none';
}

function aceDryDialogUpdateResetButton(){
  var btn=document.getElementById('ace-dry-dialog-reset-default');
  if(!btn)return;
  var key=_aceDryDialogPresetKey||'';
  var d=ACE_DRY_PRESET_DEFAULTS[key];
  if(!key||!d){btn.style.display='none';return;}
  var cur=aceDryDialogCurrentValues();
  var changed=(cur.temp!==Number(d.temp)||cur.duration_sec!==Number(d.duration_sec));
  btn.style.display=changed?'':'none';
}

function aceDryDialogInputsChanged(){
  if(aceDryDialogIsCustomPreset(_aceDryDialogPresetKey)){
    var b=document.querySelector('.ace-dry-preset-btn[data-preset="'+_aceDryDialogPresetKey+'"]');
    var i=document.getElementById('ace-dry-dialog-custom-name');
    if(b&&i){
      var t=(i.value||'').trim();
      b.textContent=t||((ACE_DRY_PRESETS[_aceDryDialogPresetKey]&&ACE_DRY_PRESETS[_aceDryDialogPresetKey].name)||('Custom '+_aceDryDialogPresetKey.slice(-1)));
    }
  }
  aceDryDialogUpdateSaveButton();
  aceDryDialogUpdateResetButton();
}

function aceDryDialogHighlightPreset(presetKey){
  _aceDryDialogPresetKey=presetKey||'';
  document.querySelectorAll('.ace-dry-preset-btn').forEach(function(btn){
    var on=(btn.getAttribute('data-preset')===presetKey);
    btn.style.background=on?'var(--accent)':'var(--raised)';
    btn.style.color=on?'#fff':'var(--txt2)';
    btn.style.borderColor=on?'var(--accent)':'var(--border)';
  });
  aceDryDialogUpdateCustomNameUi();
}

function aceDryDialogPreset(presetKey){
  var p=ACE_DRY_PRESETS[presetKey];
  if(!p)return;
  var sec=p.duration_sec;
  document.getElementById('ace-dry-dialog-temp').value=p.temp;
  document.getElementById('ace-dry-dialog-h').value=Math.floor(sec/3600);
  document.getElementById('ace-dry-dialog-m').value=Math.floor((sec%3600)/60);
  document.getElementById('ace-dry-dialog-s').value=sec%60;
  aceDryDialogHighlightPreset(presetKey);
  aceDryDialogSyncCustomButtonNames();
  aceDryDialogUpdateSaveButton();
  aceDryDialogUpdateResetButton();
}

function resetAceDryPresetToDefault(){
  var key=_aceDryDialogPresetKey||'';
  var d=ACE_DRY_PRESET_DEFAULTS[key];
  if(!key||!d)return;
  var sec=Number(d.duration_sec)||0;
  document.getElementById('ace-dry-dialog-temp').value=Number(d.temp)||45;
  document.getElementById('ace-dry-dialog-h').value=Math.floor(sec/3600);
  document.getElementById('ace-dry-dialog-m').value=Math.floor((sec%3600)/60);
  document.getElementById('ace-dry-dialog-s').value=sec%60;
  aceDryDialogInputsChanged();
}

function saveAceDryPresetAndRestart(){
  var key=_aceDryDialogPresetKey||'';
  var btn=document.getElementById('ace-dry-dialog-save-preset');
  if(!key||!ACE_DRY_PRESETS[key]||!btn)return;
  var cur=aceDryDialogCurrentValues();
  if(!ACE_DRY_PRESETS[key])ACE_DRY_PRESETS[key]={};
  ACE_DRY_PRESETS[key].temp=cur.temp;
  ACE_DRY_PRESETS[key].duration_sec=cur.duration_sec;
  if(aceDryDialogIsCustomPreset(key)){
    var nameInp=document.getElementById('ace-dry-dialog-custom-name');
    var nm=((nameInp&&nameInp.value)||'').trim();
    ACE_DRY_PRESETS[key].name=nm||('Custom '+key.slice(-1));
  }
  btn.disabled=true;
  btn.textContent='…';
  fetch(_apiUrl('/api/settings')).then(function(r){return r.json();}).then(function(d){
    d.ace_dry_presets={
      pla:{temp:ACE_DRY_PRESETS.pla.temp,duration_sec:ACE_DRY_PRESETS.pla.duration_sec},
      pla_plus:{temp:ACE_DRY_PRESETS.pla_plus.temp,duration_sec:ACE_DRY_PRESETS.pla_plus.duration_sec},
      petg:{temp:ACE_DRY_PRESETS.petg.temp,duration_sec:ACE_DRY_PRESETS.petg.duration_sec},
      tpu:{temp:ACE_DRY_PRESETS.tpu.temp,duration_sec:ACE_DRY_PRESETS.tpu.duration_sec},
      abs_asa:{temp:ACE_DRY_PRESETS.abs_asa.temp,duration_sec:ACE_DRY_PRESETS.abs_asa.duration_sec},
      pa_pc:{temp:ACE_DRY_PRESETS.pa_pc.temp,duration_sec:ACE_DRY_PRESETS.pa_pc.duration_sec},
      custom_1:{name:ACE_DRY_PRESETS.custom_1.name,temp:ACE_DRY_PRESETS.custom_1.temp,duration_sec:ACE_DRY_PRESETS.custom_1.duration_sec},
      custom_2:{name:ACE_DRY_PRESETS.custom_2.name,temp:ACE_DRY_PRESETS.custom_2.temp,duration_sec:ACE_DRY_PRESETS.custom_2.duration_sec},
      custom_3:{name:ACE_DRY_PRESETS.custom_3.name,temp:ACE_DRY_PRESETS.custom_3.temp,duration_sec:ACE_DRY_PRESETS.custom_3.duration_sec}
    };
    return post('/api/settings',d);
  }).then(function(){
    clog('ACE preset '+key+' '+tr('settings_save'),'msg-ok');
    closeAceDryDialog();
  }).catch(function(e){
    btn.disabled=false;
    btn.textContent=tr('ace_dry_dialog_save_restart');
    clog('ACE preset error: '+e,'msg-err');
  });
}

function confirmAceDryDialog(){
  if(_aceDryDialogAceId<0)return;
  var t=parseInt(document.getElementById('ace-dry-dialog-temp').value||45,10);
  var h=parseInt(document.getElementById('ace-dry-dialog-h').value||0,10);
  var m=parseInt(document.getElementById('ace-dry-dialog-m').value||0,10);
  var s=parseInt(document.getElementById('ace-dry-dialog-s').value||0,10);
  t=Math.max(30,Math.min(80,t));
  h=Math.max(0,Math.min(24,h));
  m=Math.max(0,Math.min(59,m));
  s=Math.max(0,Math.min(59,s));
  var totalSec=(h*3600)+(m*60)+s;
  totalSec=Math.max(10*60,Math.min(24*3600,totalSec));
  var preset=_aceDryDialogPresetKey||'';
  _aceDryProfileSet(_aceDryDialogAceId,t,totalSec,preset);
  closeAceDryDialog();
  applyState();
}

function aceDryToggle(aceId,on){
  if(on)return aceDryStart(aceId);
  return aceDryStop(aceId);
}

function toggleCam(){if(camOn)camStop();else camStart()}

function resetCamera(){
  post('/api/camera/reset',{}).then(function(){
    var btn=document.getElementById('cam-reset-btn');
    if(btn){btn.textContent='↻';setTimeout(function(){btn.textContent='↺';},1000);}
  }).catch(function(){});
}

function aceDryStop(aceId){
  aceId=(typeof aceId==='number'&&aceId>=0)?aceId:0;
  return post('/api/ace/dry',{action:'stop',ace_id:aceId})
    .then(function(r){return r.json();})
    .then(function(r){
      if(r.error){throw new Error(r.error);}
      clog('ACE '+(aceId+1)+' - '+tr('ace_dry_dryer')+': '+tr('ace_dry_stop'),'msg-ok');
      poll();
    })
    .catch(function(e){clog('ACE error: '+e,'msg-err');});
}

function loadStore(){
  // Render the bridge library as soon as /kx/files answers. The printer-side
  // listing is an MQTT round trip (up to 8 s, fails while the printer is busy)
  // and only decides the "On printer / Bridge only" tag, so it must not gate
  // the whole grid: waiting on both made the Browser tab look dead.
  var filesReq=fetch(_apiUrl('/kx/files')).then(function(r){return r.json();});
  var printerReq=fetch(_apiUrl('/kx/printer-files')).then(function(r){return r.json();}).catch(function(){return {result:[]};});
  filesReq.then(function(d){
    storeFiles=d.result||[];
    // Reset any pending selection - stale ids from a deleted/renamed file
    // should never carry over into a fresh file list.
    storeExitSelectMode();
    renderStore();
    _renderBrowserPrinterLabel();
  }).catch(function(e){clog('Store error: '+e,'msg-err')});
  Promise.all([filesReq,printerReq]).then(function(results){
    // A failed printer query returns {error}, not a list. Treating that as an
    // empty list would mislabel every card as "Bridge only".
    printerFiles=results[1].result||[];
    _printerFilesLoaded=!results[1].error;
    renderStore();
  }).catch(function(){});
}

// The browser shows one printer's files at a time; name it, so a farm operator
// can never delete or start a file on the wrong machine after switching.
function _renderBrowserPrinterLabel(){
  var el=document.getElementById('browser-printer-label');
  if(!el)return;
  var name=(_activePrinter&&_activePrinter.name)||'';
  el.textContent=name||'';
  el.style.display=name&&_printers.length>1?'':'none';
}

// Applies the store's search/filter/sort controls to storeFiles. Shared by
// renderStore() and storeToggleSelectAll() so "Select All" only selects what
// the user can currently see, not the entire (possibly filtered-out) list.
function _storeFilteredFiles(){
  var q=(document.getElementById('store-search')||{value:''}).value.toLowerCase().trim();
  var filter=(document.getElementById('store-filter')||{value:'all'}).value;
  var sort=(document.getElementById('store-sort')||{value:'date_desc'}).value;

  var files=storeFiles.filter(function(f){
    if(q&&f.filename.toLowerCase().indexOf(q)===-1) return false;
    if(filter==='completed'&&f.last_print_status!=='completed') return false;
    if(filter==='failed'&&(f.last_print_status!=='cancelled'&&f.last_print_status!=='failed')) return false;
    if(filter==='never'&&f.last_print_status) return false;
    return true;
  });

  files.sort(function(a,b){
    if(sort==='name_asc') return a.filename.localeCompare(b.filename);
    if(sort==='duration_asc'){
      var da=a.last_print_duration||a.est_print_time_sec||0;
      var db=b.last_print_duration||b.est_print_time_sec||0;
      return da-db;
    }
    // date_desc (default)
    return (b.uploaded_at||'').localeCompare(a.uploaded_at||'');
  });
  return files;
}

function uploadGcode(file){
  if(!file) return;
  var zone=document.getElementById('store-upload-zone');
  var status=document.getElementById('store-upload-status');
  var label=document.getElementById('store-upload-label');
  // Nur druckbare Dateien zulassen (Issue #59) — Drag&Drop umgeht das
  // accept-Attribut, daher hier explizit prüfen.
  var _fn=(file.name||'').toLowerCase();
  if(!/\.(gcode|bgcode)$/.test(_fn)){
    if(status){ status.textContent=T.store_upload_only_gcode||'Only GCode files allowed'; status.style.display=''; status.className='upload-status-err'; }
    clog('Upload abgelehnt (kein GCode): '+file.name,'msg-err');
    return;
  }
  if(status) { status.textContent=T.store_upload_busy; status.style.display=''; status.className='upload-status-busy'; }
  if(label) label.style.display='none';
  if(zone) zone.style.pointerEvents='none';
  var fd=new FormData();
  fd.append('file', file);
  fd.append('web_upload', 'true');
  var xhr=new XMLHttpRequest();
  kxTransferStart();
  xhr.open('POST',_apiUrl('/api/files/local'));
  xhr.upload.onprogress=function(ev){
    if(!ev.lengthComputable||!status)return;
    var pct=Math.round(ev.loaded*100/ev.total);
    status.textContent=(currentLang==='de'?'Browser → Bridge: ':'Browser → bridge: ')+pct+'% · '+
      (ev.loaded/1048576).toFixed(1)+' / '+(ev.total/1048576).toFixed(1)+' MB';
  };
  xhr.onload=function(){
    kxTransferEnd();
    if(xhr.status<200||xhr.status>=300){
      var msg=xhr.responseText||('HTTP '+xhr.status);
      if(status){status.textContent=(T.store_upload_error||'Upload failed: {error}').replace('{error}',msg);status.className='upload-status-err';}
      if(label)label.style.display='';if(zone)zone.style.pointerEvents='';
      return;
    }
    if(status){status.textContent=(T.store_upload_success||'Uploaded: {file}').replace('{file}',file.name);status.className='upload-status-ok';}
    loadStore();
    setTimeout(function(){
      if(status){status.style.display='none';status.className='';}
      if(label)label.style.display='';if(zone)zone.style.pointerEvents='';
    },3000);
  };
  xhr.onerror=function(){
    kxTransferEnd();
    if(status){status.textContent=(T.store_upload_error||'Upload failed: {error}').replace('{error}','network error');status.className='upload-status-err';}
    if(label)label.style.display='';if(zone)zone.style.pointerEvents='';
  };
  xhr.send(fd);
}

// True when this exact file (name + byte size) already sits on the printer's
// own storage, which is what decides Print vs Upload & print.
function _fileOnPrinter(f){
  if(!Array.isArray(printerFiles)) return false;
  return printerFiles.some(function(r){
    return r.filename===f.filename && Number(r.size||0)===Number(f.size_bytes||0);
  });
}

function _kxEsc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function renderStore(){
  var grid=document.getElementById('store-grid');
  var empty=document.getElementById('store-empty');
  var files=_storeFilteredFiles();

  if(!storeFiles.length){
    empty.textContent=T.store_empty;
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  if(!files.length){
    empty.textContent=T.store_no_results;
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  empty.style.display='none';
  var lgdHere=document.getElementById('kx-lgd-here');
  var lgdBridge=document.getElementById('kx-lgd-bridge');
  if(lgdHere)lgdHere.textContent=currentLang==='de'
    ? 'On printer — starts directly'
    : 'On printer — can start immediately';
  if(lgdBridge)lgdBridge.textContent=currentLang==='de'
    ? 'Nur Bridge — erst hochladen, oder hochladen & drucken'
    : 'Bridge only — upload first, or upload & print';
  grid.innerHTML=files.map(function(f){
    var jsId=f.id.replace(/'/g,"\\'");
    var here=_fileOnPrinter(f);
    // Thumbnails are fetched per file instead of arriving inline in /kx/files:
    // 39 base64 images made that response 356KB and delayed the whole grid.
    // loading="lazy" means only on-screen cards fetch, and the response is
    // immutable-cacheable because file_id is the content hash.
    var thumb=f.has_thumbnail
      ? '<img loading="lazy" decoding="async" src="'+_kxEsc(_apiUrl('/kx/files/'+encodeURIComponent(f.id)+'/thumbnail'))+'" alt="'+_kxEsc(f.filename)+'">'
      : '<span class="kxfile-ph">▤</span>';
    var est=f.est_print_time_sec?formatDur(f.est_print_time_sec):'–';
    var date=f.uploaded_at?f.uploaded_at.replace('T',' ').slice(0,16):'';
    var res='';
    if(f.last_print_status==='completed'){
      res='<span class="kxfile-res ok">'+(f.last_print_duration?formatDur(f.last_print_duration):'✓')+'</span>';
    } else if(f.last_print_status==='cancelled'||f.last_print_status==='failed'){
      res='<span class="kxfile-res bad">'+(currentLang==='de'?'abgebrochen':_kxEsc(f.last_print_status))+'</span>';
    }
    var mat='';
    try{
      var fil=typeof f.gcode_filaments==='string'?JSON.parse(f.gcode_filaments||'[]'):(f.gcode_filaments||[]);
      if(fil.length){
        mat='<span class="kxfile-mat"><i class="kxswatch" style="background:'+_kxEsc(fil[0].color_hex||'#5d666e')+'"></i>'+_kxEsc(fil[0].material||'')+'</span>';
      }
    }catch(e){}
    var onPrinterLabel=currentLang==='de'?'On printer':'On printer';
    var bridgeOnlyLabel=currentLang==='de'?'Nur Bridge':'Bridge only';
    var uploadPrintLabel=currentLang==='de'?'Hochladen & drucken':'Upload & print';
    var uploadOnlyLabel=currentLang==='de'?'Nur hochladen':'Upload only';
    var reuploadLabel=currentLang==='de'?'Erneut hochladen':'Re-upload';
    var downloadLabel=currentLang==='de'?'Herunterladen':'Download';
    var deleteLabel=currentLang==='de'?'Löschen':'Delete';
    var isSelected=!!_storeSelected[f.id];
    var cardAttrs='class="kxfile'+(isSelected?' sel':'')+'"'+
      (_storeSelectMode?' onclick="storeToggleSelect(\''+jsId+'\')" style="cursor:pointer"':'');
    return '<div '+cardAttrs+'>'+
      '<div class="kxfile-thumb">'+thumb+
        '<span class="kxfile-cb" role="checkbox" tabindex="0"'+
          ' aria-checked="'+(isSelected?'true':'false')+'"'+
          ' aria-label="'+_kxEsc(f.filename)+'"'+
          ' onclick="event.stopPropagation();storeToggleSelect(\''+jsId+'\')"'+
          ' onkeydown="if(event.key===\' \'||event.key===\'Enter\'){event.preventDefault();event.stopPropagation();storeToggleSelect(\''+jsId+'\')}">'+
          '<input type="checkbox" class="store-card-cb" tabindex="-1" '+(isSelected?'checked':'')+'></span>'+
        '<span class="kxfile-tag"><i class="kxkey '+(here?'here':'bridgeonly')+'"></i>'+
          (here?onPrinterLabel:bridgeOnlyLabel)+'</span>'+
        res+
      '</div>'+
      '<div class="kxfile-body">'+
        '<div class="kxfile-name" title="'+_kxEsc(f.filename)+'">'+_kxEsc(f.filename)+'</div>'+
        '<div class="kxfile-meta"><span>'+est+'</span>'+mat+'</div>'+
        '<div class="kxfile-meta"><span>'+date+'</span></div>'+
        '<div class="kxfile-actions">'+
          '<button class="'+(here?'go':'')+'" onclick="event.stopPropagation();storePrint(\''+jsId+'\',\''+_kxEsc(f.filename.replace(/'/g,"\\'"))+'\')">'+
            (here?(T.store_print||'Print'):uploadPrintLabel)+'</button>'+
          '<div class="row2">'+
            '<button onclick="event.stopPropagation();storeUploadLocal(\''+jsId+'\',this)">'+
              (here?reuploadLabel:uploadOnlyLabel)+'</button>'+
            '<button title="'+_kxEsc(downloadLabel)+'" aria-label="'+_kxEsc(downloadLabel)+'"'+
              ' onclick="event.stopPropagation();storeDownload(\''+jsId+'\')">⭳</button>'+
            '<button class="del" title="'+_kxEsc(deleteLabel)+'" aria-label="'+_kxEsc(deleteLabel)+'"'+
              ' onclick="event.stopPropagation();storeDelete(\''+jsId+'\')">🗑</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');

  _storeUpdateSelectBar(files);
}

// Reflects the current selection onto the select-all checkbox (incl.
// indeterminate state), the selected-count label, and the delete button's
// disabled state. `files` is the currently-filtered/visible list.
function _storeUpdateSelectBar(files){
  var selectAll=document.getElementById('store-select-all');
  var countEl=document.getElementById('store-selected-count');
  var delBtn=document.getElementById('store-delete-selected-btn');
  if(!selectAll||!countEl||!delBtn)return;
  var visibleIds=files.map(function(f){return f.id;});
  var selectedVisible=visibleIds.filter(function(id){return _storeSelected[id];});
  var n=selectedVisible.length;
  selectAll.checked=n>0&&n===visibleIds.length;
  selectAll.indeterminate=n>0&&n<visibleIds.length;
  countEl.textContent=n>0?(T.store_selected_count||'{n} selected').replace('{n}',n):'';
  delBtn.disabled=n===0;
}

function formatDur(sec){
  var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);
  return h?h+'h '+m+'m':m+'m';
}

var _storeFileId=null;
var _storeFilename=null;
// Upload a store file to the printer's own storage without starting a print.
// Lets the job be started from the printer's screen, bypassing the bridge's
// print/start payload.
function storeUploadLocal(fileId,btn){
  // The GCode store is shared by every bridge instance, so the same file_id
  // can be pushed to any printer just by POSTing to that printer's own
  // bridge_url. With more than one printer, ask which ones first.
  if(_printers.length>1){openSendDialog(fileId,btn);return;}
  _sendToPrinters(fileId,[_activePrinter||{}],btn);
}

// POST /kx/upload-local to each target printer in parallel. An empty
// bridge_url means "same origin as this UI" (single-printer setup).
function _sendToPrinters(fileId,targets,btn){
  if(!targets.length)return Promise.resolve([]);
  var label=btn?btn.textContent:'';
  kxTransferStart();
  if(btn){btn.disabled=true;btn.textContent='…';}
  // Bridge starts pushing bytes immediately; pull farm state now so the
  // transfer bar appears within ~1s instead of at the next 5s tick.
  setTimeout(refreshFarmState,300);
  return Promise.all(targets.map(function(p){
    var base=(p.bridge_url||'').replace(/\/+$/,'');
    return fetch(base+'/kx/upload-local',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file_id:fileId})
    }).then(function(r){
      return r.json().then(function(d){
        if(!r.ok||d.error)throw new Error(d.error||('HTTP '+r.status));
        return {name:p.name||'',ok:true,uploaded:d.uploaded,filename:d.filename};
      });
    }).catch(function(e){
      return {name:p.name||'',ok:false,error:e.message};
    });
  })).then(function(results){
    results.forEach(function(r){
      if(r.ok)clog((r.name?r.name+': ':'')+(r.uploaded?'Uploaded to printer: ':'Already on printer: ')+r.filename,'msg-ok');
      else clog((r.name?r.name+': ':'')+'Upload error: '+r.error,'msg-err');
    });
    if(typeof loadPrinterFiles==='function')loadPrinterFiles();
    return results;
  }).then(function(results){
    kxTransferEnd();
    if(btn){btn.disabled=false;btn.textContent=label;}
    return results;
  });
}

// Printer picker for multi-send. Built on demand so index.html stays untouched;
// reuses the existing .modal-overlay/.modal-box styling.
function openSendDialog(fileId,btn){
  var dlg=document.getElementById('send-dialog');
  if(!dlg){
    dlg=document.createElement('div');
    dlg.className='modal-overlay';
    dlg.id='send-dialog';
    dlg.onclick=function(e){if(e.target===dlg)closeSendDialog();};
    dlg.innerHTML='<div class="modal-box" style="max-width:340px;width:100%">'+
      '<div class="modal-header" style="margin-bottom:14px">'+
        '<span class="modal-title" id="sd-title" style="font-size:14px"></span>'+
        '<button onclick="closeSendDialog()" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--txt2)">✕</button>'+
      '</div>'+
      '<div id="sd-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px"></div>'+
      '<div style="display:flex;gap:8px;justify-content:flex-end">'+
        '<button onclick="closeSendDialog()" style="padding:8px 14px;background:var(--raised);color:var(--txt);border:1px solid var(--border);border-radius:8px;cursor:pointer">'+
          (currentLang==='de'?'Abbrechen':'Cancel')+'</button>'+
        '<button id="sd-confirm" style="padding:8px 18px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">'+
          (currentLang==='de'?'Senden':'Send')+'</button>'+
      '</div>'+
    '</div>';
    document.body.appendChild(dlg);
  }
  document.getElementById('sd-title').textContent=currentLang==='de'?'An Drucker senden':'Send to printers';
  var activeId=_activePrinter?String(_activePrinter.id):'';
  document.getElementById('sd-list').innerHTML=_printers.map(function(p){
    return '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:var(--raised);border:1px solid var(--border);cursor:pointer;font-size:13px">'+
      '<input type="checkbox" class="sd-target" value="'+_kxEsc(String(p.id))+'"'+(String(p.id)===activeId?' checked':'')+'>'+
      '<span>'+_kxEsc(p.name||('Printer '+p.id))+'</span>'+
      '</label>';
  }).join('');
  document.getElementById('sd-confirm').onclick=function(){
    var ids=[].slice.call(document.querySelectorAll('.sd-target'))
      .filter(function(c){return c.checked;}).map(function(c){return c.value;});
    var targets=_printers.filter(function(p){return ids.indexOf(String(p.id))>=0;});
    if(!targets.length)return;
    closeSendDialog();
    _sendToPrinters(fileId,targets,btn);
  };
  dlg.classList.add('open');
}
function closeSendDialog(){
  var dlg=document.getElementById('send-dialog');
  if(dlg)dlg.classList.remove('open');
}
var _filamentDialogMode='store'; // 'store' oder 'banner'
var _pendingWebVerifyFileId=null;
var _pendingWebVerifyFilename='';
var _pendingWebVerifyAction=null;
var _pendingWebVerifyAutoOpen=false;
// GCode-Store-Dateiliste. MUSS deklariert sein – sonst ReferenceError, wenn
// "Slots wählen" im Banner geklickt wird, bevor der Browser-Tab je geladen
// wurde (Issue #29 / Theme-Auslagerung PR #27).
var storeFiles=[];

// Multi-select state for the GCode browser (Issue #94).
var _storeSelectMode=false;
var _storeSelected={};  // file.id -> true

function storeToggleSelect(id){
  if(!_storeSelectMode){
    _storeSelectMode=true;
    var bar=document.getElementById('store-select-bar');
    if(bar)bar.style.display='flex';
  }
  if(_storeSelected[id])delete _storeSelected[id];
  else _storeSelected[id]=true;
  renderStore();
}

function storeToggleSelectAll(checked){
  // Only the currently filtered/visible files are affected, so search/filter
  // never causes "Select All" to silently pick up hidden files too.
  var visible=_storeFilteredFiles();
  _storeSelected={};
  if(checked)visible.forEach(function(f){_storeSelected[f.id]=true;});
  renderStore();
}

function storeExitSelectMode(){
  _storeSelectMode=false;
  _storeSelected={};
  var bar=document.getElementById('store-select-bar');
  if(bar)bar.style.display='none';
  renderStore();
}

function storeDeleteSelected(){
  var ids=Object.keys(_storeSelected);
  if(!ids.length)return;
  if(!confirm((T.store_delete_selected_confirm||'Delete {n} selected files?').replace('{n}',ids.length)))return;
  Promise.all(ids.map(function(id){
    return fetch(_apiUrl('/kx/files/'+id),{method:'DELETE'}).then(function(r){return{id:id,ok:r.ok};});
  })).then(function(results){
    var failed=results.filter(function(r){return !r.ok;});
    if(failed.length)clog((T.log_delete_failed||'Delete failed')+': '+failed.length,'msg-err');
    storeExitSelectMode();
    loadStore();
  });
}

// ── Files on the printer's own internal storage (Issue: 2nd Browser tab) ──
// Uses filename as the identity key (the printer has no numeric file id like
// the bridge's own GCodeStore) and a single batch-delete call, since the
// printer's file/deleteBatch MQTT action natively accepts a filename list.
var printerFiles=[];
var _printerFilesSelectMode=false;
var _printerFilesSelected={};  // filename -> true

function loadPrinterFiles(){
  var errEl=document.getElementById('printer-store-error');
  if(errEl)errEl.style.display='none';
  _renderBrowserPrinterLabel();
  fetch(_apiUrl('/kx/printer-files')).then(function(r){return r.json()}).then(function(d){
    _printerFilesLoaded=true;
    if(d.error){
      printerFiles=[];
      if(errEl){errEl.textContent=T.printer_store_unreachable||d.error;errEl.style.display='block';}
      renderPrinterFiles();
      return;
    }
    printerFiles=d.result||[];
    _printerFilesSelected={};
    _printerFilesSelectMode=false;
    var bar=document.getElementById('printer-store-select-bar');
    if(bar)bar.style.display='none';
    renderPrinterFiles();
  }).catch(function(e){
    _printerFilesLoaded=true;
    if(errEl){errEl.textContent=T.printer_store_unreachable||String(e);errEl.style.display='block';}
  });
}

function renderPrinterFiles(){
  var grid=document.getElementById('printer-store-grid');
  var empty=document.getElementById('printer-store-empty');
  var summary=document.getElementById('printer-store-summary');
  if(!grid||!empty)return;
  var q=(document.getElementById('printer-store-search')||{value:''}).value.toLowerCase().trim();
  var sort=(document.getElementById('printer-store-sort')||{value:'date_desc'}).value;
  var files=printerFiles.filter(function(f){return !q||f.filename.toLowerCase().indexOf(q)>=0;});
  files.sort(function(a,b){
    if(sort==='name_asc')return a.filename.localeCompare(b.filename);
    if(sort==='size_desc')return Number(b.size||0)-Number(a.size||0);
    return Number(b.timestamp||0)-Number(a.timestamp||0);
  });
  if(summary){
    var bytes=files.reduce(function(n,f){return n+Number(f.size||0);},0);
    summary.textContent=files.length+' / '+printerFiles.length+' files · '+(bytes/1048576).toFixed(bytes>=104857600?0:1)+' MB';
  }
  if(!printerFiles.length){
    empty.textContent=T.printer_store_empty||'No files on the printer.';
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  if(!files.length){
    empty.textContent=T.store_no_results||'No matching files.';
    grid.innerHTML='';
    empty.style.display='block';
    return;
  }
  empty.style.display='none';
  grid.innerHTML=files.map(function(f,idx){
    // Escape for the JS string literal first, then for the HTML attribute it
    // sits inside. Quote-only escaping let a `"` in a printer-side filename
    // close the attribute and inject an event handler.
    var jsName=_kxEsc(f.filename.replace(/'/g,"\\'"));
    var sizeKb=f.size?(f.size/1024).toFixed(0)+' KB':'–';
    var date=f.timestamp?new Date(f.timestamp).toISOString().replace('T',' ').slice(0,16):'';
    var isSelected=!!_printerFilesSelected[f.filename];
    var thumbId='pft-'+idx;
    var cachedThumb=_printerThumbCache[f.filename];
    var thumbHtml=cachedThumb
      ? '<img id="'+thumbId+'" src="data:image/png;base64,'+cachedThumb+'" alt="'+_kxEsc(f.filename)+'">'
      : '<span id="'+thumbId+'" class="kxfile-ph" data-filename="'+encodeURIComponent(f.filename)+'">▤</span>';
    var cardAttrs='class="kxfile'+(isSelected?' sel':'')+'"'+
      (_printerFilesSelectMode?' onclick="printerFileToggleSelect(\''+jsName+'\')" style="cursor:pointer"':'');
    return '<div '+cardAttrs+'>'+
      '<div class="kxfile-thumb">'+thumbHtml+
        '<span class="kxfile-cb" role="checkbox" tabindex="0"'+
          ' aria-checked="'+(isSelected?'true':'false')+'"'+
          ' aria-label="'+_kxEsc(f.filename)+'"'+
          ' onclick="event.stopPropagation();printerFileToggleSelect(\''+jsName+'\')"'+
          ' onkeydown="if(event.key===\' \'||event.key===\'Enter\'){event.preventDefault();event.stopPropagation();printerFileToggleSelect(\''+jsName+'\')}">'+
          '<input type="checkbox" class="store-card-cb" tabindex="-1" '+(isSelected?'checked':'')+'></span>'+
        '<span class="kxfile-tag"><i class="kxkey here"></i>'+(T.kx_on_printer||'On printer')+'</span>'+
      '</div>'+
      '<div class="kxfile-body">'+
        '<div class="kxfile-name" title="'+_kxEsc(f.filename)+'">'+_kxEsc(f.filename)+'</div>'+
        '<div class="kxfile-meta"><span>'+sizeKb+'</span><span>'+date+'</span></div>'+
        '<div class="kxfile-actions">'+
          '<div class="row2" style="grid-template-columns:1fr 44px">'+
            '<button class="go" onclick="event.stopPropagation();printerFilePrint(\''+jsName+'\',this)">'+(T.store_print||'Print')+'</button>'+
            '<button class="del" title="'+_kxEsc(T.store_delete||'Delete')+'" aria-label="'+_kxEsc(T.store_delete||'Delete')+'"'+
              ' onclick="event.stopPropagation();printerFileDelete(\''+jsName+'\')">🗑</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  }).join('');
  _printerFilesUpdateSelectBar();
  _loadVisiblePrinterThumbnails();
}

// Thumbnails are fetched lazily, one at a time, only for cards not already
// cached - fetching all of them upfront would mean one MQTT roundtrip per
// file (145+ files is common), overwhelming the single MQTT connection.
var _printerThumbCache={};  // filename -> base64 PNG string ("" = no thumbnail)
var _printerThumbQueue=[];
var _printerThumbLoading=false;

function _loadVisiblePrinterThumbnails(){
  var placeholders=document.querySelectorAll('#printer-store-grid [data-filename]');
  _printerThumbQueue=Array.prototype.slice.call(placeholders);
  _pumpPrinterThumbQueue();
}

function _pumpPrinterThumbQueue(){
  if(_printerThumbLoading||!_printerThumbQueue.length)return;
  var el=_printerThumbQueue.shift();
  if(!el||!el.isConnected){_pumpPrinterThumbQueue();return;}
  var encodedName=el.getAttribute('data-filename');
  _printerThumbLoading=true;
  fetch(_apiUrl('/kx/printer-files/'+encodedName+'/thumbnail'))
    .then(function(r){return r.json()})
    .then(function(d){
      var thumb=(d.result&&d.result.thumbnail)||'';
      _printerThumbCache[decodeURIComponent(encodedName)]=thumb;
      if(thumb&&el.isConnected){
        var img=document.createElement('img');
        img.src='data:image/png;base64,'+thumb;
        img.style.cssText='width:100%;height:60px;object-fit:contain;border-radius:6px;background:var(--raised);margin-bottom:8px';
        img.id=el.id;
        el.replaceWith(img);
      }
    })
    .catch(function(){/* keep the placeholder icon on failure */})
    .finally(function(){
      _printerThumbLoading=false;
      _pumpPrinterThumbQueue();
    });
}

function _printerFilesUpdateSelectBar(){
  var selectAll=document.getElementById('printer-store-select-all');
  var countEl=document.getElementById('printer-store-selected-count');
  var delBtn=document.getElementById('printer-store-delete-selected-btn');
  if(!selectAll||!countEl||!delBtn)return;
  var allNames=printerFiles.map(function(f){return f.filename;});
  var selected=allNames.filter(function(n){return _printerFilesSelected[n];});
  var n=selected.length;
  selectAll.checked=n>0&&n===allNames.length;
  selectAll.indeterminate=n>0&&n<allNames.length;
  countEl.textContent=n>0?(T.store_selected_count||'{n} selected').replace('{n}',n):'';
  delBtn.disabled=n===0;
}

function printerFileToggleSelect(filename){
  if(!_printerFilesSelectMode){
    _printerFilesSelectMode=true;
    var bar=document.getElementById('printer-store-select-bar');
    if(bar)bar.style.display='flex';
  }
  if(_printerFilesSelected[filename])delete _printerFilesSelected[filename];
  else _printerFilesSelected[filename]=true;
  renderPrinterFiles();
}

function printerFileToggleSelectAll(checked){
  _printerFilesSelected={};
  if(checked)printerFiles.forEach(function(f){_printerFilesSelected[f.filename]=true;});
  renderPrinterFiles();
}

function printerFileExitSelectMode(){
  _printerFilesSelectMode=false;
  _printerFilesSelected={};
  var bar=document.getElementById('printer-store-select-bar');
  if(bar)bar.style.display='none';
  renderPrinterFiles();
}

function printerFilePrint(filename,btn){
  if(!confirm('Start "'+filename+'" on '+((_activePrinter&&_activePrinter.name)||'this printer')+'?'))return;
  var label=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch(_apiUrl('/kx/printer-files/start'),{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filename:filename,auto_leveling:1})
  }).then(function(r){return r.json().then(function(d){if(!r.ok||d.error)throw new Error(d.error||('HTTP '+r.status));return d;});})
    .then(function(){clog('Print started: '+filename,'msg-ok');showPanel('dashboard');})
    .catch(function(e){clog('Print error: '+e.message,'msg-err');if(btn){btn.disabled=false;btn.textContent=label;}});
}

function _printerFilesDeleteRequest(filenames){
  return fetch(_apiUrl('/kx/printer-files/delete'),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filenames:filenames}),
  }).then(function(r){return r.json().then(function(d){
    // Thumbnails are cached by bare filename. Without eviction, deleting
    // a.gcode and uploading a DIFFERENT a.gcode kept showing the old preview.
    if(r.ok)filenames.forEach(function(fn){delete _printerThumbCache[fn];});
    return{ok:r.ok,body:d};
  });});
}

function printerFileDelete(filename){
  if(!confirm(T.printer_store_delete_confirm||'Delete file?'))return;
  _printerFilesDeleteRequest([filename]).then(function(res){
    if(!res.ok){clog((T.log_delete_failed||'Delete failed')+': '+(res.body.error||''),'msg-err');return;}
    loadPrinterFiles();
  });
}

function printerFileDeleteSelected(){
  var names=Object.keys(_printerFilesSelected);
  if(!names.length)return;
  if(!confirm((T.printer_store_delete_selected_confirm||'Delete {n} selected files?').replace('{n}',names.length)))return;
  _printerFilesDeleteRequest(names).then(function(res){
    if(!res.ok){clog((T.log_delete_failed||'Delete failed')+': '+(res.body.error||''),'msg-err');return;}
    printerFileExitSelectMode();
    loadPrinterFiles();
  });
}

var _gcodeFilaments=[];

function _setGcodeFilamentsFromFileObj(fileObj){
  try{
    if(fileObj&&Array.isArray(fileObj.gcode_filaments)){
      _gcodeFilaments=fileObj.gcode_filaments;
    }else if(fileObj&&typeof fileObj.gcode_filaments==='string'&&fileObj.gcode_filaments){
      _gcodeFilaments=JSON.parse(fileObj.gcode_filaments);
    }else{
      _gcodeFilaments=[];
    }
  }catch(e){
    _gcodeFilaments=[];
  }
}

function storePrint(fileId, filename){
  _storeFileId=fileId;
  _storeFilename=filename;
  _filamentDialogMode='store';
  var fileObj=storeFiles.find(function(f){return f.id===fileId;});
  if(_printers.length>1){
    maybeGateWebUpload(fileObj,function(){_setGcodeFilamentsFromFileObj(fileObj);openFarmPrintDialog(fileId,filename);});
    return;
  }
  openStorePrintDialog(fileId, filename, fileObj);
}

var _farmPrintSlots={};
var _farmPrintSlotErrors={};
var _farmPrintCompatibility={};
var _farmPrintOpenSeq=0;
function _fetchGcodeCompat(p,fileId){
  var base=(p.bridge_url||'').replace(/\/+$/,'');
  return fetch(base+'/kx/files/'+encodeURIComponent(fileId)+'/compatibility').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){return d.result||d;});
}
function _compatAllows(c){return !!c&&(c.decision==='native'||c.decision==='convertible');}
function _farmLoadedSlots(slots){
  return (slots||[]).filter(function(s){return s.status==='loaded';}).sort(function(a,b){return a.slot_index-b.slot_index;});
}
function _farmChannels(){
  return _gcodeFilaments.map(function(gc,i){return {gc:gc,paint_index:i};}).filter(function(x){return x.gc.is_used!==false;});
}
function _farmPrintAssignments(printerId){
  var card=document.querySelector('.fp-printer[data-printer="'+CSS.escape(String(printerId))+'"]');
  var channels=_farmChannels();
  // No channel metadata means no manual mapping is possible. Returning null
  // here blocks dispatch instead of letting the bridge auto-map loaded slots.
  if(!card||!channels.length)return null;
  var slots=_farmLoadedSlots(_farmPrintSlots[String(printerId)]), assignments=[], valid=true;
  card.querySelectorAll('.fp-map').forEach(function(sel){
    var channel=channels[parseInt(sel.dataset.channel,10)], idx=parseInt(sel.value,10);
    var slot=channel&&slots.find(function(s){return s.slot_index===idx;});
    if(!slot){valid=false;return;}
    var gc=channel.gc;
    function rgba(hex){var c=(hex||'#ffffff').replace('#','');if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16),255];}
    assignments.push({paint_index:channel.paint_index,is_used:true,slot_index:idx,material:slot.material||gc.material||'PLA',paint_color:rgba(gc.color_hex),ams_color:rgba(slot.color_hex)});
  });
  return valid&&assignments.length===channels.length?assignments:null;
}
function _renderFarmPrintPrinter(p){
  var allSlots=_farmPrintSlots[String(p.id)]||[], slots=_farmLoadedSlots(allSlots), channels=_farmChannels();
  var live=_farmStateCache[String(p.id)]||{}, state=_farmStatus(live), compat=_farmPrintCompatibility[String(p.id)];
  var available=(state==='idle'&&channels.length>0&&_compatAllows(compat));
  var compatText=!compat?'Compatibility unavailable':(compat.decision==='convertible'?'G-code will be adjusted for '+(compat.target_model_name||p.model_name||'this printer'):(compat.decision==='blocked'?(compat.reasons||['Incompatible G-code']).join('; '):'Native G-code'));
  var inventory=allSlots.length?allSlots.slice().sort(function(a,b){return a.slot_index-b.slot_index;}).map(function(s){
    var loaded=s.status==='loaded';
    return '<span class="fp-slot '+(loaded?'loaded':'empty')+'"><i style="background:'+_escAttr(s.color_hex||'#555')+'"></i>Slot '+(s.slot_index+1)+' · '+_kxEsc(loaded?(s.material||'Loaded'):'Empty')+'</span>';
  }).join(''):'<span class="fp-error">'+_kxEsc(_farmPrintSlotErrors[String(p.id)]||'Filament slots unavailable')+'</span>';
  var rows=channels.map(function(channel,i){
    var gc=channel.gc;
    var compatible=slots.filter(function(s){return _materialsCompatible(gc.material,s.material);});
    var opts=compatible.map(function(s){return '<option value="'+s.slot_index+'">'+_swatchEmoji(s.color_hex)+' Slot '+(s.slot_index+1)+' · '+_kxEsc(s.material||'')+'</option>';}).join('');
    if(!opts)opts='<option value="">No compatible loaded slot</option>';
    return '<label class="fp-row"><span style="background:'+_escAttr(gc.color_hex||'#888')+'">'+(i+1)+'</span><b>'+_kxEsc(gc.material||'')+'</b><select class="fp-map" data-channel="'+i+'" '+(compatible.length?'':'disabled')+'>'+opts+'</select></label>';
  }).join('');
  if(!channels.length)rows='<p class="fp-error">No used G-code paint channels found.</p>';
  return '<section class="fp-printer" data-printer="'+_escAttr(String(p.id))+'"><label class="fp-head"><input type="checkbox" class="fp-target" value="'+_escAttr(String(p.id))+'" '+(available?'':'disabled')+'><b>'+_kxEsc(p.name||('Printer '+p.id))+'</b><span class="fp-state '+state+'">'+_kxEsc(available?'Ready':(live.print_state||state))+'</span></label><div class="fp-compat '+_escAttr(compat&&compat.decision||'blocked')+'">'+_kxEsc(compatText)+'</div><div class="fp-inventory">'+inventory+'</div><div class="fp-maps">'+rows+'</div></section>';
}
function openFarmPrintDialog(fileId,filename){
  var dlg=document.getElementById('farm-print-dialog');
  if(!dlg){dlg=document.createElement('div');dlg.id='farm-print-dialog';dlg.className='modal-overlay';dlg.onclick=function(e){if(e.target===dlg)closeFarmPrintDialog();};dlg.innerHTML='<div class="modal-box fp-box"><div class="modal-header"><b id="fp-title"></b><button onclick="closeFarmPrintDialog()">✕</button></div><div id="fp-list"></div><div class="fp-actions"><button onclick="closeFarmPrintDialog()">Cancel</button><button id="fp-confirm">Print selected</button></div></div>';document.body.appendChild(dlg);}
  // Fresh dialog, fresh slot data: stale slots from a previous file must never
  // populate a printer whose fetch has not returned yet or has failed.
  var seq=++_farmPrintOpenSeq;
  _farmPrintSlots={};_farmPrintSlotErrors={};_farmPrintCompatibility={};
  document.getElementById('fp-title').textContent='Print '+filename+' on printers';
  document.getElementById('fp-list').innerHTML='<p class="fp-loading">Loading live filament slots…</p>';
  document.getElementById('fp-confirm').onclick=null;
  dlg.classList.add('open');
  Promise.all(_printers.map(function(p){var base=(p.bridge_url||'').replace(/\/+$/,'');return Promise.all([
    fetch(base+'/kx/filament/slots').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(function(d){_farmPrintSlots[String(p.id)]=d.result||[];}).catch(function(e){_farmPrintSlots[String(p.id)]=[];_farmPrintSlotErrors[String(p.id)]='Slots unavailable: '+e.message;}),
    _fetchGcodeCompat(p,fileId).then(function(c){_farmPrintCompatibility[String(p.id)]=c;}).catch(function(e){_farmPrintCompatibility[String(p.id)]={decision:'blocked',reasons:['Compatibility check failed: '+e.message]};})
  ]);})).then(function(){
    if(seq!==_farmPrintOpenSeq)return;
    document.getElementById('fp-list').innerHTML=_printers.map(_renderFarmPrintPrinter).join('');
    document.getElementById('fp-confirm').onclick=function(){dispatchFarmPrint(fileId);};
  });
}
function closeFarmPrintDialog(){var dlg=document.getElementById('farm-print-dialog');if(dlg)dlg.classList.remove('open');_farmPrintOpenSeq++;}
function dispatchFarmPrint(fileId){
  var selected=[].slice.call(document.querySelectorAll('.fp-target:checked'));
  if(!selected.length)return;
  // Two passes: resolve and validate EVERY target before a single request is
  // issued. Firing inside the validation loop meant an invalid selection
  // aborted only the printers that had not been reached yet - the earlier ones
  // were already printing.
  var targets=[], invalid=[];
  selected.forEach(function(c){
    var p=_printers.find(function(x){return String(x.id)===c.value;});
    if(!p){invalid.push('Printer '+c.value+' (no longer configured)');return;}
    var compat=_farmPrintCompatibility[String(p.id)];
    if(!_compatAllows(compat)){invalid.push((p.name||('Printer '+p.id))+': '+((compat&&compat.reasons||['incompatible G-code']).join('; ')));return;}
    var assignments=_farmPrintAssignments(c.value);
    if(!assignments){invalid.push(p.name||('Printer '+p.id));return;}
    targets.push({p:p,assignments:assignments});
  });
  if(invalid.length){clog('Cannot start print — no valid filament mapping: '+invalid.join(', '),'msg-err');return;}
  closeFarmPrintDialog();kxTransferStart();
  setTimeout(refreshFarmState,300);
  var batch=_farmHeatBatch();
  if(batch&&targets.length>batch)clog('Bed heat limit: starting '+batch+' at a time, next batch when beds reach target','msg-info');
  _farmDispatchBatched(fileId,targets,batch).then(function(){
    refreshFarmState();
  }).catch(function(e){clog('Farm dispatch error: '+e.message,'msg-err');}).then(kxTransferEnd);
}
// Grid load limit: at most N beds heating at once. localStorage kxHeatBatch
// (default 2, 0 = unlimited). Bed heaters are the big draw; ten Kobras
// heating together trips the breaker.
function _farmHeatBatch(){var n=parseInt(localStorage.getItem('kxHeatBatch'),10);return isNaN(n)?2:Math.max(0,n);}
function _farmPostPrint(fileId,t){
  var base=(t.p.bridge_url||'').replace(/\/+$/,'');
  return fetch(base+'/kx/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_id:fileId,filament_assignments:t.assignments})})
    .then(function(r){return r.json().then(function(d){if(!r.ok||d.error||d.result!=='ok')throw new Error(d.error||d.result||('HTTP '+r.status));return {name:t.p.name,ok:true};});})
    .catch(function(e){return {name:t.p.name,ok:false,error:e.message};})
    .then(function(r){clog(r.name+': '+(r.ok?'print started':'print error: '+r.error),r.ok?'msg-ok':'msg-err');return r;});
}
// Bed is settled once within 3°C of a nonzero target, or once the printer is
// past preheating (kobra_state printing) - heating is over either way.
// ponytail: 12min timeout covers a stuck/offline printer instead of per-error classification.
function _farmBedSettled(p,started){
  var s=_farmStateCache[String(p.id)]||{}, t=Number(s.bed_target)||0, c=Number(s.bed_temp)||0;
  return (t>0&&c>=t-3)||s.kobra_state==='printing'||Date.now()-started>12*60*1000;
}
function _farmDispatchBatched(fileId,targets,batch){
  var post=function(t){return _farmPostPrint(fileId,t);};
  if(!batch||targets.length<=batch)return Promise.all(targets.map(post));
  function mark(i){ // group i..i+batch is starting; everything after waits on it
    var names=targets.slice(i,i+batch).map(function(t){return t.p.name;});
    targets.forEach(function(t,k){_farmQueue[String(t.p.id)]=k<i?null:{phase:k<i+batch?'starting':'queued',on:names};});
  }
  function next(i){
    if(i>=targets.length){_farmQueue={};return Promise.resolve();}
    mark(i);
    var group=targets.slice(i,i+batch), started=Date.now();
    return Promise.all(group.map(post)).then(function(rs){
      var pending=group.filter(function(t,k){return rs[k].ok;});
      if(i+batch>=targets.length||!pending.length)return next(i+batch);
      return new Promise(function(res){(function poll(){
        if(pending.every(function(t){return _farmBedSettled(t.p,started);})){res();return;}
        setTimeout(function(){refreshFarmState().then(poll,poll);},3000);
      })();}).then(function(){return next(i+batch);});
    });
  }
  return next(0);
}
// Per-printer status while a batched dispatch is in flight. Rendered by the
// fleet tile and quick-switch; cleared when the last batch has been sent.
var _farmQueue={};
function _farmQueueText(p){
  var q=_farmQueue[String(p.id)];if(!q)return '';
  if(q.phase==='queued')return 'Queued · waiting for '+q.on.join(', ')+' to heat up';
  var s=_farmStateCache[String(p.id)]||{},up=s.upload_progress||{},t=Number(s.bed_target)||0;
  if(up.active)return 'Uploading file · '+Math.round(up.percent||0)+'%';
  return t?'Heating bed '+Math.round(Number(s.bed_temp)||0)+' / '+Math.round(t)+'°C':'File sent · waiting for printer';
}

function openStorePrintDialog(fileId, filename, fileObj){
  _storeFileId=fileId;
  _storeFilename=filename;
  _filamentDialogMode='store';
  maybeGateWebUpload(fileObj, function(){
    // GCode-Filamente aus Store-Datei holen (für Vorschau im Dialog)
    _setGcodeFilamentsFromFileObj(fileObj);
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json()}).then(function(d){
      openFilamentDialog(d.result||[]);
    }).catch(function(){openFilamentDialog([]);});
  });
}

function webUploadWarningEnabled(){
  return S.web_upload_warning===undefined ? true : !!S.web_upload_warning;
}

function clearWebUploadWarningFlag(fileId, onDone){
  if(!fileId){
    if(onDone) onDone();
    return;
  }
  fetch(_apiUrl('/kx/files/'+encodeURIComponent(fileId)+'/verify'), {method:'POST'})
    .then(function(r){
      if(!r.ok) return r.text().then(function(t){throw new Error(r.status+': '+t);});
      return r.json();
    })
    .then(function(){
      var fileObj=(storeFiles||[]).find(function(f){return f.id===fileId;});
      if(fileObj){fileObj.web_unverified=false;}
      if(onDone) onDone();
      loadStore();
    })
    .catch(function(e){
      clog('Verification error: '+e,'msg-err');
    });
}

function maybeGateWebUpload(fileObj, onContinue, opts){
  opts=opts||{};
  if(!fileObj || !fileObj.web_unverified){
    if(onContinue) onContinue();
    return;
  }
  if(!webUploadWarningEnabled()){
    if(onContinue) onContinue();
    return;
  }
  var cancelledId=sessionStorage.getItem('webVerifyCancelledFileId')||'';
  if(opts.autoOpen && cancelledId && cancelledId===String(fileObj.id||'')){
    return;
  }
  openWebVerifyDialog(fileObj.id, fileObj.filename, function(){
    clearWebUploadWarningFlag(fileObj.id, onContinue);
  }, !!opts.autoOpen);
}

function openWebVerifyDialog(fileId, filename, onConfirm, autoOpen){
  _pendingWebVerifyFileId=fileId;
  _pendingWebVerifyFilename=filename;
  _pendingWebVerifyAction=onConfirm||null;
  _pendingWebVerifyAutoOpen=!!autoOpen;
  var status=document.getElementById('store-web-verify-status');
  if(status){status.textContent='';}
  openStoreWebVerifyDialog();
}

function openStoreWebVerifyDialog(){
  var modal=document.getElementById('store-web-verify-dialog');
  if(modal){modal.classList.add('open');}
}

function closeStoreWebVerifyDialog(){
  var modal=document.getElementById('store-web-verify-dialog');
  if(modal){modal.classList.remove('open');}
  if(_pendingWebVerifyAutoOpen && _pendingWebVerifyFileId){
    sessionStorage.setItem('webVerifyCancelledFileId', String(_pendingWebVerifyFileId));
  }
  _pendingWebVerifyFileId=null;
  _pendingWebVerifyFilename='';
  _pendingWebVerifyAction=null;
  _pendingWebVerifyAutoOpen=false;
}

function confirmStoreWebVerify(){
  if(!_pendingWebVerifyFileId||!_pendingWebVerifyFilename){
    closeStoreWebVerifyDialog();
    return;
  }
  var fileId=_pendingWebVerifyFileId;
  var action=_pendingWebVerifyAction;
  var status=document.getElementById('store-web-verify-status');
  if(status){status.textContent='…';}
  fetch(_apiUrl('/kx/files/'+encodeURIComponent(fileId)+'/verify'), {method:'POST'})
    .then(function(r){
      if(!r.ok) return r.text().then(function(t){throw new Error(r.status+': '+t);});
      return r.json();
    })
    .then(function(){
      var fileObj=(storeFiles||[]).find(function(f){return f.id===fileId;});
      if(fileObj){fileObj.web_unverified=false;}
      sessionStorage.removeItem('webVerifyCancelledFileId');
      _pendingWebVerifyFileId=null;
      _pendingWebVerifyFilename='';
      _pendingWebVerifyAction=null;
      _pendingWebVerifyAutoOpen=false;
      closeStoreWebVerifyDialog();
      loadStore();
      if(typeof action==='function') action();
    })
    .catch(function(e){
      if(status){status.textContent='✗ '+e.message;}
      clog('Verification error: '+e,'msg-err');
    });
}

function _showMismatchWarn(mismatches){
  var el=document.getElementById('fd-mismatch-warn');
  if(!el)return;
  if(!mismatches||!mismatches.length){el.style.display='none';el.innerHTML='';return;}
  var lines=mismatches.map(function(m){
    var slot='Slot '+(m.slot_index+1);
    if(m.reason==='empty')
      return '⚠ '+slot+': GCode needs '+_kxEsc(m.gcode_material)+' — slot is empty';
    return '⚠ '+slot+': GCode needs '+_kxEsc(m.gcode_material)+', loaded: '+_kxEsc(m.ams_material||'?');
  });
  el.innerHTML='<strong>Filament mismatch detected</strong><br>'+lines.join('<br>');
  el.style.display='';
}
function startReadyFileWithSlots(filename,_autoOpen,_mismatch){
  if(!_autoOpen) _fdAutoOpenedFile=null; // manueller Aufruf → Auto-Open-Sperre aufheben
  var fn=filename||S.file_ready;
  var currentFile=(storeFiles||[]).find(function(f){return f.filename===fn;});
  if(currentFile && currentFile.web_unverified && webUploadWarningEnabled()){
    maybeGateWebUpload(currentFile, function(){ startReadyFileWithSlots(fn,_autoOpen); }, {autoOpen:!!_autoOpen});
    return;
  }
  _filamentDialogMode='banner';
  _storeFilename=fn||'';
  // Banner must never reuse stale store-file context.
  _storeFileId=null;
  _gcodeFilaments=[];

  var _autoOpenFile=_autoOpen?fn:null;
  if(_autoOpen) _fdDialogOpen=true; // bereits während Fetch sperren
  function openWithSlots(){
    fetch(_apiUrl('/kx/filament/slots')).then(function(r){return r.json()}).then(function(d){
      if(_autoOpenFile && _fdUserCancelled){_fdDialogOpen=false;return;}
      openFilamentDialog(d.result||[]);
      _showMismatchWarn(_mismatch||null);
    }).catch(function(){
      if(_autoOpenFile && _fdUserCancelled){_fdDialogOpen=false;return;}
      openFilamentDialog([]);
      _showMismatchWarn(_mismatch||null);
    });
  }

  function _proceedWithFileObj(fileObj){
    if(fileObj && fileObj.web_unverified && webUploadWarningEnabled()){
      // Verify-Gate war beim ersten Lookup noch nicht aktiv (storeFiles leer) — jetzt prüfen.
      if(_autoOpen){_fdDialogOpen=false;}
      maybeGateWebUpload(fileObj, function(){ startReadyFileWithSlots(fn,_autoOpen); }, {autoOpen:!!_autoOpen});
      return;
    }
    if(fileObj){
      _storeFileId=fileObj.id;
      _setGcodeFilamentsFromFileObj(fileObj);
    }
    openWithSlots();
  }

  var fileObj=(storeFiles||[]).find(function(f){return f.filename===_storeFilename;});
  if(fileObj){
    _proceedWithFileObj(fileObj);
    return;
  }

  // Fallback: refresh file list, then resolve current file by filename.
  fetch(_apiUrl('/kx/files')).then(function(r){return r.json()}).then(function(d){
    storeFiles=d.result||[];
    var refreshed=(storeFiles||[]).find(function(f){return f.filename===_storeFilename;})||null;
    _proceedWithFileObj(refreshed);
  }).catch(function(){
    openWithSlots();
  });
}

var _amsSlots=[];
var _printObjects=[]; // [{name, skip}] für aktuell offenen Dialog
var _printObjectsSvg=''; // base64-SVG aus DB für Visualisierung

// Hilfsfunktionen für farbige Kanal/Slot-Marker (Issue #23)
function _contrastText(hex){
  // Helle Farbe → dunkler Text, dunkle Farbe → heller Text
  var c=(hex||'').replace('#','');
  if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  if(c.length<6)return '#fff';
  var r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
  // YIQ-Helligkeit
  var y=(r*299 + g*587 + b*114)/1000;
  return y>=140?'#111':'#fff';
}
function _normalizeMaterialKey(material){
  var key=(material||'').toUpperCase().replace(/[^A-Z0-9+]/g,'');
  // Orca often uses PLA for PLA+, while AMS may report PLA+.
  if(key==='PLA+'||key==='PLAPLUS') return 'PLA';
  // Handle modifier+base patterns in either order: "Matte PLA", "Silk PETG",
  // "PLA Silk", "PLA Matte". OrcaSlicer always writes the base type in GCode
  // (filament_type = PLA), but users label slots with the full product-style name.
  var trimmed=(material||'').trim();
  if(trimmed.indexOf(' ')>=0){
    var words=trimmed.toUpperCase().split(/\s+/);
    for(var i=0;i<words.length;i++){
      var w=words[i].replace(/[^A-Z0-9+]/g,'');
      if(_BASE_MATERIAL_TYPES.indexOf(w)>=0) return w;
    }
  }
  return key;
}
function _materialsCompatible(a,b){
  return _normalizeMaterialKey(a)===_normalizeMaterialKey(b);
}
// Issue #57 Punkt 4: konkreter Profilname (User-Override) statt generischem Typ.
// Fällt auf den Material-Typ zurück wenn kein Profil gemappt ist.
function _slotProfileLabel(slot){
  if(!slot)return '';
  if(slot.filament_name){
    return slot.filament_name+(slot.filament_vendor?' — '+slot.filament_vendor:'');
  }
  return slot.material||'';
}
function _escAttr(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// Colour strings from G-code headers and printer MQTT go into style/data
// attributes; only a real hex colour may pass, anything else is neutral grey.
function _safeHex(hex){
  var c=String(hex||'').trim();
  if(/^#[0-9a-fA-F]{3}$/.test(c))c='#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3];
  return /^#[0-9a-fA-F]{6}$/.test(c)?c.toLowerCase():'#888888';
}
// Nearest color-emoji swatch for a filament hex, used inside native <option>
// labels. A styled <span> is not an option here: browsers render option text as
// plain text, so the previous '●' inherited the select's own text colour and
// every slot looked white regardless of its real filament colour. Emoji carry
// their own colour through that plain-text path.
// ponytail: 11 emoji is the whole palette the platform gives us, so this is a
// nearest-match, not exact. The adjacent square marker still shows the true hex.
var _SWATCH_EMOJI=[
  ['#ffffff','⚪'],['#000000','⚫'],['#ff0000','🔴'],['#0047bb','🔵'],
  ['#00bb31','🟢'],['#89a84f','🟢'],['#ffec3d','🟡'],['#ff6a14','🟠'],
  ['#7b3fa0','🟣'],['#8b5a2b','🟤'],['#808080','⚪'],['#c0c0c0','⚪']
];
function _swatchEmoji(hex){
  var c=(hex||'').replace('#','').trim();
  if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  // Validate before parsing: CSS shorthand such as "bad" is valid (#bbaadd),
  // while a genuinely non-hex value such as "xyz" gets the neutral fallback.
  if(!/^[0-9a-fA-F]{6}$/.test(c))return '⬜';
  var r=parseInt(c.slice(0,2),16),g=parseInt(c.slice(2,4),16),b=parseInt(c.slice(4,6),16);
  var best='⬜',bestD=Infinity;
  for(var i=0;i<_SWATCH_EMOJI.length;i++){
    var p=_SWATCH_EMOJI[i][0].replace('#','');
    var pr=parseInt(p.slice(0,2),16),pg=parseInt(p.slice(2,4),16),pb=parseInt(p.slice(4,6),16);
    // Weighted RGB distance: green dominates perceived brightness, so an
    // unweighted metric maps mid greys onto colours instead of grey.
    var d=2*(r-pr)*(r-pr)+4*(g-pg)*(g-pg)+3*(b-pb)*(b-pb);
    if(d<bestD){bestD=d;best=_SWATCH_EMOJI[i][1];}
  }
  return best;
}
function _updateSlotMarker(sel){
  var opt=sel.options[sel.selectedIndex];
  var color=opt&&opt.dataset.color?opt.dataset.color:'#888';
  var slotIdx=parseInt(opt.value);
  var paintIdx=sel.dataset.paint;
  var marker=document.querySelector('.fd-slot-marker[data-for-paint="'+paintIdx+'"]');
  if(marker){
    marker.style.background=color;
    marker.style.color=_contrastText(color);
    marker.textContent=(slotIdx+1);
    marker.title=(opt&&opt.dataset.profile)?opt.dataset.profile:'';
  }
}

function openFilamentDialog(slots){
  _amsSlots=slots
    .filter(function(s){return s.status==='loaded';})
    .sort(function(a,b){return (a.slot_index||0)-(b.slot_index||0);});
  _loadSpoolmanStatus();
  var dlg=document.getElementById('filament-dialog');
  var title=document.getElementById('fd-title');
  var body=document.getElementById('fd-slots');
  if(title)title.textContent=_storeFilename;
  // Auto-Leveling-Checkbox mit globalem Default vorbelegen
  var fdAl=document.getElementById('fd-auto-leveling');
  if(fdAl) fdAl.checked=(S.auto_leveling===undefined?true:!!S.auto_leveling);
  // Objekt-Liste laden — sobald eine File-ID auflösbar ist (Issue #57 Punkt 3:
  // Skip-Parität auch im Banner-/Upload-Modus, nicht nur im Store-Modus).
  // startReadyFileWithSlots() setzt _storeFileId auch im Banner-Modus per
  // filename→fileObj-Lookup, daher reicht hier die _storeFileId-Prüfung.
  _printObjects=[];
  _printObjectsSvg='';
  var objSection=document.getElementById('fd-objects-section');
  var objBody=document.getElementById('fd-objects-body');
  var objArrow=document.getElementById('fd-objects-arrow');
  if(objSection)objSection.style.display='none';
  if(objBody)objBody.style.display='none';      // immer eingeklappt starten
  if(objArrow)objArrow.style.transform='';
  if(_storeFileId){
    // Bei frischem Orca-/Web-Upload liefert der Drucker die Objektliste
    // (objects_skip_parts) erst per fileDetails nach → ist im Store kurz leer.
    // Daher mehrfach nachfragen, bis Objekte da sind (Issue #57 Skip-Parität).
    var _objFid=_storeFileId;
    var _objTries=0;
    (function _loadObjects(){
      if(_objFid!==_storeFileId) return; // Dialog wechselte Datei → abbrechen
      fetch(_apiUrl('/kx/files/'+encodeURIComponent(_objFid)+'/objects'))
        .then(function(r){return r.json()})
        .then(function(d){
          var names=(d.result&&d.result.names)||[];
          var svg=(d.result&&d.result.svg_b64)||'';
          if(names.length>=2){
            _printObjectsSvg=svg;
            _printObjects=names.map(function(n){return {name:n,skip:false};});
            renderObjectChecklist(); renderObjectSvg();
            var cnt=document.getElementById('fd-objects-count');
            if(cnt)cnt.textContent='('+names.length+')';
            if(objSection)objSection.style.display='block';
          } else if(_objTries++ < 6){
            setTimeout(_loadObjects, 1000); // bis ~6s auf fileDetails warten
          }
        }).catch(function(){});
    })();
  }

  // GCode-Kanäle: bevorzugt aus _gcodeFilaments, sonst aus belegten AMS-Slots ableiten
  var channels=_gcodeFilaments.length?_gcodeFilaments:_amsSlots.map(function(s,i){
    return {slot_index:i,color_hex:s.color_hex,material:s.material};
  });

  // Default mapping strategy:
  // 1) keep order where possible (row i -> nearest compatible slot i)
  // 2) keep defaults unique while compatible slots are available
  // 3) use color proximity as tie-breaker
  function _hexToRgb(hex){
    var c=(hex||'').replace('#','');
    if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    if(c.length<6)return [255,255,255];
    return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];
  }
  function _colorDist(a,b){
    var ar=_hexToRgb(a), br=_hexToRgb(b);
    var dr=ar[0]-br[0], dg=ar[1]-br[1], db=ar[2]-br[2];
    return (dr*dr + dg*dg + db*db);
  }
  var defaultSlotByPaint={};
  var usedDefaultSlot={};
  channels.forEach(function(gc,i){
    var compatible=_amsSlots.filter(function(s){
      return _materialsCompatible(gc.material, s.material);
    });
    if(!compatible.length){
      defaultSlotByPaint[i]=-1;
      return;
    }

    var ranked=compatible.slice().sort(function(a,b){
      var da=Math.abs((a.slot_index||0)-i), db=Math.abs((b.slot_index||0)-i);
      if(da!==db)return da-db;
      var ca=_colorDist(gc.color_hex, a.color_hex), cb=_colorDist(gc.color_hex, b.color_hex);
      if(ca!==cb)return ca-cb;
      return (a.slot_index||0)-(b.slot_index||0);
    });

    var chosen=ranked.find(function(s){return !usedDefaultSlot[s.slot_index];}) || ranked[0];
    defaultSlotByPaint[i]=chosen?chosen.slot_index:-1;
    if(chosen) usedDefaultSlot[chosen.slot_index]=1;
  });

  if(!_amsSlots.length){
    body.innerHTML='<p style="color:var(--txt2);font-size:13px;text-align:center;padding:16px 0">'+T.fd_no_slots_msg.replace('{br}','<br>')+'</p>';
  } else {
    body.innerHTML=channels.map(function(gc,i){
      var isUsed=(gc&&gc.is_used!==false);
      // Only allow material-compatible slots.
      var compatible=_amsSlots.filter(function(s){
        return _materialsCompatible(gc.material, s.material);
      });

      var defaultSlotIndex=(defaultSlotByPaint.hasOwnProperty(i)?defaultSlotByPaint[i]:-1);
      var defaultSlot=compatible.find(function(s){return s.slot_index===defaultSlotIndex;})||null;
      var opts=compatible.map(function(s){
        var sel=(defaultSlot&&s.slot_index===defaultSlot.slot_index)?'selected':'';
        var sColor=_safeHex(s.color_hex);
        // '●' inherited the select's text colour (white in dark mode), so every
        // slot looked identical. The emoji keeps its own colour in option text.
        return '<option value="'+s.slot_index+'" data-color="'+sColor+'" data-material="'+_escAttr(s.material)+'" data-profile="'+_escAttr(_slotProfileLabel(s))+'" '+sel+'>'+
          _swatchEmoji(sColor)+' '+_kxEsc(T.fd_slot)+' '+(s.slot_index+1)+' · '+_kxEsc(_slotProfileLabel(s))+'</option>';
      }).join('');
      if(!compatible.length){
        opts='<option value="-1" data-color="#888888" data-material="" selected>⚠ '+_kxEsc(T.fd_no_matching_material)+'</option>';
      }
      // Kanal-Box (links): farbige Box mit Nummer + auto Kontrast-Text
      var gcColor=_safeHex(gc.color_hex);
      var txt=_contrastText(gcColor);
      var slotColor=_safeHex(defaultSlot?defaultSlot.color_hex:'#888');
      var slotTxt=_contrastText(slotColor);
      var usedBadge=isUsed
        ? '<span style="font-size:10px;color:var(--ok);font-weight:700;min-width:32px">'+_kxEsc(T.fd_used)+'</span>'
        : '<span style="font-size:10px;color:var(--txt2);font-weight:700;min-width:32px;opacity:.75">'+_kxEsc(T.fd_used)+'</span>';
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;background:var(--raised);border:1px solid var(--border)">'+
        '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:'+gcColor+';color:'+txt+';font-weight:700;font-size:13px;border:1px solid var(--border);flex-shrink:0">'+(i+1)+'</span>'+
        '<span style="font-size:11px;color:var(--txt2);min-width:36px">'+_kxEsc(gc.material)+'</span>'+
        usedBadge+
        '<span style="font-size:16px;color:var(--txt2)">→</span>'+
        '<span class="fd-slot-marker" data-for-paint="'+i+'" title="'+_escAttr(defaultSlot?_slotProfileLabel(defaultSlot):'')+'" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:5px;background:'+slotColor+';color:'+slotTxt+';font-weight:700;font-size:12px;border:1px solid var(--border);flex-shrink:0">'+(defaultSlot?defaultSlot.slot_index+1:'?')+'</span>'+
        '<select data-paint="'+i+'" data-paint-color="'+gcColor+'" data-is-used="'+(isUsed?'1':'0')+'" data-has-compatible="'+(compatible.length?'1':'0')+'" '+(compatible.length?'':'disabled')+' onchange="_updateSlotMarker(this)" style="flex:1;min-width:0;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--raised);color:var(--txt);font-size:12px">'+
        opts+'</select>'+
      '</div>';
    }).join('');
  }
  if(dlg)dlg.classList.add('open');
  // Spoolman-Section nach Slot-Render aufbauen (braucht die selects im DOM)
  setTimeout(_buildSpoolmanSection, 0);
}

function closeFilamentDialog(){
  var dlg=document.getElementById('filament-dialog');
  if(dlg)dlg.classList.remove('open');
  _showMismatchWarn(null);
  _fdDialogOpen=false;
  if(_fdAutoOpenedFile){
    _fdUserCancelled=true;
    sessionStorage.setItem('fdUserCancelled','1');
    sessionStorage.setItem('fdAutoOpenedFile',_fdAutoOpenedFile);
  }
}

function confirmFilamentPrint(){
  var selects=document.querySelectorAll('#fd-slots select');
  var assignments=[];
  var missingCompatible=0;
  selects.forEach(function(sel){
    var paintIdx=parseInt(sel.dataset.paint);
    var paintColor=sel.dataset.paintColor;
    var isUsed=(sel.dataset.isUsed==='1');
    var hasCompatible=(sel.dataset.hasCompatible==='1');
    var opt=sel.options[sel.selectedIndex];
    var amsIdx=parseInt(opt&&opt.value);
    if(!hasCompatible || Number.isNaN(amsIdx) || amsIdx < 0){
      if(isUsed) missingCompatible += 1;
      amsIdx = -1;
    }
    var amsSlot=_amsSlots.find(function(s){return s.slot_index===amsIdx;})||{};
    // Farbe als [R,G,B,255]
    function hexToRgba(h){
      var c=h.replace('#','');
      if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
      return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16),255];
    }
    assignments.push({
      paint_index:  paintIdx,
      is_used:      isUsed,
      slot_index:   amsIdx,
      material:     opt.dataset.material||'PLA',
      paint_color:  hexToRgba(paintColor||'#ffffff'),
      ams_color:    hexToRgba(amsSlot.color_hex||'#ffffff'),
    });
  });
  if(missingCompatible>0){
    clog('Cannot start print: '+missingCompatible+' used paint(s) have no matching material slot','msg-err');
    return;
  }
  // Pre-Print Skip: Namen der abgehakten Objekte sammeln
  var excludedObjects=_printObjects.filter(function(o){return o.skip;}).map(function(o){return o.name;});
  var fdAlEl=document.getElementById('fd-auto-leveling');
  var fdAutoLeveling=fdAlEl?( fdAlEl.checked?1:0):(S.auto_leveling===undefined?1:S.auto_leveling?1:0);
  // Spoolman: Slot→Spool-Mapping aus Dialog sammeln und senden
  if(_spoolmanStatus.configured){
    var slotMap={};
    document.querySelectorAll('[data-spool-slot]').forEach(function(sel){
      var idx=sel.dataset.spoolSlot;
      var val=parseInt(sel.value);
      if(val>0)slotMap[idx]=val;
    });
    _slotSpoolMap=slotMap;
    post('/kx/spoolman/active-spool',{slot_map:slotMap}).catch(function(){});
  }
  closeFilamentDialog();
  if(_filamentDialogMode==='banner'){
    // Banner-Modus: /kx/print bevorzugen wenn _storeFileId bekannt (gleicher Pfad wie File-Browser).
    var btn=document.getElementById('file-ready-btn');
    if(btn){btn.disabled=true;btn.textContent='…';}
    var startPromise;
    if(_storeFileId){
      startPromise=fetch(_apiUrl('/kx/print'),{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          file_id:_storeFileId,
          filament_assignments:assignments,
          excluded_objects:excludedObjects,
          auto_leveling:fdAutoLeveling
        })
      });
    }else{
      startPromise=post('/printer/print/start',{
        filename:S.file_ready||_storeFilename,
        filament_assignments:assignments,
        excluded_objects:excludedObjects,
        auto_leveling:fdAutoLeveling
      });
    }
    kxTransferStart();
    startPromise.then(function(r){
      if(!r.ok){return r.text().then(function(t){throw new Error(t||('HTTP '+r.status));});}
      return r.json();
    }).then(function(d){
      if(d&&d.error) throw new Error(d.error);
      if(d&&d.result&&d.result!=='ok') throw new Error(String(d.result));
      document.getElementById('file-ready-banner').style.display='none';
      if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
    }).catch(function(e){
      clog(tr('log_error')+' '+e,'msg-err');
      if(btn){btn.disabled=false;setText('file-ready-btn',T.file_ready_btn);}
    }).then(function(){kxTransferEnd();});
  } else {
    // Store-Modus: POST /kx/print
    kxTransferStart();
    fetch(_apiUrl('/kx/print'),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file_id:_storeFileId,filament_assignments:assignments,excluded_objects:excludedObjects,auto_leveling:fdAutoLeveling})
    }).then(function(r){return r.json()}).then(function(d){
      if(d.result==='ok'){clog('Print started: '+_storeFilename,'msg-ok');showPanel('dashboard');}
      else{clog('Print error: '+(d.error||'?'),'msg-err');}
    }).catch(function(e){clog('Print error: '+e,'msg-err');})
      .then(function(){kxTransferEnd();});
  }
}

function renderObjectChecklist(){
  var box=document.getElementById('fd-objects');
  if(!box)return;
  box.innerHTML=_printObjects.map(function(o,i){
    var label=o.name;
    // Klipper-Namen sind oft "Datei.stl_id_N_copy_M" → schöner darstellen
    var m=label.match(/^(.+)\.stl_id_(\d+)_copy_(\d+)$/);
    if(m)label=m[1]+' #'+(parseInt(m[2])+1)+(m[3]!=='0'?' ('+(parseInt(m[3])+1)+')':'');
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--raised);border:1px solid var(--border);cursor:pointer;font-size:12px">'+
      '<input type="checkbox" data-idx="'+i+'" '+(o.skip?'checked':'')+' onchange="_toggleObjectSkip('+i+',this.checked)">'+
      '<span style="word-break:break-all">'+_kxEsc(label)+'</span>'+
      '</label>';
  }).join('');
}
function _toggleObjectSkip(idx,val){
  if(_printObjects[idx])_printObjects[idx].skip=!!val;
  renderObjectSvg();
}
// Issue #57 Punkt 3: Skip-Objekte-Bereich ein-/ausklappen
function toggleFdObjects(){
  var body=document.getElementById('fd-objects-body');
  var arrow=document.getElementById('fd-objects-arrow');
  if(!body)return;
  var open=body.style.display!=='none';
  body.style.display=open?'none':'block';
  if(arrow)arrow.style.transform=open?'':'rotate(90deg)';
}
function renderObjectSvg(){
  var box=document.getElementById('fd-objects-svg');
  if(!box)return;
  if(!_printObjectsSvg||!_printObjects.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  var svgEl=_renderSvgInto(box,_printObjectsSvg);
  if(!svgEl){box.style.display='none';return;}
  svgEl.style.width='100%'; svgEl.style.maxHeight='200px'; svgEl.style.height='auto';
  _printObjects.forEach(function(o,i){
    var g=svgEl.querySelector('g[id="'+CSS.escape(o.name)+'"]');
    if(!g)return;
    var path=g.querySelector('path');
    g.style.cursor='pointer';
    g.setAttribute('opacity', o.skip?'0.8':'0.35');
    if(path){
      path.setAttribute('fill', o.skip?'#ff5e5b':'#5fa7ff');
      path.setAttribute('fill-opacity', o.skip?'0.4':'0.18');
    }
    g.onclick=function(){
      _printObjects[i].skip=!_printObjects[i].skip;
      renderObjectChecklist(); renderObjectSvg();
    };
  });
}

// ── Mid-Print Skip ──
var _skipObjects=[]; // [{name, skipped, willSkip}]
var _skipSvg='';
var _skipPollTimer=null;
function _applySkipDialogState(s){
  s=s||{};
  _skipSvg=s.svg_b64||'';
  var skipped=s.skipped||[];
  // Pending-Auswahl (willSkip) beim Refresh erhalten.
  var prevWillSkip={};
  (_skipObjects||[]).forEach(function(o){if(o&&o.name)prevWillSkip[o.name]=!!o.willSkip;});
  _skipObjects=(s.objects||[]).map(function(n){
    var isSkipped=(skipped.indexOf(n)>=0);
    return {name:n, skipped:isSkipped, willSkip:isSkipped?false:!!prevWillSkip[n]};
  });
  renderSkipList(); renderSkipSvg();
}
function openSkipDialog(){
  document.getElementById('skip-status').textContent='';
  document.getElementById('skip-confirm').disabled=false;
  _refreshSkipDialog();
  if(_skipPollTimer)clearInterval(_skipPollTimer);
  _skipPollTimer=setInterval(function(){
    var dlg=document.getElementById('skip-dialog');
    if(!(dlg&&dlg.classList.contains('open')))return;
    _refreshSkipDialog();
  },2000);
  document.getElementById('skip-dialog').classList.add('open');
}
function _refreshSkipDialog(){
  // query-Endpoint wartet intern auf frischen skip/report (bis 1.5s).
  fetch(_apiUrl('/kx/skip/query'),{method:'POST'})
    .then(function(r){return r.json();})
    .then(function(d){_applySkipDialogState(d.result||{});})
    .catch(function(){
      fetch(_apiUrl('/kx/skip/state')).then(function(r){return r.json();}).then(function(d){
        _applySkipDialogState(d.result||{});
      }).catch(function(){});
    });
}
function closeSkipDialog(){
  if(_skipPollTimer){clearInterval(_skipPollTimer);_skipPollTimer=null;}
  document.getElementById('skip-dialog').classList.remove('open');
}
function _shortLabel(name){
  var m=name.match(/^(.+)\.[sS][tT][lL]_id_(\d+)_copy_(\d+)$/);
  if(!m)return name;
  return m[1]+' #'+(parseInt(m[2])+1)+(m[3]!=='0'?' ('+(parseInt(m[3])+1)+')':'');
}
function renderSkipList(){
  var box=document.getElementById('skip-list');
  if(!box)return;
  if(!_skipObjects.length){
    box.innerHTML='<div style="color:var(--txt2);font-size:12px;padding:12px;text-align:center">'+tr('skip_no_objects')+'</div>';
    return;
  }
  box.innerHTML=_skipObjects.map(function(o,i){
    var label=_shortLabel(o.name);
    var dis=o.skipped?'disabled':'';
    var note=o.skipped?'<span style="font-size:11px;color:var(--warn);margin-left:auto">'+tr('skip_already')+'</span>':'';
    return '<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--raised);border:1px solid var(--border);font-size:12px;'+(o.skipped?'opacity:0.5':'')+'">'+
      '<input type="checkbox" data-idx="'+i+'" '+(o.willSkip?'checked':'')+' '+dis+' onchange="_toggleWillSkip('+i+',this.checked)">'+
      '<span style="word-break:break-all">'+_kxEsc(label)+'</span>'+note+
      '</label>';
  }).join('');
}
// Printer-supplied SVG is untrusted markup. Parse it, then copy only the shape
// elements and attributes the object picker actually needs into a fresh tree -
// dropping <script>, <foreignObject>, every on* handler and any javascript:
// URL. Assigning the decoded string straight to innerHTML let printer file
// metadata run code in the dashboard.
var _SVG_TAGS={svg:1,g:1,path:1,polygon:1,polyline:1,rect:1,circle:1,ellipse:1,line:1,title:1,defs:1};
var _SVG_ATTRS={id:1,d:1,points:1,x:1,y:1,x1:1,y1:1,x2:1,y2:1,cx:1,cy:1,r:1,rx:1,ry:1,
  width:1,height:1,fill:1,'fill-opacity':1,'fill-rule':1,stroke:1,'stroke-width':1,
  'stroke-linecap':1,'stroke-linejoin':1,opacity:1,transform:1,viewBox:1,preserveAspectRatio:1,
  xmlns:1,class:1};
function _sanitizeSvg(markup){
  var doc;
  try{ doc=new DOMParser().parseFromString(markup,'image/svg+xml'); }catch(e){ return null; }
  if(!doc||doc.querySelector('parsererror'))return null;
  var src=doc.documentElement;
  if(!src||src.nodeName.toLowerCase()!=='svg')return null;
  function copy(node){
    var tag=node.nodeName.toLowerCase();
    if(!_SVG_TAGS[tag])return null;
    var out=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Array.prototype.forEach.call(node.attributes||[],function(a){
      var n=a.name.toLowerCase();
      if(!_SVG_ATTRS[n])return;                       // drops on*, href, style
      if(/(?:javascript|data):/i.test(a.value))return;
      out.setAttribute(a.name,a.value);
    });
    Array.prototype.forEach.call(node.childNodes,function(c){
      if(c.nodeType===3){out.appendChild(document.createTextNode(c.nodeValue));return;}
      if(c.nodeType!==1)return;                        // drops comments/CDATA
      var child=copy(c);
      if(child)out.appendChild(child);
    });
    return out;
  }
  return copy(src);
}
function _renderSvgInto(box,b64){
  var markup='';
  try{ markup=atob(b64); }catch(e){ return null; }
  var safe=_sanitizeSvg(markup);
  box.innerHTML='';
  if(!safe)return null;
  box.appendChild(safe);
  return safe;
}
function renderSkipSvg(){
  var box=document.getElementById('skip-svg');
  if(!box)return;
  if(!_skipSvg||!_skipObjects.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='block';
  var svgEl=_renderSvgInto(box,_skipSvg);
  if(!svgEl){box.style.display='none';return;}
  svgEl.style.width='100%'; svgEl.style.maxHeight='280px'; svgEl.style.height='auto';
  _skipObjects.forEach(function(o,i){
    var g=svgEl.querySelector('g[id="'+CSS.escape(o.name)+'"]');
    if(!g)return;
    var path=g.querySelector('path');
    if(o.skipped){
      // bereits übersprungen → ausgegraut, kein Klick
      g.setAttribute('opacity','0.25');
      if(path){path.setAttribute('fill','#888');path.setAttribute('fill-opacity','0.3');}
      g.style.cursor='not-allowed';
    } else {
      g.style.cursor='pointer';
      g.setAttribute('opacity', o.willSkip?'0.8':'0.35');
      if(path){
        path.setAttribute('fill', o.willSkip?'#ff5e5b':'#5fa7ff');
        path.setAttribute('fill-opacity', o.willSkip?'0.4':'0.18');
      }
      g.onclick=function(){
        _skipObjects[i].willSkip=!_skipObjects[i].willSkip;
        renderSkipList(); renderSkipSvg();
      };
    }
  });
}
function _toggleWillSkip(idx,val){
  if(_skipObjects[idx])_skipObjects[idx].willSkip=!!val;
  renderSkipSvg();
}
function confirmSkip(){
  var names=_skipObjects.filter(function(o){return o.willSkip;}).map(function(o){return o.name;});
  var st=document.getElementById('skip-status');
  var btn=document.getElementById('skip-confirm');
  if(!names.length){st.textContent=tr('skip_select_at_least_one');st.style.color='var(--warn)';return;}
  btn.disabled=true; st.textContent=tr('skip_sending'); st.style.color='var(--txt2)';
  fetch(_apiUrl('/kx/skip'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({names:names})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){st.textContent=(res.j&&res.j.error)||tr('log_error','Error');st.style.color='var(--err)';btn.disabled=false;return;}
      st.textContent=tr('skip_success');st.style.color='var(--ok)';
      // Dialog offen lassen + neu laden damit der "übersprungen"-Status erscheint
      setTimeout(function(){ _refreshSkipDialog(); btn.disabled=false; st.textContent=''; }, 1500);
    })
    .catch(function(e){st.textContent=''+e;st.style.color='var(--err)';btn.disabled=false;});
}

function storeDelete(fileId){
  if(!confirm(T.store_delete_confirm)) return;
  fetch(_apiUrl('/kx/files/'+fileId),{method:'DELETE'}).then(function(r){
    if(r.ok){loadStore();}
    else{clog('Delete failed','msg-err');}
  });
}

function storeDownload(fileId){
  var a=document.createElement('a');
  a.href=_apiUrl('/kx/files/'+encodeURIComponent(fileId)+'/download');
  a.style.display='none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Drucker hinzufügen ──
function openAddPrinterDialog(){
  document.getElementById('apd-ip').value='';
  document.getElementById('apd-name').value='';
  var st=document.getElementById('apd-status');st.textContent='';st.style.color='var(--txt2)';
  document.getElementById('apd-confirm').disabled=false;
  document.getElementById('add-printer-dialog').classList.add('open');
}
function closeAddPrinterDialog(){
  document.getElementById('add-printer-dialog').classList.remove('open');
}
function confirmAddPrinter(){
  var ip=document.getElementById('apd-ip').value.trim();
  var name=document.getElementById('apd-name').value.trim();
  var st=document.getElementById('apd-status'),btn=document.getElementById('apd-confirm');
  if(!ip){st.textContent=T.apd_err_ip;st.style.color='var(--err)';return;}
  st.textContent=T.apd_fetching;st.style.color='var(--txt2)';btn.disabled=true;
  fetch('/kx/printers/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({printer_ip:ip,name:name})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){st.textContent=(res.j&&res.j.error)||tr('log_error','Error');st.style.color='var(--err)';btn.disabled=false;return;}
      st.textContent=T.apd_success;st.style.color='var(--ok)';
      setTimeout(function(){location.reload();},2500);
    })
    .catch(function(e){st.textContent=''+e;st.style.color='var(--err)';btn.disabled=false;});
}
function removePrinter(id,name){
  if(!confirm(T.printers_remove_confirm.replace('{name}',name)))return;
  fetch('/kx/printers/'+encodeURIComponent(id),{method:'DELETE'})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){alert((res.j&&res.j.error)||tr('log_error','Error'));return;}
      setTimeout(function(){location.href='/printer1';},2000);
    })
    .catch(function(e){alert(''+e);});
}

// ── Drucker-Tab ──
// ── Print-farm overview ────────────────────────────────────────────────────
// One backend request reads every bridge's in-memory state. Refreshing this
// panel therefore does not fan out HTTP calls or wake printer firmware.
var _farmTimer=null;
var _farmSelected={};
var _farmLastStates={};
var _farmStats={};
var _farmAlerted={};
var _farmProgressSeen={};
var FARM_SERVICE_HOURS=500;
var FARM_SERVICE_JOBS=100;
var FARM_STALL_MS=15*60*1000;

function _farmPanelChanged(id){
  if(_farmTimer){clearInterval(_farmTimer);_farmTimer=null;}
  if(id!=='printers'&&typeof closeFlowDrawer==='function')closeFlowDrawer();
  if(id==='printers'){
    // Paint immediately from the background cache, then reconcile with live
    // data. The 5s farm poll in refreshFarmState() keeps the cards updated, so
    // no second interval is needed.
    var cached=Object.keys(_farmStateCache).map(function(k){return _farmStateCache[k];});
    if(cached.length)renderFarmOverview({printers:cached});
    loadPrinterTab();
  }
}

function _farmFmtTime(sec){
  sec=Math.max(0,parseInt(sec||0));
  var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);
  return h?(h+'h '+m+'m'):(m+'m');
}

function _farmSeverity(p){
  var ks=(p.kobra_state||'').toLowerCase();
  if(p.maintenance_mode)return 1;
  if(p.connection_error||p.error_code||ks==='offline')return 0;
  if(ks==='paused'||ks==='pause')return 0;
  if((p.hours_since_service||0)>=FARM_SERVICE_HOURS||(p.jobs_since_service||0)>=FARM_SERVICE_JOBS)return 1;
  if(ks==='finished')return 2;
  if(ks==='printing'||ks==='preheating'||ks==='auto_leveling'||ks==='checking')return 3;
  return 4;
}

function _farmAlerts(p){
  var a=[],ks=(p.kobra_state||'').toLowerCase();
  if(p.maintenance_mode)a.push({key:'maintenance',level:'warn',text:'Maintenance: '+(p.maintenance_reason||'enabled')});
  if(p.connection_error||ks==='offline')a.push({key:'offline',level:'err',text:'Offline'+(p.connection_error?': '+p.connection_error:'')});
  if(p.error_code)a.push({key:'error-'+p.error_code,level:'err',text:'Error '+p.error_code+(p.pause_msg?': '+p.pause_msg:'')});
  else if(ks==='paused'||ks==='pause')a.push({key:'paused',level:'err',text:'Print paused'+(p.pause_msg?': '+p.pause_msg:'')});
  var up=p.upload_progress||{};
  if(up.phase==='error')a.push({key:'upload',level:'err',text:'Upload failed'+(up.error?': '+up.error:'')});
  // Stalled progress: only while printing, and only after 15 minutes with no
  // progress/layer change. State polling remains 5s against in-memory data;
  // this adds no printer queries.
  if(ks==='printing'){
    var sig=String(p.progress||0)+':'+String(p.curr_layer||0);
    var seen=_farmProgressSeen[String(p.id)];
    if(!seen||seen.sig!==sig)_farmProgressSeen[String(p.id)]={sig:sig,ts:Date.now()};
    else if(Date.now()-seen.ts>=FARM_STALL_MS)
      a.push({key:'stalled',level:'err',text:'Progress unchanged for 15 minutes'});
  }else{
    delete _farmProgressSeen[String(p.id)];
  }
  // Heater-target mismatch is actionable only when a target is nonzero and the
  // machine has had time to heat. Avoid false alarms during normal ramp-up.
  if((p.print_duration||0)>600){
    if((p.nozzle_target||0)>0&&Math.abs((p.nozzle_temp||0)-p.nozzle_target)>15)
      a.push({key:'nozzle-temp',level:'warn',text:'Nozzle '+Math.round(p.nozzle_temp)+'/'+Math.round(p.nozzle_target)+'°C'});
    if((p.bed_target||0)>0&&Math.abs((p.bed_temp||0)-p.bed_target)>10)
      a.push({key:'bed-temp',level:'warn',text:'Bed '+Math.round(p.bed_temp)+'/'+Math.round(p.bed_target)+'°C'});
  }
  if((p.hours_since_service||0)>=FARM_SERVICE_HOURS||(p.jobs_since_service||0)>=FARM_SERVICE_JOBS)
    a.push({key:'service-due',level:'warn',text:'Service due: '+(p.hours_since_service||0)+'h / '+(p.jobs_since_service||0)+' jobs'});
  return a;
}

function _farmNotify(p,alerts){
  alerts.forEach(function(a){
    var id=p.id+':'+a.key;
    if(_farmAlerted[id])return;
    _farmAlerted[id]=true;
    clog('Farm alert — '+p.name+': '+a.text,a.level==='err'?'msg-err':'msg-warn');
    if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
      try{new Notification('Kobra Bridge: '+p.name,{body:a.text});}catch(_){}
    }
  });
  // Let a recovered alert fire again if it recurs later.
  Object.keys(_farmAlerted).forEach(function(id){
    if(id.indexOf(p.id+':')!==0)return;
    var key=id.slice((p.id+':').length);
    if(!alerts.some(function(a){return a.key===key;}))delete _farmAlerted[id];
  });
}

function enableFarmNotifications(){
  if(typeof Notification==='undefined'){clog('Browser notifications unavailable','msg-err');return;}
  Notification.requestPermission().then(function(p){
    clog('Farm notifications: '+p,p==='granted'?'msg-ok':'msg-warn');
  });
}

// A finished print means a bed needs clearing - the single most useful farm
// signal. Fires on the transition into 'finished', so a printer left sitting
// finished does not re-notify on every refresh.
var _farmPrevState={};
function _farmNotifyFinished(printers){
  printers.forEach(function(p){
    var id=String(p.id),ks=(p.kobra_state||'').toLowerCase(),prev=_farmPrevState[id];
    if(prev&&prev!=='finished'&&ks==='finished'){
      var msg=p.name+': print finished'+(p.filename?' — '+p.filename:'');
      clog(msg,'msg-ok');
      if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
        try{new Notification('Kobra Bridge: '+p.name,{body:'Print finished — bed needs clearing'});}catch(_){}
      }
    }
    _farmPrevState[id]=ks;
  });
}

function farmToggle(id,checked){
  if(checked)_farmSelected[String(id)]=true; else delete _farmSelected[String(id)];
  _farmUpdateBulkBar();
}
function farmSelectAll(checked){
  _farmSelected={};
  if(checked)(_farmLastStates.printers||[]).forEach(function(p){_farmSelected[String(p.id)]=true;});
  renderFarmOverview(_farmLastStates);
}
function _farmTargets(){
  return (_farmLastStates.printers||[]).filter(function(p){return _farmSelected[String(p.id)];});
}
function _farmUpdateBulkBar(){
  var n=Object.keys(_farmSelected).length;
  var bar=document.getElementById('farm-bulk-bar');
  var count=document.getElementById('farm-selected-count');
  if(bar)bar.style.display=n?'flex':'none';
  if(count)count.textContent=n+' selected';
}

function _farmPost(target,path,body){
  var base='http://'+location.hostname+':'+target.port;
  return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})})
    .then(function(r){return r.json().catch(function(){return{};}).then(function(d){
      if(!r.ok||d.error)throw new Error(d.error||('HTTP '+r.status));return d;
    });});
}

function farmRefreshSelected(){loadPrinterTab();}
function farmStopSelected(){
  var targets=_farmTargets().filter(function(p){
    var s=(p.kobra_state||'').toLowerCase();return s==='printing'||s==='paused'||s==='pause';
  });
  if(!targets.length){clog('No selected printer is printing','msg-warn');return;}
  var names=targets.map(function(p){return p.name;}).join(', ');
  if(!confirm('STOP prints on: '+names+'?\n\nThis cannot be undone.'))return;
  Promise.all(targets.map(function(p){
    return _farmPost(p,'/printer/print/cancel',{}).then(function(){return{name:p.name,ok:true};})
      .catch(function(e){return{name:p.name,ok:false,error:e.message};});
  })).then(function(results){
    results.forEach(function(r){clog(r.name+': '+(r.ok?'stop sent':'stop failed: '+r.error),r.ok?'msg-ok':'msg-err');});
    setTimeout(loadPrinterTab,1000);
  });
}

function farmDeleteSelected(){
  var targets=_farmTargets(),name=prompt('Exact filename to delete from selected printers:','');
  if(!targets.length||!name)return;
  if(!confirm('Delete "'+name+'" from: '+targets.map(function(p){return p.name;}).join(', ')+'?'))return;
  Promise.all(targets.map(function(p){
    return _farmPost(p,'/kx/printer-files/delete',{filenames:[name]}).then(function(){return{name:p.name,ok:true};})
      .catch(function(e){return{name:p.name,ok:false,error:e.message};});
  })).then(function(results){
    results.forEach(function(r){clog(r.name+': '+(r.ok?'file deleted':'delete failed: '+r.error),r.ok?'msg-ok':'msg-err');});
  });
}

function farmMaintenance(id,enabled){
  var p=(_farmLastStates.printers||[]).find(function(x){return String(x.id)===String(id);});
  if(!p)return;
  var reason=enabled?(prompt('Maintenance reason for '+p.name+':',p.maintenance_reason||'')||''):'';
  if(enabled&&!reason)return;
  _farmPost(p,'/kx/maintenance',{maintenance_mode:enabled,reason:reason})
    .then(loadPrinterTab).catch(function(e){clog('Maintenance update failed: '+e.message,'msg-err');});
}
function farmServiced(id){
  var p=(_farmLastStates.printers||[]).find(function(x){return String(x.id)===String(id);});
  if(!p||!confirm('Mark '+p.name+' as serviced now?'))return;
  var note=prompt('Service note (optional):','')||'';
  _farmPost(p,'/kx/maintenance',{action:'serviced',note:note})
    .then(loadPrinterTab).catch(function(e){clog('Service update failed: '+e.message,'msg-err');});
}

function renderFarmStats(stats){
  _farmStats=stats||{};
  var host=document.getElementById('farm-stats');
  if(!host)return;
  var rows=Object.keys(_farmStats.printers||{}).sort().map(function(id){
    var s=_farmStats.printers[id];
    return '<tr><td>'+_kxEsc(s.name||('Printer '+id))+'</td><td>'+s.utilization_pct+'%</td><td>'+s.print_hours+'h</td><td>'+s.completed+'/'+s.jobs+'</td><td>'+(s.success_rate_pct===null?'–':s.success_rate_pct+'%')+'</td><td>'+s.hours_since_service+'h / '+s.jobs_since_service+'</td></tr>';
  }).join('');
  host.innerHTML='<div style="font-weight:700;margin-bottom:8px">7-day utilization</div><div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th>Printer</th><th>Util.</th><th>Hours</th><th>Done/jobs</th><th>Success</th><th>Since service</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function _farmStatusBadge(ks,alerts,maint){
  ks=(ks||'free').toLowerCase();
  if(alerts.some(function(a){return a.level==='err';}))return {cls:'status-err',dot:'#ff5c5c',label:alerts[0].text||'Error'};
  if(maint)return {cls:'status-maint',dot:'#ffb84d',label:'Maintenance'};
  if(ks==='printing')return {cls:'status-print',dot:'#3aa8ff',label:'Printing'};
  if(ks==='paused'||ks==='pause')return {cls:'status-pause',dot:'#ffb84d',label:'Paused'};
  if(ks==='finished')return {cls:'status-done',dot:'#2ecc71',label:'Finished'};
  if(ks==='free'||ks==='idle'||ks==='standby')return {cls:'status-idle',dot:'#2ecc71',label:'Ready'};
  return {cls:'status-warn',dot:'#ffb84d',label:ks};
}

// ── Flow farm view (approved option D) ───────────────────────────────────────
// Organised by the operator's loop, not by data type:
//   1. Needs you   - attention queue; empty when nothing needs a human.
//   2. Fleet       - one tile per printer; drop target for a file; click = drawer.
//   3. Send a job  - file library with thumbnails; picking a file computes
//                    filament fit per printer BEFORE any dialog; Start routes
//                    through the same validated dispatchFarmPrint() path.
// All destructive actions keep their existing confirmations/handlers.
var _flowSel=null;          // selected store file id
var _flowTargets={};        // printer id -> true
var _flowDrag=null;         // file id being dragged
var _flowMaps={};           // printer id -> [slot_index per channel] (manual overrides)
var _flowCompatCache={};    // file id -> printer id -> compatibility report
var _flowCompatProgress={}; // file id -> shared source scan progress
var _flowCompatPollToken=0;

function _flowCompat(p,f){return f&&_flowCompatCache[String(f.id)]&&_flowCompatCache[String(f.id)][String(p.id)]||null;}
function _flowCanTarget(p,f){var s=_flowState(p);return s==='ready'&&_flowFit(p,f).ok&&_compatAllows(_flowCompat(p,f));}
function _flowCompatText(p,f){
  var c=_flowCompat(p,f),pr=f&&_flowCompatProgress[String(f.id)];
  if(!c&&pr&&pr.active){
    var stage=pr.phase==='hashing'?'Reading file':'Scanning commands';
    var done=(Number(pr.processed_bytes)||0)/1048576,total=(Number(pr.size_bytes)||0)/1048576;
    return 'Checking G-code compatibility · '+Math.round(pr.percent||0)+'% · '+stage+' '+done.toFixed(0)+'/'+total.toFixed(0)+' MB';
  }
  if(!c)return 'Checking G-code compatibility…';
  if(c.decision==='convertible')return 'G-code adjusted for '+(c.target_model_name||p.model_name||'this printer');
  if(c.decision==='blocked')return (c.reasons||['incompatible G-code']).join('; ');
  return '';
}
// One compatibility fetch per (file, printer); results are cached until the
// file list changes so the 5 s farm refresh never re-scans a 300 MB file.
function _flowLoadCompat(f){
  var fid=String(f.id),cache=_flowCompatCache[fid]||(_flowCompatCache[fid]={}),printers=_farmLastStates.printers||[];
  var pending=printers.filter(function(p){return !cache[String(p.id)];});
  if(!pending.length)return Promise.resolve();
  var token=++_flowCompatPollToken,finished=false,progressPrinter=pending[0];
  function pollProgress(){
    if(finished||token!==_flowCompatPollToken)return;
    var base=(progressPrinter.bridge_url||'').replace(/\/+$/,'');
    fetch(base+'/kx/files/'+encodeURIComponent(fid)+'/compatibility/progress',{cache:'no-store'})
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
      .then(function(d){if(token!==_flowCompatPollToken)return;_flowCompatProgress[fid]=d.result||d;if(String(_flowSel)===fid)renderFlowJob();})
      .catch(function(){})
      .then(function(){if(!finished&&token===_flowCompatPollToken)setTimeout(pollProgress,500);});
  }
  pollProgress();
  return Promise.all(pending.map(function(p){return _fetchGcodeCompat(p,fid).then(function(c){cache[String(p.id)]=c;}).catch(function(e){cache[String(p.id)]={decision:'blocked',reasons:['Compatibility check failed: '+e.message]};});})).then(function(){
    finished=true;_flowCompatProgress[fid]={active:false,phase:'done',percent:100};
    if(String(_flowSel)===fid){printers.forEach(function(p){if(_flowTargets[p.id]&&!_flowCanTarget(p,f))delete _flowTargets[p.id];});renderFarmOverview(_farmLastStates);}
  });
}

function _flowFileById(id){return (storeFiles||[]).find(function(f){return String(f.id)===String(id);});}
function _flowFileByName(n){return n&&(storeFiles||[]).find(function(f){return f.filename===n;});}
function _flowChannels(f){
  var fil=[];try{fil=typeof f.gcode_filaments==='string'?JSON.parse(f.gcode_filaments||'[]'):(f.gcode_filaments||[]);}catch(e){}
  return fil.map(function(gc,i){return {gc:gc,paint_index:i};}).filter(function(x){return x.gc.is_used!==false;});
}
function _flowThumb(f,cls){
  if(!f)return '<div class="kxthumb ph '+(cls||'')+'">no preview</div>';
  return f.has_thumbnail
    ? '<img class="kxthumb '+(cls||'')+'" loading="lazy" decoding="async" src="'+_kxEsc(_apiUrl('/kx/files/'+encodeURIComponent(f.id)+'/thumbnail'))+'" alt="">'
    : '<div class="kxthumb ph '+(cls||'')+'">no preview</div>';
}
function _flowRgb(h){var c=(h||'#888').replace('#','');if(c.length===3)c=c[0]+c[0]+c[1]+c[1]+c[2]+c[2];return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)];}
function _flowDist(a,b){var x=_flowRgb(a),y=_flowRgb(b);return (x[0]-y[0])*(x[0]-y[0])+(x[1]-y[1])*(x[1]-y[1])+(x[2]-y[2])*(x[2]-y[2]);}
// Fit: for each used channel, a loaded slot with compatible material, each
// slot used once, nearest colour wins. Returns {ok, map:[slot_index|-1]}.
function _flowFit(p,f){
  var slots=_farmLoadedSlots(p.slots||[]),used={};
  var map=_flowChannels(f).map(function(ch){
    var c=slots.filter(function(s){return _materialsCompatible(ch.gc.material,s.material)&&!used[s.slot_index];});
    if(!c.length)return -1;
    c.sort(function(a,b){return _flowDist(a.color_hex,ch.gc.color_hex)-_flowDist(b.color_hex,ch.gc.color_hex);});
    used[c[0].slot_index]=1;return c[0].slot_index;});
  return {ok:map.length>0&&map.every(function(i){return i>=0;}),map:map};
}
function _flowState(p){
  var ks=(p.kobra_state||'').toLowerCase(),up=p.upload_progress||{};
  if(p.connection_error||ks==='offline')return 'offline';
  if(ks==='paused'||ks==='pause'||ks==='pausing')return 'paused';
  // These come from the bridge, not the page that started the job, so they
  // remain busy after a close/reopen and cannot be selected for another job.
  if(up.active||p.print_pending)return 'printing';
  if(ks==='printing'||_KOBRA_PHASE[ks])return 'printing';
  if(p.error_code)return 'error';
  if(p.maintenance_mode)return 'maint';
  return 'ready';
}
var _FLOW_LABEL={offline:'Offline',printing:'Printing',paused:'Paused',error:'Error',maint:'Maintenance',ready:'Ready'};
// Raw Kobra phases the bridge folds into "printing". Shown verbatim so an
// operator can tell preheating from leveling from actually extruding.
var _KOBRA_PHASE={preheating:'Preheating',auto_leveling:'Bed leveling',checking:'Checking',init:'Preparing',updated:'Preparing',busy:'Busy',resuming:'Resuming',stopping:'Stopping'};
function _farmBadge(p){var q=_farmQueue[String(p.id)],up=p.upload_progress||{},s=_flowState(p),phase=_KOBRA_PHASE[(p.kobra_state||'').toLowerCase()];return (q?(q.phase==='queued'?'Queued':'Starting'):null)||(up.active?'Sending':null)||(s==='printing'&&phase)|| (p.print_pending?'Starting':null)||_FLOW_LABEL[s];}
// One full human-readable status line per printer; every surface (tile,
// quick-switch tooltip, drawer) reads this so they never disagree.
function _farmDetail(p){
  var qt=_farmQueueText(p);if(qt)return qt;
  var s=_flowState(p),ks=(p.kobra_state||'').toLowerCase(),up=p.upload_progress||{};
  var temps=' · Bed '+Math.round(p.bed_temp||0)+'/'+Math.round(p.bed_target||0)+'° · Nozzle '+Math.round(p.nozzle_temp||0)+'/'+Math.round(p.nozzle_target||0)+'°';
  if(s==='offline')return 'Offline · '+(p.connection_error||'unreachable');
  if(s==='error')return 'Error '+p.error_code+(p.pause_msg?' · '+p.pause_msg:'');
  if(s==='maint')return 'Maintenance'+(p.maintenance_reason?' · '+p.maintenance_reason:'');
  if(up.active)return (up.phase==='processing'?'Preparing ':'Uploading ')+(up.filename||'file')+(up.phase==='processing'?'':' · '+Math.round(up.percent||0)+'%');
  if(up.phase==='error')return 'Upload failed · '+(up.error||'');
  if(p.print_pending&&!(s==='printing'&&_KOBRA_PHASE[ks]))return 'File sent · waiting for printer';
  if(s==='paused')return 'Paused'+(p.pause_msg?' · '+p.pause_msg:'')+temps;
  if(s==='printing'){
    if(_KOBRA_PHASE[ks])return _KOBRA_PHASE[ks]+(p.filename?' · '+p.filename:'')+temps;
    return 'Printing '+Math.round((p.progress||0)*100)+'% · Layer '+(p.curr_layer||0)+'/'+(p.total_layers||0)+(p.remain_time?' · '+_farmFmtTime(p.remain_time)+' left':'')+temps;
  }
  if(ks==='finished')return 'Finished · clear the bed'+(p.filename?' · '+p.filename:'');
  return 'Idle'+((p.bed_target||p.nozzle_target)?' · heaters on'+temps:'');
}

function _flowAttn(printers){
  var items=[];
  printers.forEach(function(p){
    var s=_flowState(p),id=_kxEsc(String(p.id));
    if(s==='offline')items.push({lvl:'err',t:p.name+' is offline',d:p.connection_error||'unreachable',acts:'<button onclick="loadPrinterTab()">Retry</button><button onclick="farmMaintenance(\''+id+'\',true)">Maintenance</button>'});
    if(s==='paused')items.push({lvl:'warn',t:p.name+' paused',d:p.pause_msg||'',acts:'<button class="primary" onclick="_farmPost(_farmById(\''+id+'\'),\'/printer/print/resume\',{}).then(loadPrinterTab)">Resume</button><button class="danger" onclick="_farmSelected={};_farmSelected[\''+id+'\']=true;farmStopSelected()">Stop</button>'});
    if(s==='error')items.push({lvl:'err',t:p.name+': error '+p.error_code,d:p.pause_msg||'',acts:'<button onclick="selectPrinter(\''+id+'\');showPanel(\'dashboard\')">Open</button>'});
    if(s==='maint')items.push({lvl:'warn',t:p.name+' in maintenance',d:p.maintenance_reason||'',acts:'<button onclick="farmMaintenance(\''+id+'\',false)">Return to service</button><button onclick="farmServiced(\''+id+'\')">Serviced</button>'});
    if((p.kobra_state||'').toLowerCase()==='finished')items.push({lvl:'ok',t:p.name+' finished — clear the bed',d:p.filename||'',acts:'<button class="primary" onclick="selectPrinter(\''+id+'\');showPanel(\'dashboard\')">Open</button>'});
    var up=p.upload_progress||{};if(up.phase==='error')items.push({lvl:'err',t:p.name+': upload failed',d:up.error||'',acts:''});
    if(s!=='offline'&&(p.hours_since_service||0)>=FARM_SERVICE_HOURS)items.push({lvl:'warn',t:p.name+': service due',d:Math.round(p.hours_since_service)+' h since last service',acts:'<button onclick="farmServiced(\''+id+'\')">Serviced</button>'});
  });
  var n=document.getElementById('attn-n');if(n)n.textContent=items.length;
  var el=document.getElementById('kxattn');if(!el)return;
  el.innerHTML=items.length?items.map(function(i){return '<div class="item '+i.lvl+'"><i></i><div><b>'+_kxEsc(i.t)+'</b><small>'+_kxEsc(i.d)+'</small></div><div class="act">'+i.acts+'</div></div>';}).join('')
    :'<div class="empty">Nothing needs you. All printers are running or ready.</div>';
}
function _farmById(id){return (_farmLastStates.printers||[]).find(function(x){return String(x.id)===String(id);});}

function _flowFleet(printers){
  var grid=document.getElementById('printers-grid');if(!grid)return;
  var f=_flowSel&&_flowFileById(_flowSel);
  var n=document.getElementById('fleet-n');if(n)n.textContent=printers.length;
  if(!printers.length){grid.innerHTML='<div class="kxledger-empty">No printers configured</div>';return;}
  grid.innerHTML=printers.map(function(p){
    var s=_flowState(p),pct=Math.round((p.progress||0)*100),busy=(s==='printing'||s==='paused'),id=_kxEsc(String(p.id));
    var ft=f?_flowFit(p,f):null,hits={};if(ft)ft.map.forEach(function(i){if(i>=0)hits[i]=1;});
    var slots=(p.slots||[]).slice().sort(function(a,b){return a.slot_index-b.slot_index;}).map(function(x){return '<i class="'+(x.status!=='loaded'?'empty':'')+(hits[x.slot_index]?' hit':'')+'" style="background:'+_kxEsc(x.color_hex)+'" title="Slot '+(x.slot_index+1)+' '+_kxEsc(x.material||'')+(x.status!=='loaded'?' · empty':'')+'"></i>';}).join('')||'<span class="fit">no ACE data</span>';
    var eta=busy?'<b>'+pct+'%</b> · '+(p.remain_time?_farmFmtTime(p.remain_time)+' left':'Layer '+(p.curr_layer||0)+'/'+(p.total_layers||0)):(s==='offline'?_kxEsc(p.connection_error||'unreachable'):(s==='maint'?_kxEsc(p.maintenance_reason||'maintenance'):'idle'));
    var detail=_farmDetail(p);if(_farmQueueText(p)||(busy&&_KOBRA_PHASE[(p.kobra_state||'').toLowerCase()]))eta='<b>'+_kxEsc(detail)+'</b>';
    var fitTxt=f&&s==='ready'?(ft.ok?'<span class="fit ok">✓ filament fits</span>':'<span class="fit bad">✗ no matching filament</span>'):(f&&busy?'<span class="fit">busy</span>':'');
    var job=busy?(_flowFileByName(p.filename)?_flowThumb(_flowFileByName(p.filename),'tile'):'<div class="kxthumb ph tile">started on printer</div>'):'';
    var checked=_farmSelected[String(p.id)]?' checked':'';
    return '<div class="kxtile '+s+(f&&s==='ready'?(ft.ok?' drop':' nofit'):'')+(_activePrinter&&String(_activePrinter.id)===String(p.id)?' sel':'')+'" id="farm-p-'+id+'" ondragover="event.preventDefault()" ondrop="_flowDropOn(event,\''+id+'\')">'+
      '<header><label class="kxpick" onclick="event.stopPropagation()"><input type="checkbox" onchange="farmToggle(\''+id+'\',this.checked)"'+checked+'></label><h3 onclick="openFlowDrawer(\''+id+'\')">'+_kxEsc(p.name)+'</h3><span class="kxst"><i></i>'+_kxEsc(_farmBadge(p))+'</span></header>'+
      '<div class="body" title="'+_kxEsc(detail)+'" onclick="openFlowDrawer(\''+id+'\')">'+job+(busy?'<div class="kxbar"><span style="width:'+pct+'%"></span></div>':'')+'<div class="eta">'+eta+'</div><div class="slots">'+slots+'</div>'+fitTxt+'</div></div>';
  }).join('');
  _farmUpdateBulkBar();
}

function renderFlowFiles(){
  var el=document.getElementById('flow-files');if(!el)return;
  var q=((document.getElementById('flow-q')||{}).value||'').toLowerCase();
  var printers=_farmLastStates.printers||[];
  var files=(storeFiles||[]).filter(function(f){return !q||f.filename.toLowerCase().indexOf(q)>=0;});
  if(!files.length){el.innerHTML='<div class="kxledger-empty">'+(storeFiles&&storeFiles.length?'No match':'No files on the bridge yet')+'</div>';return;}
  el.innerHTML=files.map(function(f){
    var ch=_flowChannels(f),jsId=_kxEsc(String(f.id));
    var fits=printers.filter(function(p){return _flowState(p)==='ready'&&_flowFit(p,f).ok;}).length;
    return '<div class="kxfilerow'+(String(f.id)===String(_flowSel)?' sel':'')+'" draggable="true" ondragstart="_flowDrag=\''+jsId+'\'" onclick="flowPick(\''+jsId+'\')">'+_flowThumb(f)+
      '<div class="txt"><div class="fn" title="'+_kxEsc(f.filename)+'">'+_kxEsc(f.filename)+'</div><div class="meta">'+ch.map(function(x){return '<i style="background:'+_kxEsc(x.gc.color_hex||'#888')+'"></i>'+_kxEsc(x.gc.material||'');}).join(' ')+(f.est_print_time_sec?'<span>· '+formatDur(f.est_print_time_sec)+'</span>':'')+'<span>· fits '+fits+' ready</span></div></div>'+
      '<button class="go" onclick="event.stopPropagation();flowPick(\''+jsId+'\')">Select</button></div>';
  }).join('');
}

function renderFlowJob(){
  var el=document.getElementById('flow-job');if(!el)return;
  var f=_flowSel&&_flowFileById(_flowSel);
  if(!f){el.innerHTML='<div class="kxjob-empty">Select or drag a file. Printers light up green where the filament fits, red where it does not.</div>';return;}
  var printers=_farmLastStates.printers||[],ch=_flowChannels(f);
  var rows=printers.map(function(p){
    var s=_flowState(p),ft=_flowFit(p,f),compat=_flowCompat(p,f),can=(s==='ready'&&ch.length>0&&_compatAllows(compat)),id=_kxEsc(String(p.id));
    var on=!!_flowTargets[p.id]&&can&&ft.ok;
    var loaded=_farmLoadedSlots(p.slots||[]);
    var maps=ch.map(function(c,i){
      var comp=loaded.filter(function(x){return _materialsCompatible(c.gc.material,x.material);});
      var cur=(_flowMaps[p.id]&&_flowMaps[p.id][i]!=null)?_flowMaps[p.id][i]:ft.map[i];
      return '<i style="background:'+_kxEsc(c.gc.color_hex||'#888')+'"></i>→<select class="fp-map" data-channel="'+i+'" '+(comp.length?'':'disabled')+' onchange="_flowMaps[\''+id+'\']=_flowMaps[\''+id+'\']||[];_flowMaps[\''+id+'\']['+i+']=parseInt(this.value,10)">'+
        (comp.length?comp.map(function(x){return '<option value="'+x.slot_index+'"'+(x.slot_index===cur?' selected':'')+'>Slot '+(x.slot_index+1)+' '+_kxEsc(x.material||'')+'</option>';}).join(''):'<option value="">none</option>')+'</select>';}).join(' ');
    var why=can?(ft.ok?'ready · filament matched':'ready · no matching filament'):(s==='offline'?'offline':(s==='ready'?(ch.length?(_flowCompatText(p,f)||'ready'):'ready · file has no filament metadata'):_FLOW_LABEL[s].toLowerCase()+(p.remain_time?' · free in '+_farmFmtTime(p.remain_time):'')));
    var note=can&&compat&&compat.decision==='convertible'?' · '+_flowCompatText(p,f):'';
    return '<label class="tg '+(can&&ft.ok?'ok':'bad')+' fp-printer" data-printer="'+id+'"><input type="checkbox" class="fp-target" value="'+id+'" '+(on?'checked':'')+' '+(can&&ft.ok?'':'disabled')+' onchange="_flowTargets[\''+id+'\']=this.checked;renderFlowJob()"><div class="who"><b>'+_kxEsc(p.name)+'</b><small>'+_kxEsc(why+note)+'</small></div><div class="map">'+(can?maps:'')+'</div></label>';
  }).join('');
  var count=printers.filter(function(p){return _flowTargets[p.id]&&_flowCanTarget(p,f);}).length;
  el.innerHTML='<div class="hd">'+_flowThumb(f,'big')+'<div class="txt"><div class="fn" title="'+_kxEsc(f.filename)+'">'+_kxEsc(f.filename)+'</div><span class="mono">'+(f.est_print_time_sec?formatDur(f.est_print_time_sec):'')+'</span></div></div>'+
    '<div class="need">'+ch.map(function(x,i){return '<span><i style="background:'+_kxEsc(x.gc.color_hex||'#888')+'"></i>'+(i+1)+' '+_kxEsc(x.gc.material||'');}).join('')+(ch.length?'':'<span class="bad">No filament metadata in this file — re-slice to enable dispatch</span>')+'</div>'+
    '<div class="targets">'+rows+'</div>'+
    '<div class="go"><span class="sum">'+count+' printer'+(count===1?'':'s')+' selected'+(count?(_farmHeatBatch()&&count>_farmHeatBatch()?' · '+_farmHeatBatch()+' at a time (bed heat limit)':' · starts immediately'):'')+'</span><button onclick="_flowSel=null;_flowTargets={};_flowMaps={};renderFarmOverview(_farmLastStates)">Clear</button><button class="primary" '+(count?'':'disabled')+' onclick="flowStart()">Start on '+count+'</button></div>';
}

function flowPick(id){
  var f=_flowFileById(id);if(!f)return;
  // Web-uploaded files that were never verified keep their existing gate.
  maybeGateWebUpload(f,function(){
    _flowSel=String(id);_flowTargets={};_flowMaps={};
    (_farmLastStates.printers||[]).forEach(function(p){if(_flowCanTarget(p,f))_flowTargets[p.id]=true;});
    renderFarmOverview(_farmLastStates);
    Promise.resolve(_flowLoadCompat(f)).then(function(){
      if(String(_flowSel)!==String(id))return;
      (_farmLastStates.printers||[]).forEach(function(p){if(_flowCanTarget(p,f))_flowTargets[p.id]=true;});
      renderFarmOverview(_farmLastStates);
    });
    var j=document.getElementById('flow-job');if(j)j.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
}
function _flowDropOn(ev,pid){ev.preventDefault();if(!_flowDrag)return;var id=_flowDrag;_flowDrag=null;
  var f=_flowFileById(id);if(!f)return;
  maybeGateWebUpload(f,function(){_flowSel=String(id);_flowTargets={};_flowTargets[pid]=true;_flowMaps={};renderFarmOverview(_farmLastStates);Promise.resolve(_flowLoadCompat(f)).then(function(){if(String(_flowSel)===String(id))renderFarmOverview(_farmLastStates);});});
}
// Start: reuse the validated multi-printer path. _farmPrintSlots/_gcodeFilaments
// are what _farmPrintAssignments() reads; the .fp-printer/.fp-target/.fp-map
// markup above is the same contract the modal dialog renders.
function flowStart(){
  var f=_flowSel&&_flowFileById(_flowSel);if(!f)return;
  _setGcodeFilamentsFromFileObj(f);
  _farmPrintSlots={};_farmPrintCompatibility={};(_farmLastStates.printers||[]).forEach(function(p){_farmPrintSlots[String(p.id)]=p.slots||[];_farmPrintCompatibility[String(p.id)]=_flowCompat(p,f);});
  var names=(_farmLastStates.printers||[]).filter(function(p){return _flowTargets[p.id]&&_flowCanTarget(p,f);}).map(function(p){return p.name;});
  if(!names.length)return;
  if(!confirm('Start "'+f.filename+'" on: '+names.join(', ')+'?'))return;
  dispatchFarmPrint(f.id);
  _flowSel=null;_flowTargets={};_flowMaps={};
  setTimeout(function(){renderFarmOverview(_farmLastStates);},50);
}

var FLOW_CAM_PREVIEW_MS=15000;
var _flowCam={pid:'',printer:null,timer:null,poll:null};
function _flowCamBoxClear(){
  var box=document.getElementById('kxdrawer-cam');if(!box)return;
  var img=box.querySelector('img');if(img){img.onerror=null;img.src='';}
  box.innerHTML='';box.style.display='none';
}
function _flowCamStop(){
  var cam=_flowCam;
  if(cam.timer)clearTimeout(cam.timer);
  if(cam.poll)clearInterval(cam.poll);
  _flowCam={pid:'',printer:null,timer:null,poll:null};
  _flowCamBoxClear();
  if(cam.printer)_farmPost(cam.printer,'/api/camera/stop',{preview:true}).catch(function(){});
}
function _flowCamStart(p){
  var pid=String(p.id),box=document.getElementById('kxdrawer-cam');
  if(!box||p.camera_enabled===0||S.camera_enabled===0)return;
  // renderFarmOverview refreshes the open drawer every 5 s; the same printer
  // keeps its original 15 s deadline and camera session.
  if(_flowCam.pid===pid)return;
  _flowCamStop();
  box.style.display='';
  box.innerHTML='<img alt="'+_escAttr((p.name||'Printer')+' camera preview')+'"><span class="kxcam-label">15 s preview</span>';
  var img=box.querySelector('img');
  _flowCam={pid:pid,printer:p,timer:null,poll:null};
  _farmPost(p,'/api/camera/start',{}).then(function(d){
    if(_flowCam.pid!==pid)return;
    if(d&&d.result==='disabled'){_flowCamStop();return;}
    img.onerror=function(){if(_flowCam.pid===pid)box.innerHTML='<div class="kxcam-error">Camera unavailable</div>';};
    var base='http://'+location.hostname+':'+p.port;
    if(/Android/i.test(navigator.userAgent)){
      function frame(){if(_flowCam.pid===pid)img.src=base+'/api/camera/snapshot?t='+Date.now();}
      frame();_flowCam.poll=setInterval(frame,500);
    }else img.src=base+'/api/camera/stream?t='+Date.now();
  }).catch(function(){if(_flowCam.pid===pid)box.innerHTML='<div class="kxcam-error">Camera unavailable</div>';});
  _flowCam.timer=setTimeout(_flowCamStop,FLOW_CAM_PREVIEW_MS);
}
function openFlowDrawer(pid,refreshOnly){
  var p=_farmById(pid);if(!p)return;
  var s=_flowState(p),pct=Math.round((p.progress||0)*100),busy=(s==='printing'||s==='paused'),id=_kxEsc(String(p.id));
  var slots=(p.slots||[]).slice().sort(function(a,b){return a.slot_index-b.slot_index;}).map(function(x){return '<span class="kxslot'+(x.status!=='loaded'?' empty':'')+'"><i style="background:'+_kxEsc(x.color_hex)+'"></i><b>'+(x.slot_index+1)+'</b><span>'+_kxEsc(x.status!=='loaded'?'—':(x.material||''))+'</span></span>';}).join('')||'<span class="kxslot none">no ACE data</span>';
  var file=_flowFileByName(p.filename);
  var acts=busy
    ?'<button onclick="_farmPost(_farmById(\''+id+'\'),\'/printer/print/'+(s==='paused'?'resume':'pause')+'\',{}).then(loadPrinterTab).catch(function(e){clog(e.message,\'msg-err\')})">'+(s==='paused'?'Resume':'Pause')+'</button><button class="danger" onclick="_farmSelected={};_farmSelected[\''+id+'\']=true;farmStopSelected()">Stop</button>'
    :'<button onclick="farmMaintenance(\''+id+'\','+(!p.maintenance_mode)+')">'+(p.maintenance_mode?'Return to service':'Maintenance')+'</button><button onclick="farmServiced(\''+id+'\')">Serviced</button>';
  document.getElementById('kxdrawer-in').innerHTML=
    '<div>'+(p.filename?_flowThumb(file,'drawer'):'')+'<h3>'+_kxEsc(p.name)+' <span class="kxst '+s+'"><i></i>'+_kxEsc(_farmBadge(p))+'</span></h3>'+
      (p.filename?'<div class="kxfn" title="'+_kxEsc(p.filename)+'">'+_kxEsc(p.filename)+'</div>':'')+
      (busy&&!_KOBRA_PHASE[(p.kobra_state||'').toLowerCase()]?'<div class="big">'+pct+'%</div>':'')+'<div class="muted">'+_kxEsc(_farmDetail(p))+'</div></div>'+
    '<div><dl class="kxtele"><div><dt>Nozzle</dt><dd>'+Math.round(p.nozzle_temp||0)+'<small>/'+Math.round(p.nozzle_target||0)+'°</small></dd></div><div><dt>Bed</dt><dd>'+Math.round(p.bed_temp||0)+'<small>/'+Math.round(p.bed_target||0)+'°</small></dd></div>'+
      (busy?'<div><dt>Layer</dt><dd>'+(p.curr_layer||0)+'<small>/'+(p.total_layers||0)+'</small></dd></div><div><dt>Elapsed</dt><dd>'+_farmFmtTime(p.print_duration||0)+'</dd></div><div><dt>Remaining</dt><dd>'+_farmFmtTime(p.remain_time||0)+'</dd></div>':'')+
      '<div><dt>State</dt><dd><small>'+_kxEsc(p.kobra_state||'-')+'</small></dd></div><div><dt>Hours</dt><dd>'+Math.round(p.lifetime_print_hours||0)+'</dd></div></dl><div class="kxslots" style="margin-top:10px">'+slots+'</div></div>'+
    '<div class="kxactions">'+acts+'<button class="primary" onclick="closeFlowDrawer();selectPrinter(\''+id+'\');showPanel(\'dashboard\')">Full controls →</button></div>';
  document.getElementById('kxdrawer').classList.add('open');
  // Identity for live refresh: two printers can share a name prefix
  // ("Kobra X" / "Kobra X 2"), so refresh by id, never by name text.
  document.getElementById('kxdrawer').setAttribute('data-pid',String(p.id));
  // Only an operator click starts the 15 s preview; the 5 s live refresh of an
  // already-open drawer must neither restart nor extend it.
  if(!refreshOnly)_flowCamStart(p);
}
function closeFlowDrawer(){var d=document.getElementById('kxdrawer');if(d)d.classList.remove('open');_flowCamStop();}
document.addEventListener('keydown',function(e){
  if(currentPanel!=='printers')return;
  if(e.key==='/'&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)){e.preventDefault();var q=document.getElementById('flow-q');if(q)q.focus();}
  if(e.key==='Escape')closeFlowDrawer();
});

// Fleet order is a fixed alphabetical (natural numeric) sort. Sorting by
// severity re-shuffled the tiles on every 5 s poll whenever a printer changed
// state, so the operator kept losing track of which tile was which. Problems
// are still surfaced by the attention list and per-tile badges.
var _farmNameCollator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
function _farmSortPrinters(list){
  return (list||[]).slice().sort(function(a,b){
    return _farmNameCollator.compare(String(a.name||''),String(b.name||''))||String(a.id).localeCompare(String(b.id));
  });
}
function renderFarmOverview(data){
  _farmLastStates=data||{printers:[]};
  var printers=_farmSortPrinters(_farmLastStates.printers);
  _farmNotifyFinished(printers);
  printers.forEach(function(p){_farmNotify(p,_farmAlerts(p));});
  _flowAttn(printers);
  _flowFleet(printers);
  renderFlowFiles();
  renderFlowJob();
  // Keep the drawer live while open.
  var d=document.getElementById('kxdrawer');
  if(d&&d.classList.contains('open')){var pid=d.getAttribute('data-pid');if(pid&&_farmById(pid))openFlowDrawer(pid,true);}
}

function loadPrinterTab(){
  var grid=document.getElementById('printers-grid');
  if(!(storeFiles&&storeFiles.length))fetch(_apiUrl('/kx/files')).then(function(r){return r.json();}).then(function(d){storeFiles=d.result||[];renderFlowFiles();renderFlowJob();}).catch(function(){});
  return Promise.all([
    fetch('/kx/farm/overview',{cache:'no-store'}).then(function(r){return r.json();}),
    fetch('/kx/farm/stats?days=7',{cache:'no-store'}).then(function(r){return r.json();})
  ]).then(function(all){
    renderFarmStats((all[1].result)||{});
    renderFarmOverview((all[0].result)||{printers:[]});
  }).catch(function(e){
    if(grid&&!grid.innerHTML)grid.innerHTML='<div style="color:var(--err);padding:20px">Farm overview error: '+_kxEsc(e)+'</div>';
  });
}
