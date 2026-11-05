/**
 * PTITP 展會招商問卷系統 — Google Apps Script 後端
 * ------------------------------------------------
 * 功能：
 *   1. doPost()  接收 GitHub Pages 前端送來的問卷 JSON，寫入 "Leads" 工作表
 *   2. generarReporteDiario()  將當日問卷自動彙整成西文「業務推廣暨當日工作報告」
 *      → 寫入 "Reportes" 工作表 + （可選）寄送 Email
 *   3. doPost(accion=abrirReporte)  驗證主管密鑰後顯示報告；密鑰不放網址
 *
 * 部署方式見 README.md
 */

// ══════════ 設定區 ══════════
const CONFIG = {
  SHEET_LEADS: 'Leads',
  SHEET_REPORTES: 'Reportes',
  SHEET_CONFIG: 'Config',
  SHEET_EVENTOS: 'Eventos',
  // 備用收件人：正常情況請改用 Sheet 的「Config」分頁 B1 儲存格填寫（可多個，逗號分隔），
  // 那裡改完立即生效，不需要重新部署
  REPORT_EMAIL: '',
  // 預設展會名稱（前端也可覆寫）
  EVENTO_DEFAULT: 'EXPO PBW',
  EVENTO_DESDE: '2026-11-10',
  EVENTO_HASTA: '2026-11-14',
  VERSION: '1.15.0',
  ADMIN_EMAIL: 'jaimehuang168@gmail.com',
  ZONA_HORARIA: 'America/Asuncion',
  // 名片掃描設定
  OCR_MODEL: 'claude-haiku-4-5',
  OCR_DESDE: '2026-11-06',
  OCR_HASTA: '2026-11-14',
  OCR_LIMITE_DIARIO: 300,          // 每日辨識上限（防止公開端點被刷 API 額度）
  OCR_MAX_BASE64: 2500000,         // 約 1.9 MB；前端壓縮後應遠低於此值
  CARPETA_TARJETAS: 'PTITP_Tarjetas', // 名片影像存放的 Drive 資料夾
};

const HEADERS = [
  'Timestamp', 'Fecha', 'Evento', 'Promotor',
  'Nombre', 'Empresa', 'Cargo', 'País', 'Teléfono/WhatsApp', 'Email',
  'Tipo de organización', 'Sector/Rubro', 'Intereses', 'Plazo',
  'Superficie (m²)', 'Empleos est.', 'Cómo nos conoció',
  'Calificación', 'Observaciones', 'Próximos pasos',
  'Fecha límite seguimiento', 'Responsable seguimiento', 'Estado',
  'Tarjeta (imagen)', 'LeadID', 'RequestID',
  'Registrado por (email)', 'Google UID', 'Nombre de cuenta',
  'Evento ID',
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
    ['Tarjeta (imagen)', 'LeadID', 'RequestID', 'Registrado por (email)', 'Google UID', 'Nombre de cuenta', 'Evento ID'].forEach(col => {
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
  _asegurarEventos(ss);
  Logger.log('✅ 初始化完成');
}

// ══════════ 接收前端請求（問卷 / 名片辨識） ══════════
function doPost(e) {
  let d;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string')
      return _json({ ok: false, error: 'Solicitud inválida' });
    if (e.postData.contents.length > CONFIG.OCR_MAX_BASE64 + 10000)
      return _json({ ok: false, error: 'Solicitud demasiado grande' });
    const body = e.parameter && e.parameter.reportRequest || e.postData.contents;
    if (body.length > CONFIG.OCR_MAX_BASE64 + 10000)
      return _json({ ok: false, error: 'Solicitud demasiado grande' });
    d = JSON.parse(body);
    if (!d || typeof d !== 'object' || Array.isArray(d))
      return _json({ ok: false, error: 'Solicitud inválida' });
  } catch (err) {
    return _json({ ok: false, error: 'JSON inválido' });
  }

  if (d.accion !== 'ocrTarjeta' && JSON.stringify(d).length > 120000)
    return _json({ ok: false, error: 'Solicitud demasiado grande' });
  if (d.accion === 'abrirReporte') {
    return _respuestaReporte({parameter:d});
  }

  // 名片辨識分支（不佔用問卷寫入的鎖）
  if (d.accion === 'ocrTarjeta') return _ocrTarjeta(d);
  if (d.accion === 'guardarEvento') return _guardarEvento(d);
  if (d.accion === 'enviarReporteA') {
    const auth = _autorizarAdministrador(d.idToken);
    if (!auth.ok) return _json(auth);
    return _enviarReporteAdmin(d);
  }

  const auth = _autorizarOperador(d.idToken);
  if (!auth.ok) return _json(auth);
  if (d.accion === 'sesion') return _json({ok:true,usuario:auth.usuario,..._configuracionEventos(d.eventoId)});
  if (d.operadorUid && d.operadorUid !== auth.usuario.uid)
    return _json({ok:false,authRequired:true,retryable:false,error:'Iniciá sesión con la cuenta que creó este registro pendiente'});
  const seleccion=_eventoRegistro(d);
  if(seleccion.error)return _json({ok:false,retryable:false,error:seleccion.error});
  const desdeAdministracion=d.modoRegistro==='administracion'&&auth.usuario.admin===true;
  const fechaVisita=desdeAdministracion&&typeof d.fechaVisita==='string'?d.fechaVisita:'';
  if(d.fechaVisita&&(!desdeAdministracion||!_fechaValida(fechaVisita)))
    return _json({ok:false,retryable:false,error:'La fecha de visita solo se puede indicar con una fecha válida desde administración'});
  const validado = _validarLead(d);
  if (validado.error) return _json({ ok: false, error: validado.error });
  d = validado.datos;
  if(seleccion.evento){d.evento=_textoSeguro(seleccion.evento.nombre);d.eventoId=seleccion.evento.id;}
  d.promotor = _textoSeguro((auth.usuario.nombre || auth.usuario.email).slice(0,100));

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000))
    return _json({ ok: false, retryable: true, error: 'Sistema ocupado; reintente' });
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(CONFIG.SHEET_LEADS) || ss.insertSheet(CONFIG.SHEET_LEADS);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);

    const now = new Date();
    const hoy = Utilities.formatDate(now, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');

    const rid = d.requestId || '';
    if (rid && _requestIdExiste(sh, rid))
      return _json({ ok: true, duplicate: true, msg: 'Lead ya registrado' });
    if(fechaVisita&&fechaVisita>hoy)return _json({ok:false,retryable:false,error:'La fecha de visita no puede ser futura'});
    const vigente=seleccion.evento?_leerEventos().find(e=>e.id===seleccion.evento.id):null;
    if(seleccion.evento&&(!vigente||!vigente.visible))
      return _json({ok:false,retryable:false,error:'Actividad archivada. Conservá el pendiente y pedí a administración que revise su carga.'});
    if((!vigente||_eventoPasado(vigente,hoy))&&!desdeAdministracion)
      return _json({ok:false,retryable:false,error:'Actividad finalizada o histórica. Conservá los datos; solo administración puede cargarlos desde Reportes → Cargar desde administración.'});
    if(vigente){d.evento=_textoSeguro(vigente.nombre);d.eventoId=vigente.id;}

    const cabecera = _columnasAuditoria(sh);
    const fila = [
      Utilities.formatDate(now, CONFIG.ZONA_HORARIA, 'yyyy-MM-dd HH:mm:ss'),
      fechaVisita||hoy,
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
      rid,
    ];
    while(fila.length < cabecera.length) fila.push('');
    [['Registrado por (email)',auth.usuario.email],['Google UID',auth.usuario.uid],['Nombre de cuenta',auth.usuario.nombre],['Evento ID',d.eventoId||'']]
      .forEach(([col,value])=>{fila[cabecera.indexOf(col)]=_textoSeguro(value);});
    sh.appendRow(fila);

    SpreadsheetApp.flush();
    return _json({ ok: true, msg: 'Lead registrado', requestId: rid });
  } catch (err) {
    Logger.log('doPost error: ' + String(err));
    return _json({ ok: false, retryable: true, error: 'No se pudo registrar el lead' });
  } finally {
    lock.releaseLock();
  }
}

