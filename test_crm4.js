// W1 web 介面測試：伺服端授權/資料/動作 + 前端渲染（demo 模式）
const fs=require('fs');
// ── 伺服端 ──
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r.slice());return this}getRange(a,b){const s=this;return{setValue(v){s.rows[a-1][b-1]=v},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}}}setFrozenRows(){}getDataRange(){const s=this;return{getValues:()=>s.rows.map(r=>r.slice())}}}
function mkSS(){const sheets={};return{_sheets:sheets,getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))}}
const crmSS=mkSS(),expoSS=mkSS();expoSS.insertSheet('Leads').appendRow(['Timestamp','LeadID','Estado']);
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:()=>expoSS,newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
global.Utilities={newBlob:h=>({getAs:()=>({setName(){return this},getName:()=>'x',getBytes:()=>[1]})}),formatDate:d=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');return t.getUTCFullYear()+'-'+p(t.getUTCMonth()+1)+'-'+p(t.getUTCDate())}};
global.MailApp={sendEmail:()=>{}};global.CalendarApp={getDefaultCalendar:()=>({createEvent:()=>({getId:()=>'E'}),getEventById:()=>({deleteEvent(){}})})};
global.UrlFetchApp={fetch:()=>({getResponseCode:()=>404})};
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyMinutes(){return this},everyDays(){return this},atHour(){return this},onWeekDay(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
let EMAIL='jaime@ptitp.com.py';
global.Session={getActiveUser:()=>({getEmail:()=>EMAIL})};
let htmlServed='';
global.HtmlService={createHtmlOutput:h=>({_h:h,setTitle(){return this},addMetaTag(){return this}}),createHtmlOutputFromFile:f=>{htmlServed=f;return{setTitle(){return this},addMetaTag(){return this}}}};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

setupCRM();
check(crmSS._sheets['Config'].rows.some(r=>r[0]==='Usuarios web'),'W1 Config 有 Usuarios web 參數');

// 授權
check(_usuarioWebAutorizado()===true,'W2 白名單留空 → 交由部署層（允許）');
crmSS._sheets['Config'].rows.find(r=>r[0]==='Usuarios web')[1]='jaime@ptitp.com.py, maria@ptitp.com.py';
check(_usuarioWebAutorizado()===true,'W2 名單內 email 允許');
EMAIL='intruso@evil.com';
check(_usuarioWebAutorizado()===false,'W2 名單外 email 拒絕');
let bloqueado=false; try{webDatos()}catch(e){bloqueado=true}
check(bloqueado,'W2 webDatos 對未授權者拋錯');
EMAIL='jaime@ptitp.com.py';
doGet({});
check(htmlServed==='Index','W2 doGet 供應 Index HTML');

// 資料
const pipe=crmSS._sheets['Pipeline'];
const fila=(id,n,e,c,et,lim,sup,prob)=>{const r=Array(20).fill('');r[0]=id;r[1]=n;r[2]=e;r[7]=c;r[10]=et;r[13]=lim;r[15]=sup;r[17]=prob;r[5]=n.toLowerCase()+'@x.com';return r;};
const HOY=Utilities.formatDate(new Date());
pipe.appendRow(fila('L-1','Carlos','Textil SA','A - Caliente','En negociación','2026-01-01',5000,60));
pipe.appendRow(fila('L-2','Lin','Formosa','A - Caliente','Nuevo',HOY,'',''));
pipe.appendRow(fila('L-3','Ana','LogBras','B - Tibio','Ganado (contrato)','','',''));
const d=webDatos();
check(d.pipeline.length===3&&d.etapas.length===9,'W3 webDatos 回傳管線與階段');
check(d.kpis.abiertos===2&&d.kpis.vencidas===1&&d.kpis.hoyVencen===1,'W3 KPI 計算正確（開放/逾期/今日）');
check(d.kpis.m2Ponderado===3000,'W3 加權 m² = 5000×60%');
check(d.funnel.find(f=>f.etapa==='En negociación').n===1,'W3 漏斗計數');
check(d.disponibilidad.catTotal>0,'W3 含土地可用率');
check(d.pipeline[0].calif==='A'&&d.pipeline[0].email==='carlos@x.com','W3 卡片欄位齊備');

// 動作
const r1=webActividad('L-1','llamada','Habló del contrato');
check(r1.ok&&crmSS._sheets['Actividades'].rows.length===2,'W4 webActividad 寫入活動');
check(pipe.rows[1][14]===r1.fecha,'W4 Último contacto 回填');
check(crmSS._sheets['Actividades'].rows[1][4]==='jaime','W4 負責人自動取自登入者');
let malo=false;try{webActividad('L-1','llamada','  ')}catch(e){malo=true}
check(malo,'W4 空摘要拒絕');
const r2=webEtapa('L-1','Propuesta enviada');
check(r2.ok&&pipe.rows[1][10]==='Propuesta enviada','W5 webEtapa 換階段');
malo=false;try{webEtapa('L-1','EtapaFalsa')}catch(e){malo=true}
check(malo,'W5 非法階段拒絕');
const acts=webActividadesDe('L-1');
check(acts.length===1&&acts[0].resumen==='Habló del contrato','W6 活動史查詢');

console.log(`\n═══ Web W1 伺服端測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
