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
  // 每日報告收件人，留空字串則不寄信（可填多個，逗號分隔）
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

// ══════════ 網頁查看報告：<WebAppURL>?action=reporte&fecha=2026-07-06 ══════════
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (action === 'reporte') {
    const fecha = (e.parameter.fecha) ||
      Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
    const rpt = _construirReporte(fecha);
    return HtmlService.createHtmlOutput(
      '<pre style="font-family:monospace;white-space:pre-wrap;max-width:800px;margin:2rem auto;line-height:1.5">'
      + rpt.texto.replace(/</g, '&lt;') + '</pre>'
    ).setTitle('Reporte PTITP ' + fecha);
  }
  return _json({ ok: true, servicio: 'PTITP Expo API', hora: new Date().toISOString() });
}

// ══════════ 每日報告（可手動執行，或由觸發器每晚自動執行） ══════════
function generarReporteDiario() {
  const fecha = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const rpt = _construirReporte(fecha);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rep = ss.getSheetByName(CONFIG.SHEET_REPORTES) || ss.insertSheet(CONFIG.SHEET_REPORTES);
  rep.appendRow([fecha, rpt.evento, rpt.total, rpt.nA, rpt.nB, rpt.nC, rpt.texto]);

  if (CONFIG.REPORT_EMAIL) {
    MailApp.sendEmail({
      to: CONFIG.REPORT_EMAIL,
      subject: `[PTITP] Reporte diario de promoción — ${fecha} (${rpt.total} visitantes, ${rpt.nA} leads A)`,
      body: rpt.texto,
    });
  }
  Logger.log(rpt.texto);
  return rpt.texto;
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