// ══════════ 名片辨識：存 Drive + Claude 視覺辨識 → 結構化欄位 ══════════
function _ocrTarjeta(d) {
  try {
    const auth = _autorizarOperador(d.idToken);
    if (!auth.ok) return _json(auth);
    const permiso = _estadoEscaneo(d.eventoId);
    if (!permiso.activo) return _json({ok:false,retryable:false,error:'Escaneo no habilitado para esta actividad o fuera de su período (hora de Paraguay)'});
    d.promotor = auth.usuario.nombre || auth.usuario.email;
    if (!d.imagen) return _json({ ok: false, error: 'Falta la imagen' });
    if (typeof d.imagen !== 'string' || d.imagen.length > CONFIG.OCR_MAX_BASE64 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(d.imagen))
      return _json({ ok: false, error: 'Imagen inválida o demasiado grande' });
    const mime = String(d.mime || 'image/jpeg').toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) === -1)
      return _json({ ok: false, error: 'Formato de imagen no permitido' });
    const firmas = {'image/jpeg': /^\/9j\//, 'image/png': /^iVBORw0KGgo/, 'image/webp': /^UklGR/};
    if (d.imagen.length % 4 !== 0 || !firmas[mime].test(d.imagen))
      return _json({ok:false,error:'El contenido no corresponde al formato de imagen'});

    const props = PropertiesService.getScriptProperties();

    const apiKey = props.getProperty('ANTHROPIC_API_KEY');
    if (!apiKey)
      return _json({ ok: false, error: 'API key no configurada (Script Properties → ANTHROPIC_API_KEY)' });

    // 每日用量閘門：先在鎖內保留額度，避免並行請求突破上限
    const hoy = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
    const kCnt = 'ocr_' + hoy;
    const quotaLock = LockService.getScriptLock();
    if (!quotaLock.tryLock(10000))
      return _json({ ok: false, retryable: true, error: 'Sistema ocupado; reintente' });
    try {
      const usados = Number(props.getProperty(kCnt) || 0);
      if (usados >= CONFIG.OCR_LIMITE_DIARIO)
        return _json({ ok: false, error: 'Límite diario de escaneos alcanzado' });
      props.setProperty(kCnt, String(usados + 1));
    } finally {
      quotaLock.releaseLock();
    }

    // 1. 影像留存到 Drive
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

    return _json({ ok: true, datos: datos, imagen: urlImagen });
  } catch (err) {
    Logger.log('OCR error: ' + String(err));
    return _json({ ok: false, error: 'No se pudo analizar la tarjeta' });
  }
}

function _carpetaTarjetas() {
  const it = DriveApp.getFoldersByName(CONFIG.CARPETA_TARJETAS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.CARPETA_TARJETAS);
}

// ══════════ 網頁查看報告 ══════════
// Report HTML/PDF/fichas are opened with authenticated POST requests only.
// Google credentials never appear in report URLs.
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;
  if (['reporte','reporteExpo','reporteRango','fichas','fichasPdf','reportePdf'].indexOf(action) !== -1)
    return _json({ok:false,error:'Abra el reporte desde el formulario (POST)'});
  if (action === 'config') return _json({ok:true,zona:CONFIG.ZONA_HORARIA,version:CONFIG.VERSION,
    auth:_configuracionGoogle(),..._configuracionEventos(e.parameter.eventoId)});
  return _respuestaReporte(e);
}

