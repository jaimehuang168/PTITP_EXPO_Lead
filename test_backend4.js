// 名片辨識功能測試
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r);return this}getRange(){return{setValue(){},getValue:()=>'',setFontWeight:()=>({setBackground:()=>({setFontColor:()=>({})})})}}setFrozenRows(){}getDataRange(){return{getValues:()=>this.rows}}}
const sheets={};const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))};
global.SpreadsheetApp={getActiveSpreadsheet:()=>ss,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})};
global.Utilities={newBlob:(b,m,n)=>({_name:n,getAs:mt=>({setName(x){this._n=x;return this},getBytes:()=>[1],getName(){return this._n}})}),base64Decode:s=>'BYTES:'+s,base64Encode:()=>'B64',formatDate:(d,tz,fmt)=>fmt.includes('HHmmss')?'20260706_183000':(fmt.includes('HH')?'2026-07-06 18:30:00':'2026-07-06')};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({_text:t,setMimeType(){return this}})};
global.HtmlService={createHtmlOutput:h=>({_html:h,setTitle(){return this}})};
global.MailApp={sendEmail:()=>{}};
global.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyDays(){return this},atHour(){return this},nearMinute(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
// Script Properties mock
const propStore={};
global.PropertiesService={getScriptProperties:()=>({getProperty:k=>propStore[k]||null,setProperty:(k,v)=>propStore[k]=v})};
// Drive mock
const driveFiles=[];
global.DriveApp={getFoldersByName:n=>({hasNext:()=>false,next:()=>null}),createFolder:n=>({createFile:b=>{driveFiles.push(b._name);return{getUrl:()=>'https://drive.google.com/file/d/FAKE123/view'}}})};
// Claude API mock
let apiMode='ok', apiCalls=0;
global.UrlFetchApp={fetch:(url,opts)=>{apiCalls++;
  if(apiMode==='fail')return{getResponseCode:()=>500,getContentText:()=>'err'};
  const payload=JSON.parse(opts.payload);
  return{getResponseCode:()=>200,getContentText:()=>JSON.stringify({content:[{type:'text',text:'```json\n{"nombre":"Carlos Benítez","empresa":"Textil del Este SA","cargo":"Gerente General","telefono":"+595 981 123456","email":"carlos@textileste.com.py","pais":"Paraguay"}\n```'}]})};
}};
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

// O1: 沒有 API key
let r=doPost({postData:{contents:JSON.stringify({accion:'ocrTarjeta',imagen:'AAA',promotor:'María'})}});
let j=JSON.parse(r._text);
check(j.ok===false&&/API key no configurada/.test(j.error),'O1 缺 API key 明確報錯');

// O2: 正常辨識
propStore['ANTHROPIC_API_KEY']='sk-test';
r=doPost({postData:{contents:JSON.stringify({accion:'ocrTarjeta',imagen:'AAA',mime:'image/jpeg',promotor:'María González'})}});
j=JSON.parse(r._text);
check(j.ok===true,'O2 辨識成功');
check(j.datos.nombre==='Carlos Benítez'&&j.datos.email==='carlos@textileste.com.py','O2 欄位解析正確（含 markdown 圍欄清除）');
check(j.imagen==='https://drive.google.com/file/d/FAKE123/view','O2 回傳 Drive 影像連結');
check(driveFiles.length===1&&driveFiles[0].startsWith('Tarjeta_20260706_183000'),'O2 影像已存 Drive 且檔名含時間戳');
check(propStore['ocr_2026-07-06']==='1','O2 每日計數 +1');

// O3: 每日上限
propStore['ocr_2026-07-06']='300';
r=doPost({postData:{contents:JSON.stringify({accion:'ocrTarjeta',imagen:'AAA'})}});
check(JSON.parse(r._text).ok===false&&/Límite diario/.test(JSON.parse(r._text).error),'O3 達每日上限拒絕');
propStore['ocr_2026-07-06']='5';

// O4: API 失敗仍回傳影像連結
apiMode='fail';
r=doPost({postData:{contents:JSON.stringify({accion:'ocrTarjeta',imagen:'AAA'})}});
j=JSON.parse(r._text);
check(j.ok===false&&j.imagen&&/no disponible/.test(j.error),'O4 API 失敗回錯誤但保留影像連結');
apiMode='ok';

// O5: 缺影像
r=doPost({postData:{contents:JSON.stringify({accion:'ocrTarjeta'})}});
check(JSON.parse(r._text).ok===false,'O5 缺影像拒絕');

// O6: 問卷寫入含名片連結（第 24 欄），且不受 OCR 分支影響
setup();
r=doPost({postData:{contents:JSON.stringify({nombre:'Test',calificacion:'C - Frío',tarjetaUrl:'https://drive.google.com/x'})}});
check(JSON.parse(r._text).ok===true,'O6 問卷送出正常');
const fila=sheets['Leads'].rows[sheets['Leads'].rows.length-1];
check(fila.length===25&&fila[23]==='https://drive.google.com/x'&&fila[22]==='Pendiente','O6 名片連結存於第24欄、Estado 不受影響');
checK___=0;check(/^L-[A-Z0-9]+-[A-Z0-9]{2}$/.test(fila[24]),'O7 每筆 lead 自動生成 LeadID');

console.log(`\n═══ 名片辨識測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
