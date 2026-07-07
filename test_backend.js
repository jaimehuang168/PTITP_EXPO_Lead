/**
 * test_backend.js — 在 Node 中模擬 Google Apps Script 環境測試 Code.gs
 * 測試項目：
 *   T1 setup() 建立表頭
 *   T2 doPost() 寫入 6 筆模擬問卷（含 A/B/C、多國、缺欄位、錯誤 JSON）
 *   T3 generarReporteDiario() 統計正確 + 報告內容完整
 *   T4 doGet(?action=reporte) 回傳 HTML
 */
const fs = require('fs');

// ── Mock GAS 服務 ──────────────────────────────
class MockSheet {
  constructor(name){ this.name=name; this.rows=[]; }
  getLastRow(){ return this.rows.length; }
  appendRow(r){ this.rows.push(r); return this; }
  getRange(){ return { setFontWeight:()=>({setBackground:()=>({setFontColor:()=>({})})}) }; }
  setFrozenRows(){}
  getDataRange(){ return { getValues: ()=> this.rows }; }
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = new MockSheet(n)),
};
global.SpreadsheetApp = { getActiveSpreadsheet: ()=>ss, getUi: ()=>({ createMenu:()=>({addItem(){return this},addToUi(){}}) }) };
global.Utilities = {
  formatDate: (d, tz, fmt) => {
    // 簡化：以 Asuncion 時區近似 (UTC-4 七月)
    const t = new Date(d.getTime() - 4*3600*1000);
    const p = n => String(n).padStart(2,'0');
    const s = `${t.getUTCFullYear()}-${p(t.getUTCMonth()+1)}-${p(t.getUTCDate())}`;
    return fmt.includes('HH') ? `${s} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}` : s;
  }
};
global.LockService = { getScriptLock: ()=>({ tryLock:()=>true, releaseLock:()=>{} }) };
global.ContentService = {
  MimeType:{JSON:'json'},
  createTextOutput: t => ({ _text:t, setMimeType(){ return this; } }),
};
global.HtmlService = { createHtmlOutput: h => ({ _html:h, setTitle(){ return this; } }) };
global.MailApp = { sendEmail: o => { global._lastEmail = o; } };
global.ScriptApp = { getProjectTriggers: ()=>[], newTrigger: ()=>({timeBased(){return this},everyDays(){return this},atHour(){return this},nearMinute(){return this},create(){}}), deleteTrigger:()=>{} };
global.Logger = { log: m => console.log('   [Logger]', String(m).split('\n')[0]) };

// ── 載入 Code.gs ──────────────────────────────
eval(fs.readFileSync('Code.gs','utf8'));

let pass=0, fail=0;
const check = (cond, name) => { cond ? (pass++, console.log('✅', name)) : (fail++, console.log('❌', name)); };

// T1: setup
setup();
check(sheets['Leads'] && sheets['Leads'].rows[0].length === 25, 'T1 setup() 建立 Leads 表頭 (25 欄)');
check(sheets['Reportes'] && sheets['Reportes'].rows.length === 1, 'T1 setup() 建立 Reportes 表頭');