function _respuestaReporte(e) {
  const action = e && e.parameter && e.parameter.action;
  const privadas = ['reporte', 'reporteExpo', 'reporteRango', 'fichas', 'fichasPdf',
                    'reportePdf'];
  if (privadas.indexOf(action) !== -1) {
    const auth = _autorizarReporte(e);
    if (!auth.ok) return _json(auth);
    const normal=_parametrosEvento(e.parameter);
    if(normal.error)return _json({ok:false,retryable:false,error:normal.error});
    e={parameter:normal.params};
  }

  if (action === 'reporte') {
    const fecha = (e.parameter.fecha) ||
      Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
    if (!_fechaValida(fecha)) return _json({ok:false,error:'Fecha inválida'});
    return _htmlReporte(_construirReporte(fecha,e.parameter.evento).texto, 'Reporte diario ' + fecha);
  }

  if (action === 'reporteExpo') {
    return _htmlReporte(_construirReporteExpo(e.parameter.evento).texto, 'Reporte acumulado del evento');
  }

  // 日期範圍報告檢視：?action=reporteRango&desde=2026-07-06&hasta=2026-07-09
  if (action === 'reporteRango') {
    const desde = e.parameter.desde, hasta = e.parameter.hasta;
    if (!_fechaValida(desde) || !_fechaValida(hasta) || desde > hasta)
      return _json({ ok: false, error: 'Rango de fechas inválido' });
    return _htmlReporte(_construirReporteRango(desde, hasta,e.parameter.evento).texto, `Reporte ${desde} → ${hasta}`);
  }

  // 可列印 Lead 資料卡：?action=fichas&tipo=dia|rango|expo[&fecha|&desde&hasta][&calif=A,B]
  if (action === 'fichas' || action === 'fichasPdf') {
    try {
      const sel = _fichasSegunTipo(e.parameter,true);
      if (sel.error) return _json({ ok: false, error: sel.error });
      const html = _htmlFichas(sel.leads, sel.titulo, sel.evento, e.parameter, action === 'fichas');
      if (action === 'fichas')
        return HtmlService.createHtmlOutput(html).setTitle('Fichas de Leads — PTITP');
      const pdf = Utilities.newBlob(html, 'text/html', sel.archivo + '.html')
        .getAs('application/pdf').setName(sel.archivo + '.pdf');
      const b64 = Utilities.base64Encode(pdf.getBytes());
      const pagina =
        '<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:3rem auto;text-align:center">' +
        '<p style="color:#152730">Su PDF est&aacute; listo:</p>' +
        '<a id="d" download="' + sel.archivo + '.pdf" href="data:application/pdf;base64,' + b64 + '"' +
        ' style="display:inline-block;padding:.9rem 1.4rem;background:#009C81;color:#fff;' +
        'border-radius:10px;text-decoration:none;font-weight:bold">&#128229; Descargar ' + sel.archivo + '.pdf</a></div>' +
        '<script>try{document.getElementById("d").click();}catch(e){}</script>';
      return HtmlService.createHtmlOutput(pagina).setTitle('PTITP — PDF');
    } catch (err) {
      return _json({ ok: false, error: String(err) });
    }
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

  // 寄信是副作用，只接受 doPost；防止爬蟲、連結預覽或誤點觸發。
  if (action === 'enviarReporteA' || action === 'enviarReporte')
    return _json({ ok: false, error: 'Método no permitido' });

  return _json({ ok: true, servicio: 'PTITP Expo API', version:CONFIG.VERSION, hora: new Date().toISOString() });
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
  const evento=_eventoMasReciente(_leerEventos());
  if(!evento)throw new Error('Revise la actividad predeterminada antes de generar el reporte');
  const rpt = _construirReporte(fecha,_filtroEvento(evento));

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
  Logger.log('Reporte generado: ' + fecha + ', visitantes: ' + rpt.total);
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

// Only verified Google identity is authoritative. Legacy shared keys grant no access.
function _configuracionGoogle(){
  const props=PropertiesService.getScriptProperties();
  const projectId=String(props.getProperty('FIREBASE_PROJECT_ID')||'').trim();
  const apiKey=String(props.getProperty('FIREBASE_WEB_API_KEY')||'').trim();
  return {required:true,configured:!!projectId&&!!apiKey,firebase:{projectId,apiKey,authDomain:projectId?projectId+'.firebaseapp.com':''}};
}

const EVENT_HEADERS=['ID','Nombre','Inicio','Fin','Escaneo habilitado','Escaneo inicio','Escaneo fin','Disponible','Nombre histórico','Versión'];
function _eventosIniciales(){
  return [
    {id:'pbw-2026',nombre:CONFIG.EVENTO_DEFAULT,desde:CONFIG.EVENTO_DESDE,hasta:CONFIG.EVENTO_HASTA,ocrHabilitado:true,ocrDesde:CONFIG.OCR_DESDE,ocrHasta:CONFIG.OCR_HASTA,visible:true,legacyNombre:'EXPO PBW',revision:1},
    {id:'expo-paraguay-2026',nombre:'Expo Paraguay 2026',desde:'',hasta:'',ocrHabilitado:false,ocrDesde:'',ocrHasta:'',visible:true,legacyNombre:'Expo Paraguay 2026',revision:1}
  ];
}
function _booleanoEvento(value){return value===true||value===1||String(value).toLowerCase()==='true';}
function _filaEvento(e){return[e.id,_textoSeguro(e.nombre),e.desde,e.hasta,e.ocrHabilitado,e.ocrDesde,e.ocrHasta,e.visible,e.legacyNombre,e.revision];}
function _asegurarEventos(ss){
  let sh=ss.getSheetByName(CONFIG.SHEET_EVENTOS);
  if(!sh)sh=ss.insertSheet(CONFIG.SHEET_EVENTOS);
  if(sh.getLastRow()===0){sh.appendRow(EVENT_HEADERS);_eventosIniciales().forEach(e=>sh.appendRow(_filaEvento(e)));sh.setFrozenRows(1);}
  return sh;
}
function _leerEventos(){
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_EVENTOS);
  if(!sh)return _eventosIniciales();
  const values=sh.getDataRange().getValues();if(!values.length)return [];
  const H={};values[0].forEach((name,index)=>H[name]=index);
  if(H.ID==null||H.Nombre==null)throw new Error('Revise los encabezados de Eventos');
  return values.slice(1).filter(row=>/^[a-zA-Z0-9_-]{3,80}$/.test(String(row[H.ID]||''))).map(row=>{
    const desde=_fechaTexto(row[H.Inicio]),hasta=_fechaTexto(row[H.Fin]);
    const ocrDesde=_fechaTexto(row[H['Escaneo inicio']]),ocrHasta=_fechaTexto(row[H['Escaneo fin']]);
    return{id:String(row[H.ID]),nombre:String(row[H.Nombre]||'').trim(),desde,hasta,
      ocrHabilitado:_booleanoEvento(row[H['Escaneo habilitado']])&&_fechaValida(ocrDesde)&&_fechaValida(ocrHasta)&&ocrDesde<=ocrHasta,
      ocrDesde,ocrHasta,visible:_booleanoEvento(row[H.Disponible]),legacyNombre:String(row[H['Nombre histórico']]||''),revision:Number(row[H['Versión']])||1};
  }).filter(e=>e.nombre);
}
function _configuracionEventos(eventoId){
  const hoy=Utilities.formatDate(new Date(),CONFIG.ZONA_HORARIA,'yyyy-MM-dd');
  const eventos=_leerEventos().map(e=>({...e,pasado:_eventoPasado(e,hoy),permiteRegistro:e.visible&&!_eventoPasado(e,hoy)}));
  const defaultId=_eventoMasReciente(eventos)?.id||'';
  const id=eventoId||defaultId;
  const evento=typeof id==='string'?eventos.find(e=>e.id===id&&e.visible):null;
  return {eventos:eventos.map(e=>({...e,predeterminado:e.id===defaultId})),eventoDefaultId:defaultId,fechaLocal:hoy,
    eventoSeleccionado:evento||null,eventoError:evento?'':'Actividad no disponible. Elegí otra actividad.',
    evento:evento?.nombre||'',desde:evento?.desde||'',hasta:evento?.hasta||'',ocr:_estadoEscaneo(id)};
}
function _eventoMasReciente(eventos){
  return eventos.filter(e=>e.visible).reduce((latest,e)=>!latest||String(e.desde||'')>=String(latest.desde||'')?e:latest,null);
}
function _eventoPasado(evento,hoy){
  hoy=hoy||Utilities.formatDate(new Date(),CONFIG.ZONA_HORARIA,'yyyy-MM-dd');
  return !_fechaValida(evento.hasta)||hoy>evento.hasta;
}
function _eventoRegistro(raw){
  const eventos=_leerEventos();
  if(raw.eventoId){
    const evento=typeof raw.eventoId==='string'&&eventos.find(e=>e.id===raw.eventoId);
    return evento?{evento}:{error:'Actividad no encontrada. Conservá el registro y consultá al administrador.'};
  }
  const nombre=String(raw.evento||'').trim();
  const id=_eventoMasReciente(eventos)?.id||'';
  const evento=nombre?eventos.find(e=>e.legacyNombre===nombre):eventos.find(e=>e.id===id);
  return{evento:evento||null}; // Legacy queued labels are preserved, never reassigned to another exhibition.
}
function _guardarEvento(d){
  const auth=_autorizarAdministrador(d.idToken);if(!auth.ok)return _json(auth);
  const raw=d.eventoConfig;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return _json({ok:false,error:'Configuración inválida'});
  const lock=LockService.getScriptLock();if(!lock.tryLock(30000))return _json({ok:false,retryable:true,error:'Sistema ocupado; reintente'});
  try{
    const eventos=_leerEventos();
    const id=raw.id||'evt_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10);
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{3,80}$/.test(id))return _json({ok:false,error:'ID de actividad inválido'});
    const anterior=eventos.find(e=>e.id===id);
    if(!anterior&&raw.revision&&Number(raw.revision)!==0)return _json({ok:false,conflict:true,error:'La actividad cambió. Volvé a cargar la configuración.'});
    const nombre=typeof raw.nombre==='string'?raw.nombre.trim():'';
    if(!nombre||nombre.length>120||/[\x00-\x1f]/.test(nombre))return _json({ok:false,error:'Escribí un nombre válido (máximo 120 caracteres)'});
    const desde=String(raw.desde||''),hasta=String(raw.hasta||'');
    const sinFechaHistorica=!!anterior?.legacyNombre&&!desde&&!hasta;
    if(!sinFechaHistorica&&(!_fechaValida(desde)||!_fechaValida(hasta)||desde>hasta))return _json({ok:false,error:'Fechas oficiales inválidas'});
    const ocrDesde=String(raw.ocrDesde||''),ocrHasta=String(raw.ocrHasta||''),ocrHabilitado=raw.ocrHabilitado===true;
    if((ocrHabilitado||ocrDesde||ocrHasta)&&(!_fechaValida(ocrDesde)||!_fechaValida(ocrHasta)||ocrDesde>ocrHasta))return _json({ok:false,error:'Fechas de escaneo inválidas'});
    const evento={id,nombre,desde,hasta,ocrHabilitado,ocrDesde,ocrHasta,visible:raw.visible!==false,legacyNombre:anterior?.legacyNombre||'',revision:(anterior?.revision||0)+1};
    if(anterior&&Number(raw.revision||0)!==anterior.revision){
      const igual=['nombre','desde','hasta','ocrHabilitado','ocrDesde','ocrHasta','visible'].every(k=>evento[k]===anterior[k]);
      if(!(Number(raw.revision||0)===0&&anterior.revision===1&&igual))return _json({ok:false,conflict:true,error:'La actividad cambió en otra sesión. Volvé a cargarla antes de guardar.'});
      return _json({ok:true,..._configuracionEventos(id),evento:anterior});
    }
    if(!anterior&&eventos.length>=100)return _json({ok:false,error:'Se alcanzó el máximo de actividades configuradas'});
    const sh=_asegurarEventos(SpreadsheetApp.getActiveSpreadsheet()),values=sh.getDataRange().getValues();
    const index=values.findIndex((row,i)=>i>0&&String(row[0])===id);
    if(index<0)sh.appendRow(_filaEvento(evento));else sh.getRange(index+1,1,1,EVENT_HEADERS.length).setValues([_filaEvento(evento)]);
    SpreadsheetApp.flush();
    return _json({ok:true,..._configuracionEventos(id),evento});
  }catch(err){Logger.log('Event settings error: '+String(err));return _json({ok:false,retryable:true,error:'No se pudo guardar la actividad. Conservá los datos y reintentá.'});}
  finally{lock.releaseLock();}
}
function _filtroEvento(evento){return{id:evento.id,nombre:evento.nombre,legacyNombre:evento.legacyNombre};}
function _parametrosEvento(p){
  const params={...(p||{})};
  if(params.eventoId){const evento=typeof params.eventoId==='string'&&_leerEventos().find(e=>e.id===params.eventoId);if(!evento)return{error:'Actividad no encontrada'};params.evento=_filtroEvento(evento);}
  else if(params.evento&&typeof params.evento!=='string')return{error:'Filtro de actividad inválido'};
  else params.evento=_prepararFiltroEvento(params.evento);
  return{params};
}
function _prepararFiltroEvento(filtro){
  if(typeof filtro!=='string'||!filtro)return filtro;
  const legado=_leerEventos().find(e=>e.legacyNombre===filtro);return legado?_filtroEvento(legado):filtro;
}
function _coincideEvento(row,H,filtro){
  if(!filtro)return true;
  if(typeof filtro==='string')return String(row[H.Evento])===filtro;
  const id=H['Evento ID']==null?'':String(row[H['Evento ID']]||'');
  return id?id===filtro.id:!!filtro.legacyNombre&&String(row[H.Evento])===filtro.legacyNombre;
}
function _tituloEventoFiltro(filtro){return typeof filtro==='object'&&filtro?filtro.nombre:(filtro||'Todos los eventos');}

