const reportPost = p=>doPost({postData:{contents:JSON.stringify({accion:'abrirReporte',...p})}});
// 安全回歸：授權、公式注入、輸入型別、鎖定與重複提交
const fs = require('fs');
class MockSheet {
  constructor(name){ this.name=name; this.rows=[]; }
  getLastRow(){ return this.rows.length; }
  appendRow(r){ this.rows.push(r.slice()); return this; }
  getRange(row,col){ const self=this; return {
    setValue(v){ if(!self.rows[row-1]) self.rows[row-1]=[]; self.rows[row-1][col-1]=v; return this; },
    setFontWeight(){return this}, setBackground(){return this}, setFontColor(){return this}
  }; }
  setFrozenRows(){}
  getDataRange(){ const self=this; return {getValues:()=>self.rows.map(r=>r.slice())}; }
}
const sheets={};
const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))};
global.SpreadsheetApp={flush:()=>{},getActiveSpreadsheet:()=>ss,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})};
global.Utilities={formatDate:()=> '2026-08-07',newBlob:()=>({getAs:()=>({setName(){return this},getBytes:()=>[1]})}),base64Encode:()=>''};
let lockMode=true, releases=0;
global.LockService={getScriptLock:()=>({tryLock:()=>lockMode,releaseLock:()=>{releases++}})};
global.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({_text:t,setMimeType(){return this}})};
global.HtmlService={createHtmlOutput:h=>({_html:h,setTitle(){return this}})};
global.MailApp={sendEmail:()=>{}};
global.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyDays(){return this},atHour(){return this},nearMinute(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
const props={REPORT_ADMIN_TOKEN:'test-admin-token-123456',ANTHROPIC_API_KEY:'sk-test',OCR_ACCESS_TOKEN:'test-operator-secret'};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})};
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0,fail=0;
const check=(c,n)=>c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n));
const post=d=>JSON.parse(doPost({postData:{contents:JSON.stringify(d)}})._text);
setup();

let r=JSON.parse(reportPost({action:'reporte'})._text);
check(r.ok===false&&/No autorizado/.test(r.error),'S1 未提供管理密鑰不可讀報告');
r=post({accion:'enviarReporteA',token:'incorrect-token-123456'});
check(r.ok===false,'S1 錯誤密鑰不可觸發寄信');
const getSend=JSON.parse(doGet({parameter:{action:'enviarReporteA',token:'test-admin-token-123456'}})._text);
check(getSend.ok===false&&/Método no permitido/.test(getSend.error),'S1 GET 不可觸發寄信副作用');

r=post({nombre:'=IMPORTXML("https://evil.test")',empresa:'+SUM(1,1)',calificacion:'A - Caliente',requestId:'request_secure_001'});
const row=sheets.Leads.rows[1];
check(r.ok===true&&row[4].startsWith("'=")&&row[5].startsWith("'+"),'S2 試算表公式字首被轉為純文字');
check(post({nombre:'Test',calificacion:'A - Caliente',intereses:'no-array'}).ok===false,'S2 非陣列 intereses 被拒絕');
check(post({nombre:'Test',calificacion:'Z',requestId:'request_secure_002'}).ok===false,'S2 非法評級被拒絕');
check(post({nombre:'Test',calificacion:'B - Tibio',tarjetaUrl:'javascript:alert(1)',requestId:'request_secure_003'}).ok===false,'S2 非受信任名片 URL 被拒絕');

lockMode=false; const before=releases;
r=post({nombre:'Concurrente',calificacion:'C - Frío',requestId:'request_secure_004'});
check(r.ok===false&&r.retryable===true&&releases===before,'S3 取鎖失敗不寫入也不釋放未持有鎖');
lockMode=true;

const payload={nombre:'Único',calificacion:'B - Tibio',requestId:'request_secure_005'};
const first=post(payload), count=sheets.Leads.rows.length, second=post(payload);
check(first.ok===true&&second.ok===true&&second.duplicate===true&&sheets.Leads.rows.length===count,'S4 相同 RequestID 不重複寫入');

r=post({accion:'ocrTarjeta',token:'test-operator-secret',imagen:'QUFB',mime:'text/html'});
check(r.ok===false&&/Formato/.test(r.error),'S5 OCR 拒絕非影像 MIME');

console.log(`\n═══ 安全回歸測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
