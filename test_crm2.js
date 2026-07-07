// CRM Fase 2 測試：模板/語言推斷/參訪確認/Calendar/提醒/取消/階段推進
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
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:()=>expoSS,
  newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),
  getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
global.Utilities={formatDate:(d)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');return `${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}`}};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
const eventos=[];let borrados=0;
global.CalendarApp={getDefaultCalendar:()=>({
  createEvent:(t,ini,fin,o)=>{eventos.push({t,ini,fin,o});return{getId:()=>'EVT-'+eventos.length}},
  getEventById:id=>({deleteEvent(){borrados++}})})};
global.UrlFetchApp={fetch:(url)=>({getResponseCode:()=>url.includes('mapa')?200:404,getBlob:()=>({setName:n=>({_n:n})})})};
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyMinutes(){return this},everyDays(){return this},atHour(){return this},onWeekDay(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

setupCRM();
check(crmSS._sheets['Plantillas'].rows.length===7,'P1 播種 6 個三語模板');
check(crmSS._sheets['Config'].rows.some(r=>r[0]==='Link brochure'),'P1 Config 補參訪參數');
check(crmSS._sheets['Visitas'].rows[0].indexOf('Recordatorio enviado')===11,'P1 Visitas 含提醒欄');

// 語言推斷
check(_idiomaPorPais('Brasil')==='PT'&&_idiomaPorPais('Taiwán')==='EN'&&_idiomaPorPais('Paraguay')==='ES'&&_idiomaPorPais('')==='ES','P2 語言推斷 PT/EN/ES');

// 模板讀取與填值
const pl=_plantilla('confirmacion','PT');
check(/Confirmação/.test(pl.asunto),'P2 讀取葡文模板');
check(_rellenar('Hola {{nombre}} de {{empresa}}',{nombre:'Ana',empresa:'LogBras'})==='Hola Ana de LogBras','P2 佔位符填值');
check(_plantilla('confirmacion','XX').asunto.includes('Confirmación'),'P2 未知語言 fallback ES');

// 建 Pipeline 兩筆
const pipe=crmSS._sheets['Pipeline'];
const fila=(id,nombre,pais,email,etapa)=>{const r=Array(20).fill('');r[0]=id;r[1]=nombre;r[2]=nombre+' SA';r[3]=pais;r[5]=email;r[10]=etapa;return r;};
pipe.appendRow(fila('L-1','Ana','Brasil','ana@logbras.com.br','Contactado'));
pipe.appendRow(fila('L-2','Lin','Taiwán','lin@formosa.tw','Nuevo'));

// Config 填 cc 與 maps
crmSS._sheets['Config'].rows.find(r=>r[0]==='Link Google Maps')[1]='https://maps.app/xyz';
crmSS._sheets['Config'].rows.find(r=>r[0]==='Email copia visitas')[1]='gerencia@ptitp.com.py';

// 排一場明天的參訪（agendada，Idioma 留白→應推斷 PT）
const MAN=Utilities.formatDate(new Date(Date.now()+86400000));
const vis=crmSS._sheets['Visitas'];
vis.appendRow(['V-1','L-1',MAN,'10:00','Ana + 2 ingenieros','Jaime Huang','','agendada','','','','']);
vis.appendRow(['V-2','L-2','2026-08-01','14:30','Lin','Jaime Huang','EN','agendada','','','','']);

// P3: 確認流程
const res=procesarVisitas();
check(res.confirmadas===2,'P3 確認 2 場');
check(vis.rows[1][7]==='confirmada'&&vis.rows[1][8]==='EVT-1','P3 Estado→confirmada + 事件ID回填');
check(vis.rows[1][6]==='PT','P3 語言留白自動推斷 PT（巴西）');
check(eventos.length===2&&eventos[1].t.includes('Lin SA')&&eventos[1].ini.getHours()===14,'P3 Calendar 事件標題與時間正確');
check(mails.length===2,'P3 寄出 2 封確認信');
check(/Confirmação/.test(mails[0].subject)&&mails[0].to==='ana@logbras.com.br','P3 巴西客戶收葡文信');
check(/Confirmation/.test(mails[1].subject),'P3 台灣客戶收英文信');
check(mails[0].cc==='gerencia@ptitp.com.py','P3 cc 依 Config');
check(mails[0].attachments&&mails[0].attachments.length===1,'P3 附件抓得到的附上、404略過');
check(mails[0].body.includes('https://maps.app/xyz')&&mails[0].body.includes(MAN),'P3 信文含地圖連結與日期');
check(pipe.rows[1][10]==='Visita agendada'&&pipe.rows[2][10]==='Visita agendada','P3 Pipeline 階段推進');

// P4: 提醒信（只有明天的那場）
const antes=mails.length;
const env=recordatoriosVisitas();
check(env===1&&mails.length===antes+1,'P4 只寄明天的 1 場提醒');
check(/Lembrete/.test(mails[mails.length-1].subject),'P4 提醒信用對語言(PT)');
check(vis.rows[1][11]==='sí','P4 標記已提醒');
check(recordatoriosVisitas()===0,'P4 重跑不重寄');

// P5: 取消 + 已完成
vis.rows[2][7]='cancelada';
vis.rows[1][7]='realizada';
procesarVisitas();
check(borrados===1&&vis.rows[2][8]==='','P5 取消刪 Calendar 事件並清 ID');
check(pipe.rows[1][10]==='Visita realizada','P5 realizada 推進階段');

console.log(`\n═══ CRM Fase 2 測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