function _estadoEscaneo(eventoId){
  const eventos=_leerEventos();
  const id=eventoId||_eventoMasReciente(eventos)?.id||'';
  const evento=eventos.find(e=>e.id===id);
  const hoy=Utilities.formatDate(new Date(),CONFIG.ZONA_HORARIA,'yyyy-MM-dd');
  return {activo:!!evento&&evento.visible&&!_eventoPasado(evento,hoy)&&evento.ocrHabilitado&&hoy>=evento.ocrDesde&&hoy<=evento.ocrHasta,
    desde:evento?.ocrDesde||'',hasta:evento?.ocrHasta||'',zona:CONFIG.ZONA_HORARIA,limiteDiario:CONFIG.OCR_LIMITE_DIARIO};
}

function _autorizarOperador(idToken){
  const denied={ok:false,authRequired:true,retryable:false,error:'Iniciá sesión con Google para continuar'};
  try {
    if(typeof idToken!=='string'||idToken.length>10000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(idToken)) return denied;
    const cfg=_configuracionGoogle();
    if(!cfg.configured) return {ok:false,authRequired:false,retryable:true,error:'Inicio de sesión no configurado; avisá al coordinador'};
    const partes=idToken.split('.');
    const decode=s=>JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString());
    const header=decode(partes[0]), claims=decode(partes[1]), now=Math.floor(Date.now()/1000);
    if(header.alg!=='RS256'||!header.kid||claims.aud!==cfg.firebase.projectId||
      claims.iss!=='https://securetoken.google.com/'+cfg.firebase.projectId||
      typeof claims.sub!=='string'||!claims.sub||claims.sub.length>128||
      typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+60||
      typeof claims.auth_time!=='number'||claims.auth_time>now+60||
      claims.email_verified!==true||!claims.email||claims.firebase?.sign_in_provider!=='google.com') return denied;
    // Google validates the credential. Merely decoding its claims never grants access.
    let response;
    try{
      response=UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+encodeURIComponent(cfg.firebase.apiKey),{
        method:'post',contentType:'application/json',payload:JSON.stringify({idToken}),muteHttpExceptions:true
      });
    }catch(networkError){return {ok:false,authRequired:false,retryable:true,error:'No se pudo verificar la sesión. Conservá los pendientes y reintentá'};}
    const status=response.getResponseCode();
    if(status===429||status>=500) return {ok:false,authRequired:false,retryable:true,error:'No se pudo verificar la sesión. Conservá los pendientes y reintentá'};
    if(status!==200) return denied;
    const user=JSON.parse(response.getContentText()).users?.[0];
    if(!user||user.localId!==claims.sub||user.disabled||user.emailVerified!==true||
      typeof user.email!=='string'||user.email.toLowerCase()!==String(claims.email).toLowerCase()||
      Number(user.validSince||0)>claims.auth_time||
      !user.providerUserInfo?.some(p=>p.providerId==='google.com')) return denied;
    const email=user.email.trim().toLowerCase();
    const allowed=String(PropertiesService.getScriptProperties().getProperty('AUTH_ALLOWED_EMAILS')||'').split(/[,;\s]+/).map(e=>e.trim().toLowerCase()).filter(Boolean);
    if(allowed.length&&!allowed.includes(email)) return {...denied,error:'Esta cuenta no está habilitada para registrar'};
    return {ok:true,usuario:{uid:user.localId,email,nombre:String(user.displayName||email).slice(0,160),admin:email===CONFIG.ADMIN_EMAIL}};
  } catch(err){
    // Do not log credentials or remote payloads.
    return denied;
  }
}

