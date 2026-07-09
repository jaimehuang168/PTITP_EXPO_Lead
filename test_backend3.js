// 測試：Config 收件人、email 驗證、日期範圍報告、enviarReporteA
const fs=require('fs');
class MockSheet{constructor(n){this.name=n;this.rows=[]}getLastRow(){return this.rows.length}appendRow(r){this.rows.push(r);return this}getRange(){return{setValue(){},getValue:()=>'',setFontWeight:()=>({setBackground:()=>({setFontColor:()=>({})})})}}setFrozenRows(){}getDataRange(){return{getValues:()=>this.rows}}}
const sheets={};const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new MockSheet(n))};
global.SpreadsheetApp={getActiveSpreadsheet:()=>ss,getUi:()=>({createMenu:()=>({addItem(){return this},addToUi(){}})})};
global.Utilities={newBlob:(h,m,n)=>({getAs:mt=>({_html:h,_name:n,setName(x){this._name=x;return this},getBytes:()=>[1,2,3],getName(){return this._name}})}),base64Encode:b=>'B64DATA',formatDate:(d,tz,fmt)=>{const t=new Date(d.getTime()-4*3600*1000);const p=n=>String(n).padStart(2,'0');const s=`${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}`;return fmt.includes('HH')?`${s} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`:s}};
global.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
global.ContentService={MimeType:{JSON:'json'},createTextOutput:t=>({_text:t,setMimeType(){return this}})};
global.HtmlService={createHtmlOutput:h=>({_html:h,setTitle(t){return this}})};
const mails=[];global.MailApp={sendEmail:o=>mails.push(o)};
global.ScriptApp={getProjectTriggers:()=>[],newTrigger:()=>({timeBased(){return this},everyDays(){return this},atHour(){return this},nearMinute(){return this},create(){}}),deleteTrigger:()=>{}};
global.Logger={log:()=>{}};
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};

setup();
check(sheets['Config']&&sheets['Config'].rows.length===4,'C1 setup 建立 Config 分頁（含排程參數）');

// email 驗證
check(_validarEmails('a@x.com, b@y.org; malo, c@@z')==='a@x.com,b@y.org','C2 _validarEmails 清洗混合輸入');
check(_validarEmails('')==='','C2 空輸入回空字串');

// Config 收件人生效
sheets['Config'].rows[0][1]='jefe@ptitp.com.py, dir@gob.py, invalido';
check(_getReportEmails()==='jefe@ptitp.com.py,dir@gob.py','C3 從 Config B1 讀取並清洗收件人');

// 塞三天資料
const mk=(fecha,nombre,cal,pais)=>['ts',fecha,'Expo Paraguay 2026','María',nombre,'Emp','Cargo',pais,'','', 'Manufactura','Textil','Inversión','6-12 meses','','','Stand',cal,'obs','Enviar brochure','','María','Pendiente'];
sheets['Leads'].rows.push(mk('2026-07-05','D1','A - Caliente','Paraguay'));
sheets['Leads'].rows.push(mk('2026-07-06','D2','B - Tibio','Brasil'));
sheets['Leads'].rows.push(mk('2026-07-07','D3','A - Caliente','Taiwán'));
sheets['Leads'].rows.push(mk('2026-07-08','D4','C - Frío','Paraguay'));

// 範圍報告：只取 06–07
const rg=_construirReporteRango('2026-07-06','2026-07-07');
check(rg.total===2,'C4 範圍報告只計範圍內 2 筆');
check(/REPORTE POR RANGO DE FECHAS \(2026-07-06 → 2026-07-07\)/.test(rg.texto),'C4 範圍標題正確');
check(_construirReporteExpo().total===4,'C4 全展期仍為 4 筆（未受影響）');

// enviarReporteA：expo
let r=doGet({parameter:{action:'enviarReporteA',tipo:'expo',emails:'jefe@x.com,otro@y.com'}});
let j=JSON.parse(r._text);
check(j.ok&&mails.length===1&&mails[0].to==='jefe@x.com,otro@y.com','C5 expo 報告寄給多個收件人');
check(/acumulado del evento/.test(mails[0].subject),'C5 expo 主旨正確');

// enviarReporteA：rango
r=doGet({parameter:{action:'enviarReporteA',tipo:'rango',desde:'2026-07-05',hasta:'2026-07-06',emails:'a@b.co'}});
j=JSON.parse(r._text);
check(j.ok&&j.total===2&&mails.length===2,'C5 範圍報告寄出且計數正確');

// enviarReporteA：dia（今天 2026-07-06 假設 mock 日期）
r=doGet({parameter:{action:'enviarReporteA',tipo:'dia',emails:'a@b.co'}});
check(JSON.parse(r._text).ok&&mails.length===3,'C5 當日報告寄出');

// 錯誤處理
r=doGet({parameter:{action:'enviarReporteA',tipo:'expo',emails:'no-valido'}});
check(JSON.parse(r._text).ok===false&&mails.length===3,'C6 無效 email 拒寄');
r=doGet({parameter:{action:'enviarReporteA',tipo:'rango',desde:'2026-07-09',hasta:'2026-07-05',emails:'a@b.co'}});
check(JSON.parse(r._text).ok===false,'C6 desde>hasta 拒寄');
r=doGet({parameter:{action:'reporteRango',desde:'2026-07-05',hasta:'2026-07-07'}});
check(r._html&&r._html.includes('RANGO'),'C6 reporteRango 檢視正常');

// C7: PDF 功能
r=doGet({parameter:{action:'reportePdf',tipo:'expo'}});
check(r._html&&r._html.includes('B64DATA')&&r._html.includes('PTITP_Reporte_evento.pdf'),'C7 reportePdf 回傳下載頁（含 base64 與檔名）');
r=doGet({parameter:{action:'reportePdf',tipo:'rango',desde:'2026-07-05',hasta:'2026-07-06'}});
check(r._html&&r._html.includes('PTITP_Reporte_2026-07-05_a_2026-07-06.pdf'),'C7 範圍 PDF 檔名正確');
r=doGet({parameter:{action:'reportePdf',tipo:'rango',desde:'2026-07-09',hasta:'2026-07-05'}});
check(JSON.parse(r._text).ok===false,'C7 無效範圍 PDF 拒絕');
r=doGet({parameter:{action:'enviarReporteA',tipo:'expo',emails:'pdf@x.com'}});
const m=mails[mails.length-1];
check(m.attachments&&m.attachments.length===1&&m.attachments[0].getName()==='PTITP_Reporte_evento.pdf','C7 寄送報告夾帶 PDF 附件');

console.log(`\n═══ 收件人/範圍功能測試: ${pass} 通過 / ${fail} 失敗 ═══`);
process.exit(fail?1:0);
