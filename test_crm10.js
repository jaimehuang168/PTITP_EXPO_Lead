// CRM 排程守門測試
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r.slice());return this}deleteRow(i){this.rows.splice(i-1,1)}getRange(a,b){const s=this;return{setValue(v){s.rows[a-1][b-1]=v},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}}}setFrozenRows(){}getDataRange(){const s=this;return{getValues:()=>s.rows.map(r=>r.slice())}}}
function mkSS(){const sheets={};return{_sheets:sheets,getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))}}
const crmSS=mkSS(),expoSS=mkSS();expoSS.insertSheet('Leads').appendRow(['Timestamp','LeadID','Estado']);
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:()=>expoSS,newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
let HOY='2026-07-10';
global.Utilities={newBlob:h=>({getAs:()=>({setName(){return this},getName:()=>'x',getBytes:()=>[1]})}),formatDate:(d,tz,f)=>{if(d&&d._s)return d._s;return f&&f.includes('HH')?HOY+' 08:00':HOY}};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
global.CalendarApp={getDefaultCalendar:()=>({createEvent:()=>({getId:()=>'E'}),getEventById:()=>({deleteEvent(){}})})};
global.UrlFetchApp={fetch:()=>({getResponseCode:()=>404})};
const trigs=[];
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],deleteTrigger:()=>{},newTrigger:f=>({_f:f,timeBased(){return this},everyMinutes(){trigs.push(this._f);return this},everyDays(){return this},everyHours(){return this},atHour(){trigs.push(this._f);return this},onWeekDay(){return this},create(){}})};
global.Logger={log:()=>{}};
global.Session={getActiveUser:()=>({getEmail:()=>'jaime@ptitp.com.py'})};
global.HtmlService={createHtmlOutput:()=>({setTitle(){return this},addMetaTag(){return this}}),createHtmlOutputFromFile:()=>({setTitle(){return this},addMetaTag(){return this}})};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
setupCRM();
const cfg=crmSS._sheets['Config'];
check(cfg.rows.some(r=>r[0]==='Fecha inicio reportes')&&cfg.rows.some(r=>r[0]==='Fecha fin reportes'),'G1 Config 有展期兩參數');
cfg.rows.find(r=>r[0]==='Emails resumen diario')[1]='jefe@ptitp.com.py';

// G2: 日期留空 → 照常寄（向下相容）
tareasProgramadas();
check(mails.length===1,'G2 未設展期 → 任務信照寄');

// G3: 展期閘門
cfg.rows.find(r=>r[0]==='Fecha inicio reportes')[1]='2026-07-15';
cfg.rows.find(r=>r[0]==='Fecha fin reportes')[1]='2026-07-20';
check(tareasProgramadas()==='fuera de periodo'&&mails.length===1,'G3 展期未開始不寄');
HOY='2026-07-22';
check(reporteSemanalProgramado()==='fuera de periodo'&&recordatoriosProgramados()==='fuera de periodo','G3 展期結束後週報/提醒皆不寄');
HOY='2026-07-16';
tareasProgramadas();
check(mails.length===2,'G3 展期內照常寄');

// G4: Date 物件儲存格
const d1=new Date();d1._s='2026-07-16';
cfg.rows.find(r=>r[0]==='Fecha inicio reportes')[1]=d1;
check(_dentroPeriodoReportes()===true,'G4 Date 物件日期正常判斷');

// G5: 手動函式不受守門限制（展期外直接呼叫照寄）
HOY='2026-08-01';
const antes=mails.length;
tareasDiarias();
check(mails.length===antes+1,'G5 選單手動寄送不受展期限制');

// G6: 觸發器掛包裝層
trigs.length=0;
crearTriggersCRM();
check(trigs.indexOf('tareasProgramadas')!==-1&&trigs.indexOf('recordatoriosProgramados')!==-1&&trigs.indexOf('reporteSemanalProgramado')!==-1&&trigs.indexOf('sincronizarLeads')!==-1,'G6 觸發器=同步+三個守門包裝');
check(trigs.indexOf('tareasDiarias')===-1,'G6 原函式不再直掛觸發器');

console.log(`\n═══ CRM 守門測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