function _columnasAuditoria(sh){
  const cabecera=sh.getDataRange().getValues()[0].slice();
  ['Registrado por (email)','Google UID','Nombre de cuenta','Evento ID'].forEach(col=>{
    if(!cabecera.includes(col)){sh.getRange(1,cabecera.length+1).setValue(col);cabecera.push(col);}
  });
  return cabecera;
}

function _autorizarReporte(e) {
  return _autorizarAdministrador(e && e.parameter && e.parameter.idToken);
}

function _autorizarAdministrador(idToken){
  const auth=_autorizarOperador(idToken);
  if(!auth.ok) return auth;
  return auth.usuario.admin?auth:{ok:false,retryable:false,error:'Solo administración puede consultar, exportar o imprimir reportes'};
}

function _enviarReporteAdmin(p) {
  try {
    const normal=_parametrosEvento(p);if(normal.error)return _json({ok:false,error:normal.error});p=normal.params;
    const emails = _getReportEmails();
    if (!emails) return _json({ ok: false, error: 'No hay destinatarios configurados' });
    const sel = _reporteSegunTipo(p || {});
    if (sel.error) return _json({ ok: false, error: sel.error });
    MailApp.sendEmail({
      to: emails,
      subject: `[PTITP] Reporte ${sel.titulo} — ${sel.rpt.total} visitantes, ${sel.rpt.nA} leads A`,
      body: sel.rpt.texto,
      htmlBody: _htmlDeReporte(sel.rpt, sel.titulo),
      attachments: [_pdfDeReporte(sel.rpt, sel.titulo, sel.archivo)],
    });
    return _json({ ok: true, enviado: 'a ' + emails, total: sel.rpt.total });
  } catch (err) {
    Logger.log('Enviar reporte error: ' + String(err));
    return _json({ ok: false, error: 'No se pudo enviar el reporte' });
  }
}

