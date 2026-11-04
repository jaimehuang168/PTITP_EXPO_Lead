const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const rows = [];
let locked = false, flushed = false, quotaWrites = 0;
const sheet = {getLastRow:()=>rows.length, appendRow:r=>{assert(locked); rows.push([...r]); flushed=false;}, getDataRange:()=>({getValues:()=>rows.map(r=>[...r])})};
const props = {REPORT_ADMIN_TOKEN:'test-supervisor-secret', OCR_ACCESS_TOKEN:'test-operator-secret'};
const ctx = vm.createContext({console, Date, Math, JSON,
  SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>n==='Leads'?sheet:null}), flush:()=>{assert(locked); flushed=true;}},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false; locked=true; return true;},releaseLock:()=>{assert(flushed);locked=false;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||'',setProperty:()=>{quotaWrites++;}})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:t=>({text:t,setMimeType(){return this;}})},
  HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this;}})},
  Utilities:{formatDate:(date,tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-11-10':'2026-11-10 10:00:00'},
  Logger:{log:()=>{}}
});
const GOOGLE_ID_TOKEN=require('./test_helpers/gas-auth.cjs').installGasAuth(ctx,{activeOcr:true});
vm.runInContext(fs.readFileSync('Code.gs','utf8'),ctx);
rows.push(vm.runInContext('HEADERS',ctx));
const post=d=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({idToken:GOOGLE_ID_TOKEN,...d})}}).text);
const failures=[];
function test(name,fn){try{fn();console.log('PASS',name);}catch(e){failures.push(name);console.error('FAIL',name,e.message);locked=false;}}
const lead={nombre:'Test visitor',calificacion:'A - Caliente',evento:'EXPO PBW',promotor:'Operator'};
test('reject quote injection in an allowed card URL',()=>assert(ctx._validarLead({...lead,tarjetaUrl:'https://drive.google.com/" onclick="alert(1)'}).error));
test('legacy unsafe links stay inert when cards render',()=>{
  const html=ctx._htmlFichas([{nombre:'Visitor',calif:'A',tarjeta:'https://drive.google.com/" onclick="alert(1)'}],'Test','EXPO PBW',{},false);
  const dom=new JSDOM(html); assert.equal(dom.window.document.querySelectorAll('[onclick],script').length,0); dom.window.close();
});
test('reject impossible calendar dates',()=>assert.equal(ctx._fechaValida('2026-02-31'),false));
test('eight requests plus ambiguous retries create exactly eight rows and flush under lock',()=>{
  rows.splice(1);
  for(let i=0;i<8;i++) assert(post({...lead,requestId:'concurrent_'+i}).ok);
  for(let i=0;i<8;i++) assert(post({...lead,requestId:'concurrent_'+i}).duplicate);
  assert.equal(rows.length,9);assert.equal(locked,false);
});
test('reports filter event independently from date and keep historical rows intact',()=>{
  const old=[...rows[1]];old[2]='Expo Paraguay 2026'; rows.push(old);
  assert.equal(ctx._construirReporteAgregado(null,null,'EXPO PBW').total,8);
  assert.equal(ctx._fichasSegunTipo({tipo:'expo',evento:'EXPO PBW'}).leads.length,8);
  assert.equal(rows.length,10);
});
test('public configuration announces PBW dates without credentials',()=>{
  const result=JSON.parse(ctx.doGet({parameter:{action:'config'}}).text);
  assert.equal(result.evento,'EXPO PBW');assert.equal(result.desde,'2026-11-10');assert.equal(result.hasta,'2026-11-14');
  assert(!JSON.stringify(result).includes('secret'));
});
test('OCR requires verified Google identity before quota or Drive work',()=>{
  const result=post({accion:'ocrTarjeta',idToken:'',imagen:'AAAA',mime:'image/jpeg'});
  assert.equal(result.ok,false);assert.match(result.error,/sesi.n|Google/i);assert.equal(quotaWrites,0);
});
test('OCR larger than old 120k cap reaches bounded image validation',()=>{
  const result=post({accion:'ocrTarjeta',token:props.OCR_ACCESS_TOKEN,imagen:'A'.repeat(160000),mime:'text/html'});
  assert.match(result.error,/Formato/);assert.equal(quotaWrites,0);
});
test('malformed image content cannot reserve scanning quota',()=>{
  const result=post({accion:'ocrTarjeta',token:props.OCR_ACCESS_TOKEN,imagen:'AAAA',mime:'image/jpeg'});
  assert.equal(result.ok,false);assert.match(result.error,/contenido/);assert.equal(quotaWrites,0);
});
test('GET cannot accept reusable supervisor credentials',()=>{
  const result=JSON.parse(ctx.doGet({parameter:{action:'reporte',idToken:GOOGLE_ID_TOKEN}}).text);
  assert.equal(result.ok,false);assert.match(result.error,/POST/);
});
test('POST reports authorize before rendering and do not echo credentials',()=>{
  const request={accion:'abrirReporte',action:'fichas',tipo:'expo',evento:'EXPO PBW',idToken:GOOGLE_ID_TOKEN};
  const denied=post({...request,idToken:'wrong'});assert.equal(denied.ok,false);
  const rendered=ctx.doPost({parameter:{reportRequest:JSON.stringify(request)},postData:{contents:'form-urlencoded'}});
  assert(rendered.html.includes('Fichas de Leads'));assert(!rendered.html.includes(props.REPORT_ADMIN_TOKEN));
});
process.exitCode=failures.length?1:0;
