/**
 * PTITP 展會招商問卷系統 — Google Apps Script 後端
 * ------------------------------------------------
 * 功能：
 *   1. doPost()  接收 GitHub Pages 前端送來的問卷 JSON，寫入 "Leads" 工作表
 *   2. generarReporteDiario()  將當日問卷自動彙整成西文「業務推廣暨當日工作報告」
 *      → 寫入 "Reportes" 工作表 + （可選）寄送 Email
 *   3. doGet(?action=reporte)  以網頁形式顯示當日報告，主管用連結即可看
 *
 * 部署方式見 README.md
 */

// ══════════ 設定區 ══════════
const CONFIG = {
  SHEET_LEADS: 'Leads',
  SHEET_REPORTES: 'Reportes',
  SHEET_CONFIG: 'Config',
  // 備用收件人：正常情況請改用 Sheet 的「Config」分頁 B1 儲存格填寫（可多個，逗號分隔），
  // 那裡改完立即生效，不需要重新部署
  REPORT_EMAIL: '',
  // 預設展會名稱（前端也可覆寫）
  EVENTO_DEFAULT: 'Expo Paraguay 2026',
  ZONA_HORARIA: 'America/Asuncion',
};

const HEADERS = [
  'Timestamp', 'Fecha', 'Evento', 'Promotor',
  'Nombre', 'Empresa', 'Cargo', 'País', 'Teléfono/WhatsApp', 'Email',
  'Tipo de organización', 'Sector/Rubro', 'Intereses', 'Plazo',
  'Superficie (m²)', 'Empleos est.', 'Cómo nos conoció',
  'Calificación', 'Observaciones', 'Próximos pasos',
  'Fecha límite seguimiento', 'Responsable seguimiento', 'Estado',
];

// ══════════ 初始化：第一次執行 setup() 建立表頭 ══════════
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let sh = ss.getSheetByName(CONFIG.SHEET_LEADS);
  if (!sh) sh = ss.insertSheet(CONFIG.SHEET_LEADS);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold').setBackground('#0F4C46').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }

  let rep = ss.getSheetByName(CONFIG.SHEET_REPORTES);
  if (!rep) rep = ss.insertSheet(CONFIG.SHEET_REPORTES);
  if (rep.getLastRow() === 0) {
    rep.appendRow(['Fecha', 'Evento', 'Total visitantes', 'Leads A', 'Leads B', 'Leads C', 'Reporte completo']);
    rep.getRange(1, 1, 1, 7)
      .setFontWeight('bold').setBackground('#0F4C46').setFontColor('#FFFFFF');
    rep.setFrozenRows(1);
  }
  let cfg = ss.getSheetByName(CONFIG.SHEET_CONFIG);
  if (!cfg) cfg = ss.insertSheet(CONFIG.SHEET_CONFIG);
  if (cfg.getLastRow() === 0) {
    cfg.appendRow(['Emails para reporte automático (19:30)', '', '← escriba en la celda B1 uno o varios emails separados por coma; se aplica de inmediato']);
    cfg.getRange(1, 1).setFontWeight('bold');
  }
  Logger.log('✅ 初始化完成');
}