function _validarLead(raw) {
  const limites = {
    evento: 120, promotor: 100, nombre: 160, empresa: 180, cargo: 120, pais: 80,
    telefono: 60, email: 180, tipoOrg: 100, sector: 120, plazo: 80,
    superficie: 30, empleos: 30, comoNosConocio: 120, calificacion: 40,
    observaciones: 2000, fechaSeguimiento: 10, responsable: 120,
  };
  const d = {};
  for (const k in limites) {
    if (raw[k] != null && typeof raw[k] !== 'string') return { error: 'Campo inválido: ' + k };
    const s = String(raw[k] || '').trim();
    if (s.length > limites[k]) return { error: 'Campo demasiado largo: ' + k };
    d[k] = _textoSeguro(s);
  }
  if (!d.nombre) return { error: 'Falta el nombre del visitante' };
  if (!/^[ABC](?:\s|\s*-|$)/.test(d.calificacion)) return { error: 'Calificación inválida' };
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return { error: 'Email inválido' };
  if (d.fechaSeguimiento && !_fechaValida(d.fechaSeguimiento)) return { error: 'Fecha inválida' };
  if (d.superficie && !/^\d+(?:[.,]\d{1,2})?$/.test(d.superficie)) return { error: 'Superficie inválida' };
  if (d.empleos && !/^\d+$/.test(d.empleos)) return { error: 'Empleos inválidos' };

  for (const k of ['intereses', 'proximosPasos']) {
    if (raw[k] != null && !Array.isArray(raw[k])) return { error: 'Campo inválido: ' + k };
    const arr = raw[k] || [];
    if (arr.length > 12) return { error: 'Demasiados valores: ' + k };
    d[k] = [];
    for (const v of arr) {
      if (typeof v !== 'string' || v.trim().length > 120) return { error: 'Valor inválido: ' + k };
      d[k].push(_textoSeguro(v.trim()));
    }
  }

  const tarjeta = String(raw.tarjetaUrl || '').trim();
  if (tarjeta && !_urlTarjetaSegura(tarjeta))
    return { error: 'URL de tarjeta inválida' };
  d.tarjetaUrl = tarjeta;

  const rid = String(raw.requestId || '').trim();
  if (rid && !/^[A-Za-z0-9_-]{8,100}$/.test(rid)) return { error: 'RequestID inválido' };
  d.requestId = rid;
  return { datos: d };
}

