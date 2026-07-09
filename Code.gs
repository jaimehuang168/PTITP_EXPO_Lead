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
  // 名片掃描設定
  OCR_MODEL: 'claude-haiku-4-5',
  OCR_LIMITE_DIARIO: 300,          // 每日辨識上限（防止公開端點被刷 API 額度）
  CARPETA_TARJETAS: 'PTITP_Tarjetas', // 名片影像存放的 Drive 資料夾
};

const HEADERS = [
  'Timestamp', 'Fecha', 'Evento', 'Promotor',
  'Nombre', 'Empresa', 'Cargo', 'País', 'Teléfono/WhatsApp', 'Email',
  'Tipo de organización', 'Sector/Rubro', 'Intereses', 'Plazo',
  'Superficie (m²)', 'Empleos est.', 'Cómo nos conoció',
  'Calificación', 'Observaciones', 'Próximos pasos',
  'Fecha límite seguimiento', 'Responsable seguimiento', 'Estado',
  'Tarjeta (imagen)', 'LeadID',
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
  } else {
    // 遷移：舊表補上新增欄標頭
    let hdr = sh.getDataRange().getValues()[0];
    ['Tarjeta (imagen)', 'LeadID'].forEach(col => {
      if (hdr.indexOf(col) === -1) {
        sh.getRange(1, hdr.length + 1).setValue(col);
        hdr = hdr.concat([col]);
      }
    });
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
    cfg.appendRow(['Emails para reporte automático', '', '← uno o varios emails separados por coma; se aplica de inmediato']);
    cfg.getRange(1, 1).setFontWeight('bold');
  }
  // 遷移：補排程參數列（起訖日期 + 寄送時鐘），已存在則略過
  const cfgVals = cfg.getDataRange().getValues();
  const tiene = p => cfgVals.some(r => String(r[0]).toLowerCase().indexOf(p) === 0);
  if (!tiene('fecha inicio')) cfg.appendRow(['Fecha inicio reportes', '', 'yyyy-mm-dd · vacío = enviar todos los días']);
  if (!tiene('fecha fin'))    cfg.appendRow(['Fecha fin reportes', '', 'yyyy-mm-dd · vacío = sin límite']);
  if (!tiene('hora'))         cfg.appendRow(['Hora de envío (0-23)', 19, 'hora local Paraguay; se aplica de inmediato']);
  Logger.log('✅ 初始化完成');
}

// ══════════ 接收前端請求（問卷 / 名片辨識） ══════════
function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }

  // 名片辨識分支（不佔用問卷寫入的鎖）
  if (d.accion === 'ocrTarjeta') return _ocrTarjeta(d);

  const lock = LockService.getScriptLock();
  lock.tryLock(10000); // 防止多人同時送出造成競態
  try {
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
      d.tarjetaUrl || '', // 名片影像的 Drive 連結
      _nuevoLeadID(), // 與 CRM 追蹤系統的關聯鍵
    ]);

    return _json({ ok: true, msg: 'Lead registrado' });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// ══════════ 名片辨識：存 Drive + Claude 視覺辨識 → 結構化欄位 ══════════
