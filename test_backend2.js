// 補充測試：累計報告 + 手動寄送 action
const fs = require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r);return this}getRange(){return{setFontWeight:()=>({setBackground:()=>({setFontColor:()=>({})})})}}setFrozenRows(){}getDataRange(){return{getValues:()=>this.rows}}}
const sheets={};const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))};
global.SpreadsheetApp={getActiveSpreadsheet:()=>ss,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})};
global.Utilities={formatDate:(d,tz,fmt)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');const s=`${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}`;return fmt.includes('HH')?`${s} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`:s}};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({_text:t,setMimeType(){return this}})};
global.HtmlService={createHtmlOutput:h=>({_html:h,setTitle(t){this._title=t;return this}})};
global.MailApp={sendEmail:o=>{global._lastEmail=o}};
global.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyDays(){return this},atHour(){return this},nearMinute(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

setup();
// 模擬兩天的資料：手動塞不同 Fecha
const mk=(fecha,nombre,cal,pais,estado)=>['ts',fecha,'Expo Paraguay 2026','María',nombre,'Emp','Cargo',pais,'','', 'Manufactura','Textil','Inversión','6-12 meses','','','Stand',cal,'obs','Enviar brochure','','María',estado||'Pendiente'];
sheets['Leads'].rows.push(mk('2026-07-05','Día1-A','A - Caliente','Paraguay','En proceso'));
sheets['Leads'].rows.push(mk('2026-07-05','Día1-B','B - Tibio','Brasil'));
sheets['Leads'].rows.push(mk('2026-07-06','Día2-A','A - Caliente','Taiwán'));
sheets['Leads'].rows.push(mk('2026-07-06','Día2-C','C - Frío','Paraguay'));

// E1: 累計報告
const expo=_construirReporteExpo();
check(expo.total===4,'E1 累計總數 = 4（跨兩天）');
check(/Días con registros: 2/.test(expo.texto),'E1 展期天數 = 2');
check(/2026-07-05: 2 visitantes/.test(expo.texto)&&/2026-07-06: 2 visitantes/.test(expo.texto),'E1 逐日統計正確');
check(/Leads A \(calientes\): 2  \(1 aún pendientes/.test(expo.texto),'E1 A級追蹤狀態統計（1筆仍 Pendiente）');
check(expo.texto.includes('Día1-A')&&expo.texto.includes('Día2-A'),'E1 跨日 A 級名單完整');
check(/Estado: En proceso/.test(expo.texto),'E1 Estado 欄顯示於名單');

// E2: doGet actions
const g1=doGet({parameter:{action:'reporteExpo'}});
check(g1._html&&g1._html.includes('REPORTE ACUMULADO'),'E2 ?action=reporteExpo 回傳累計報告 HTML');
const g2=doGet({parameter:{action:'enviarReporte'}});
const j2=JSON.parse(g2._text);
check(j2.ok===true&&/no configurado/.test(j2.email),'E2 ?action=enviarReporte 觸發成功（Email 未設定時回報）');
check(sheets['Reportes'].rows.length===2,'E2 手動觸發有寫入 Reportes 分頁');
// 當日報告只算今天(2026-07-06)兩筆
const hoy=_construirReporte('2026-07-06');
check(hoy.total===2&&hoy.nA===1,'E2 當日報告只計今日 2 筆（A=1）');

console.log(`\n═══ 新功能測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
