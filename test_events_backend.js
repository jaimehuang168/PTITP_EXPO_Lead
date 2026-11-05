const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function harness(when='2026-11-11T15:00:00Z'){
  const now=Date.parse(when),sheets={},props={},tokens=new Map(),calls={drive:0,claude:0};let lockHook;
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  class Sheet{
    constructor(){this.rows=[];}getLastRow(){return this.rows.length;}appendRow(row){this.rows.push([...row]);return this;}setFrozenRows(){}
    getDataRange(){return{getValues:()=>this.rows.map(row=>[...row])};}
    getRange(row,col,n=1,m=1){const self=this;return{getValues:()=>Array.from({length:n},(_,y)=>Array.from({length:m},(_,x)=>self.rows[row+y-1]?.[col+x-1]??'')),setValue(value){while(self.rows.length<row)self.rows.push([]);self.rows[row-1][col-1]=value;return this;},setValues(values){values.forEach((line,y)=>line.forEach((value,x)=>self.getRange(row+y,col+x).setValue(value)));return this;},setFontWeight(){return this;},setBackground(){return this;},setFontColor(){return this;}};}
  }
  const ss={getSheetByName:name=>sheets[name]||null,insertSheet:name=>(sheets[name]=new Sheet())};
  const ctx=vm.createContext({console,Date:ClockDate,Math,JSON,
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>({FIREBASE_PROJECT_ID:'ptitp-expo-registro',FIREBASE_WEB_API_KEY:'public-fixture',ANTHROPIC_API_KEY:'fixture-only'}[key]??props[key]??''),setProperty:(key,value)=>props[key]=value})},
    LockService:{getScriptLock:()=>({tryLock:()=>{const hook=lockHook;lockHook=null;hook?.();return true;},releaseLock(){}})},
    Utilities:{formatDate:(date,zone,format)=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-')+(format.includes('HH')?' 12:00:00':'');},base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),base64Decode:s=>Buffer.from(s,'base64'),newBlob:data=>({getDataAsString:()=>Buffer.from(data).toString()})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this;}})},Logger:{log(){}},
    DriveApp:{getFoldersByName:()=>({hasNext:()=>true,next:()=>({createFile:()=>{calls.drive++;return{getUrl:()=> 'https://drive.google.com/file/d/fixture/view'};}})})},
    UrlFetchApp:{fetch:(url,options)=>{
      if(url.includes('identitytoolkit.googleapis.com')){const p=tokens.get(JSON.parse(options.payload).idToken);return{getResponseCode:()=>p?200:400,getContentText:()=>JSON.stringify({users:p?[{localId:p.sub,email:p.email,emailVerified:true,displayName:'Fixture',validSince:'0',providerUserInfo:[{providerId:'google.com'}]}]:[]})};}
      assert.equal(url,'https://api.anthropic.com/v1/messages');calls.claude++;return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({content:[{type:'text',text:'{"nombre":"Fixture"}'}]})};
    }}
  });
  vm.runInContext(fs.readFileSync('Code.gs','utf8'),ctx);
  function token(email,uid){const p={aud:'ptitp-expo-registro',iss:'https://securetoken.google.com/ptitp-expo-registro',sub:uid,email,email_verified:true,iat:now/1000-10,auth_time:now/1000-10,exp:now/1000+3600,firebase:{sign_in_provider:'google.com'}};const t=[{alg:'RS256',kid:'fixture'},p].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.fixture';tokens.set(t,p);return t;}
  const admin=token('jaimehuang168@gmail.com','admin'),operator=token('operator@example.com','operator');
  const decode=r=>r.text?JSON.parse(r.text):r;
  const post=(payload,idToken=admin)=>decode(ctx.doPost({postData:{contents:JSON.stringify({...payload,idToken})}}));
  const config=id=>decode(ctx.doGet({parameter:{action:'config',...(id?{eventoId:id}:{})}}));
  return{ctx,sheets,calls,props,admin,operator,post,config,onLock:hook=>lockHook=hook,save:config=>post({accion:'guardarEvento',eventoConfig:config})};
}
const sample=(extra={})=>({nombre:'Feria siguiente',desde:'2027-03-10',hasta:'2027-03-14',visible:true,ocrHabilitado:false,ocrDesde:'',ocrHasta:'',...extra});
let failed=0;
function test(name,run){try{run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message);}}
test('public catalog preserves PBW official and training dates',()=>{
  const h=harness(),c=h.config();assert(Array.isArray(c.eventos),'public config must expose an event catalog');assert.equal(c.eventoSeleccionado.id,'pbw-2026');assert.equal(c.desde,'2026-11-10');assert.equal(c.ocr.desde,'2026-11-06');assert.equal(c.ocr.hasta,'2026-11-14');assert.equal(c.eventos.find(e=>e.id==='expo-paraguay-2026').desde,'');
});
test('only the verified administrator can create settings; new OCR is off',()=>{
  const h=harness();assert.equal(h.post({accion:'guardarEvento',eventoConfig:sample()},h.operator).ok,false);assert(!h.sheets.Eventos);
  const result=h.save(sample());assert(result.ok,'admin event creation must succeed');assert(result.evento.id);assert.equal(result.evento.ocrHabilitado,false);assert.equal(result.evento.revision,1);assert(h.sheets.Eventos);assert.equal(h.calls.claude,0);
});
test('invalid periods are rejected before catalog writes',()=>{
  const h=harness();assert.equal(h.save(sample({desde:'2027-03-15'})).ok,false);assert(!h.sheets.Eventos);assert.equal(h.save(sample({ocrHabilitado:true,ocrDesde:'2027-03-15',ocrHasta:'2027-03-10'})).ok,false);assert(!h.sheets.Eventos);
});
test('stale administrator revisions cannot overwrite settings',()=>{
  const h=harness(),first=h.save(sample());assert(first.ok);const second=h.save({...first.evento,nombre:'Updated'});assert(second.ok);assert.equal(h.save({...first.evento,nombre:'Stale'}).conflict,true);assert.equal(h.config(first.evento.id).eventoSeleccionado.nombre,'Updated');
});
test('server derives the canonical event label from its ID',()=>{
  const h=harness(),created=h.save(sample());assert(created.ok);
  const response=h.post({eventoId:created.evento.id,evento:'Wrong label',nombre:'New visitor',calificacion:'B',requestId:'canonical_event_001'},h.operator);assert(response.ok);
  const rows=h.sheets.Leads.rows,H=rows[0];assert.equal(rows[1][H.indexOf('Evento')],'Feria siguiente');assert.equal(rows[1][H.indexOf('Evento ID')],created.evento.id);
  const before=rows.length;assert.equal(h.post({eventoId:'unknown-event',nombre:'Wrong',calificacion:'A'},h.operator).ok,false);assert.equal(rows.length,before);
});
test('same-name exhibitions remain isolated and legacy PBW rows remain queryable',()=>{
  const h=harness(),created=h.save(sample({nombre:'EXPO PBW'}));assert(created.ok);
  h.post({eventoId:'pbw-2026',nombre:'PBW old event',calificacion:'A'},h.operator);h.post({eventoId:created.evento.id,nombre:'Same name next year',calificacion:'B'},h.operator);
  const rows=h.sheets.Leads.rows,H=rows[0],legacy=Array(H.length).fill('');legacy[H.indexOf('Evento')]='EXPO PBW';legacy[H.indexOf('Nombre')]='Legacy without ID';legacy[H.indexOf('Fecha')]='2026-11-11';legacy[H.indexOf('Calificación')]='C';rows.push(legacy);
  const next=h.post({accion:'abrirReporte',action:'reporteExpo',eventoId:created.evento.id});assert(next.html?.includes('Same name next year'));assert(!next.html.includes('PBW old event'));assert(!next.html.includes('Legacy without ID'));
  const old=h.post({accion:'abrirReporte',action:'fichas',tipo:'expo',eventoId:'pbw-2026'});assert(old.html?.includes('PBW old event'));assert(old.html.includes('Legacy without ID'));assert(!old.html.includes('Same name next year'));
});
test('each event gates OCR before quota, storage and paid work',()=>{
  const h=harness('2027-03-11T15:00:00Z'),created=h.save(sample({ocrHabilitado:true,ocrDesde:'2027-03-09',ocrHasta:'2027-03-14'}));assert(created.ok);
  const before={...h.calls};assert.equal(h.post({accion:'ocrTarjeta',eventoId:'pbw-2026',imagen:'/9j/AAAA',mime:'image/jpeg'},h.operator).ok,false);assert.deepEqual(h.calls,before);
  assert(h.post({accion:'ocrTarjeta',eventoId:created.evento.id,imagen:'/9j/AAAA',mime:'image/jpeg'},h.operator).ok);assert.equal(h.calls.claude,before.claude+1);assert.equal(h.config(created.evento.id).ocr.limiteDiario,300);
});
test('invalid links do not silently select PBW and defaults remain administrator controlled',()=>{
  const h=harness(),bad=h.config('no-such-event');assert.equal(bad.eventoSeleccionado,null);assert(bad.eventoError);
  const created=h.save(sample({predeterminado:true}));assert(created.ok);assert.equal(h.config().eventoSeleccionado.id,created.evento.id);assert.equal(h.config().ocr.activo,false);
});
test('legacy pending records are retained and known names receive a stable event ID',()=>{
  const h=harness();assert(h.post({evento:'EXPO PBW',nombre:'Legacy queued',calificacion:'A'},h.operator).ok);assert(h.post({evento:'Historical custom event',nombre:'Custom queued',calificacion:'C',modoRegistro:'administracion'},h.admin).ok);
  const rows=h.sheets.Leads.rows,H=rows[0];assert.equal(rows[1][H.indexOf('Evento ID')],'pbw-2026');assert.equal(rows[2][H.indexOf('Evento')],'Historical custom event');
});
test('unknown legacy labels cannot be reassigned to a new same-name exhibition',()=>{
  const h=harness(),created=h.save(sample({nombre:'Historical custom event'}));assert(created.ok);
  assert(h.post({evento:'Historical custom event',nombre:'Old queued visitor',calificacion:'A',modoRegistro:'administracion'},h.admin).ok);
  const rows=h.sheets.Leads.rows;assert.equal(rows[1][rows[0].indexOf('Evento ID')],'');
});
test('legacy named report requests still open lead cards',()=>{
  const h=harness();h.post({evento:'EXPO PBW',nombre:'Legacy report visitor',calificacion:'A'},h.operator);
  const report=h.post({accion:'abrirReporte',action:'fichas',tipo:'expo',evento:'EXPO PBW'});assert(report.html?.includes('Legacy report visitor'));
});
test('archive state is rechecked after obtaining the write lock; duplicate confirmations still work',()=>{
  const h=harness(),created=h.save(sample());assert(created.ok);
  const payload={eventoId:created.evento.id,nombre:'Already confirmed',calificacion:'A',requestId:'archived_confirmed_001'};assert(h.post(payload,h.operator).ok);
  const archive=()=>{const row=h.sheets.Eventos.rows.find(row=>row[0]===created.evento.id);row[7]=false;};
  h.onLock(archive);const blocked=h.post({...payload,nombre:'Must not append',requestId:'archived_waiting_002'},h.operator);assert.equal(blocked.ok,false);
  assert.equal(h.sheets.Leads.rows.length,2);assert.equal(h.post(payload,h.operator).duplicate,true);
});
test('default automatically follows the latest available official start date',()=>{
  const h=harness(),later=h.save(sample({id:'later-2028',desde:'2028-05-01',hasta:'2028-05-05'}));assert(later.ok);
  h.save(sample({id:'older-2027',predeterminado:true}));h.props.EVENTO_DEFAULT_ID='pbw-2026';
  assert.equal(h.config().eventoSeleccionado.id,'later-2028');
  const archived=h.save({...later.evento,visible:false});assert(archived.ok);assert.equal(h.config().eventoSeleccionado.id,'older-2027');
});
test('historical entry requires the verified administrator and explicit back-office mode',()=>{
  const h=harness('2026-11-15T03:00:00Z');
  const payload={eventoId:'pbw-2026',nombre:'Historical backfill',calificacion:'A'};
  assert.equal(h.config('pbw-2026').eventoSeleccionado.permiteRegistro,false);
  assert.equal(h.post(payload,h.operator).ok,false);
  assert.equal(h.post({...payload,modoRegistro:'administracion'},h.operator).ok,false,'operator cannot forge back-office mode');
  assert.equal(h.post(payload,h.admin).ok,false,'admin must intentionally enter through back office');
  assert(h.post({...payload,modoRegistro:'administracion'},h.admin).ok);
  const rows=h.sheets.Leads.rows,H=rows[0];assert.equal(rows[1][H.indexOf('Registrado por (email)')],'jaimehuang168@gmail.com');
});
test('unknown legacy labels cannot bypass historical restrictions',()=>{
  const h=harness(),payload={evento:'Unconfigured historical label',nombre:'Queued old',calificacion:'B'};
  assert.equal(h.post(payload,h.operator).ok,false);
  assert(h.post({...payload,modoRegistro:'administracion'},h.admin).ok);
});
test('event end is checked under the write lock and confirmed retries remain acknowledged',()=>{
  const h=harness(),payload={eventoId:'pbw-2026',nombre:'Confirmed before closure',calificacion:'A',requestId:'end_confirmed_001'};
  assert(h.post(payload,h.operator).ok);h.save(sample());
  h.onLock(()=>{h.sheets.Eventos.rows.find(row=>row[0]==='pbw-2026')[3]='2026-11-10';});
  assert.equal(h.post({...payload,requestId:'end_waiting_002'},h.operator).ok,false);
  assert.equal(h.post(payload,h.operator).duplicate,true);assert.equal(h.sheets.Leads.rows.length,2);
});
test('official final day remains open until Paraguay midnight and historical OCR stays off',()=>{
  const before=harness('2026-11-15T02:59:59Z');assert(before.post({eventoId:'pbw-2026',nombre:'Last minute',calificacion:'A'},before.operator).ok);
  const after=harness('2026-11-15T03:00:00Z'),event=after.config('pbw-2026').eventoSeleccionado;
  assert(after.save({...event,ocrHasta:'2026-11-20'}).ok);
  assert.equal(after.config('pbw-2026').ocr.activo,false);assert.equal(after.post({accion:'ocrTarjeta',eventoId:'pbw-2026',imagen:'/9j/AAAA',mime:'image/jpeg'},after.operator).ok,false);assert.equal(after.calls.claude,0);assert.equal(after.calls.drive,0);
});
test('back-office visit dates are validated and preserve the actual input timestamp',()=>{
  const h=harness('2026-11-20T15:00:00Z'),payload={eventoId:'pbw-2026',nombre:'Historical dated visit',calificacion:'A',modoRegistro:'administracion'};
  assert.equal(h.post({...payload,fechaVisita:'2026-02-31'}).ok,false);
  assert.equal(h.post({...payload,fechaVisita:'2026-11-21'}).ok,false);
  assert(h.post({...payload,fechaVisita:'2026-11-12'}).ok);
  const rows=h.sheets.Leads.rows,H=rows[0];assert.equal(rows.at(-1)[H.indexOf('Fecha')],'2026-11-12');assert.match(rows.at(-1)[H.indexOf('Timestamp')],/^2026-11-20/);
});
process.exitCode=failed?1:0;
