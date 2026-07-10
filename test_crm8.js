// W3 伺服端測試：座標輸出、Visitas CRUD、Procesar 整合
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r.slice());return this}deleteRow(i){this.rows.splice(i-1,1)}getRange(a,b){const s=this;return{setValue(v){s.rows[a-1][b-1]=v},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}}}setFrozenRows(){}getDataRange(){const s=this;return{getValues:()=>s.rows.map(r=>r.slice())}}}
function mkSS(){const sheets={};return{_sheets:sheets,getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))}}
const crmSS=mkSS(),expoSS=mkSS();expoSS.insertSheet('Leads').appendRow(['Timestamp','LeadID','Estado']);
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:()=>expoSS,newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
global.Utilities={newBlob:h=>({getAs:()=>({setName(){return this},getName:()=>'x',getBytes:()=>[1]})}),formatDate:(d,tz,f)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');const base=t.getUTCFullYear()+'-'+p(t.getUTCMonth()+1)+'-'+p(t.getUTCDate());return f&&f.includes('HH')?base+' 10:00':base}};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
const eventos=[];global.CalendarApp={getDefaultCalendar:()=>({createEvent:(t,i,f,o)=>{eventos.push(t);return{getId:()=>'EVT-'+eventos.length}},getEventById:()=>({deleteEvent(){}})})};
global.UrlFetchApp={fetch:()=>({getResponseCode:()=>404})};
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyMinutes(){return this},everyDays(){return this},atHour(){return this},onWeekDay(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
global.Session={getActiveUser:()=>({getEmail:()=>'jaime@ptitp.com.py'})};
global.HtmlService={createHtmlOutput:h=>({setTitle(){return this},addMetaTag(){return this}}),createHtmlOutputFromFile:()=>({setTitle(){return this},addMetaTag(){return this}})};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
setupCRM();
crmSS._sheets['Config'].rows.find(r=>r[0]==='URL app')[1]='https://x.github.io/app/';
const pipe=crmSS._sheets['Pipeline'];
const r=Array(20).fill('');r[0]='L-1';r[1]='Ana';r[2]='LogBras';r[3]='Brasil';r[5]='ana@x.br';r[10]='Contactado';pipe.appendRow(r);

// M1: 座標輸出
const dl=webLotes();
const xi=dl.lotes.find(l=>l.id==='XI-01');
check(Array.isArray(xi.esquinas)&&xi.esquinas.length===4,'M1 webLotes 帶四角座標欄');
check(dl.lotes.find(l=>l.id==='XVI-C').esquinas[0].indexOf('img:')===0,'M1 有座標的地塊格式正確');
check(dl.urlMapa==='https://x.github.io/app/mapa_satelital.jpg','M1 衛星圖網址由 Config 組成');

// M2: Visitas 新增
const rv=webVisitaGuardar('',{leadId:'L-1',fecha:'2026-08-01',hora:'09:30',visitantes:'Ana + CFO',recepcion:'Jaime'});
check(rv.ok&&rv.id==='V-001','M2 新增參訪自動編號');
const lv=webVisitas();
check(lv.visitas.length===1&&lv.visitas[0].estado==='agendada'&&lv.visitas[0].empresa==='LogBras','M2 清單帶出 lead 公司名與預設 agendada');

// M3: Procesar 走既有引擎（Calendar + 信 + 階段推進）
const res=webVisitasProcesar();
check(res.confirmadas===1&&eventos.length===1&&/LogBras/.test(eventos[0]),'M3 Procesar 建 Calendar 事件');
check(mails.length===1&&/Confirmação/.test(mails[0].subject),'M3 巴西客戶收葡文確認信（語言自動推斷）');
check(pipe.rows[1][10]==='Visita agendada','M3 Pipeline 階段推進');
check(webVisitas().visitas[0].estado==='confirmada','M3 estado→confirmada');

// M4: 編輯（realizada + minuta）
webVisitaGuardar('V-001',{estado:'realizada',minuta:'Firma probable en agosto'});
check(webVisitas().visitas[0].minuta==='Firma probable en agosto','M4 minuta 寫入');
webVisitasProcesar();
check(pipe.rows[1][10]==='Visita realizada','M4 realizada 再推階段');
check(crmSS._sheets['Cambios'].rows.some(x=>x[2]==='Visita'),'M4 參訪變更留痕');

// M5: 缺必填
let err=false;try{webVisitaGuardar('',{fecha:'2026-08-02'})}catch(e){err=true}
check(err,'M5 缺 lead 拒絕');

console.log(`\n═══ Web W3 伺服端測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