// ══════════ 接收前端問卷 ══════════
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000); // 防止多人同時送出造成競態
  try {
    const d = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CONFIG.SHEET_LEADS) || ss.insertSheet(CONFIG.SHEET_LEADS);

    const now = new Date();
    const fecha = Utilities.formatDate(now, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');

    sh.appendRow([
      Utilities.formatDate(now, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss'),
      fecha,
      d.evento || CONFIG.EVENTO_DEFAULT,
      d.promotor || '',
      d.nombre || '',
      d.empresa || '',
      d.cargo || '',
      d.pais || '',
      d.telefono || '',
      d.email || '',
      d.tipoOrg || '',
      d.sector || '',
      (d.intereses || []).join(', '),
      d.plazo || '',
      d.superficie || '',
      d.empleos || '',
      d.comoNosConocio || '',
      d.calificacion || '',
      d.observaciones || '',
      (d.proximosPasos || []).join(', '),
      d.fechaSeguimiento || '',
      d.responsable || d.promotor || '',
      'Pendiente', // 追蹤狀態欄，後續人工更新：Pendiente / En proceso / Cerrado
    ]);

    return _json({ ok: true, msg: 'Lead registrado' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ══════════ 網頁查看報告 ══════════
//   <WebAppURL>?action=reporte              當日報告（可加 &fecha=2026-07-08）
//   <WebAppURL>?action=reporteExpo          整個展期累計報告
//   <WebAppURL>?action=enviarReporte        手動觸發：寫入 Reportes 分頁 + 寄 Email
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'reporte') {
    const fecha = (e.parameter.fecha) ||
      Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
    return _htmlReporte(_construirReporte(fecha).texto, 'Reporte diario ' + fecha);
  }

  if (action === 'reporteExpo') {
    return _htmlReporte(_construirReporteExpo().texto, 'Reporte acumulado del evento');
  }

  // 日期範圍報告檢視：?action=reporteRango&desde=2026-07-06&hasta=2026-07-09
  if (action === 'reporteRango') {
    const desde = e.parameter.desde, hasta = e.parameter.hasta;
    if (!_fechaValida(desde) || !_fechaValida(hasta) || desde > hasta)
      return _json({ ok: false, error: 'Rango de fechas inválido' });
    return _htmlReporte(_construirReporteRango(desde, hasta).texto, `Reporte ${desde} → ${hasta}`);
  }

  // 業務人員自訂寄送：?action=enviarReporteA&tipo=dia|rango|expo&emails=a@x,b@y[&desde&hasta]
  if (action === 'enviarReporteA') {
    try {
      const emails = _validarEmails(e.parameter.emails || '');
      if (!emails) return _json({ ok: false, error: 'Emails inválidos o vacíos' });
      const tipo = e.parameter.tipo || 'dia';
      let rpt, titulo;

      if (tipo === 'expo') {
        rpt = _construirReporteExpo();
        titulo = 'acumulado del evento';
      } else if (tipo === 'rango') {
        const desde = e.parameter.desde, hasta = e.parameter.hasta;
        if (!_fechaValida(desde) || !_fechaValida(hasta) || desde > hasta)
          return _json({ ok: false, error: 'Rango de fechas inválido' });
        rpt = _construirReporteRango(desde, hasta);
        titulo = `del ${desde} al ${hasta}`;
      } else {
        const f = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
        rpt = _construirReporte(f);
        titulo = 'diario ' + f;
      }

      MailApp.sendEmail({
        to: emails,
        subject: `[PTITP] Reporte ${titulo} — ${rpt.total} visitantes, ${rpt.nA} leads A`,
        body: rpt.texto,
      });
      return _json({ ok: true, enviado: 'a ' + emails, total: rpt.total });
    } catch (err) {
      return _json({ ok: false, error: String(err) });
    }
  }

  if (action === 'enviarReporte') {
    try {
      generarReporteDiario();
      const dest = _getReportEmails();
      return _json({ ok: true, email: dest ? 'enviado a ' + dest : 'no configurado (solo guardado en la hoja Reportes; configure emails en la hoja "Config" celda B1)' });
    } catch (err) {
      return _json({ ok: false, error: String(err) });
    }
  }

  return _json({ ok: true, servicio: 'PTITP Expo API', hora: new Date().toISOString() });
}

function _htmlReporte(texto, titulo) {
  return HtmlService.createHtmlOutput(
    '<pre style="font-family:monospace;white-space:pre-wrap;max-width:800px;margin:2rem auto;line-height:1.5">'
    + texto.replace(/</g, '&lt;') + '</pre>'
  ).setTitle('PTITP — ' + titulo);
}

// ══════════ 每日報告（可手動執行，或由觸發器每晚自動執行） ══════════
function generarReporteDiario() {
  const fecha = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const rpt = _construirReporte(fecha);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rep = ss.getSheetByName(CONFIG.SHEET_REPORTES) || ss.insertSheet(CONFIG.SHEET_REPORTES);
  rep.appendRow([fecha, rpt.evento, rpt.total, rpt.nA, rpt.nB, rpt.nC, rpt.texto]);

  const dest = _getReportEmails();
  if (dest) {
    MailApp.sendEmail({
      to: dest,
      subject: `[PTITP] Reporte diario de promoción — ${fecha} (${rpt.total} visitantes, ${rpt.nA} leads A)`,
      body: rpt.texto,
    });
  }
  Logger.log(rpt.texto);
  return rpt.texto;
}

// ══════════ 收件人工具 ══════════
// 自動報告收件人：優先讀 Sheet「Config」分頁 B1（改完立即生效），否則用 CONFIG.REPORT_EMAIL
function _getReportEmails() {
  try {
    const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CONFIG);
    let raw = '';
    if (cfg) {
      const vals = cfg.getDataRange().getValues();
      const row = vals.find(r => String(r[0]).toLowerCase().indexOf('email') === 0);
      raw = row ? String(row[1] || '') : '';
    }
    if (!String(raw).trim()) raw = CONFIG.REPORT_EMAIL;
    return _validarEmails(raw);
  } catch (err) {
    return _validarEmails(CONFIG.REPORT_EMAIL);
  }
}

// 驗證並清洗 email 清單（逗號/分號/空白分隔，上限 10 個）
function _validarEmails(raw) {
  return String(raw).split(/[,;\s]+/)
    .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .slice(0, 10).join(',');
}

function _fechaValida(f) {
  return /^\d{4}-\d{2}-\d{2}$/.test(f || '');
}

// ══════════ 報告產生核心 ══════════
function _construirReporte(fecha) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_LEADS);
  const data = sh.getDataRange().getValues();
  const H = {};
  data[0].forEach((h, i) => H[h] = i);

  const rows = data.slice(1).filter(r => String(r[H['Fecha']]).slice(0, 10) === fecha
    || Utilities.formatDate(new Date(r[H['Timestamp']]), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd') === fecha);

  const evento = rows.length ? rows[0][H['Evento']] : CONFIG.EVENTO_DEFAULT;
  const byCal = { A: [], B: [], C: [] };
  const byPais = {}, byInteres = {}, byPromotor = {};

  rows.forEach(r => {
    const cal = String(r[H['Calificación']]).charAt(0).toUpperCase() || 'C';
    (byCal[cal] || byCal.C).push(r);
    const p = r[H['País']] || 'N/D';
    byPais[p] = (byPais[p] || 0) + 1;
    String(r[H['Intereses']]).split(',').map(s => s.trim()).filter(Boolean)
      .forEach(i => byInteres[i] = (byInteres[i] || 0) + 1);
    const pr = r[H['Promotor']] || 'N/D';
    byPromotor[pr] = (byPromotor[pr] || 0) + 1;
  });

  const fmtTop = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  • ${k}: ${v}`).join('\n') || '  • (sin datos)';

  const fmtLead = r =>
    `  ▸ ${r[H['Nombre']]} — ${r[H['Empresa']] || 's/empresa'} (${r[H['Cargo']] || 's/cargo'}, ${r[H['País']] || 'N/D'})\n` +
    `    Interés: ${r[H['Intereses']] || 'N/D'} | Plazo: ${r[H['Plazo']] || 'N/D'}` +
    (r[H['Superficie (m²)']] ? ` | ${r[H['Superficie (m²)']]} m²` : '') + '\n' +
    `    Contacto: ${r[H['Teléfono/WhatsApp']] || '—'} / ${r[H['Email']] || '—'}\n` +
    (r[H['Observaciones']] ? `    Obs.: ${r[H['Observaciones']]}\n` : '') +
    `    ➜ Próximos pasos: ${r[H['Próximos pasos']] || 'definir'}` +
    (r[H['Fecha límite seguimiento']] ? ` (antes del ${String(r[H['Fecha límite seguimiento']]).slice(0, 10)})` : '') +
    ` — Resp.: ${r[H['Responsable seguimiento']] || 'N/D'}`;

  const texto =
`══════════════════════════════════════════════════
 PTITP — PARQUE TECNOLÓGICO INTELIGENTE TAIWÁN-PARAGUAY
 REPORTE DIARIO DE PROMOCIÓN Y CAPTACIÓN DE INVERSIONES
══════════════════════════════════════════════════
Evento: ${evento}
Fecha:  ${fecha}

1. RESUMEN DEL DÍA
  • Visitantes registrados: ${rows.length}
  • Leads A (calientes): ${byCal.A.length}
  • Leads B (tibios):    ${byCal.B.length}
  • Leads C (fríos):     ${byCal.C.length}

2. VISITANTES POR PAÍS
${fmtTop(byPais)}

3. INTERESES MÁS CONSULTADOS
${fmtTop(byInteres)}

4. REGISTROS POR PROMOTOR
${fmtTop(byPromotor)}

5. LEADS PRIORITARIOS (A) — ACCIÓN EN 24-48 HS
${byCal.A.map(fmtLead).join('\n\n') || '  (ninguno hoy)'}

6. LEADS DE SEGUIMIENTO (B) — ACCIÓN EN 1 SEMANA
${byCal.B.map(fmtLead).join('\n\n') || '  (ninguno hoy)'}

7. PENDIENTES PARA MAÑANA
  • Enviar material prometido a todos los leads A antes del mediodía.
  • Confirmar visitas al parque agendadas.
  • Reponer folletos / verificar material del stand.

Generado automáticamente — Sistema de Captación PTITP
══════════════════════════════════════════════════`;

  return { texto, total: rows.length, nA: byCal.A.length, nB: byCal.B.length, nC: byCal.C.length, evento };
}

// ══════════ 彙總報告：全展期或指定日期範圍 ══════════
function _construirReporteExpo() { return _construirReporteAgregado(null, null); }
function _construirReporteRango(desde, hasta) { return _construirReporteAgregado(desde, hasta); }

function _construirReporteAgregado(desde, hasta) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_LEADS);
  const data = sh.getDataRange().getValues();
  const H = {};
  data[0].forEach((h, i) => H[h] = i);
  let rows = data.slice(1);
  if (desde && hasta) {
    rows = rows.filter(r => {
      const f = String(r[H['Fecha']]).slice(0, 10);
      return f >= desde && f <= hasta;
    });
  }

  const evento = rows.length ? rows[0][H['Evento']] : CONFIG.EVENTO_DEFAULT;
  const byCal = { A: [], B: [], C: [] };
  const byPais = {}, byInteres = {}, byPromotor = {}, byDia = {};

  rows.forEach(r => {
    const cal = String(r[H['Calificación']]).charAt(0).toUpperCase() || 'C';
    (byCal[cal] || byCal.C).push(r);
    const p = r[H['País']] || 'N/D';
    byPais[p] = (byPais[p] || 0) + 1;
    String(r[H['Intereses']]).split(',').map(s => s.trim()).filter(Boolean)
      .forEach(i => byInteres[i] = (byInteres[i] || 0) + 1);
    const pr = r[H['Promotor']] || 'N/D';
    byPromotor[pr] = (byPromotor[pr] || 0) + 1;
    const d = String(r[H['Fecha']]).slice(0, 10) || 'N/D';
    byDia[d] = (byDia[d] || 0) + 1;
  });

  const fmtTop = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `  • ${k}: ${v}`).join('\n') || '  • (sin datos)';
  const fmtDias = () => Object.entries(byDia).sort()
    .map(([k, v]) => `  • ${k}: ${v} visitantes`).join('\n') || '  • (sin datos)';

  const fmtLeadCorto = r =>
    `  ▸ ${r[H['Nombre']]} — ${r[H['Empresa']] || 's/empresa'} (${r[H['País']] || 'N/D'}) | ` +
    `${r[H['Intereses']] || 'N/D'} | ${r[H['Plazo']] || 'N/D'}` +
    (r[H['Superficie (m²)']] ? ` | ${r[H['Superficie (m²)']]} m²` : '') +
    ` | Estado: ${r[H['Estado']] || 'Pendiente'} — Resp.: ${r[H['Responsable seguimiento']] || 'N/D'}`;

  const pendA = byCal.A.filter(r => (r[H['Estado']] || 'Pendiente') === 'Pendiente').length;

  const encabezado = (desde && hasta)
    ? ` REPORTE POR RANGO DE FECHAS (${desde} → ${hasta})`
    : ' REPORTE ACUMULADO DEL EVENTO (hasta la fecha)';

  const texto =
`══════════════════════════════════════════════════
 PTITP — PARQUE TECNOLÓGICO INTELIGENTE TAIWÁN-PARAGUAY
${encabezado}
══════════════════════════════════════════════════
Evento: ${evento}
Días con registros: ${Object.keys(byDia).length}
Generado: ${Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss')}

1. TOTALES${desde ? ' DEL PERÍODO' : ' DEL EVENTO'}
  • Visitantes registrados: ${rows.length}
  • Leads A (calientes): ${byCal.A.length}  (${pendA} aún pendientes de seguimiento)
  • Leads B (tibios):    ${byCal.B.length}
  • Leads C (fríos):     ${byCal.C.length}

2. VISITANTES POR DÍA
${fmtDias()}

3. VISITANTES POR PAÍS
${fmtTop(byPais)}

4. INTERESES MÁS CONSULTADOS
${fmtTop(byInteres)}

5. REGISTROS POR PROMOTOR
${fmtTop(byPromotor)}

6. TODOS LOS LEADS A DEL EVENTO
${byCal.A.map(fmtLeadCorto).join('\n') || '  (ninguno)'}

7. TODOS LOS LEADS B DEL EVENTO
${byCal.B.map(fmtLeadCorto).join('\n') || '  (ninguno)'}

Generado automáticamente — Sistema de Captación PTITP
══════════════════════════════════════════════════`;

  return { texto, total: rows.length, nA: byCal.A.length, nB: byCal.B.length, nC: byCal.C.length, evento };
}

// ══════════ 每晚 19:30 自動產生報告（執行一次即可安裝） ══════════
function crearTriggerDiario() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'generarReporteDiario')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('generarReporteDiario')
    .timeBased().everyDays(1).atHour(19).nearMinute(30).create();
  Logger.log('✅ 已安裝每日 19:30 觸發器');
}

// ══════════ Sheet 選單 ══════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📋 PTITP Expo')
    .addItem('Generar reporte de hoy', 'generarReporteDiario')
    .addItem('Instalar reporte automático (19:30)', 'crearTriggerDiario')
    .addToUi();
}

// ══════════ 工具 ══════════
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
