// CRM Fase 3 測試：種子/推導狀態/跨區租用/雙口徑/週報
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}
  getLastRow(){return this.rows.length}
  appendRow(r){this.rows.push(r.slice());return this}
  getRange(a,b){const s=this;return{setValue(v){s.rows[a-1][b-1]=v},getValue:()=>s.rows[a-1][b-1],
    setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}}}
  setFrozenRows(){}
  getDataRange(){const s=this;return{getValues:()=>s.rows.map(r=>r.slice())}}}
function mkSS(){const sheets={};return{_sheets:sheets,getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))}}
const crmSS=mkSS(), expoSS=mkSS();
expoSS.insertSheet('Leads').appendRow(['Timestamp','Fecha','LeadID','Estado']); // 最小 stub
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:()=>expoSS,
  newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),
  getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
global.Utilities={newBlob:(h,m,n)=>({_html:h,getAs:()=>({setName(x){this._n=x;return this},getBytes:()=>[1],getName(){return this._n},_html:h})}),
  formatDate:(d)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');return `${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}`}};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
global.CalendarApp={getDefaultCalendar:()=>({createEvent:()=>({getId:()=>'E'}),getEventById:()=>({deleteEvent(){}})})};
global.UrlFetchApp={fetch:()=>({getResponseCode:()=>404,getBlob:()=>({setName:n=>({})})})};
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyMinutes(){return this},everyDays(){return this},atHour(){return this},onWeekDay(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

setupCRM();
const lot=crmSS._sheets['Lotes'], ocu=crmSS._sheets['Ocupaciones'];
check(lot.rows.length>30,'F1 地籍種子 30+ 筆（含五類用途）');
check(ocu.rows.length===10,'F1 租用種子 9 筆');
check(lot.rows[0].length===11&&lot.rows[0][9]==='Estado (derivado)','F1 推導欄存在');
check(lot.rows.some(r=>r[2]==='área verde')&&lot.rows.some(r=>r[2]==='infraestructura')&&lot.rows.some(r=>r[2]==='administrativo PSC')&&lot.rows.some(r=>r[2]==='reserva'),'F1 五類用途齊備');
check(String(lot.rows.find(r=>r[0]==='SUR-01')[4]).startsWith('img:'),'F1 主要地塊含影像相對座標');

// F2: 推導狀態
actualizarLotes();
const est=id=>lot.rows.find(r=>r[0]===id)[9];
check(est('TELECEL-01')==='ocupado','F2 整塊 alquilado → ocupado');
check(est('SUR-01')==='parcial','F2 部分租用 → parcial');
check(est('XIV-05')==='reservado'&&est('XV-06')==='reservado','F2 Julong 整塊保留 → reservado');
check(est('XIII-06')==='disponible','F2 無人引用 → disponible');
check(est('VERDE-01')==='—'&&est('INFRA-PTAR')==='—','F2 非工業用途 → —');
check(lot.rows.find(r=>r[0]==='TELECEL-01')[10]===2700,'F2 整塊佔用回填 m²');

// F3: 跨區租用（Cintas 跨 SUR-04 與 SUR-06）
check(est('SUR-04')==='parcial'&&est('SUR-06')==='parcial','F3 跨區租用兩塊皆 parcial');

// F4: 雙口徑
ocu.rows[3][5]=8000; // K y K 簽約 8000 m²（跨/部分）
ocu.rows[7][5]=12000; // Master Bus 保留 12000
const d=resumenDisponibilidad();
const telecel=2700;
check(d.catTotal>90000,'F4 工業地籍總量合理（>9萬m²）');
check(d.catOcupado>=telecel+2120*2+4134*2,'F4 地籍口徑含整塊佔用（TELECEL+Julong 4塊）');
check(d.catTotal-d.catOcupado===d.catDisponible,'F4 可用=總量-佔用');
check(d.lotesParciales>=3,'F4 parcial 地塊計數');
check(d.contrato.alquilado===2700+8000&&d.contrato.reservado===12000,'F4 合約口徑依類型加總');

// F5: 週報
crmSS._sheets['Config'].rows.find(r=>r[0]==='Emails resumen diario')[1]='jefe@ptitp.com.py';
const pipe=crmSS._sheets['Pipeline'];
const fila=(id,emp,etapa,sup,prob)=>{const r=Array(20).fill('');r[0]=id;r[1]=emp;r[2]=emp+' SA';r[10]=etapa;r[15]=sup;r[17]=prob;return r;};
pipe.appendRow(fila('L-1','Textil','En negociación',5000,60));
pipe.appendRow(fila('L-2','Formosa','Propuesta enviada',12000,40));
pipe.appendRow(fila('L-3','Frio','Nuevo','',''));
const html=reporteSemanal();
check(/Embudo del pipeline/.test(html)&&/En negociaci&oacute;n|En negociación/.test(html),'F5 週報含漏斗');
check(html.includes('7.800')||html.includes('7800'),'F5 加權 m² = 5000×60%+12000×40% = 7.800');
check(/Disponibilidad de suelo industrial/.test(html)&&/Contractual/.test(html),'F5 含雙口徑可用率');
const m=mails[mails.length-1];
check(m&&m.attachments&&/PTITP_Pipeline_Semanal_/.test(m.attachments[0].getName()),'F5 週報 PDF 附件寄出');
check(/ponderados/.test(m.subject),'F5 主旨含加權數字');

console.log(`\n═══ CRM Fase 3 測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
