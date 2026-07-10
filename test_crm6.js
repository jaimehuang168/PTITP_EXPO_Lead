// W2 伺服端測試：編輯白名單、Lotes/Ocupaciones CRUD、刪除保護、留痕
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r.slice());return this}deleteRow(i){this.rows.splice(i-1,1)}getRange(a,b){const s=this;return{setValue(v){s.rows[a-1][b-1]=v},setFontWeight(){return this},setBackground(){return this},setFontColor(){return this},setDataValidation(){return this}}}setFrozenRows(){}getDataRange(){const s=this;return{getValues:()=>s.rows.map(r=>r.slice())}}}
function mkSS(){const sheets={};return{_sheets:sheets,getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))}}
const crmSS=mkSS(),expoSS=mkSS();expoSS.insertSheet('Leads').appendRow(['Timestamp','LeadID','Estado']);
global.SpreadsheetApp={getActiveSpreadsheet:()=>crmSS,openById:()=>expoSS,newDataValidation:()=>({requireValueInList(){return this},build(){return{}}}),getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})};
global.Utilities={newBlob:h=>({getAs:()=>({setName(){return this},getName:()=>'x',getBytes:()=>[1]})}),formatDate:(d,tz,f)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');const base=t.getUTCFullYear()+'-'+p(t.getUTCMonth()+1)+'-'+p(t.getUTCDate());return f&&f.includes('HH')?base+' 10:00':base}};
global.MailApp={sendEmail:()=>{}};global.CalendarApp={getDefaultCalendar:()=>({createEvent:()=>({getId:()=>'E'}),getEventById:()=>({deleteEvent(){}})})};
global.UrlFetchApp={fetch:()=>({getResponseCode:()=>404})};
global.ScriptApp={WeekDay:{MONDAY:1},getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyMinutes(){return this},everyDays(){return this},atHour(){return this},onWeekDay(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
global.Session={getActiveUser:()=>({getEmail:()=>'jaime@ptitp.com.py'})};
global.HtmlService={createHtmlOutput:h=>({setTitle(){return this},addMetaTag(){return this}}),createHtmlOutputFromFile:f=>({setTitle(){return this},addMetaTag(){return this}})};
eval(fs.readFileSync('Code_CRM.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
setupCRM();
const pipe=crmSS._sheets['Pipeline'];
const r=Array(20).fill('');r[0]='L-1';r[1]='Carlos';r[10]='Nuevo';pipe.appendRow(r);

// E1: 編輯客戶（白名單）
webLeadGuardar('L-1',{empresa:'Textil SA',sup:'6000',prob:'70',lote:'VI-01',limite:'2026-08-01',hackea:'x',Etapa:'Ganado (contrato)'});
check(pipe.rows[1][2]==='Textil SA'&&pipe.rows[1][15]==='6000'&&pipe.rows[1][17]==='70','E1 白名單欄位寫入');
check(pipe.rows[1][10]==='Nuevo','E1 非白名單欄（Etapa）不可經編輯 API 寫入');
check(crmSS._sheets['Cambios'].rows.length===2&&/empresa/.test(crmSS._sheets['Cambios'].rows[1][4]),'E1 變更留痕');

// E2: webLotes 全量
const dl=webLotes();
check(dl.lotes.length===91&&dl.ocupaciones.length===10&&dl.disponibilidad.catTotal>0,'E2 webLotes 回傳三組資料');

// E3: Lote 更新與新增
webLoteGuardar('VI-01',{m2:4200,notas:'medido en campo'});
check(crmSS._sheets['Lotes'].rows.find(x=>x[0]==='VI-01')[3]===4200,'E3 Lote 更新 m²');
webLoteGuardar('PRUEBA-01',{block:'P',tipo:'industrial',m2:1000,notas:'nuevo'});
check(crmSS._sheets['Lotes'].rows.some(x=>x[0]==='PRUEBA-01'),'E3 Lote 新增');

// E4: 刪除保護
let err='';try{webLoteBorrar('XI-01')}catch(e){err=e.message}
check(/referenciado/.test(err),'E4 被 Ocupación 引用的 Lote 拒刪');
webLoteBorrar('PRUEBA-01');
check(!crmSS._sheets['Lotes'].rows.some(x=>x[0]==='PRUEBA-01'),'E4 未引用者可刪');

// E5: Ocupación 新增→推導、編輯、刪除→釋放
const antes=crmSS._sheets['Lotes'].rows.find(x=>x[0]==='VI-02')[9];
const rn=webOcupGuardar('',{empresa:'NuevaCo',tipo:'en negociación',lotes:'VI-02',m2:2000});
check(rn.ok&&rn.id.indexOf('O-')===0,'E5 新增 Ocupación 自動編號');
check(crmSS._sheets['Lotes'].rows.find(x=>x[0]==='VI-02')[9]==='en negociación'&&antes==='disponible','E5 新增後推導狀態即時更新');
webOcupGuardar(rn.id,{tipo:'alquilado'});
check(crmSS._sheets['Lotes'].rows.find(x=>x[0]==='VI-02')[9]==='ocupado','E5 編輯類型→ocupado');
webOcupBorrar(rn.id);
check(crmSS._sheets['Lotes'].rows.find(x=>x[0]==='VI-02')[9]==='disponible','E5 刪除→地塊釋放為 disponible');
check(crmSS._sheets['Cambios'].rows.length>=6,'E5 全程留痕');

// E6: Verificado 工作流
const dl2=webLotes();
check(dl2.lotes.some(l=>l.verificado===false)&&dl2.disponibilidad.sinVerificar.lotes>0,'E6 webLotes 帶出待確認旗標與統計');
webLoteGuardar('TELECEL-01',{verificado:'sí'});
check(crmSS._sheets['Lotes'].rows.find(x=>x[0]==='TELECEL-01')[11]==='sí','E6 介面可標記為已確認');
const rNueva=webOcupGuardar('',{empresa:'PendCo',tipo:'reservado',lotes:'VI-03',m2:500});
const hoO={};crmSS._sheets['Ocupaciones'].rows[0].forEach((h,i)=>hoO[h]=i);
check(crmSS._sheets['Ocupaciones'].rows.find(x=>x[0]===rNueva.id)[hoO['Verificado']]==='','E6 新增記錄預設待確認');
webOcupBorrar(rNueva.id);
const antes6=webLotes().disponibilidad.sinVerificar.lotes;
marcarVerificadosIniciales();
const despues6=webLotes().disponibilidad.sinVerificar.lotes;
check(despues6<=antes6&&webLotes().lotes.find(l=>l.id==='XV').verificado===false,'E6 批次標記：備註含 verificar 者維持待確認');

console.log(`\n═══ Web W2 伺服端測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