// T2: doPost 模擬 6 筆問卷
const leads = [
  { evento:'Expo Paraguay 2026', promotor:'María González', nombre:'Carlos Benítez', empresa:'Textil del Este SA',
    cargo:'Gerente General', pais:'Paraguay', telefono:'+595 981 123456', email:'carlos@textileste.com.py',
    tipoOrg:'Manufactura', sector:'Textil', intereses:['Alquiler de lote / nave industrial','Instalación de planta'],
    plazo:'Inmediato (0-6 meses)', superficie:'5000', empleos:'120', comoNosConocio:'Cámara o gremio',
    calificacion:'A - Caliente', observaciones:'Dueño con decisión. Ya alquila en CDE, quiere ampliar. Preguntó por energía y régimen de maquila.',
    proximosPasos:['Agendar visita al parque','Enviar propuesta/cotización'], fechaSeguimiento:'2026-07-08', responsable:'Jaime Huang' },
  { evento:'Expo Paraguay 2026', promotor:'María González', nombre:'Ana Souza', empresa:'LogBras Ltda',
    cargo:'Directora Comercial', pais:'Brasil', telefono:'+55 45 99911 2233', email:'ana@logbras.com.br',
    tipoOrg:'Logística/Comercio', sector:'Logística', intereses:['Servicios del parque','Inversión'],
    plazo:'6-12 meses', superficie:'', empleos:'', comoNosConocio:'Prensa / Medios',
    calificacion:'B - Tibio', observaciones:'Interés en hub logístico frontera. Sin presupuesto aprobado aún.',
    proximosPasos:['Enviar brochure/dossier','Reunión de seguimiento'], fechaSeguimiento:'2026-07-13', responsable:'' },
  { evento:'Expo Paraguay 2026', promotor:'Pedro Rojas', nombre:'Lin Wei-Chen', empresa:'Formosa Electronics',
    cargo:'VP Operations', pais:'Taiwán', telefono:'+886 912 345 678', email:'wlin@formosaelec.tw',
    tipoOrg:'Manufactura', sector:'Electrónica', intereses:['Instalación de planta'],
    plazo:'Más de 1 año', superficie:'12000', empleos:'300', comoNosConocio:'Gobierno / Embajada',
    calificacion:'A - Caliente', observaciones:'Evaluando Paraguay vs Brasil para ensamblaje. Decisión de directorio Q4. Preocupa mano de obra calificada.',
    proximosPasos:['Presentar a dirección','Agendar visita al parque'], fechaSeguimiento:'2026-07-07', responsable:'Jaime Huang' },
  { evento:'Expo Paraguay 2026', promotor:'Pedro Rojas', nombre:'Julia Fernández', empresa:'Universidad Nacional del Este',
    cargo:'Investigadora', pais:'Paraguay', telefono:'', email:'jfernandez@une.edu.py',
    tipoOrg:'Académico', sector:'Educación', intereses:['Cooperación institucional'],
    plazo:'Solo explorando', superficie:'', empleos:'', comoNosConocio:'Pasó por el stand',
    calificacion:'C - Frío', observaciones:'Interés en pasantías para alumnos.',
    proximosPasos:['Agregar a newsletter'], fechaSeguimiento:'', responsable:'' },
  { evento:'Expo Paraguay 2026', promotor:'María González', nombre:'Roberto Díaz', empresa:'',
    cargo:'', pais:'Argentina', telefono:'+54 9 11 5555', email:'',
    tipoOrg:'Inversionista', sector:'', intereses:['Inversión','Información general'],
    plazo:'6-12 meses', superficie:'', empleos:'', comoNosConocio:'Redes sociales',
    calificacion:'B - Tibio', observaciones:'Inversor individual, monto no revelado.',
    proximosPasos:['Enviar brochure/dossier'], fechaSeguimiento:'2026-07-15', responsable:'' },
  // 極簡填寫（只有必填）
  { nombre:'Visitante Anónimo', calificacion:'C - Frío', promotor:'Pedro Rojas' },
];

leads.forEach((p,i)=>{
  const res = doPost({ postData:{ contents: JSON.stringify(p) } });
  const j = JSON.parse(res._text);
  check(j.ok === true, `T2 doPost 第 ${i+1} 筆寫入 (${p.nombre})`);
});
check(sheets['Leads'].rows.length === 7, 'T2 Leads 表共 1 表頭 + 6 筆資料');

// 錯誤 JSON 不應炸掉
const bad = doPost({ postData:{ contents: '{{{ not json' } });
check(JSON.parse(bad._text).ok === false, 'T2 錯誤 JSON 回傳 ok:false 而非例外');

// 欄位對齊檢查：intereses 陣列應存成逗號字串
const row1 = sheets['Leads'].rows[1];
check(row1[12] === 'Alquiler de lote / nave industrial, Instalación de planta', 'T2 intereses 陣列→字串正確');
check(row1[22] === 'Pendiente', 'T2 Estado 預設為 Pendiente');

// T3: 報告
const rpt = generarReporteDiario();
check(/Visitantes registrados: 6/.test(rpt), 'T3 報告總數 = 6');
check(/Leads A \(calientes\): 2/.test(rpt), 'T3 A 級 = 2');
check(/Leads B \(tibios\):    2/.test(rpt), 'T3 B 級 = 2');
check(/Leads C \(fríos\):     2/.test(rpt), 'T3 C 級 = 2');
check(rpt.includes('Carlos Benítez') && rpt.includes('Lin Wei-Chen'), 'T3 A 級客戶名單完整');
check(rpt.includes('Paraguay: 2') && rpt.includes('Taiwán: 1'), 'T3 國別統計正確');
check(rpt.includes('antes del 2026-07-07'), 'T3 追蹤期限顯示正確');
check(sheets['Reportes'].rows.length === 2, 'T3 報告寫入 Reportes 分頁');

// T4: doGet 報告網頁
const page = doGet({ parameter:{ action:'reporte' } });
check(page._html && page._html.includes('REPORTE DIARIO'), 'T4 doGet ?action=reporte 回傳 HTML 報告');
const ping = doGet({ parameter:{} });
check(JSON.parse(ping._text).ok === true, 'T4 doGet 無參數回傳 API 狀態');

console.log(`\n═══ 後端測試結果: ${pass} 通過 / ${fail} 失敗 ═══\n`);
if (fail === 0) {
  console.log('──── 以下為自動產生的當日報告全文 ────\n');
  console.log(rpt);
}
process.exit(fail ? 1 : 0);
