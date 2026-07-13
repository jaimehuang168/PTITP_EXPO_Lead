// Fichas 測試
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r.slice());return this}getRange(){return{setValue(){},setFontWeight:()=>({setBackground:()=>({setFontColor:()=>({})})})}}setFrozenRows(){}getDataRange(){return{getValues:()=>this.rows}}}
const sheets={};const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))};
global.SpreadsheetApp={getActiveSpreadsheet:()=>ss,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})};
global.Utilities={newBlob:(h,m,n)=>({_h:h,getAs:()=>({setName(x){this._n=x;return this},getBytes:()=>[1],getName(){return this._n}})}),base64Encode:()=>'B64X',formatDate:()=>'2026-07-10 09:00'};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({_text:t,setMimeType(){return this}})};
let htmlOut='';global.HtmlService={createHtmlOutput:h=>{htmlOut=h;return{setTitle(){return this}}}};
global.MailApp={sendEmail:()=>{}};global.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyDays(){return this},everyHours(){return this},atHour(){return this},nearMinute(){return this},create(){}}),deleteTrigger:()=>{}};global.Logger={log:()=>{}};
global.PropertiesService={getScriptProperties:()=>({getProperty:()=>null,setProperty:()=>{}})};
global.DriveApp={getFoldersByName:()=>({hasNext:()=>false}),createFolder:()=>({})};
global.UrlFetchApp={fetch:()=>({})};
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
setup();
const H=sheets['Leads'].rows[0];
const mk=(fecha,nombre,calif,obs)=>{const r=Array(25).fill('');
  r[1]=fecha;r[2]='Expo PY 2026';r[3]='María';r[4]=nombre;r[5]=nombre+' SA';r[6]='Gerente';r[7]='Paraguay';
  r[8]='+595 981';r[9]=nombre.toLowerCase()+'@x.com';r[10]='Manufactura';r[11]='Textil';r[12]='Inversión';
  r[13]='6-12 meses';r[14]='5000';r[15]='40';r[16]='Feria';r[17]=calif;r[18]=obs;r[19]='Enviar brochure';
  r[20]='2026-07-15';r[21]='Jaime';r[22]='Pendiente';r[23]='https://drive.google.com/t';r[24]='L-X'+nombre;return r;};
sheets['Leads'].appendRow(mk('2026-07-09','Zoe','C - Frío',''));
sheets['Leads'].appendRow(mk('2026-07-10','Carlos','A - Caliente','Dueño con decisión'));
sheets['Leads'].appendRow(mk('2026-07-10','Ana','B - Tibio','Consultar con directorio'));

// F1: 列印視圖
doGet({parameter:{action:'fichas',tipo:'expo'}});
check(/Fichas de Leads/.test(htmlOut)&&/window\.print/.test(htmlOut),'F1 列印視圖含工具列');
check(/Carlos/.test(htmlOut)&&/Zoe/.test(htmlOut)&&/Ana/.test(htmlOut),'F1 含全部 leads（A/B/C）');
check(htmlOut.indexOf('Carlos')<htmlOut.indexOf('Ana')&&htmlOut.indexOf('Ana')<htmlOut.indexOf('Zoe'),'F1 排序 A→B→C');
check(/Dueño con decisión/.test(htmlOut)&&/Observaciones/.test(htmlOut),'F1 觀察欄呈現');
check(/Manufactura/.test(htmlOut)&&/5000 m/.test(htmlOut)&&/ver tarjeta/.test(htmlOut),'F1 完整欄位（組織/面積/名片連結）');
check(/A:1 (&middot;|·) B:1 (&middot;|·) C:1/.test(htmlOut),'F1 頁首統計');
check(/page-break-inside:avoid/.test(htmlOut)&&/confidencialidad/.test(htmlOut),'F1 防截斷與機密註記');
check(/action=fichasPdf&tipo=expo/.test(htmlOut),'F1 內含 PDF 下載連結（帶原參數）');

// F2: 過濾
doGet({parameter:{action:'fichas',tipo:'dia',fecha:'2026-07-10'}});
check(/Carlos/.test(htmlOut)&&!/Zoe/.test(htmlOut),'F2 依日期過濾');
doGet({parameter:{action:'fichas',tipo:'expo',calif:'A'}});
check(/Carlos/.test(htmlOut)&&!/Ana(?! SA)/.test(htmlOut.replace(/Ana SA/g,''))&&!/Zoe/.test(htmlOut),'F2 依評級 A 過濾');

// F3: PDF 下載頁
doGet({parameter:{action:'fichasPdf',tipo:'expo'}});
check(/B64X/.test(htmlOut)&&/PTITP_Fichas_evento\.pdf/.test(htmlOut),'F3 PDF 下載頁');

console.log(`\n═══ Fichas 測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