function _ocrTarjeta(d) {
  try {
    if (!d.imagen) return _json({ ok: false, error: 'Falta la imagen' });

    const props = PropertiesService.getScriptProperties();

    // 每日用量閘門
    const hoy = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
    const kCnt = 'ocr_' + hoy;
    const usados = Number(props.getProperty(kCnt) || 0);
    if (usados >= CONFIG.OCR_LIMITE_DIARIO)
      return _json({ ok: false, error: 'Límite diario de escaneos alcanzado' });

    const apiKey = props.getProperty('ANTHROPIC_API_KEY');
    if (!apiKey)
      return _json({ ok: false, error: 'API key no configurada (Script Properties → ANTHROPIC_API_KEY)' });

    // 1. 影像留存到 Drive
    const mime = d.mime || 'image/jpeg';
    const nombreArchivo = 'Tarjeta_' +
      Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyyMMdd_HHmmss') +
      (d.promotor ? '_' + String(d.promotor).replace(/[^\w\u00C0-\u017F]/g, '') : '') + '.jpg';
    const blob = Utilities.newBlob(Utilities.base64Decode(d.imagen), mime, nombreArchivo);
    const urlImagen = _carpetaTarjetas().createFile(blob).getUrl();

    // 2. Claude 視覺辨識 → 嚴格 JSON
    const prompt =
      'Extraé los datos de esta tarjeta de presentación (puede estar en español, inglés o chino, y tener texto en varias direcciones). ' +
      'Respondé SOLO con un objeto JSON válido, sin markdown ni explicaciones, con exactamente estas claves ' +
      '(usá null si el dato no figura): ' +
      '{"nombre": "nombre completo de la persona", "empresa": "nombre de la empresa u organización", ' +
      '"cargo": "puesto o título", "telefono": "teléfono con código de país si figura, preferí el móvil/WhatsApp", ' +
      '"email": "correo electrónico", "pais": "país inferido por la dirección o el código telefónico"}';

    const resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: CONFIG.OCR_MODEL,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: d.imagen } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
      muteHttpExceptions: true,
    });

    if (resp.getResponseCode() !== 200)
      return _json({ ok: false, error: 'Servicio de análisis no disponible (' + resp.getResponseCode() + ')', imagen: urlImagen });

    const data = JSON.parse(resp.getContentText());
    let txt = ((data.content || []).filter(c => c.type === 'text').map(c => c.text).join('')) || '';
    txt = txt.replace(/```json|```/g, '').trim();
    const datos = JSON.parse(txt);

    props.setProperty(kCnt, String(usados + 1));
    return _json({ ok: true, datos: datos, imagen: urlImagen });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function _carpetaTarjetas() {
  const it = DriveApp.getFoldersByName(CONFIG.CARPETA_TARJETAS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CARPETA_TARJETAS);
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

  // PDF 下載：?action=reportePdf&tipo=dia|rango|expo[&desde&hasta]
  if (action === 'reportePdf') {
    try {
      const sel = _reporteSegunTipo(e.parameter);
      if (sel.error) return _json({ ok: false, error: sel.error });
      const pdf = _pdfDeReporte(sel.rpt, sel.titulo, sel.archivo);
      const b64 = Utilities.base64Encode(pdf.getBytes());
      const pagina =
        '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:3rem auto;text-align:center">' +
        '<p style="color:#152730">Su PDF est&aacute; listo:</p>' +
        '<a id="d" download="' + sel.archivo + '.pdf" href="data:application/pdf;base64,' + b64 + '"' +
        ' style="display:inline-block;padding:.9rem 1.4rem;background:#009C81;color:#fff;' +
        'border-radius:10px;text-decoration:none;font-weight:bold">&#128229; Descargar ' + sel.archivo + '.pdf</a>' +
        '<p style="color:#5E7079;font-size:.8rem;margin-top:1rem">Si la descarga no inicia autom&aacute;ticamente, toque el bot&oacute;n.</p></div>' +
        '<script>try{document.getElementById("d").click();}catch(e){}</script>';
      return HtmlService.createHtmlOutput(pagina).setTitle('PTITP — PDF');
    } catch (err) {
      return _json({ ok: false, error: String(err) });
    }
  }

  // 業務人員自訂寄送：?action=enviarReporteA&tipo=dia|rango|expo&emails=a@x,b@y[&desde&hasta]
  if (action === 'enviarReporteA') {
    try {
      const emails = _validarEmails(e.parameter.emails || '');
      if (!emails) return _json({ ok: false, error: 'Emails inválidos o vacíos' });
      const sel = _reporteSegunTipo(e.parameter);
      if (sel.error) return _json({ ok: false, error: sel.error });

      MailApp.sendEmail({
        to: emails,
        subject: `[PTITP] Reporte ${sel.titulo} — ${sel.rpt.total} visitantes, ${sel.rpt.nA} leads A`,
        body: sel.rpt.texto, // 純文字 fallback
        htmlBody: _htmlDeReporte(sel.rpt, sel.titulo),
        attachments: [_pdfDeReporte(sel.rpt, sel.titulo, sel.archivo)],
      });
      return _json({ ok: true, enviado: 'a ' + emails, total: sel.rpt.total });
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
      body: rpt.texto, // 純文字 fallback
      htmlBody: _htmlDeReporte(rpt, 'diario ' + fecha),
      attachments: [_pdfDeReporte(rpt, 'diario ' + fecha, 'PTITP_Reporte_diario_' + fecha)],
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

// 讀 Config 分頁參數：以標籤前綴比對（不分大小寫），日期儲存格自動正規化為 yyyy-MM-dd
function _cfgExpo(prefijo) {
  try {
    const cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_CONFIG);
    if (!cfg) return '';
    const vals = cfg.getDataRange().getValues();
    const row = vals.find(r => String(r[0]).toLowerCase().indexOf(prefijo) === 0);
    if (!row) return '';
    const v = row[1];
    if (v instanceof Date) return Utilities.formatDate(v, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
    return String(v == null ? '' : v).trim();
  } catch (err) { return ''; }
}

// ══════════ 排程守門：每小時被觸發器喚醒，只在展期內的指定時鐘寄送 ══════════
// Config 三參數（改完即生效，不用重裝觸發器）：
//   Fecha inicio/fin reportes：兩者可留空 = 不設限（每天寄）
//   Hora de envío (0-23)：預設 19（觸發器整點喚醒，實際寄出在該時鐘的 0-59 分內）
function reporteProgramado() {
  const ahora = new Date();
  const hoy = Utilities.formatDate(ahora, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  const horaActual = Number(Utilities.formatDate(ahora, CONFIG.ZONA_HORARIA, 'H'));

  const ini = _cfgExpo('fecha inicio');
  const fin = _cfgExpo('fecha fin');
  const horaCfg = _cfgExpo('hora') === '' ? 19 : Number(_cfgExpo('hora'));

  if (_fechaValida(ini) && hoy < ini) { Logger.log('展期未開始，不寄'); return 'antes del rango'; }
  if (_fechaValida(fin) && hoy > fin) { Logger.log('展期已結束，不寄'); return 'después del rango'; }
  if (horaActual !== horaCfg) return 'hora distinta';

  // 同日去重（觸發器每小時執行，一天只寄一次）
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ultimo_reporte_auto') === hoy) return 'ya enviado hoy';

  generarReporteDiario();
  props.setProperty('ultimo_reporte_auto', hoy);
  return 'enviado';
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

// 產生 Lead 短 ID（CRM 追蹤系統的關聯鍵），如 L-MCK3A9F7-X2
function _nuevoLeadID() {
  return 'L-' + Date.now().toString(36).toUpperCase() + '-' +
    Math.random().toString(36).slice(2, 4).toUpperCase();
}

// ══════════ PDF 工具 ══════════
// 依 tipo 參數取得對應報告（dia / rango / expo），寄送與 PDF 下載共用
function _reporteSegunTipo(p) {
  const tipo = (p && p.tipo) || 'dia';
  if (tipo === 'expo') {
    return { rpt: _construirReporteExpo(), titulo: 'acumulado del evento', archivo: 'PTITP_Reporte_evento' };
  }
  if (tipo === 'rango') {
    if (!_fechaValida(p.desde) || !_fechaValida(p.hasta) || p.desde > p.hasta)
      return { error: 'Rango de fechas inválido' };
    return { rpt: _construirReporteRango(p.desde, p.hasta), titulo: `del ${p.desde} al ${p.hasta}`,
             archivo: `PTITP_Reporte_${p.desde}_a_${p.hasta}` };
  }
  const f = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  return { rpt: _construirReporte(f), titulo: 'diario ' + f, archivo: 'PTITP_Reporte_diario_' + f };
}

// 品牌化 PDF：頁首色帶、統計卡、雙欄統計表、A/B 客戶卡片。
// 注意：GAS 的 HTML→PDF 轉換不支援 flexbox/grid，排版一律用 table。
function _pdfDeReporte(rpt, titulo, archivo) {
  const html = _htmlDeReporte(rpt, titulo);
  return Utilities.newBlob(html, 'text/html', archivo + '.html')
    .getAs('application/pdf').setName(archivo + '.pdf');
}

// 品牌化報告 HTML：同時用於 PDF 轉換與 email 的 htmlBody
function _htmlDeReporte(rpt, titulo) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const d = rpt.datos;

  // 相容保護：若無結構化資料，退回純文字版
  if (!d) {
    return '<html><head><meta charset="utf-8"></head><body><pre>' +
      esc(rpt.texto || rpt) + '</pre></body></html>';
  }

  const C = { verde: '#009C81', azul: '#14588F', tinta: '#152730', gris: '#5E7079',
              linea: '#DCE7E3', claro: '#F2F7F5', A: '#D3452B', B: '#D99A2B', Cc: '#5E7079' };

  const statBox = (num, label, color) =>
    `<td width="25%" style="border:1px solid ${C.linea};padding:10px 6px;text-align:center">` +
    `<div style="font-size:22px;font-weight:bold;color:${color}">${num}</div>` +
    `<div style="font-size:8.5px;color:${C.gris};text-transform:uppercase;letter-spacing:1px">${label}</div></td>`;

  const seccion = t =>
    `<div style="margin:16px 0 6px;border-left:5px solid ${C.verde};padding:2px 0 2px 8px;` +
    `font-size:11px;font-weight:bold;color:${C.azul};text-transform:uppercase;letter-spacing:1.5px">${t}</div>`;

  const tablaConteo = obj => {
    const filas = Object.entries(obj || {}).sort((a, b) => b[1] - a[1])
      .map(([k, v]) =>
        `<tr><td style="padding:3px 6px;border-bottom:1px solid ${C.linea}">${esc(k)}</td>` +
        `<td align="right" style="padding:3px 6px;border-bottom:1px solid ${C.linea};font-weight:bold;color:${C.azul}">${v}</td></tr>`)
      .join('');
    return `<table width="100%" style="border-collapse:collapse;font-size:9.5px">${filas ||
      `<tr><td style="padding:3px 6px;color:${C.gris}">(sin datos)</td></tr>`}</table>`;
  };

  const tarjetaLead = (l, color) => {
    const linea2 = [l.intereses, l.plazo, l.sup ? l.sup + ' m²' : ''].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ');
    const contacto = [l.tel ? 'Tel: ' + esc(l.tel) : '', l.email ? 'Email: ' + esc(l.email) : ''].filter(Boolean).join(' &nbsp;&middot;&nbsp; ');
    return `<div style="border:1px solid ${C.linea};border-left:5px solid ${color};padding:7px 10px;margin-top:7px">` +
      `<div style="font-size:10.5px"><b>${esc(l.nombre)}</b> &mdash; ${esc(l.empresa) || 's/empresa'}` +
      ` <span style="color:${C.gris}">(${[esc(l.cargo), esc(l.pais)].filter(Boolean).join(', ') || 'N/D'})</span></div>` +
      (linea2 ? `<div style="font-size:9px;color:${C.gris};margin-top:2px">${linea2}</div>` : '') +
      (contacto ? `<div style="font-size:9px;margin-top:2px">${contacto}</div>` : '') +
      (l.obs ? `<div style="font-size:9px;font-style:italic;color:${C.tinta};margin-top:3px;` +
               `background:${C.claro};padding:4px 6px">Obs.: ${esc(l.obs)}</div>` : '') +
      `<div style="font-size:9px;margin-top:3px">&rarr; <b>${esc(l.pasos) || 'definir próximos pasos'}</b>` +
      (l.fseg ? ` <span style="color:${C.A}">(antes del ${esc(l.fseg)})</span>` : '') +
      ` &mdash; Resp.: ${esc(l.resp) || 'N/D'}` +
      (d.byDia ? ` &nbsp;<span style="color:${C.gris}">[${esc(l.estado)}]</span>` : '') + `</div></div>`;
  };

  const bloqueLeads = (arr, color, vacio) =>
    (arr && arr.length) ? arr.map(l => tarjetaLead(l, color)).join('') :
    `<div style="font-size:9.5px;color:${C.gris};margin-top:4px">(${vacio})</div>`;

  const generado = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd HH:mm');
  const pendTxt = (d.pendA != null && rpt.nA > 0)
    ? ` &nbsp;<span style="font-size:8.5px;color:${C.A}">(${d.pendA} pendientes de seguimiento)</span>` : '';

  const html =
`<html><head><meta charset="utf-8"><style>
body{font-family:Helvetica,Arial,sans-serif;color:${C.tinta};margin:24px;font-size:10px}
table{border-collapse:collapse}
</style></head><body>

<table width="100%"><tr>
<td style="background:${C.verde};padding:13px 16px">
  <div style="font-size:15px;font-weight:bold;color:#ffffff">PTITP &mdash; Parque Tecnol&oacute;gico Inteligente Taiw&aacute;n-Paraguay</div>
  <div style="font-size:9.5px;color:#DFF3EE;margin-top:3px">Reporte ${esc(titulo)} &nbsp;&middot;&nbsp; Evento: ${esc(rpt.evento)} &nbsp;&middot;&nbsp; Generado: ${generado}</div>
</td>
<td width="6" style="background:${C.azul}"></td>
</tr></table>

${seccion('Resumen')}
<table width="100%"><tr>
${statBox(rpt.total, 'Visitantes', C.azul)}
${statBox(rpt.nA, 'Leads A &middot; calientes', C.A)}
${statBox(rpt.nB, 'Leads B &middot; tibios', C.B)}
${statBox(rpt.nC, 'Leads C &middot; fr&iacute;os', C.Cc)}
</tr></table>${pendTxt}

${d.byDia ? seccion('Visitantes por d&iacute;a') + tablaConteo(d.byDia) : ''}

<table width="100%"><tr>
<td width="48%" valign="top">${seccion('Por pa&iacute;s')}${tablaConteo(d.byPais)}</td>
<td width="4%"></td>
<td width="48%" valign="top">${seccion('Intereses consultados')}${tablaConteo(d.byInteres)}</td>
</tr></table>

${seccion('Registros por promotor')}
${tablaConteo(d.byPromotor)}

${seccion('Leads prioritarios (A) &mdash; acci&oacute;n en 24-48 hs')}
${bloqueLeads(d.leadsA, C.A, 'ninguno')}

${seccion('Leads de seguimiento (B) &mdash; acci&oacute;n en 1 semana')}
${bloqueLeads(d.leadsB, C.B, 'ninguno')}

<div style="margin-top:20px;border-top:1px solid ${C.linea};padding-top:6px;font-size:8px;color:${C.gris}">
Generado autom&aacute;ticamente &mdash; Sistema de Captaci&oacute;n PTITP &nbsp;&middot;&nbsp; Hernandarias, Alto Paran&aacute;, Paraguay</div>

</body></html>`;

  return html;
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

  const aObj = r => ({
    nombre: r[H['Nombre']], empresa: r[H['Empresa']], cargo: r[H['Cargo']], pais: r[H['País']],
    tel: r[H['Teléfono/WhatsApp']], email: r[H['Email']], intereses: r[H['Intereses']],
    plazo: r[H['Plazo']], sup: r[H['Superficie (m²)']], obs: r[H['Observaciones']],
    pasos: r[H['Próximos pasos']], fseg: String(r[H['Fecha límite seguimiento']] || '').slice(0, 10),
    resp: r[H['Responsable seguimiento']], estado: r[H['Estado']] || 'Pendiente',
  });

  return { texto, total: rows.length, nA: byCal.A.length, nB: byCal.B.length, nC: byCal.C.length, evento,
           fecha, datos: { byPais, byInteres, byPromotor,
                           leadsA: byCal.A.map(aObj), leadsB: byCal.B.map(aObj) } };
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

  const aObj = r => ({
    nombre: r[H['Nombre']], empresa: r[H['Empresa']], cargo: r[H['Cargo']], pais: r[H['País']],
    tel: r[H['Teléfono/WhatsApp']], email: r[H['Email']], intereses: r[H['Intereses']],
    plazo: r[H['Plazo']], sup: r[H['Superficie (m²)']], obs: r[H['Observaciones']],
    pasos: r[H['Próximos pasos']], fseg: String(r[H['Fecha límite seguimiento']] || '').slice(0, 10),
    resp: r[H['Responsable seguimiento']], estado: r[H['Estado']] || 'Pendiente',
  });

  return { texto, total: rows.length, nA: byCal.A.length, nB: byCal.B.length, nC: byCal.C.length, evento,
           datos: { byPais, byInteres, byPromotor, byDia, pendA,
                    leadsA: byCal.A.map(aObj), leadsB: byCal.B.map(aObj) } };
}

// ══════════ 每晚 19:30 自動產生報告（執行一次即可安裝） ══════════
function crearTriggerDiario() {
  ScriptApp.getProjectTriggers()
    .filter(t => ['generarReporteDiario', 'reporteProgramado'].indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('reporteProgramado')
    .timeBased().everyHours(1).create(); // 每小時醒來，由 Config 決定寄不寄
  Logger.log('✅ 已安裝每日 19:30 觸發器');
}

// ══════════ Sheet 選單 ══════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('📋 PTITP Expo')
    .addItem('Generar reporte de hoy', 'generarReporteDiario')
    .addItem('Instalar reporte automático (según Config)', 'crearTriggerDiario')
    .addToUi();
}

// ══════════ 工具 ══════════
function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
