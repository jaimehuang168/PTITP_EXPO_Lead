// CRM Fase 1 測試：初始化、同步去重、SLA、Último contacto、Estado 回寫、任務信
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[];this.cells={}}
  getLastRow(){return this.rows.length}
  appendRow(r){this.rows.push(r.slice());return this}
  getRange(a,b,c,d){const self=this;
    return{setValue(v){if(self.rows[a-1])self.rows[a-1][b-1]=v;else{self.cells[a+','+b]=v}},
      getValue:()=>self.rows[a-1]?self.rows[a-1][b-1]:'',
      setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},
      setDataValidation(){return this}};}
  setFrozenRows(){}
  getDataRange(){const self=this;return{getValues:()=>self.rows.map(r=>r.slice())}}}
function mkSS(){const sheets={};return{_sheets:sheets,
  getSheetByName:n=>sheets[n]||null,
  insertSheet:n=>(sheets[n]=new MockSheet(n))};}
const crmSS=mkSS(), expoSS=mkSS();
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:id=>expoSS,
  newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),
  getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
global.Utilities={formatDate:(d,tz,fmt)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');return `${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}`}};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyMinutes(){return this},everyDays(){return this},atHour(){return this},onWeekDay(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
const HOY=Utilities.formatDate(new Date(),'','yyyy-MM-dd');

// 建展會 Leads 模擬表（含新舊資料：一筆有 LeadID、一筆沒有）
const EXPO_H=['Timestamp','Fecha','Evento','Promotor','Nombre','Empresa','Cargo','País','Teléfono/WhatsApp','Email','Tipo de organización','Sector/Rubro','Intereses','Plazo','Superficie (m²)','Empleos est.','Cómo nos conoció','Calificación','Observaciones','Próximos pasos','Fecha límite seguimiento','Responsable seguimiento','Estado','Tarjeta (imagen)','LeadID'];
const leads=expoSS.insertSheet('Leads');
leads.appendRow(EXPO_H);
const mkLead=(nombre,calif,limite,resp,id)=>{const r=Array(25).fill('');
  r[1]='2026-07-06';r[2]='Expo Paraguay 2026';r[3]='María';r[4]=nombre;r[5]=nombre+' SA';r[7]='Paraguay';
  r[12]='Inversión';r[14]='5000';r[17]=calif;r[19]='Enviar brochure';r[20]=limite;r[21]=resp;r[22]='Pendiente';r[24]=id||'';return r;};
leads.appendRow(mkLead('Carlos','A - Caliente','','Jaime','L-TEST1'));
leads.appendRow(mkLead('Ana','B - Tibio','2026-07-20','María',''));   // 舊資料無 LeadID
leads.appendRow(mkLead('Julia','C - Frío','','',''));

// T1: setupCRM
setupCRM();
check(crmSS._sheets['Pipeline']&&crmSS._sheets['Actividades']&&crmSS._sheets['Lotes']&&crmSS._sheets['Ocupaciones']&&crmSS._sheets['Plantillas'],'T1 七張分頁建立');
check(crmSS._sheets['Config'].rows.length>=3&&crmSS._sheets['Config'].rows.some(r=>r[0]==='ID hoja Expo'),'T1 Config 含展會ID參數列');

// T2: 未設定展會 ID 時不炸
check(sincronizarLeads()===0,'T2 未填展會ID安全返回');
crmSS._sheets['Config'].rows[1][1]='EXPO_FAKE_ID';
crmSS._sheets['Config'].rows[2][1]='jefe@ptitp.com.py';

// T3: 同步
const n=sincronizarLeads();
check(n===3,'T3 匯入 3 筆');
const pipe=crmSS._sheets['Pipeline'].rows;
check(pipe.length===4,'T3 Pipeline 3 列 + 表頭');
check(pipe[1][0]==='L-TEST1'&&pipe[1][10]==='Nuevo','T3 既有 LeadID 沿用、Etapa=Nuevo');
check(leads.rows[2][24]!==''&&pipe[2][0]===leads.rows[2][24],'T3 舊資料補發 LeadID 並回寫展會表');
// SLA：A=+2天（展會沒填期限）、B=沿用展會期限
const esperadoA=Utilities.formatDate(new Date(Date.now()+2*86400000),'','yyyy-MM-dd');
check(pipe[1][13]===esperadoA,'T3 A 級 SLA = +2 天');
check(pipe[2][13]==='2026-07-20','T3 展會已填期限者沿用');
// 去重
check(sincronizarLeads()===0&&crmSS._sheets['Pipeline'].rows.length===4,'T3 重複同步不重複匯入');

// T4: Actividades → Último contacto + Estado 回寫
crmSS._sheets['Actividades'].appendRow(['2026-07-06','L-TEST1','llamada','Llamado inicial','Jaime']);
crmSS._sheets['Actividades'].appendRow(['2026-07-08','L-TEST1','reunión','Reunión CDE','Jaime']);
pipe[1][10]='En negociación'; // 手動推階段
actualizarPipeline();
check(crmSS._sheets['Pipeline'].rows[1][14]==='2026-07-08','T4 Último contacto 取最近活動日');
check(leads.rows[1][22]==='En proceso','T4 Estado 回寫展會表（En negociación→En proceso）');
pipe[1][10]='Ganado (contrato)';
actualizarPipeline();
check(leads.rows[1][22]==='Cerrado','T4 Ganado→Cerrado');

// T5: 任務信
pipe[2][13]='2026-01-01'; // Ana 逾期
const rpt=tareasDiarias();
check(/VENCIDAS \(1\)/.test(rpt)&&rpt.includes('Ana'),'T5 逾期清單正確');
check(/LEADS A SIN CONTACTO/.test(rpt),'T5 A級怠慢區塊存在');
check(mails.length===1&&/jefe@ptitp.com.py/.test(mails[0].to),'T5 任務信寄給 Config 收件人');
check(/vencidas/.test(mails[0].subject),'T5 主旨含統計');

console.log(`\n═══ CRM Fase 1 測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
