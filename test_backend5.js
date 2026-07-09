// 排程守門測試：展期起訖 + 寄送時鐘 + 同日去重
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r.slice());return this}getRange(a,b){const s=this;return{setValue(v){s.rows[a-1][b-1]=v},setFontWeight(){return{setBackground:()=>({setFontColor:()=>({})})}},}}setFrozenRows(){}getDataRange(){const s=this;return{getValues:()=>s.rows.map(r=>r.slice())}}}
const sheets={};const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))};
global.SpreadsheetApp={getActiveSpreadsheet:()=>ss,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})};
let HORA=19, HOY='2026-07-10';
global.Utilities={
  formatDate:(d,tz,fmt)=>{ if(fmt==='H')return String(HORA); if(fmt==='yyyy-MM-dd')return (d instanceof Date && d._s)?d._s:HOY; if(fmt.includes('HH'))return HOY+' '+String(HORA).padStart(2,'0')+':00:00'; return HOY;},
  newBlob:(h)=>({getAs:()=>({setName(x){return this},getBytes:()=>[1],getName:()=>'x'})}),
  base64Encode:()=>'B'};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({_text:t,setMimeType(){return this}})};
global.HtmlService={createHtmlOutput:h=>({setTitle(){return this}})};
const trigs=[];
global.ScriptApp={getProjectTriggers:()=>[],deleteTrigger:()=>{},newTrigger:f=>({timeBased(){return this},everyHours(h){trigs.push([f,'everyHours',h]);return this},everyDays(){return this},atHour(){return this},nearMinute(){return this},create(){}})};
global.Logger={log:()=>{}};
const props={};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>props[k]=v})};
global.DriveApp={getFoldersByName:()=>({hasNext:()=>false}),createFolder:()=>({})};
global.UrlFetchApp={fetch:()=>({})};
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

// 準備：Leads 表頭 + Config
setup();
sheets['Config'].rows[0][1]='jefe@ptitp.com.py';
check(sheets['Config'].rows.length===4,'G1 setup 建立 4 個 Config 參數列');
check(String(sheets['Config'].rows[3][1])==='19','G1 預設寄送時鐘 19');

// G2: 未設定日期 → 每天照寄（向下相容），時鐘符合才寄
sheets['Config'].rows[1][1]=''; sheets['Config'].rows[2][1]='';
HORA=18;
check(reporteProgramado()==='hora distinta'&&mails.length===0,'G2 時鐘不符不寄');
HORA=19;
check(reporteProgramado()==='enviado'&&mails.length===1,'G2 日期留空+時鐘符合 → 寄出');
check(reporteProgramado()==='ya enviado hoy'&&mails.length===1,'G2 同日重跑不重寄');

// G3: 展期閘門
delete props['ultimo_reporte_auto'];
sheets['Config'].rows[1][1]='2026-07-15'; sheets['Config'].rows[2][1]='2026-07-18';
check(reporteProgramado()==='antes del rango'&&mails.length===1,'G3 展期未開始不寄');
HOY='2026-07-20';
check(reporteProgramado()==='después del rango','G3 展期結束後不寄');
HOY='2026-07-16';
check(reporteProgramado()==='enviado'&&mails.length===2,'G3 展期內指定時鐘寄出');

// G4: 日期儲存格為 Date 物件（Sheet 常見情況）
delete props['ultimo_reporte_auto'];
const d1=new Date();d1._s='2026-07-16'; const d2=new Date();d2._s='2026-07-17';
sheets['Config'].rows[1][1]=d1; sheets['Config'].rows[2][1]=d2;
check(reporteProgramado()==='enviado','G4 Date 物件日期正規化後照常判斷');

// G5: 改時鐘即生效
delete props['ultimo_reporte_auto'];
sheets['Config'].rows[3][1]=21; HORA=19;
check(reporteProgramado()==='hora distinta','G5 改成 21 點後 19 點不寄');
HORA=21;
check(reporteProgramado()==='enviado','G5 21 點寄出');

// G6: 觸發器改為每小時
crearTriggerDiario();
check(trigs.length===1&&trigs[0][0]==='reporteProgramado'&&trigs[0][1]==='everyHours'&&trigs[0][2]===1,'G6 觸發器 = reporteProgramado 每小時');

console.log(`\n═══ 排程守門測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
