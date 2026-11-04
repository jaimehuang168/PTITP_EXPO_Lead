// Real doPost paths with only external Google/Claude/Sheet services replaced.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
let now=Date.parse('2026-11-11T15:00:00Z'), identityStatus=200, disabled=false, verified=true;
let returnedEmail,returnedUid,provider='google.com', quotaWrites=0,driveWrites=0,claudeCalls=0,googleCalls=0;
const props={FIREBASE_PROJECT_ID:'ptitp-expo-registro',FIREBASE_WEB_API_KEY:'public-test-api-key',ANTHROPIC_API_KEY:'test-api-secret',OCR_ACCESS_TOKEN:'legacy-secret-123456',REPORT_ADMIN_TOKEN:'legacy-admin-secret'};
const tokens=new Map();
function token(email='operator@gmail.com',uid='operator-uid',overrides={}){
  const p={aud:'ptitp-expo-registro',iss:'https://securetoken.google.com/ptitp-expo-registro',sub:uid,email,email_verified:true,iat:Math.floor(now/1000)-10,auth_time:Math.floor(now/1000)-10,exp:Math.floor(now/1000)+3600,firebase:{sign_in_provider:'google.com'},...overrides};
  const t=[{alg:'RS256',kid:'google-key'},p].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.test-signature';
  tokens.set(t,p);return t;
}
class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const rows=[];
const sheet={getLastRow:()=>rows.length,appendRow:r=>rows.push([...r]),getDataRange:()=>({getValues:()=>rows.map(r=>[...r])}),getRange:(row,col)=>({setValue(v){rows[row-1][col-1]=v;return this;}})};
function localDate(d){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);return ['year','month','day'].map(k=>p.find(v=>v.type===k).value).join('-');}
const ctx=vm.createContext({console,Date:ClockDate,Math,JSON,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||'',setProperty:(k,v)=>{quotaWrites++;props[k]=v;}})},
  SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}),flush(){}},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{formatDate:(d,tz,fmt)=>localDate(d)+(fmt.includes('HH')?' 12:00:00':''),base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),base64Decode:s=>Buffer.from(s,'base64'),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString()})},
  DriveApp:{getFoldersByName:()=>({hasNext:()=>true,next:()=>({createFile:()=>{driveWrites++;return{getUrl:()=> 'https://drive.google.com/file/d/test/view'};}})})},
  UrlFetchApp:{fetch:(url,options)=>{
    if(url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=')){
      googleCalls++;if(identityStatus===-1)throw new Error('network timeout');const p=tokens.get(JSON.parse(options.payload).idToken);
      return{getResponseCode:()=>p?identityStatus:400,getContentText:()=>JSON.stringify({users:p?[{localId:returnedUid||p.sub,email:returnedEmail||p.email,emailVerified:verified,displayName:'Verified Operator',disabled,validSince:'0',providerUserInfo:[{providerId:provider,email:p.email}]}]:[]})};
    }
    assert.equal(url,'https://api.anthropic.com/v1/messages');claudeCalls++;
    return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({content:[{type:'text',text:'{"nombre":"Visitor"}'}],usage:{input_tokens:1500,output_tokens:250}})};
  }},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this;}})},Logger:{log(){}}
});
vm.runInContext(fs.readFileSync('Code.gs','utf8'),ctx);
const post=d=>{const r=ctx.doPost({postData:{contents:JSON.stringify(d)}});return r.text?JSON.parse(r.text):r;};
let failures=0,passed=0;
function test(name,fn){try{fn();passed++;console.log('PASS',name);}catch(e){failures++;console.error('FAIL',name,e.message);}finally{identityStatus=200;disabled=false;verified=true;returnedEmail=undefined;returnedUid=undefined;provider='google.com';delete props.AUTH_ALLOWED_EMAILS;}}
const lead={nombre:'Visitor',evento:'EXPO PBW',calificacion:'A - Caliente',promotor:'Forged name'};
const operator=()=>token();
const admin=()=>token('jaimehuang168@gmail.com','admin-uid');
test('anonymous registration is rejected before writing',()=>{rows.splice(0);assert.equal(post(lead).ok,false);assert.equal(rows.length,0);});
test('a self-signed identity cannot register even with a plausible email',()=>{const fake=operator()+'x';assert.equal(post({...lead,idToken:fake}).ok,false);});
test('wrong project, issuer, expired token and password login are rejected',()=>{for(const o of [{aud:'other-project'},{iss:'https://evil.example'},{exp:Math.floor(now/1000)-1},{firebase:{sign_in_provider:'password'}}])assert.equal(post({...lead,idToken:token('operator@gmail.com','operator-uid',o)}).ok,false);});
test('Google account response must agree with signed subject and email',()=>{returnedEmail='other@gmail.com';assert.equal(post({...lead,idToken:operator()}).ok,false);returnedEmail=undefined;returnedUid='other-uid';assert.equal(post({...lead,idToken:operator()}).ok,false);});
test('disabled and unverified accounts cannot register',()=>{disabled=true;assert.equal(post({...lead,idToken:operator()}).ok,false);disabled=false;verified=false;assert.equal(post({...lead,idToken:operator()}).ok,false);});
test('identity outages preserve retryable work instead of accepting unchecked claims',()=>{identityStatus=503;const r=post({...lead,idToken:operator()});assert.equal(r.ok,false);assert.equal(r.retryable,true);assert.equal(r.authRequired,false);});
test('Google connection timeouts remain retryable',()=>{identityStatus=-1;const r=post({...lead,idToken:operator()});assert.equal(r.ok,false);assert.equal(r.retryable,true);assert.equal(r.authRequired,false);});
test('optional email allowlist is enforced by the server',()=>{props.AUTH_ALLOWED_EMAILS='jaimehuang168@gmail.com';assert.equal(post({...lead,idToken:operator()}).ok,false);});
test('legacy rows stay intact and new rows audit the verified identity',()=>{
  rows.splice(0);rows.push(Array.from(vm.runInContext('HEADERS',ctx)).slice(0,26),Array(26).fill('legacy'));
  assert.equal(post({...lead,idToken:operator(),requestId:'new_audited_001',operadorUid:'operator-uid',operadorEmail:'forged@evil.example'}).ok,true);
  assert.equal(rows[1][3],'legacy');assert.equal(rows[2][3],'Verified Operator');
  assert.equal(rows[2][rows[0].indexOf('Registrado por (email)')],'operator@gmail.com');
  assert.equal(rows[2][rows[0].indexOf('Google UID')],'operator-uid');
  assert.equal(rows[2][rows[0].indexOf('Nombre de cuenta')],'Verified Operator');
});
test('pending work belonging to another Google account cannot be relabeled',()=>assert.equal(post({...lead,idToken:operator(),operadorUid:'someone-else'}).ok,false));
test('verified session returns role and identity without reusable secrets',()=>{const r=post({accion:'sesion',idToken:operator()});assert(r.ok);assert.equal(r.usuario.email,'operator@gmail.com');assert.equal(r.usuario.admin,false);assert(!JSON.stringify(r).includes('secret'));});
test('shared administrator token can no longer export or print',()=>{for(const action of ['reporte','reporteExpo','reporteRango','reportePdf','fichas','fichasPdf'])assert.equal(post({accion:'abrirReporte',action,tipo:'expo',token:props.REPORT_ADMIN_TOKEN}).ok,false);});
test('ordinary signed-in Google users cannot export print or send reports',()=>{for(const action of ['reporte','reporteExpo','reportePdf','fichas','fichasPdf'])assert.equal(post({accion:'abrirReporte',action,tipo:'expo',idToken:operator()}).ok,false);assert.equal(post({accion:'enviarReporteA',tipo:'expo',idToken:operator()}).ok,false);});
test('only Jaime receives administrator role and a report response',()=>{assert.equal(post({accion:'sesion',idToken:admin()}).usuario.admin,true);const r=post({accion:'abrirReporte',action:'fichas',tipo:'expo',idToken:admin()});assert(r.html?.includes('Fichas'));});
test('Google login enables OCR during PBW without OCR_ACCESS_TOKEN',()=>{const before=claudeCalls;delete props.OCR_ACCESS_TOKEN;const r=post({accion:'ocrTarjeta',idToken:operator(),imagen:'/9j/AAAA',mime:'image/jpeg'});assert.equal(r.ok,true);assert.equal(claudeCalls,before+1);});
test('OCR starts and ends at Paraguay midnight with no outside quota or paid work',()=>{
  for(const [when,active] of [['2026-11-06T02:59:59Z',false],['2026-11-06T03:00:00Z',true],['2026-11-15T02:59:59Z',true],['2026-11-15T03:00:00Z',false]]){
    now=Date.parse(when);const q=quotaWrites,c=claudeCalls,d=driveWrites;
    const r=post({accion:'ocrTarjeta',idToken:operator(),imagen:'/9j/AAAA',mime:'image/jpeg',token:'legacy-secret-123456'});
    assert.equal(r.ok,active,when);if(!active){assert.equal(quotaWrites,q);assert.equal(claudeCalls,c);assert.equal(driveWrites,d);}
  }
});
test('manual registration still accepts authenticated pre and post-event entries',()=>{for(const when of ['2026-11-09T15:00:00Z','2026-11-16T15:00:00Z']){now=Date.parse(when);assert.equal(post({...lead,idToken:operator()}).ok,true);}});
test('legacy OCR secret cannot bypass Google login',()=>assert.equal(post({accion:'ocrTarjeta',token:'legacy-secret-123456',imagen:'/9j/AAAA',mime:'image/jpeg'}).ok,false));
console.log(`${passed} passed / ${failures} failed`);process.exitCode=failures?1:0;