function _textoSeguro(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function _urlTarjetaSegura(value) {
  return typeof value === 'string' && value.length <= 2000 &&
    /^https:\/\/(?:drive|docs)\.google\.com\/[^\s<>"'`\\]*$/i.test(value);
}

function _escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _fechaTexto(value) {
  return value instanceof Date ? Utilities.formatDate(value,CONFIG.ZONA_HORARIA,'yyyy-MM-dd') : String(value || '').slice(0,10);
}

function _requestIdExiste(sh, requestId) {
  if (!requestId || sh.getLastRow() < 2) return false;
  const vals = sh.getDataRange().getValues();
  const idx = vals[0].indexOf('RequestID');
  return idx !== -1 && vals.slice(1).some(r => String(r[idx]) === requestId);
}

function _fechaValida(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const date = new Date(f + 'T12:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0,10) === f;
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
    return { rpt: _construirReporteExpo(p.evento), titulo: 'acumulado del evento', archivo: 'PTITP_Reporte_evento' };
  }
  if (tipo === 'rango') {
    if (!_fechaValida(p.desde) || !_fechaValida(p.hasta) || p.desde > p.hasta)
      return { error: 'Rango de fechas inválido' };
    return { rpt: _construirReporteRango(p.desde, p.hasta, p.evento), titulo: `del ${p.desde} al ${p.hasta}`,
             archivo: `PTITP_Reporte_${p.desde}_a_${p.hasta}` };
  }
  const f = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');
  return { rpt: _construirReporte(f, p.evento), titulo: 'diario ' + f, archivo: 'PTITP_Reporte_diario_' + f };
}

// ══════════ Lead 資料卡（Fichas）：完整欄位、可列印設計 ══════════
function _fichasSegunTipo(p,normalizado=false) {
  if(!normalizado){const normal=_parametrosEvento(p);if(normal.error)return{error:normal.error};p=normal.params;}
  const tipo = p.tipo || 'expo';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_LEADS);
  if (!sh || sh.getLastRow() < 2) return { error: 'Sin datos' };
  const datos = sh.getDataRange().getValues();
  const H = {};
  datos[0].forEach((h, i) => H[h] = i);
  const hoy = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd');

  let filtro, titulo, archivo;
  if (tipo === 'dia') {
    const f = _fechaValida(p.fecha) ? p.fecha : hoy;
    filtro = r => _fechaTexto(r[H['Fecha']]) === f;
    titulo = 'del ' + f; archivo = 'PTITP_Fichas_' + f;
  } else if (tipo === 'rango') {
    if (!_fechaValida(p.desde) || !_fechaValida(p.hasta) || p.desde > p.hasta) return { error: 'Fechas inválidas' };
    filtro = r => { const f = _fechaTexto(r[H['Fecha']]); return f >= p.desde && f <= p.hasta; };
    titulo = 'del ' + p.desde + ' al ' + p.hasta; archivo = 'PTITP_Fichas_' + p.desde + '_' + p.hasta;
  } else {
    filtro = () => true;
    titulo = 'de todo el evento'; archivo = 'PTITP_Fichas_evento';
  }

  // 選擇性過濾評級：&calif=A,B
  const califs = String(p.calif || '').toUpperCase().split(',').filter(c => c && 'ABC'.indexOf(c) !== -1);

  const orden = { A: 0, B: 1, C: 2 };
  const leads = datos.slice(1).filter(r => _coincideEvento(r,H,p.evento)).filter(filtro).map(r => ({
    fecha: _fechaTexto(r[H['Fecha']]),
    evento: r[H['Evento']] || '', promotor: r[H['Promotor']] || '',
    nombre: r[H['Nombre']] || '', empresa: r[H['Empresa']] || '', cargo: r[H['Cargo']] || '',
    pais: r[H['País']] || '', tel: r[H['Teléfono/WhatsApp']] || '', email: r[H['Email']] || '',
    tipoOrg: r[H['Tipo de organización']] || '', sector: r[H['Sector/Rubro']] || '',
    intereses: r[H['Intereses']] || '', plazo: r[H['Plazo']] || '',
    sup: r[H['Superficie (m²)']] || '', empleos: r[H['Empleos est.']] || '',
    conocio: r[H['Cómo nos conoció']] || '',
    calif: String(r[H['Calificación']] || 'C').charAt(0).toUpperCase(),
    obs: r[H['Observaciones']] || '', pasos: r[H['Próximos pasos']] || '',
    fseg: String(r[H['Fecha límite seguimiento']] || '').slice(0, 10),
    resp: r[H['Responsable seguimiento']] || '', estado: r[H['Estado']] || 'Pendiente',
    tarjeta: H['Tarjeta (imagen)'] != null ? (r[H['Tarjeta (imagen)']] || '') : '',
    leadId: H['LeadID'] != null ? (r[H['LeadID']] || '') : '',
  })).filter(l => !califs.length || califs.indexOf(l.calif) !== -1)
    .sort((a, b) => (orden[a.calif] - orden[b.calif]) || (a.fecha < b.fecha ? -1 : 1));

  return { leads, titulo, archivo, evento: typeof p.evento==='object'?p.evento.nombre:(p.evento||'Todos los eventos') };
}

// 資料卡 HTML：瀏覽器（含網頁字型與列印工具列）與 GAS PDF（Helvetica）雙用
function _htmlFichas(leads, titulo, evento, params, conToolbar) {
  const esc = _escHtml;
  const C = { verde: '#009C81', azul: '#14588F', tinta: '#152730', gris: '#5E7079',
              linea: '#DCE7E3', claro: '#F2F7F5', A: '#D3452B', B: '#D99A2B', Cc: '#5E7079' };
  const colorDe = c => c === 'A' ? C.A : (c === 'B' ? C.B : C.Cc);
  const generado = Utilities.formatDate(new Date(), CONFIG.ZONA_HORARIA, 'yyyy-MM-dd HH:mm');

  const dato = (eti, val) => val ?
    '<td style="padding:3px 10px 3px 0;vertical-align:top"><div style="font-size:8px;color:' + C.gris +
    ';text-transform:uppercase;letter-spacing:1px">' + eti + '</div>' +
    '<div style="font-size:10.5px;color:' + C.tinta + '">' + esc(val) + '</div></td>' : '';

  const ficha = l => {
    const col = colorDe(l.calif);
    return '<div class="ficha" style="border:1px solid ' + C.linea + ';border-left:6px solid ' + col +
      ';border-radius:10px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid;background:#fff">' +
      // 頭列：徽章 + 姓名 + 識別
      '<table width="100%" style="border-collapse:collapse"><tr>' +
      '<td width="44" style="vertical-align:top"><div style="width:34px;height:34px;background:' + col +
      ';border-radius:8px;color:#fff;font-size:19px;font-weight:bold;text-align:center;line-height:34px;font-family:\'Space Grotesk\',Helvetica,Arial,sans-serif">' + esc(l.calif) + '</div></td>' +
      '<td style="vertical-align:top"><div style="font-size:15px;font-weight:bold;color:' + C.tinta +
      ';font-family:\'Space Grotesk\',Helvetica,Arial,sans-serif">' + esc(l.nombre) + '</div>' +
      '<div style="font-size:10.5px;color:' + C.gris + '">' + esc(l.empresa || 's/empresa') +
      (l.cargo ? ' &middot; ' + esc(l.cargo) : '') + (l.pais ? ' &middot; ' + esc(l.pais) : '') + '</div></td>' +
      '<td align="right" style="vertical-align:top;font-size:8.5px;color:' + C.gris + '">' +
      esc(l.leadId) + '<br>' + esc(l.fecha) + ' &middot; ' + esc(l.promotor) + '</td></tr></table>' +
      // 聯絡
      '<div style="margin-top:7px;font-size:10.5px;color:' + C.azul + '">' +
      [l.tel ? '&#9742; ' + esc(l.tel) : '', l.email ? '&#9993; ' + esc(l.email) : '']
        .filter(Boolean).join(' &nbsp;&nbsp; ') + '</div>' +
      // 檔案欄位
      '<table width="100%" style="border-collapse:collapse;margin-top:7px"><tr>' +
      dato('Organizaci&oacute;n', l.tipoOrg) + dato('Sector', l.sector) + dato('Plazo', l.plazo) +
      dato('Superficie', l.sup ? l.sup + ' m&sup2;' : '') + dato('Empleos', l.empleos) + '</tr>' +
      '<tr>' + dato('Intereses', l.intereses) + dato('C&oacute;mo nos conoci&oacute;', l.conocio) +
      dato('Estado', l.estado) + '</tr></table>' +
      // 觀察
      (l.obs ? '<div style="margin-top:7px;background:' + C.claro + ';border-radius:7px;padding:7px 10px;' +
        'font-size:10px;font-style:italic;color:' + C.tinta + '"><b style="font-style:normal;font-size:8px;' +
        'color:' + C.gris + ';text-transform:uppercase;letter-spacing:1px">Observaciones</b><br>' + esc(l.obs) + '</div>' : '') +
      // 下一步
      '<div style="margin-top:7px;font-size:10.5px">&rarr; <b>' + (esc(l.pasos) || 'definir pr&oacute;ximos pasos') + '</b>' +
      (l.fseg ? ' <span style="color:' + C.A + ';font-weight:bold">(antes del ' + esc(l.fseg) + ')</span>' : '') +
      (l.resp ? ' &mdash; Resp.: ' + esc(l.resp) : '') +
      (_urlTarjetaSegura(l.tarjeta) ? ' &nbsp;&middot;&nbsp; <a rel="noreferrer noopener" href="' + esc(l.tarjeta) + '" style="color:' + C.azul + ';font-size:9px">ver tarjeta</a>' : '') +
      '</div></div>';
  };

  const nA = leads.filter(l => l.calif === 'A').length,
        nB = leads.filter(l => l.calif === 'B').length,
        nC = leads.filter(l => l.calif === 'C').length;

  const toolbar = conToolbar ?
    '<div class="toolbar" style="max-width:800px;margin:0 auto 12px;text-align:right">' +
    '<button onclick="window.print()" style="background:' + C.azul + ';color:#fff;border:0;border-radius:8px;' +
    'padding:9px 16px;font-weight:bold;font-size:13px;cursor:pointer">&#128424; Imprimir / Guardar PDF</button></div>' : '';

  return '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">' +
    '<style>body{font-family:Helvetica,Arial,sans-serif;background:#EEF4F2;margin:0;padding:16px}' +
    '.hoja{max-width:800px;margin:0 auto}' +
    '@media print{body{background:#fff;padding:0}.toolbar{display:none}}' +
    '</style></head><body>' + toolbar +
    '<div class="hoja">' +
    '<table width="100%" style="border-collapse:collapse;margin-bottom:14px"><tr>' +
    '<td style="background:' + C.verde + ';padding:13px 16px;border-radius:10px 0 0 10px">' +
    '<div style="font-size:16px;font-weight:bold;color:#fff;font-family:\'Space Grotesk\',Helvetica,sans-serif">PTITP &mdash; Fichas de Leads</div>' +
    '<div style="font-size:9.5px;color:#DFF3EE;margin-top:3px">' + esc(titulo) + ' &middot; ' + esc(evento) +
    ' &middot; ' + leads.length + ' leads (A:' + nA + ' &middot; B:' + nB + ' &middot; C:' + nC + ')' +
    ' &middot; Generado: ' + generado + '</div></td>' +
    '<td width="8" style="background:' + C.azul + ';border-radius:0 10px 10px 0"></td></tr></table>' +
    (leads.map(ficha).join('') || '<p style="color:' + C.gris + '">(sin leads en el per&iacute;odo)</p>') +
    '<div style="border-top:1px solid ' + C.linea + ';padding-top:6px;font-size:8px;color:' + C.gris + '">' +
    'Documento interno &mdash; Sistema de Captaci&oacute;n PTITP &middot; contiene datos de contacto: manejar con confidencialidad</div>' +
    '</div></body></html>';
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
function _construirReporte(fecha, eventoFiltro) {
  eventoFiltro=_prepararFiltroEvento(eventoFiltro);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_LEADS);
  const data = sh.getDataRange().getValues();
  const H = {};
  data[0].forEach((h, i) => H[h] = i);

  const rows = data.slice(1).filter(r => _coincideEvento(r,H,eventoFiltro))
    .filter(r => _fechaTexto(r[H['Fecha']]) === fecha);

  const evento = _tituloEventoFiltro(eventoFiltro);
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
function _construirReporteExpo(evento) { return _construirReporteAgregado(null, null, evento); }
function _construirReporteRango(desde, hasta, evento) { return _construirReporteAgregado(desde, hasta, evento); }

function _construirReporteAgregado(desde, hasta, eventoFiltro) {
  eventoFiltro=_prepararFiltroEvento(eventoFiltro);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_LEADS);
  const data = sh.getDataRange().getValues();
  const H = {};
  data[0].forEach((h, i) => H[h] = i);
  let rows = data.slice(1).filter(r => _coincideEvento(r,H,eventoFiltro));
  if (desde && hasta) {
    rows = rows.filter(r => {
      const f = _fechaTexto(r[H['Fecha']]);
      return f >= desde && f <= hasta;
    });
  }

  const evento = _tituloEventoFiltro(eventoFiltro);
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
