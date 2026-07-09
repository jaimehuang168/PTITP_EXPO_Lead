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
check(lot.rows.length===92,'F1 地籍種子 91 筆（v4）');
check(ocu.rows.length===11,'F1 租用種子 10 筆');
check(lot.rows.filter(r=>r[2]==='industrial').length===82,'F1 工業地塊 82 筆');
check(lot.rows.some(r=>r[2]==='área verde')&&lot.rows.some(r=>r[2]==='infraestructura')&&lot.rows.some(r=>r[2]==='administrativo PSC')&&lot.rows.some(r=>r[2]==='reserva'),'F1 五類用途齊備');
check(lot.rows.find(r=>r[0]==='VII-11')[3]===4134,'F1 VII-11 地籍 4.134');
const xvi=lot.rows.filter(r=>r[1]==='XVI');
check(xvi.length===4&&Math.round(xvi.reduce((s,r)=>s+r[3],0)*100)/100===21447.25,'F1 XVI 四拆且合計 21.447,25 分毫不差');
check(lot.rows.find(r=>r[0]==='XVI-C')[3]===6012,'F1 MB 第二保留塊更正為 6.012');
check(lot.rows.find(r=>r[0]==='INFRA-RET')[3]===4200,'F1 蓄洪池 4.200');
check(lot.rows.filter(r=>r[1]==='XI').length===12,'F1 XI 拆為 12 個地塊');

// F2: 推導狀態
actualizarLotes();
const est=id=>lot.rows.find(r=>r[0]===id)[9];
check(est('TELECEL-01')==='ocupado'&&est('VII-12')==='ocupado','F2 整塊 alquilado → ocupado');
check(est('XII-05')==='parcial','F2 Gauss 部分租用 → parcial（餘 1.181,15 可租）');
check(est('XI-01')==='reservado'&&est('XI-12')==='reservado'&&lot.rows.filter(r=>r[1]==='XI'&&r[9]==='reservado').length===12,'F2 ACELON 12 塊全 reservado');
check(est('VI-01')==='disponible'&&est('X-01')==='disponible','F2 無人引用 → disponible');
check(est('XIV')==='—'&&est('XIII')==='—','F2 非工業用途 → —');

// F3: 跨區/部分租用
check(est('VII-11')==='ocupado'&&est('IX-01')==='ocupado','F3 Cintas 兩廠房（VII-11 + IX-01）皆 ocupado');
check(est('XVI-A')==='ocupado'&&est('XVI-B')==='reservado'&&est('XVI-C')==='reservado'&&est('XVI-D')==='disponible','F3 XVI 四組成狀態各自正確');
check(est('XV')==='reservado','F3 Master Bus 保留 XV');

// F4: 雙口徑
const d=resumenDisponibilidad();
check(Math.round(d.catTotal*100)/100===272516.25,'F4 工業地籍總量 272.516,25 m²');
check(Math.round(d.catOcupado)===Math.round(4134+4134+4524+4134+2120+33496+15449+2700+4178+6012+340),'F4 地籍口徑=整塊佔用 81.221 m²');
check(d.catTotal-d.catOcupado===d.catDisponible,'F4 可用=總量-佔用（191.295,25 介於兩份官方口徑之間）');
check(d.lotesParciales===1,'F4 parcial = 1（僅 XII-05 Gauss）');
check(Math.round(d.contrato.alquilado*100)/100===Math.round((340+1618.85+4134+4134+2120+8658+2700)*100)/100,'F4 合約口徑 alquilado 23.704,85');
check(d.contrato.reservado===33496+21461+4178,'F4 合約口徑 reservado 59.135');

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
