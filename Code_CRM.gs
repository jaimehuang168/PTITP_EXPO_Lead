/**
 * PTITP 展後客戶追蹤系統（CRM）— Fase 1
 * ------------------------------------------------
 * 獨立的 Google Sheet + Apps Script，與展會問卷系統分離。
 * 透過 EXPO Sheet ID 定時拉取新 leads → 建入 Pipeline 並掛 SLA 期限。
 *
 * 分頁：Pipeline / Actividades / Visitas / Lotes / Ocupaciones / Plantillas / Config
 * 自動化：
 *   - sincronizarLeads()  每 10 分鐘從展會 Sheet 匯入新 leads（去重）
 *   - actualizarPipeline() 由 Actividades 重算「Último contacto」、回寫展會 Estado
 *   - tareasDiarias()      每朝 8:00 寄任務摘要信（逾期/今日/怠慢的A級）
 * 初始化：setupCRM() → Config 填展會 Sheet ID → crearTriggersCRM()
 */

// ══════════ 設定 ══════════
const CRM = {
  ZONA: 'America/Asuncion',
  SH: {
    PIPELINE: 'Pipeline', ACT: 'Actividades', VIS: 'Visitas',
    LOTES: 'Lotes', OCUP: 'Ocupaciones', PLANT: 'Plantillas', CFG: 'Config',
  },
  // A/B/C 首次追蹤 SLA（天）
  SLA_DIAS: { A: 2, B: 7, C: 30 },
  // A 級幾天沒聯繫算「怠慢」
  DIAS_ALERTA_A: 3,
  ETAPAS: ['Nuevo', 'Contactado', 'Visita agendada', 'Visita realizada',
           'En negociación', 'Propuesta enviada', 'Ganado (contrato)', 'Perdido', 'En pausa'],
};

const H_PIPELINE = ['LeadID', 'Nombre', 'Empresa', 'País', 'Teléfono', 'Email',
  'Evento', 'Calificación', 'Intereses', 'Tarjeta', 'Etapa', 'Responsable',
  'Próxima acción', 'Fecha límite', 'Último contacto',
  'Superficie (m²)', 'Lote candidato', 'Probabilidad %', 'Fecha est. decisión', 'Notas'];
const H_ACT = ['Fecha', 'LeadID', 'Tipo', 'Resumen', 'Responsable'];
const H_VIS = ['VisitaID', 'LeadID', 'Fecha', 'Hora', 'Visitantes', 'Recepción',
  'Idioma', 'Estado', 'CalendarEventId', 'Minuta', 'Evaluación', 'Recordatorio enviado'];
const H_LOTES = ['LoteID', 'Block', 'Tipo de uso', 'm² catastral',
  'Esquina 1', 'Esquina 2', 'Esquina 3', 'Esquina 4', 'Notas',
  'Estado (derivado)', 'm² ocupados (derivado)', 'Verificado'];
const H_OCUP = ['OcupID', 'Empresa', 'LeadID', 'Tipo', 'Lotes involucrados', 'm² arrendados',
  'Esquina 1', 'Esquina 2', 'Esquina 3', 'Esquina 4', 'Fecha inicio', 'Fecha fin', 'Notas', 'Verificado'];
const H_PLANT = ['Clave', 'Idioma', 'Asunto', 'Cuerpo'];

// ══════════ 初始化 ══════════
function setupCRM() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mk = (nombre, headers) => {
    let sh = ss.getSheetByName(nombre);
    if (!sh) sh = ss.insertSheet(nombre);
    if (sh.getLastRow() === 0) {
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold').setBackground('#14588F').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
    }
    return sh;
  };
  mk(CRM.SH.PIPELINE, H_PIPELINE);
  mk(CRM.SH.ACT, H_ACT);
  mk(CRM.SH.VIS, H_VIS);
  mk(CRM.SH.LOTES, H_LOTES);
  mk(CRM.SH.OCUP, H_OCUP);
  mk(CRM.SH.PLANT, H_PLANT);

  let cfg = ss.getSheetByName(CRM.SH.CFG);
  if (!cfg) cfg = ss.insertSheet(CRM.SH.CFG);
  if (cfg.getLastRow() === 0) {
    cfg.appendRow(['Parámetro', 'Valor', 'Notas']);
    cfg.appendRow(['ID hoja Expo', '', '← pegar el ID del Google Sheet del sistema de expo (está en su URL)']);
    cfg.appendRow(['Emails resumen diario', '', 'uno o varios, separados por coma']);
    cfg.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#14588F').setFontColor('#FFFFFF');
  }

  // Fase 2 遷移：Config 補參訪相關參數列（已存在則略過）
  const cfgVals = cfg.getDataRange().getValues();
  const tieneParam = p => cfgVals.some(r => String(r[0]).trim() === p);
  [
    ['Dirección del parque', 'Parque Tecnológico Inteligente Taiwán-Paraguay, Hernandarias, Alto Paraná, Paraguay', ''],
    ['Link Google Maps', '', '← pegar el enlace de Google Maps del parque'],
    ['Link brochure', 'https://drive.google.com/file/d/1anVMXMkn8U-Rwqm8UEzfTV4hntBLnRCs/view?usp=drive_link', 'tríptico EN/ES/PT'],
    ['URL app', 'https://jaimehuang168.github.io/PTITP_EXPO_Lead/', 'para adjuntar mapas a los emails'],
    ['Email copia visitas', '', 'opcional: cc de las confirmaciones/recordatorios'],
  ].forEach(fila => { if (!tieneParam(fila[0])) cfg.appendRow(fila); });

  // Fase 2 遷移：舊 Visitas 表補「Recordatorio enviado」欄
  const shv = ss.getSheetByName(CRM.SH.VIS);
  if (shv && shv.getLastRow() > 0) {
    const hv = shv.getDataRange().getValues()[0];
    if (hv.indexOf('Recordatorio enviado') === -1)
      shv.getRange(1, hv.length + 1).setValue('Recordatorio enviado');
  }

  // Fase 3 遷移：舊 Lotes 表補推導欄與 Verificado
  const shl = ss.getSheetByName(CRM.SH.LOTES);
  if (shl && shl.getLastRow() > 0) {
    let hl = shl.getDataRange().getValues()[0];
    ['Estado (derivado)', 'm² ocupados (derivado)', 'Verificado'].forEach(c => {
      if (hl.indexOf(c) === -1) { shl.getRange(1, hl.length + 1).setValue(c); hl = hl.concat([c]); }
    });
  }
  const sho2 = ss.getSheetByName(CRM.SH.OCUP);
  if (sho2 && sho2.getLastRow() > 0) {
    const ho2 = sho2.getDataRange().getValues()[0];
    if (ho2.indexOf('Verificado') === -1) sho2.getRange(1, ho2.length + 1).setValue('Verificado');
  }
  if (!tieneParam('Emails reporte semanal'))
    cfg.appendRow(['Emails reporte semanal', '', 'lunes 8:30; si queda vacío usa "Emails resumen diario"']);
  if (!tieneParam('Usuarios web'))
    cfg.appendRow(['Usuarios web', '', 'emails autorizados para la interfaz web (coma); vacío = solo controla el despliegue']);

  _sembrarPlantillas(ss);
  _sembrarLotes(ss);

  // Pipeline 的 Etapa 欄加下拉驗證
  try {
    const sh = ss.getSheetByName(CRM.SH.PIPELINE);
    const col = H_PIPELINE.indexOf('Etapa') + 1;
    const regla = SpreadsheetApp.newDataValidation().requireValueInList(CRM.ETAPAS, true).build();
    sh.getRange(2, col, 5000, 1).setDataValidation(regla);
  } catch (e) { /* 環境不支援時略過 */ }

  Logger.log('✅ CRM 初始化完成。請到 Config 填「ID hoja Expo」與「Emails resumen diario」，再執行 crearTriggersCRM()');
}

// ══════════ Config 讀取 ══════════
function _cfgCRM(param) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.CFG);
  if (!sh) return '';
  const vals = sh.getDataRange().getValues();
  const fila = vals.find(r => String(r[0]).trim() === param);
  return fila ? String(fila[1] || '').trim() : '';
}

// ══════════ 同步：展會 Leads → Pipeline ══════════
function sincronizarLeads() {
  const expoId = _cfgCRM('ID hoja Expo');
  if (!expoId) { Logger.log('⚠️ Config 未填「ID hoja Expo」'); return 0; }

  const expo = SpreadsheetApp.openById(expoId);
  const shLeads = expo.getSheetByName('Leads');
  if (!shLeads) { Logger.log('⚠️ 展會 Sheet 找不到 Leads 分頁'); return 0; }

  const datos = shLeads.getDataRange().getValues();
  const HE = {};
  datos[0].forEach((h, i) => HE[h] = i);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pipe = ss.getSheetByName(CRM.SH.PIPELINE);
  const pvals = pipe.getDataRange().getValues();
  const existentes = {};
  pvals.slice(1).forEach(r => existentes[String(r[0])] = true);

  const hoy = new Date();
  let importados = 0;

  for (let i = 1; i < datos.length; i++) {
    const r = datos[i];
    let leadId = HE['LeadID'] != null ? String(r[HE['LeadID']] || '') : '';

    // 舊資料沒有 LeadID：補發並回寫展會表，建立關聯鍵
    if (!leadId) {
      leadId = 'L-' + Date.now().toString(36).toUpperCase() + '-' + i;
      if (HE['LeadID'] != null) shLeads.getRange(i + 1, HE['LeadID'] + 1).setValue(leadId);
    }
    if (existentes[leadId]) continue;

    const calif = String(r[HE['Calificación']] || 'C').charAt(0).toUpperCase();
    const sla = CRM.SLA_DIAS[calif] || CRM.SLA_DIAS.C;

    // 首次追蹤期限：展會填的優先，否則依 A/B/C SLA
    let limite = String(r[HE['Fecha límite seguimiento']] || '').slice(0, 10);
    if (!limite) {
      const f = new Date(hoy.getTime() + sla * 86400000);
      limite = Utilities.formatDate(f, CRM.ZONA, 'yyyy-MM-dd');
    }

    pipe.appendRow([
      leadId,
      r[HE['Nombre']] || '', r[HE['Empresa']] || '', r[HE['País']] || '',
      r[HE['Teléfono/WhatsApp']] || '', r[HE['Email']] || '',
      r[HE['Evento']] || '', r[HE['Calificación']] || '', r[HE['Intereses']] || '',
      r[HE['Tarjeta (imagen)']] || '',
      'Nuevo',
      r[HE['Responsable seguimiento']] || r[HE['Promotor']] || '',
      r[HE['Próximos pasos']] || 'Primer contacto',
      limite,
      '', // Último contacto
      r[HE['Superficie (m²)']] || '', '', '', '', '',
    ]);
    existentes[leadId] = true;
    importados++;
  }
  Logger.log('✅ 同步完成，匯入 ' + importados + ' 筆新 leads');
  return importados;
}

// ══════════ 重算 Último contacto + 回寫展會 Estado ══════════
function actualizarPipeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pipe = ss.getSheetByName(CRM.SH.PIPELINE);
  const acts = ss.getSheetByName(CRM.SH.ACT).getDataRange().getValues();

  // 每個 LeadID 的最近活動日
  const ultimo = {};
  acts.slice(1).forEach(r => {
    const id = String(r[1] || ''), f = String(r[0] || '').slice(0, 10);
    if (id && f && (!ultimo[id] || f > ultimo[id])) ultimo[id] = f;
  });

  const pvals = pipe.getDataRange().getValues();
  const cUlt = H_PIPELINE.indexOf('Último contacto') + 1;
  for (let i = 1; i < pvals.length; i++) {
    const id = String(pvals[i][0]);
    if (ultimo[id] && String(pvals[i][cUlt - 1]).slice(0, 10) !== ultimo[id]) {
      pipe.getRange(i + 1, cUlt).setValue(ultimo[id]);
    }
  }

  // 回寫展會 Estado（維持舊報告相容）：Ganado/Perdido→Cerrado、Nuevo→Pendiente、其餘→En proceso
  const expoId = _cfgCRM('ID hoja Expo');
  if (!expoId) return;
  const shLeads = SpreadsheetApp.openById(expoId).getSheetByName('Leads');
  const datos = shLeads.getDataRange().getValues();
  const HE = {};
  datos[0].forEach((h, i) => HE[h] = i);
  if (HE['LeadID'] == null || HE['Estado'] == null) return;

  const etapaDe = {};
  pvals.slice(1).forEach(r => etapaDe[String(r[0])] = String(r[H_PIPELINE.indexOf('Etapa')]));
  const mapear = et => /Ganado|Perdido/.test(et) ? 'Cerrado' : (et === 'Nuevo' ? 'Pendiente' : 'En proceso');

  for (let i = 1; i < datos.length; i++) {
    const id = String(datos[i][HE['LeadID']] || '');
    if (!id || !etapaDe[id]) continue;
    const nuevo = mapear(etapaDe[id]);
    if (String(datos[i][HE['Estado']]) !== nuevo) {
      shLeads.getRange(i + 1, HE['Estado'] + 1).setValue(nuevo);
    }
  }
}

// ══════════ 每朝任務摘要信 ══════════
function tareasDiarias() {
  sincronizarLeads();
  actualizarPipeline();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pvals = ss.getSheetByName(CRM.SH.PIPELINE).getDataRange().getValues();
  const HP = {};
  pvals[0].forEach((h, i) => HP[h] = i);
  const hoy = Utilities.formatDate(new Date(), CRM.ZONA, 'yyyy-MM-dd');
  const manana = Utilities.formatDate(new Date(Date.now() + 86400000), CRM.ZONA, 'yyyy-MM-dd');

  const abiertos = pvals.slice(1).filter(r =>
    !/Ganado|Perdido/.test(String(r[HP['Etapa']])));

  const linea = r =>
    `  ▸ [${r[HP['Calificación']] || '?'}] ${r[HP['Nombre']]} — ${r[HP['Empresa']] || 's/empresa'}` +
    ` | ${r[HP['Próxima acción']] || 'definir acción'} | vence: ${String(r[HP['Fecha límite']]).slice(0, 10) || 'N/D'}` +
    ` | Resp.: ${r[HP['Responsable']] || 'N/D'}`;

  const vencidas = abiertos.filter(r => {
    const f = String(r[HP['Fecha límite']]).slice(0, 10);
    return f && f < hoy;
  });
  const paraHoy = abiertos.filter(r => String(r[HP['Fecha límite']]).slice(0, 10) === hoy);

  const lim = new Date(Date.now() - CRM.DIAS_ALERTA_A * 86400000);
  const limStr = Utilities.formatDate(lim, CRM.ZONA, 'yyyy-MM-dd');
  const aFrios = abiertos.filter(r =>
    String(r[HP['Calificación']]).charAt(0) === 'A' &&
    (!String(r[HP['Último contacto']]).slice(0, 10) || String(r[HP['Último contacto']]).slice(0, 10) < limStr));

  // 今明兩日參訪（Fase 2 表，可能為空）
  let visitasTxt = '  (ninguna)';
  const shVis = ss.getSheetByName(CRM.SH.VIS);
  if (shVis && shVis.getLastRow() > 1) {
    const vv = shVis.getDataRange().getValues().slice(1)
      .filter(r => {
        const f = String(r[2]).slice(0, 10);
        return (f === hoy || f === manana) && !/cancelada/i.test(String(r[7]));
      })
      .map(r => `  ▸ ${String(r[2]).slice(0, 10)} ${r[3] || ''} — ${r[4] || ''} (recibe: ${r[5] || 'N/D'})`);
    if (vv.length) visitasTxt = vv.join('\n');
  }

  const cuerpo =
`PTITP — TAREAS DE SEGUIMIENTO · ${hoy}
════════════════════════════════════════

⚠️ VENCIDAS (${vencidas.length})
${vencidas.map(linea).join('\n') || '  (ninguna)'}

📌 VENCEN HOY (${paraHoy.length})
${paraHoy.map(linea).join('\n') || '  (ninguna)'}

🔥 LEADS A SIN CONTACTO HACE +${CRM.DIAS_ALERTA_A} DÍAS (${aFrios.length})
${aFrios.map(linea).join('\n') || '  (ninguno)'}

🏭 VISITAS AL PARQUE HOY / MAÑANA
${visitasTxt}

Pipeline abierto: ${abiertos.length} leads
— Sistema de Seguimiento PTITP`;

  // HTML 版任務信
  const lineaHtml = r =>
    '<b>' + _escHtml(r[HP['Nombre']]) + '</b> — ' + (_escHtml(r[HP['Empresa']]) || 's/empresa') +
    ' <span style="color:#5E7079">[' + _escHtml(String(r[HP['Calificación']]).charAt(0) || '?') + ']</span><br>' +
    _escHtml(r[HP['Próxima acción']] || 'definir acción') +
    ' · vence <b style="color:#D3452B">' + _escHtml(String(r[HP['Fecha límite']]).slice(0, 10) || 'N/D') + '</b>' +
    ' · Resp.: ' + (_escHtml(r[HP['Responsable']]) || 'N/D');
  const visHtmlItems = visitasTxt === '  (ninguna)' ? [] :
    visitasTxt.split('\n').map(v => _escHtml(v.replace(/^  ▸ /, '')));
  const htmlCuerpo =
    _seccionTareasHtml('⚠️ Vencidas (' + vencidas.length + ')', '#D3452B', vencidas.map(lineaHtml)) +
    _seccionTareasHtml('📌 Vencen hoy (' + paraHoy.length + ')', '#D99A2B', paraHoy.map(lineaHtml)) +
    _seccionTareasHtml('🔥 Leads A sin contacto hace +' + CRM.DIAS_ALERTA_A + ' días (' + aFrios.length + ')', '#CE1126', aFrios.map(lineaHtml)) +
    _seccionTareasHtml('🏭 Visitas al parque hoy / mañana', '#009C81', visHtmlItems) +
    '<div style="margin-top:12px;font-size:12px;color:#5E7079">Pipeline abierto: <b>' + abiertos.length + '</b> leads</div>';

  const dest = _validarEmailsCRM(_cfgCRM('Emails resumen diario'));
  if (dest) {
    MailApp.sendEmail({
      to: dest,
      subject: `[PTITP CRM] Tareas ${hoy} — ${vencidas.length} vencidas, ${paraHoy.length} hoy, ${aFrios.length} leads A fríos`,
      body: cuerpo, // 純文字 fallback
      htmlBody: _envolturaHtml('Tareas de seguimiento', hoy + ' · PTITP CRM', htmlCuerpo),
    });
  }
  Logger.log(cuerpo);
  return cuerpo;
}

// ══════════ Fase 2：三語模板系統 ══════════
// 模板存在 Plantillas 分頁，同仁可直接改措辭，不用動程式。
// 佔位符：{{nombre}} {{empresa}} {{fecha}} {{hora}} {{recepcion}} {{direccion}} {{maps}} {{brochure}}
function _sembrarPlantillas(ss) {
  const sh = ss.getSheetByName(CRM.SH.PLANT);
  if (!sh || sh.getLastRow() > 1) return; // 已有內容不覆蓋

  const P = [
    ['confirmacion', 'ES', 'Confirmación de su visita al PTITP — {{fecha}}',
`Estimado/a {{nombre}}:

Confirmamos su visita al Parque Tecnológico Inteligente Taiwán-Paraguay (PTITP).

📅 Fecha: {{fecha}}
🕐 Hora: {{hora}}
📍 Dirección: {{direccion}}
🗺️ Cómo llegar: {{maps}}

Lo/a recibirá: {{recepcion}}

Adjuntamos la vista satelital y el plano del parque para su referencia. Puede conocer más en nuestro brochure: {{brochure}}

Si necesita reprogramar, responda a este correo.

Saludos cordiales,
Parque Tecnológico Inteligente Taiwán-Paraguay`],
    ['confirmacion', 'EN', 'Confirmation of your visit to PTITP — {{fecha}}',
`Dear {{nombre}},

We are pleased to confirm your visit to the Taiwan-Paraguay Smart Technology Park (PTITP).

📅 Date: {{fecha}}
🕐 Time: {{hora}}
📍 Address: {{direccion}}
🗺️ Directions: {{maps}}

You will be received by: {{recepcion}}

Please find attached the satellite view and site plan of the park. Learn more in our brochure: {{brochure}}

Should you need to reschedule, simply reply to this email.

Best regards,
Taiwan-Paraguay Smart Technology Park`],
    ['confirmacion', 'PT', 'Confirmação da sua visita ao PTITP — {{fecha}}',
`Prezado/a {{nombre}},

Confirmamos a sua visita ao Parque Tecnológico Inteligente Taiwan-Paraguai (PTITP).

📅 Data: {{fecha}}
🕐 Horário: {{hora}}
📍 Endereço: {{direccion}}
🗺️ Como chegar: {{maps}}

Você será recebido/a por: {{recepcion}}

Em anexo, a vista de satélite e a planta do parque. Conheça mais no nosso folheto: {{brochure}}

Caso precise reagendar, basta responder a este e-mail.

Atenciosamente,
Parque Tecnológico Inteligente Taiwan-Paraguai`],
    ['recordatorio', 'ES', 'Recordatorio: su visita al PTITP es mañana {{fecha}}',
`Estimado/a {{nombre}}:

Le recordamos su visita de mañana al PTITP.

📅 {{fecha}} a las {{hora}}
📍 {{direccion}}
🗺️ {{maps}}

Lo/a espera: {{recepcion}}

¡Hasta mañana!
Parque Tecnológico Inteligente Taiwán-Paraguay`],
    ['recordatorio', 'EN', 'Reminder: your visit to PTITP is tomorrow {{fecha}}',
`Dear {{nombre}},

A friendly reminder of your visit to PTITP tomorrow.

📅 {{fecha}} at {{hora}}
📍 {{direccion}}
🗺️ {{maps}}

You will be received by: {{recepcion}}

See you tomorrow!
Taiwan-Paraguay Smart Technology Park`],
    ['recordatorio', 'PT', 'Lembrete: sua visita ao PTITP é amanhã {{fecha}}',
`Prezado/a {{nombre}},

Lembramos a sua visita ao PTITP amanhã.

📅 {{fecha}} às {{hora}}
📍 {{direccion}}
🗺️ {{maps}}

Você será recebido/a por: {{recepcion}}

Até amanhã!
Parque Tecnológico Inteligente Taiwan-Paraguai`],
  ];
  P.forEach(p => sh.appendRow(p));
}

function _plantilla(clave, idioma) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.PLANT);
  const vals = sh.getDataRange().getValues().slice(1);
  let fila = vals.find(r => r[0] === clave && String(r[1]).toUpperCase() === idioma);
  if (!fila) fila = vals.find(r => r[0] === clave && String(r[1]).toUpperCase() === 'ES'); // fallback
  return fila ? { asunto: String(fila[2]), cuerpo: String(fila[3]) } : null;
}

function _rellenar(txt, m) {
  return String(txt).replace(/\{\{(\w+)\}\}/g, (_, k) => (m[k] != null ? m[k] : ''));
}

// 依國別推斷信件語言：巴西/葡→PT，亞洲/美/歐→EN，其餘拉美→ES
function _idiomaPorPais(pais) {
  const p = String(pais || '').toLowerCase();
  if (/brasil|brazil|portugal/.test(p)) return 'PT';
  if (/taiw|china|jap|corea|korea|ee\.uu|usa|estados unidos|united|europa|europe|alemania|francia|india|israel/.test(p)) return 'EN';
  return 'ES';
}

function _leadDePipeline(leadId) {
  const vals = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CRM.SH.PIPELINE).getDataRange().getValues();
  const HP = {};
  vals[0].forEach((h, i) => HP[h] = i);
  const r = vals.find((f, i) => i > 0 && String(f[0]) === String(leadId));
  if (!r) return null;
  return { fila: vals.indexOf(r) + 1, nombre: r[HP['Nombre']], empresa: r[HP['Empresa']],
           email: r[HP['Email']], pais: r[HP['País']], etapa: r[HP['Etapa']] };
}

// ══════════ Fase 2：參訪處理（確認/取消/已完成） ══════════
// Sheet 選單執行：掃 Visitas 表
//   Estado=agendada  → 建 Calendar 事件 + 寄三語確認信（附地圖）→ Estado=confirmada
//   Estado=cancelada 且有事件ID → 刪 Calendar 事件
//   Estado=realizada → Pipeline 階段推進到「Visita realizada」
function procesarVisitas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CRM.SH.VIS);
  const vals = sh.getDataRange().getValues();
  const HV = {};
  vals[0].forEach((h, i) => HV[h] = i);
  let confirmadas = 0, canceladas = 0;

  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    const estado = String(r[HV['Estado']] || '').toLowerCase();
    const leadId = String(r[HV['LeadID']] || '');
    const lead = _leadDePipeline(leadId);

    if (estado === 'agendada') {
      if (!lead) continue;
      const fecha = String(r[HV['Fecha']]).slice(0, 10);
      const hora = String(r[HV['Hora']] || '10:00');
      let idioma = String(r[HV['Idioma']] || '').toUpperCase();
      if (!idioma) {
        idioma = _idiomaPorPais(lead.pais);
        sh.getRange(i + 1, HV['Idioma'] + 1).setValue(idioma);
      }

      // Calendar 事件（90 分鐘）
      let eventoId = '';
      try {
        const [Y, M, D] = fecha.split('-').map(Number);
        const [h, m] = hora.split(':').map(Number);
        const ini = new Date(Y, M - 1, D, h, m || 0);
        const fin = new Date(ini.getTime() + 90 * 60000);
        const ev = CalendarApp.getDefaultCalendar().createEvent(
          'Visita PTITP: ' + (lead.empresa || lead.nombre),
          ini, fin,
          { description: 'Lead: ' + leadId + '\nVisitantes: ' + (r[HV['Visitantes']] || '') +
                         '\nRecibe: ' + (r[HV['Recepción']] || '') });
        eventoId = ev.getId();
        sh.getRange(i + 1, HV['CalendarEventId'] + 1).setValue(eventoId);
      } catch (e) { /* Calendar 失敗不擋信件 */ }

      // 三語確認信
      if (lead.email) _enviarEmailVisita('confirmacion', idioma, lead, fecha, hora, r[HV['Recepción']], true);

      sh.getRange(i + 1, HV['Estado'] + 1).setValue('confirmada');
      if (lead.etapa === 'Nuevo' || lead.etapa === 'Contactado')
        ss.getSheetByName(CRM.SH.PIPELINE)
          .getRange(lead.fila, H_PIPELINE.indexOf('Etapa') + 1).setValue('Visita agendada');
      confirmadas++;
    }

    if (estado === 'cancelada' && r[HV['CalendarEventId']]) {
      try {
        const ev = CalendarApp.getDefaultCalendar().getEventById(String(r[HV['CalendarEventId']]));
        if (ev) ev.deleteEvent();
      } catch (e) {}
      sh.getRange(i + 1, HV['CalendarEventId'] + 1).setValue('');
      canceladas++;
    }

    if (estado === 'realizada' && lead &&
        ['Nuevo', 'Contactado', 'Visita agendada'].indexOf(lead.etapa) !== -1) {
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.PIPELINE)
        .getRange(lead.fila, H_PIPELINE.indexOf('Etapa') + 1).setValue('Visita realizada');
    }
  }
  Logger.log(`✅ 參訪處理完成：確認 ${confirmadas}、取消 ${canceladas}`);
  return { confirmadas, canceladas };
}

// 每日 16:00：明天的已確認參訪 → 寄提醒信（去重）
function recordatoriosVisitas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CRM.SH.VIS);
  if (!sh || sh.getLastRow() < 2) return 0;
  const vals = sh.getDataRange().getValues();
  const HV = {};
  vals[0].forEach((h, i) => HV[h] = i);
  const manana = Utilities.formatDate(new Date(Date.now() + 86400000), CRM.ZONA, 'yyyy-MM-dd');
  let enviados = 0;

  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (String(r[HV['Estado']]).toLowerCase() !== 'confirmada') continue;
    if (String(r[HV['Fecha']]).slice(0, 10) !== manana) continue;
    if (String(r[HV['Recordatorio enviado']] || '')) continue;

    const lead = _leadDePipeline(String(r[HV['LeadID']]));
    if (!lead || !lead.email) continue;
    const idioma = String(r[HV['Idioma']] || 'ES').toUpperCase();
    _enviarEmailVisita('recordatorio', idioma, lead,
      String(r[HV['Fecha']]).slice(0, 10), String(r[HV['Hora']] || ''), r[HV['Recepción']], false);
    sh.getRange(i + 1, HV['Recordatorio enviado'] + 1).setValue('sí');
    enviados++;
  }
  Logger.log('✅ 提醒信寄出 ' + enviados + ' 封');
  return enviados;
}

// 組信 + 附件（衛星圖 & 平面圖從 app 網址抓，抓不到就略過附件照樣寄）
function _enviarEmailVisita(clave, idioma, lead, fecha, hora, recepcion, conAdjuntos) {
  const pl = _plantilla(clave, idioma);
  if (!pl) return;
  const m = { nombre: lead.nombre, empresa: lead.empresa, fecha: fecha, hora: hora,
              recepcion: recepcion || 'Equipo PTITP',
              direccion: _cfgCRM('Dirección del parque'),
              maps: _cfgCRM('Link Google Maps') || '(consulte con su anfitrión)',
              brochure: _cfgCRM('Link brochure') };
  const adjuntos = [];
  if (conAdjuntos) {
    const base = _cfgCRM('URL app');
    if (base) {
      ['mapa_satelital.jpg', 'plano_loteamiento.pdf'].forEach(f => {
        try {
          const resp = UrlFetchApp.fetch(base + f, { muteHttpExceptions: true });
          if (resp.getResponseCode() === 200) adjuntos.push(resp.getBlob().setName(f));
        } catch (e) {}
      });
    }
  }
  const cuerpoTxt = _rellenar(pl.cuerpo, m);
  const tituloMail = clave === 'recordatorio'
    ? { ES: 'Recordatorio de visita', EN: 'Visit reminder', PT: 'Lembrete de visita' }[idioma] || 'Recordatorio de visita'
    : { ES: 'Visita confirmada', EN: 'Visit confirmed', PT: 'Visita confirmada' }[idioma] || 'Visita confirmada';
  const opciones = {
    to: lead.email,
    subject: _rellenar(pl.asunto, m),
    body: cuerpoTxt, // 純文字 fallback
    htmlBody: _envolturaHtml(tituloMail, 'PTITP · ' + fecha + (hora ? ' · ' + hora : ''), _textoAHtml(cuerpoTxt)),
  };
  if (adjuntos.length) opciones.attachments = adjuntos;
  const cc = _validarEmailsCRM(_cfgCRM('Email copia visitas'));
  if (cc) opciones.cc = cc;
  MailApp.sendEmail(opciones);
}

// ══════════ Fase 3：地籍與租用種子資料（v4 — 三源核對版） ══════════
// 資料源交叉核對：①官方可出租清單 20251024 V2 ②土地使用現況表 20250421（會計口徑）③平面圖 CAD PDF。
// v4 重點：XVI（21.447,25）拆解為四個組成 = MB已租 2.700 + 技術團區 4.178 + MB保留塊 6.012 + 可租餘地 8.557,25（加總分毫不差）；
//   原獨立列的 MB-B/BLK-8558 併入 XVI（v3 有 14.570 m² 重複計算）；MB 第二保留塊更正 6.912→6.012；
//   XVII = 願景館+保留地 13.508,1 + 小辦公室 243,9；蓄洪池 4.200。
// 官方參考口徑：現況表(4月) 可租 263.036,25 / 空地 188.836,4 (58塊)；清單(10月) 空地 195.688,40。
// 已知待釐清（Notas 標 verificar）：TELECEL 340 vs 95；XV 15.449(清單) vs 15.756(現況表)；
//   蓄洪池 4.200 與 Manzana IV 面積相同但清單標 IV 可租。
function _sembrarLotes(ss) {
  const shL = ss.getSheetByName(CRM.SH.LOTES);
  if (shL && shL.getLastRow() <= 1) {
    const pad = n => (n < 10 ? '0' : '') + n;
    const fila = (id, blk, tipo, m2, nota, e1, e2, e3, e4) =>
      shL.appendRow([id, blk, tipo, m2, e1 || '', e2 || '', e3 || '', e4 || '', nota || '', '', '',
        /verificar/i.test(nota || '') ? '' : 'sí']); // 備註含 verificar 者 = 待確認

    // 街廓 I–IV：整塊單一地塊
    fila('I', 'I', 'industrial', 3480, 'manzana de lote único');
    fila('II', 'II', 'industrial', 6360, 'manzana de lote único');
    fila('III', 'III', 'industrial', 6360, 'manzana de lote único');
    fila('IV', 'IV', 'industrial', 4200, 'lista oficial: disponible; 現況表 lista 蓄洪池 4.200 con igual superficie — verificar');

    // 街廓內地塊面積模式（官方清單逐塊）
    const P6a  = [5460, 2800, 2800, 2800, 2800, 5460];             // V, XII
    const P12  = [4134, 4134, 2120, 2120, 2120, 2120, 2120, 2120, 2120, 2120, 4134, 4134]; // VI, VII, X, XI
    const P6b  = [4524, 2320, 2320, 2320, 2320, 4524];             // VIII, IX
    const patrones = { V: P6a, VI: P12, VII: P12, VIII: P6b, IX: P6b, X: P12, XI: P12, XII: P6a };
    Object.keys(patrones).forEach(blk => {
      patrones[blk].forEach((m, i) => fila(blk + '-' + pad(i + 1), blk, 'industrial', m, ''));
    });

    // 大型/特殊地塊
    fila('XIII', 'XIII', 'infraestructura', 10920, 'planta de tratamiento de aguas y reserva de potabilización', 'img:78%,6%', 'img:87%,6%', 'img:87%,16%', 'img:78%,16%');
    fila('XIV', 'XIV', 'área verde', 15755.25, 'GREEN AREA (現況表: 15.756); incluye restaurante (400) y centro de capacitación (2.300)');
    fila('XV', 'XV', 'industrial', 15449, 'MANZANA PREVISTA PARA MASTERBUS (現況表 indica 15.756 — verificar)');
    // XVI 拆解為四個組成（合計 21.447,25 分毫不差）
    fila('XVI-A', 'XVI', 'industrial', 2700, 'área arrendada por Master Bus');
    fila('XVI-B', 'XVI', 'industrial', 4178, 'ÁREA MISIÓN TÉCNICA (incluye zona dormitorio; 現況表: 宿舍生活區 4.038 — verificar)');
    fila('XVI-C', 'XVI', 'industrial', 6012, '2º bloque reservado Master Bus (junto a TAIPEI; plano rotula 6.012)', 'img:85%,60%', 'img:92%,60%', 'img:92%,70%', 'img:85%,70%');
    fila('XVI-D', 'XVI', 'industrial', 8557.25, 'remanente disponible de XVI (plano rotula 8.558,25)', 'img:85%,71%', 'img:92%,71%', 'img:92%,80%', 'img:85%,80%');
    fila('XVII', 'XVII', 'administrativo PSC', 13752, 'PTITP ADM. = 願景館 y reserva 13.508,1 + oficina 243,9');
    fila('TELECEL-01', 'E', 'industrial', 340, 'área TELECEL (現況表 2025-04 implica 95 m² — verificar)');
    fila('INFRA-RET', 'NO', 'reserva', 4200, '蓄洪池 / retención pluvial (現況表)', 'img:2%,6%', 'img:8%,6%', 'img:8%,16%', 'img:2%,16%');
    fila('EDIF-ADM', 'E', 'administrativo PSC', 280, 'ADMINISTRATION CENTER (舊行政大樓)', 'img:69%,22%', 'img:76%,22%', 'img:76%,30%', 'img:69%,30%');
    fila('EDIF-OFI', 'E', 'administrativo PSC', 243.9, 'oficina pequeña (小辦公室 243,90)');
    fila('EDIF-GUARD', 'E', 'administrativo PSC', 182.1, 'caseta de guardia (守衛室)');
    fila('EDIF-REST', 'XIV', 'administrativo PSC', 400, 'restaurante (dentro de XIV)');
    fila('EDIF-CAP', 'XIV', 'administrativo PSC', 2300, 'centro de capacitación e incubación (dentro de XIV)');
  }

  const shO = ss.getSheetByName(CRM.SH.OCUP);
  if (shO && shO.getLastRow() <= 1) {
    const xi = [];
    for (let i = 1; i <= 12; i++) xi.push('XI-' + (i < 10 ? '0' : '') + i);
    const O = [
      ['O-001', 'TELECEL', '', 'alquilado', 'TELECEL-01', 340, '', '', '', '', '', '', 'superficie a verificar (340 vs 95)'],
      ['O-002', 'Gauss (高斯)', '', 'alquilado', 'XII-05(parcial)', 1618.85, 'img:56%,4%', 'img:61%,4%', 'img:61%,15%', 'img:56%,15%', '', '', 'lote 2.800 m²; libre restante 1.181,15 m² (activación 活化案)'],
      ['O-003', 'K y K', '', 'alquilado', 'VII-12', 4134, 'img:29%,51%', 'img:36%,51%', 'img:36%,62%', 'img:29%,62%', '', '', 'arrendatario original'],
      ['O-004', 'POLOS', '', 'alquilado', 'X-02', 4134, 'img:39%,51%', 'img:46%,51%', 'img:46%,62%', 'img:39%,62%', '', '', 'arrendatario original'],
      ['O-005', 'Maruri', '', 'alquilado', 'X-08', 2120, 'img:53%,51%', 'img:57%,51%', 'img:57%,61%', 'img:53%,61%', '', '', 'arrendatario original'],
      ['O-006', 'Cintas', '', 'alquilado', 'VII-11, IX-01', 8658, '', '', '', '', '', '', 'dos naves: VII-11 (4.134) + IX-01 (4.524); edificación 2.067 m²'],
      ['O-007', 'ACELON (聚隆纖維)', '', 'reservado', xi.join(', '), 33496, 'img:40%,25%', 'img:68%,25%', 'img:68%,48%', 'img:40%,48%', '', '', 'manzana XI completa (12 lotes); reserva 活化案'],
      ['O-008', 'Master Bus (成運)', '', 'alquilado', 'XVI-A', 2700, '', '', '', '', '', '', 'área arrendada (activación 活化案)'],
      ['O-009', 'Master Bus (成運)', '', 'reservado', 'XV, XVI-C', 21461, '', '', '', '', '', '', 'XV (15.449) + bloque XVI-C (6.012); 現況表 indica 21.768 con XV=15.756 — verificar'],
      ['O-010', 'Misión Técnica de Taiwán', '', 'reservado', 'XVI-B', 4178, '', '', '', '', '', '', 'ÁREA MISIÓN TÉCNICA (incluye dormitorio)'],
    ];
    O.forEach(r => shO.appendRow(r.concat([/verificar/i.test(r[12] || '') ? '' : 'sí'])));
  }
}

// ══════════ Fase 3：推導狀態引擎 ══════════
// 掃 Ocupaciones 的「Lotes involucrados」，回寫每個 Lote 的商業狀態：
//   ocupado（整塊被 alquilado）＞ reservado ＞ en negociación ＞ parcial ＞ disponible
//   非工業用途（verde/infra/admin/reserva）顯示 «—»
function actualizarLotes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shL = ss.getSheetByName(CRM.SH.LOTES);
  const shO = ss.getSheetByName(CRM.SH.OCUP);
  const lv = shL.getDataRange().getValues();
  const ov = shO.getDataRange().getValues();
  const HL = {}; lv[0].forEach((h, i) => HL[h] = i);
  const HO = {}; ov[0].forEach((h, i) => HO[h] = i);

  // lote → [{tipo, parcial}]
  const refs = {};
  ov.slice(1).forEach(r => {
    const tipo = String(r[HO['Tipo']] || '').toLowerCase();
    String(r[HO['Lotes involucrados']] || '').split(',').forEach(tok => {
      tok = tok.trim();
      if (!tok) return;
      const parcial = /\(.*parcial.*\)/i.test(tok);
      const id = tok.replace(/\(.*?\)/g, '').trim();
      if (!refs[id]) refs[id] = [];
      refs[id].push({ tipo, parcial });
    });
  });

  const rango = (fila, col, val) => shL.getRange(fila, col + 1).setValue(val);

  for (let i = 1; i < lv.length; i++) {
    const id = String(lv[i][HL['LoteID']]);
    const uso = String(lv[i][HL['Tipo de uso']] || '').toLowerCase();
    const m2 = Number(lv[i][HL['m² catastral']]) || 0;
    let estado = 'disponible', m2ocu = '';

    if (uso !== 'industrial') {
      estado = '—';
    } else if (refs[id]) {
      const rr = refs[id];
      const full = t => rr.some(x => x.tipo.indexOf(t) === 0 && !x.parcial);
      const any = t => rr.some(x => x.tipo.indexOf(t) === 0);
      if (full('alquilado')) { estado = 'ocupado'; m2ocu = m2 || ''; }
      else if (full('reservado')) { estado = 'reservado'; m2ocu = m2 || ''; }
      else if (full('en negociación') || full('en negociacion')) estado = 'en negociación';
      else if (any('alquilado') || any('reservado')) estado = 'parcial';
      else estado = 'en negociación';
    }
    if (String(lv[i][HL['Estado (derivado)']]) !== estado) rango(i + 1, HL['Estado (derivado)'], estado);
    if (String(lv[i][HL['m² ocupados (derivado)']]) !== String(m2ocu)) rango(i + 1, HL['m² ocupados (derivado)'], m2ocu);
  }
  Logger.log('✅ 地塊狀態已重算');
}

// ══════════ Fase 3：雙口徑可用率 ══════════
// 地籍口徑：工業地籍 m² 總量 vs 整塊被佔的 m²（parcial 不計入，於報告註明）
// 合約口徑：Ocupaciones 表「m² arrendados」依類型加總（跨區租用下這才是真實簽約量）
function resumenDisponibilidad() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lv = ss.getSheetByName(CRM.SH.LOTES).getDataRange().getValues();
  const ov = ss.getSheetByName(CRM.SH.OCUP).getDataRange().getValues();
  const HL = {}; lv[0].forEach((h, i) => HL[h] = i);
  const HO = {}; ov[0].forEach((h, i) => HO[h] = i);

  let catTotal = 0, catOcupado = 0, lotesParciales = 0;
  const sinVerificar = { lotes: 0, ocupaciones: 0, m2Lotes: 0 };
  lv.slice(1).forEach(r => {
    if (!String(r[HL['LoteID']] || '')) return;
    const pendiente = HL['Verificado'] != null && String(r[HL['Verificado']]).toLowerCase() !== 'sí';
    if (pendiente) sinVerificar.lotes++;
    if (String(r[HL['Tipo de uso']]).toLowerCase() !== 'industrial') return;
    const m2 = Number(r[HL['m² catastral']]) || 0;
    catTotal += m2;
    if (pendiente) sinVerificar.m2Lotes += m2;
    const est = String(r[HL['Estado (derivado)']]);
    if (est === 'ocupado' || est === 'reservado') catOcupado += m2;
    if (est === 'parcial') lotesParciales++;
  });
  ov.slice(1).forEach(r => {
    if (!String(r[HO['OcupID']] || '')) return;
    if (HO['Verificado'] != null && String(r[HO['Verificado']]).toLowerCase() !== 'sí') sinVerificar.ocupaciones++;
  });

  const contrato = { alquilado: 0, reservado: 0, negociacion: 0 };
  ov.slice(1).forEach(r => {
    const m2 = Number(r[HO['m² arrendados']]) || 0;
    const t = String(r[HO['Tipo']] || '').toLowerCase();
    if (t.indexOf('alquilado') === 0) contrato.alquilado += m2;
    else if (t.indexOf('reservado') === 0) contrato.reservado += m2;
    else contrato.negociacion += m2;
  });

  return { catTotal, catOcupado, catDisponible: catTotal - catOcupado, lotesParciales, contrato, sinVerificar };
}

// ══════════ Fase 3：每週管線報告（週一 8:30，PDF 附件） ══════════
function reporteSemanal() {
  sincronizarLeads();
  actualizarPipeline();
  actualizarLotes();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pv = ss.getSheetByName(CRM.SH.PIPELINE).getDataRange().getValues();
  const HP = {}; pv[0].forEach((h, i) => HP[h] = i);
  const av = ss.getSheetByName(CRM.SH.ACT).getDataRange().getValues();
  const vv = ss.getSheetByName(CRM.SH.VIS).getDataRange().getValues();

  const hoy = new Date();
  const hace7 = Utilities.formatDate(new Date(hoy.getTime() - 7 * 86400000), CRM.ZONA, 'yyyy-MM-dd');
  const en7 = Utilities.formatDate(new Date(hoy.getTime() + 7 * 86400000), CRM.ZONA, 'yyyy-MM-dd');
  const hoyStr = Utilities.formatDate(hoy, CRM.ZONA, 'yyyy-MM-dd');

  // 漏斗
  const funnel = {};
  CRM.ETAPAS.forEach(e => funnel[e] = 0);
  pv.slice(1).forEach(r => { const e = String(r[HP['Etapa']] || 'Nuevo'); funnel[e] = (funnel[e] || 0) + 1; });

  // 加權 m² 管線（洽談中階段：superficie × prob%）
  let m2Ponderado = 0, negociaciones = [];
  pv.slice(1).forEach(r => {
    const et = String(r[HP['Etapa']]);
    if (['En negociación', 'Propuesta enviada', 'Visita realizada'].indexOf(et) === -1) return;
    const sup = Number(r[HP['Superficie (m²)']]) || 0;
    const prob = (Number(r[HP['Probabilidad %']]) || 0) / 100;
    m2Ponderado += sup * prob;
    if (sup) negociaciones.push({ empresa: r[HP['Empresa']] || r[HP['Nombre']], etapa: et, sup, prob: prob * 100, lote: r[HP['Lote candidato']] || '—' });
  });
  negociaciones.sort((a, b) => b.sup * b.prob - a.sup * a.prob);

  const actsSemana = av.slice(1).filter(r => String(r[0]).slice(0, 10) >= hace7).length;
  const visReal = vv.slice(1).filter(r => String(r[7]).toLowerCase() === 'realizada' && String(r[2]).slice(0, 10) >= hace7).length;
  const visProx = vv.slice(1).filter(r => {
    const f = String(r[2]).slice(0, 10);
    return f >= hoyStr && f <= en7 && !/cancelada/i.test(String(r[7]));
  }).length;

  const disp = resumenDisponibilidad();
  const fmt = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  const html =
`<html><head><meta charset="utf-8"><style>body{font-family:Helvetica,Arial;color:#152730;margin:24px;font-size:10.5px}table{border-collapse:collapse}</style></head><body>
<table width="100%"><tr><td style="background:#14588F;padding:13px 16px">
<div style="font-size:15px;font-weight:bold;color:#fff">PTITP &mdash; Reporte Semanal de Pipeline</div>
<div style="font-size:9.5px;color:#D9E8F5;margin-top:3px">Semana al ${hoyStr} &middot; Sistema de Seguimiento PTITP</div>
</td><td width="6" style="background:#009C81"></td></tr></table>

<div style="margin:14px 0 6px;border-left:5px solid #009C81;padding-left:8px;font-weight:bold;color:#14588F;text-transform:uppercase;letter-spacing:1.5px;font-size:11px">Embudo del pipeline</div>
<table width="100%" style="font-size:10px">${CRM.ETAPAS.map(e =>
  `<tr><td style="padding:3px 6px;border-bottom:1px solid #DCE7E3">${e}</td><td align="right" style="padding:3px 6px;border-bottom:1px solid #DCE7E3;font-weight:bold;color:#14588F">${funnel[e] || 0}</td></tr>`).join('')}
</table>

<div style="margin:14px 0 6px;border-left:5px solid #009C81;padding-left:8px;font-weight:bold;color:#14588F;text-transform:uppercase;letter-spacing:1.5px;font-size:11px">Actividad de la semana</div>
<table width="100%"><tr>
<td width="33%" style="border:1px solid #DCE7E3;padding:9px;text-align:center"><div style="font-size:20px;font-weight:bold;color:#14588F">${actsSemana}</div><div style="font-size:8.5px;color:#5E7079">CONTACTOS REGISTRADOS</div></td>
<td width="33%" style="border:1px solid #DCE7E3;padding:9px;text-align:center"><div style="font-size:20px;font-weight:bold;color:#009C81">${visReal}</div><div style="font-size:8.5px;color:#5E7079">VISITAS REALIZADAS</div></td>
<td width="33%" style="border:1px solid #DCE7E3;padding:9px;text-align:center"><div style="font-size:20px;font-weight:bold;color:#D99A2B">${visProx}</div><div style="font-size:8.5px;color:#5E7079">VISITAS PR&Oacute;XIMOS 7 D&Iacute;AS</div></td>
</tr></table>

<div style="margin:14px 0 6px;border-left:5px solid #009C81;padding-left:8px;font-weight:bold;color:#14588F;text-transform:uppercase;letter-spacing:1.5px;font-size:11px">Negociaciones activas (m&sup2; ponderados: ${fmt(m2Ponderado)})</div>
${negociaciones.slice(0, 12).map(n =>
  `<div style="border:1px solid #DCE7E3;border-left:5px solid #D99A2B;padding:6px 9px;margin-top:5px;font-size:9.5px"><b>${n.empresa}</b> &mdash; ${n.etapa} | ${fmt(n.sup)} m&sup2; &times; ${n.prob}% | Lote: ${n.lote}</div>`).join('') ||
  '<div style="color:#5E7079;font-size:9.5px">(sin negociaciones con superficie cargada)</div>'}

<div style="margin:14px 0 6px;border-left:5px solid #009C81;padding-left:8px;font-weight:bold;color:#14588F;text-transform:uppercase;letter-spacing:1.5px;font-size:11px">Disponibilidad de suelo industrial</div>
<table width="100%" style="font-size:10px">
<tr><td style="padding:3px 6px;border-bottom:1px solid #DCE7E3">Catastral total (industrial)</td><td align="right" style="padding:3px 6px;border-bottom:1px solid #DCE7E3;font-weight:bold">${fmt(disp.catTotal)} m&sup2;</td></tr>
<tr><td style="padding:3px 6px;border-bottom:1px solid #DCE7E3">Ocupado / reservado (lotes completos)</td><td align="right" style="padding:3px 6px;border-bottom:1px solid #DCE7E3;font-weight:bold;color:#D3452B">${fmt(disp.catOcupado)} m&sup2;</td></tr>
<tr><td style="padding:3px 6px;border-bottom:1px solid #DCE7E3">Disponible (catastral)</td><td align="right" style="padding:3px 6px;border-bottom:1px solid #DCE7E3;font-weight:bold;color:#009C81">${fmt(disp.catDisponible)} m&sup2;</td></tr>
<tr><td style="padding:3px 6px;border-bottom:1px solid #DCE7E3">Lotes con ocupaci&oacute;n parcial</td><td align="right" style="padding:3px 6px;border-bottom:1px solid #DCE7E3">${disp.lotesParciales}</td></tr>
<tr><td style="padding:3px 6px;border-bottom:1px solid #DCE7E3">Contractual: alquilado / reservado / en negociaci&oacute;n</td><td align="right" style="padding:3px 6px;border-bottom:1px solid #DCE7E3">${fmt(disp.contrato.alquilado)} / ${fmt(disp.contrato.reservado)} / ${fmt(disp.contrato.negociacion)} m&sup2;</td></tr>
</table>
<div style="font-size:8px;color:#5E7079;margin-top:4px">Nota: la ocupaci&oacute;n parcial no descuenta m&sup2; catastrales; el dato contractual refleja los m&sup2; efectivamente comprometidos (permite arriendos que cruzan lotes).</div>
${(disp.sinVerificar && (disp.sinVerificar.lotes + disp.sinVerificar.ocupaciones) > 0) ?
  '<div style="margin-top:6px;background:#FFF6E5;border:1px solid #D99A2B;padding:6px 9px;font-size:9px;color:#8a6410"><b>&#9888; DATOS PROVISORIOS:</b> ' +
  disp.sinVerificar.lotes + ' lotes y ' + disp.sinVerificar.ocupaciones + ' ocupaciones pendientes de verificaci&oacute;n (' +
  fmt(disp.sinVerificar.m2Lotes) + ' m&sup2; catastrales involucrados). Las cifras de este bloque pueden variar.</div>' : ''}

<div style="margin-top:18px;border-top:1px solid #DCE7E3;padding-top:6px;font-size:8px;color:#5E7079">Generado autom&aacute;ticamente &mdash; Sistema de Seguimiento PTITP</div>
</body></html>`;

  const pdf = Utilities.newBlob(html, 'text/html', 'reporte.html')
    .getAs('application/pdf').setName('PTITP_Pipeline_Semanal_' + hoyStr + '.pdf');

  const dest = _validarEmailsCRM(_cfgCRM('Emails reporte semanal')) ||
               _validarEmailsCRM(_cfgCRM('Emails resumen diario'));
  if (dest) {
    MailApp.sendEmail({
      to: dest,
      subject: `[PTITP CRM] Pipeline semanal ${hoyStr} — ${fmt(m2Ponderado)} m² ponderados, ${visProx} visitas próximas`,
      body: 'Adjunto el reporte semanal de pipeline del PTITP.\n\n— Sistema de Seguimiento PTITP', // 純文字 fallback
      htmlBody: html,
      attachments: [pdf],
    });
  }
  Logger.log('✅ 週報產生完成');
  return html;
}

// ══════════ Email HTML 工具 ══════════
function _escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
// 品牌化信件外框（青綠頁首帶 + 內容 + 頁尾）
function _envolturaHtml(titulo, subtitulo, contenido) {
  return '<html><body style="margin:0;padding:0;background:#F2F6F5">' +
    '<div style="max-width:640px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:#152730">' +
    '<table width="100%" style="border-collapse:collapse"><tr>' +
    '<td style="background:#009C81;padding:14px 18px">' +
    '<div style="font-size:16px;font-weight:bold;color:#ffffff">' + titulo + '</div>' +
    (subtitulo ? '<div style="font-size:11px;color:#DFF3EE;margin-top:3px">' + subtitulo + '</div>' : '') +
    '</td><td width="6" style="background:#14588F"></td></tr></table>' +
    '<div style="background:#ffffff;padding:16px 18px;border:1px solid #DCE7E3;border-top:0">' + contenido + '</div>' +
    '<div style="padding:10px 18px;font-size:10px;color:#5E7079">Sistema PTITP &mdash; Parque Tecnol&oacute;gico Inteligente Taiw&aacute;n-Paraguay</div>' +
    '</div></body></html>';
}
// 純文字模板 → HTML（跳脫、換行、自動連結）
function _textoAHtml(txt) {
  return _escHtml(txt)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#14588F">$1</a>')
    .replace(/\n/g, '<br>');
}
// 任務信的清單區塊
function _seccionTareasHtml(titulo, color, items) {
  return '<div style="margin:14px 0 6px;border-left:5px solid ' + color + ';padding-left:9px;' +
    'font-weight:bold;color:#14588F;font-size:13px">' + titulo + '</div>' +
    (items.length
      ? items.map(i => '<div style="border:1px solid #DCE7E3;border-left:4px solid ' + color + ';' +
          'padding:7px 10px;margin-top:5px;font-size:12px;line-height:1.45">' + i + '</div>').join('')
      : '<div style="color:#5E7079;font-size:12px">(ninguna)</div>');
}

function _validarEmailsCRM(raw) {
  return String(raw || '').split(/[,;\s]+/)
    .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).slice(0, 10).join(',');
}

// ══════════ 觸發器 ══════════
function crearTriggersCRM() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['sincronizarLeads', 'tareasDiarias', 'recordatoriosVisitas', 'reporteSemanal'].indexOf(t.getHandlerFunction()) !== -1)
      ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizarLeads').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('tareasDiarias').timeBased().everyDays(1).atHour(8).create();
  ScriptApp.newTrigger('recordatoriosVisitas').timeBased().everyDays(1).atHour(16).create();
  ScriptApp.newTrigger('reporteSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  Logger.log('✅ 觸發器已安裝：同步每10分鐘、任務信每朝8:00、參訪提醒每日16:00、週報週一8點');
}

// ══════════ Web 介面（W1：Dashboard + Pipeline 看板） ══════════
// 部署：部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」→ 存取權「只有我自己」。
// 未來開放同事：存取權改「任何擁有 Google 帳戶的使用者」並在 Config「Usuarios web」填 email 白名單。
function doGet(e) {
  if (!_usuarioWebAutorizado())
    return HtmlService.createHtmlOutput('<h3 style="font-family:sans-serif">Acceso no autorizado</h3>');
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('PTITP CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function _usuarioWebAutorizado() {
  try {
    const lista = _cfgCRM('Usuarios web');
    if (!lista) return true; // 白名單留空：交由部署層的存取權控管（「只有我」）
    const yo = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    return lista.toLowerCase().split(/[,;\s]+/).indexOf(yo) !== -1;
  } catch (err) { return false; }
}

// 一次抓齊 Dashboard + 看板資料（前端單次往返）
function webDatos() {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const pv = ss.getSheetByName(CRM.SH.PIPELINE).getDataRange().getValues();
  const HP = {}; pv[0].forEach((h, i) => HP[h] = i);
  const hoy = Utilities.formatDate(new Date(), CRM.ZONA, 'yyyy-MM-dd');
  const en7 = Utilities.formatDate(new Date(Date.now() + 7 * 86400000), CRM.ZONA, 'yyyy-MM-dd');
  const limA = Utilities.formatDate(new Date(Date.now() - CRM.DIAS_ALERTA_A * 86400000), CRM.ZONA, 'yyyy-MM-dd');

  const pipeline = pv.slice(1).filter(r => String(r[0])).map(r => ({
    leadId: String(r[HP['LeadID']]),
    nombre: String(r[HP['Nombre']] || ''), empresa: String(r[HP['Empresa']] || ''),
    pais: String(r[HP['País']] || ''), tel: String(r[HP['Teléfono']] || ''),
    email: String(r[HP['Email']] || ''), calif: String(r[HP['Calificación']] || '').charAt(0) || 'C',
    intereses: String(r[HP['Intereses']] || ''), tarjeta: String(r[HP['Tarjeta']] || ''),
    etapa: String(r[HP['Etapa']] || 'Nuevo'), resp: String(r[HP['Responsable']] || ''),
    accion: String(r[HP['Próxima acción']] || ''),
    limite: String(r[HP['Fecha límite']]).slice(0, 10),
    ultimo: String(r[HP['Último contacto']]).slice(0, 10),
    sup: String(r[HP['Superficie (m²)']] || ''), prob: String(r[HP['Probabilidad %']] || ''),
    lote: String(r[HP['Lote candidato']] || ''), notas: String(r[HP['Notas']] || ''),
  }));

  const abiertos = pipeline.filter(l => !/Ganado|Perdido/.test(l.etapa));
  const funnel = CRM.ETAPAS.map(et => ({ etapa: et, n: pipeline.filter(l => l.etapa === et).length }));
  let m2p = 0;
  abiertos.forEach(l => {
    if (['En negociación', 'Propuesta enviada', 'Visita realizada'].indexOf(l.etapa) !== -1)
      m2p += (Number(l.sup) || 0) * (Number(l.prob) || 0) / 100;
  });

  // 近 7 日參訪
  let visProx = 0;
  const shV = ss.getSheetByName(CRM.SH.VIS);
  if (shV && shV.getLastRow() > 1) {
    visProx = shV.getDataRange().getValues().slice(1).filter(r => {
      const f = String(r[2]).slice(0, 10);
      return f >= hoy && f <= en7 && !/cancelada/i.test(String(r[7]));
    }).length;
  }

  return {
    usuario: String(Session.getActiveUser().getEmail() || ''),
    hoy: hoy,
    etapas: CRM.ETAPAS,
    pipeline: pipeline,
    kpis: {
      abiertos: abiertos.length,
      vencidas: abiertos.filter(l => l.limite && l.limite < hoy).length,
      hoyVencen: abiertos.filter(l => l.limite === hoy).length,
      aFrios: abiertos.filter(l => l.calif === 'A' && (!l.ultimo || l.ultimo < limA)).length,
      visProx: visProx,
      m2Ponderado: Math.round(m2p),
    },
    funnel: funnel,
    disponibilidad: resumenDisponibilidad(),
  };
}

// 記一筆聯繫（回填 Último contacto，10 秒工作流的核心）
function webActividad(leadId, tipo, resumen) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  if (!leadId || !String(resumen || '').trim()) throw new Error('Faltan datos');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoy = Utilities.formatDate(new Date(), CRM.ZONA, 'yyyy-MM-dd');
  const yo = String(Session.getActiveUser().getEmail() || '').split('@')[0];
  ss.getSheetByName(CRM.SH.ACT).appendRow([hoy, leadId, tipo || 'otro', String(resumen).trim(), yo]);
  const lead = _leadDePipeline(leadId);
  if (lead) ss.getSheetByName(CRM.SH.PIPELINE)
    .getRange(lead.fila, H_PIPELINE.indexOf('Último contacto') + 1).setValue(hoy);
  return { ok: true, fecha: hoy };
}

// 換階段（看板拖拉 / 詳情選單共用）
function webEtapa(leadId, etapa) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  if (CRM.ETAPAS.indexOf(etapa) === -1) throw new Error('Etapa inválida');
  const lead = _leadDePipeline(leadId);
  if (!lead) throw new Error('Lead no encontrado');
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.PIPELINE)
    .getRange(lead.fila, H_PIPELINE.indexOf('Etapa') + 1).setValue(etapa);
  return { ok: true };
}

// 客戶詳情用：該 lead 的活動史（開 modal 時才抓）
function webActividadesDe(leadId) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const vals = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CRM.SH.ACT).getDataRange().getValues();
  return vals.slice(1)
    .filter(r => String(r[1]) === String(leadId))
    .map(r => ({ fecha: String(r[0]).slice(0, 10), tipo: String(r[2] || ''), resumen: String(r[3] || ''), resp: String(r[4] || '') }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

// ══════════ Web W2：資料維護（編輯客戶 / Lotes / Ocupaciones + 變更留痕） ══════════
const CAMPOS_LEAD = { // 前端欄位 → Pipeline 表頭（白名單，防寫入任意欄）
  nombre: 'Nombre', empresa: 'Empresa', pais: 'País', tel: 'Teléfono', email: 'Email',
  calif: 'Calificación', intereses: 'Intereses', resp: 'Responsable',
  accion: 'Próxima acción', limite: 'Fecha límite', sup: 'Superficie (m²)',
  prob: 'Probabilidad %', lote: 'Lote candidato', notas: 'Notas',
};

function _logCambio(entidad, id, detalle) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Cambios');
    if (!sh) {
      sh = ss.insertSheet('Cambios');
      sh.appendRow(['Fecha', 'Usuario', 'Entidad', 'ID', 'Detalle']);
      sh.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#14588F').setFontColor('#FFFFFF');
    }
    sh.appendRow([
      Utilities.formatDate(new Date(), CRM.ZONA, 'yyyy-MM-dd HH:mm'),
      String(Session.getActiveUser().getEmail() || ''), entidad, id, detalle,
    ]);
  } catch (err) { /* 留痕失敗不擋主流程 */ }
}

// 編輯客戶欄位（僅白名單欄位）
function webLeadGuardar(leadId, campos) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const lead = _leadDePipeline(leadId);
  if (!lead) throw new Error('Lead no encontrado');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.PIPELINE);
  const cambios = [];
  Object.keys(campos || {}).forEach(k => {
    if (!CAMPOS_LEAD[k]) return;
    const col = H_PIPELINE.indexOf(CAMPOS_LEAD[k]) + 1;
    if (col > 0) { sh.getRange(lead.fila, col).setValue(campos[k]); cambios.push(k); }
  });
  if (cambios.length) _logCambio('Lead', leadId, 'editó: ' + cambios.join(', '));
  return { ok: true };
}

// Lotes / Ocupaciones 全量（維護分頁用）
function webLotes() {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lv = ss.getSheetByName(CRM.SH.LOTES).getDataRange().getValues();
  const HL = {}; lv[0].forEach((h, i) => HL[h] = i);
  const ov = ss.getSheetByName(CRM.SH.OCUP).getDataRange().getValues();
  const HO = {}; ov[0].forEach((h, i) => HO[h] = i);
  return {
    lotes: lv.slice(1).filter(r => String(r[0])).map(r => ({
      id: String(r[HL['LoteID']]), block: String(r[HL['Block']] || ''),
      tipo: String(r[HL['Tipo de uso']] || ''), m2: String(r[HL['m² catastral']] || ''),
      notas: String(r[HL['Notas']] || ''), estado: String(r[HL['Estado (derivado)']] || ''),
      verificado: HL['Verificado'] != null && String(r[HL['Verificado']]).toLowerCase() === 'sí',
    })),
    ocupaciones: ov.slice(1).filter(r => String(r[0])).map(r => ({
      id: String(r[HO['OcupID']]), empresa: String(r[HO['Empresa']] || ''),
      tipo: String(r[HO['Tipo']] || ''), lotes: String(r[HO['Lotes involucrados']] || ''),
      m2: String(r[HO['m² arrendados']] || ''), inicio: String(r[HO['Fecha inicio']]).slice(0, 10),
      fin: String(r[HO['Fecha fin']]).slice(0, 10), notas: String(r[HO['Notas']] || ''),
      verificado: HO['Verificado'] != null && String(r[HO['Verificado']]).toLowerCase() === 'sí',
    })),
    disponibilidad: resumenDisponibilidad(),
  };
}

function _filaPorId(sh, id) {
  const vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) if (String(vals[i][0]) === String(id)) return i + 1;
  return -1;
}

// Lote：更新 / 新增 / 刪除（被 Ocupaciones 引用者拒刪）
function webLoteGuardar(loteId, campos) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.LOTES);
  const HL = {}; sh.getDataRange().getValues()[0].forEach((h, i) => HL[h] = i);
  const fila = _filaPorId(sh, loteId);
  const mapa = { block: 'Block', tipo: 'Tipo de uso', m2: 'm² catastral', notas: 'Notas', verificado: 'Verificado' };
  if (fila === -1) { // 新增（預設待確認）
    if (!loteId || !String(loteId).trim()) throw new Error('Falta LoteID');
    const nueva = Array(sh.getDataRange().getValues()[0].length).fill('');
    nueva[HL['LoteID']] = String(loteId).trim();
    nueva[HL['Block']] = campos.block || '';
    nueva[HL['Tipo de uso']] = campos.tipo || 'industrial';
    nueva[HL['m² catastral']] = campos.m2 || '';
    nueva[HL['Notas']] = campos.notas || '';
    if (HL['Verificado'] != null) nueva[HL['Verificado']] = campos.verificado === 'sí' ? 'sí' : '';
    sh.appendRow(nueva);
    _logCambio('Lote', loteId, 'creado');
  } else {
    Object.keys(campos || {}).forEach(k => {
      if (!mapa[k] || HL[mapa[k]] == null) return;
      sh.getRange(fila, HL[mapa[k]] + 1).setValue(k === 'verificado' ? (campos[k] === 'sí' ? 'sí' : '') : campos[k]);
    });
    _logCambio('Lote', loteId, 'editado');
  }
  actualizarLotes();
  return { ok: true };
}

function webLoteBorrar(loteId) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // 保護：被任何 Ocupación 引用就拒刪
  const ov = ss.getSheetByName(CRM.SH.OCUP).getDataRange().getValues();
  const HO = {}; ov[0].forEach((h, i) => HO[h] = i);
  const usado = ov.slice(1).some(r =>
    String(r[HO['Lotes involucrados']] || '').split(',')
      .some(tok => tok.replace(/\(.*?\)/g, '').trim() === String(loteId)));
  if (usado) throw new Error('No se puede borrar: el lote está referenciado en Ocupaciones');
  const sh = ss.getSheetByName(CRM.SH.LOTES);
  const fila = _filaPorId(sh, loteId);
  if (fila === -1) throw new Error('Lote no encontrado');
  sh.deleteRow(fila);
  _logCambio('Lote', loteId, 'borrado');
  return { ok: true };
}

// Ocupación：更新 / 新增 / 刪除（任何變動後重算推導狀態）
function webOcupGuardar(ocupId, campos) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.OCUP);
  const HO = {}; sh.getDataRange().getValues()[0].forEach((h, i) => HO[h] = i);
  const mapa = { empresa: 'Empresa', tipo: 'Tipo', lotes: 'Lotes involucrados',
                 m2: 'm² arrendados', inicio: 'Fecha inicio', fin: 'Fecha fin', notas: 'Notas', verificado: 'Verificado' };
  let fila = ocupId ? _filaPorId(sh, ocupId) : -1;
  if (fila === -1) { // 新增：自動編號，預設待確認
    const n = sh.getLastRow(); // 含表頭
    ocupId = 'O-' + ('000' + n).slice(-3);
    const nueva = Array(sh.getDataRange().getValues()[0].length).fill('');
    nueva[HO['OcupID']] = ocupId;
    nueva[HO['Empresa']] = campos.empresa || '';
    nueva[HO['Tipo']] = campos.tipo || 'en negociación';
    nueva[HO['Lotes involucrados']] = campos.lotes || '';
    nueva[HO['m² arrendados']] = campos.m2 || '';
    nueva[HO['Fecha inicio']] = campos.inicio || '';
    nueva[HO['Fecha fin']] = campos.fin || '';
    nueva[HO['Notas']] = campos.notas || '';
    if (HO['Verificado'] != null) nueva[HO['Verificado']] = campos.verificado === 'sí' ? 'sí' : '';
    sh.appendRow(nueva);
    _logCambio('Ocupación', ocupId, 'creada: ' + (campos.empresa || ''));
  } else {
    Object.keys(campos || {}).forEach(k => {
      if (!mapa[k] || HO[mapa[k]] == null) return;
      sh.getRange(fila, HO[mapa[k]] + 1).setValue(k === 'verificado' ? (campos[k] === 'sí' ? 'sí' : '') : campos[k]);
    });
    _logCambio('Ocupación', ocupId, 'editada');
  }
  actualizarLotes();
  return { ok: true, id: ocupId };
}

function webOcupBorrar(ocupId) {
  if (!_usuarioWebAutorizado()) throw new Error('No autorizado');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CRM.SH.OCUP);
  const fila = _filaPorId(sh, ocupId);
  if (fila === -1) throw new Error('Ocupación no encontrada');
  sh.deleteRow(fila);
  _logCambio('Ocupación', ocupId, 'borrada');
  actualizarLotes();
  return { ok: true };
}

// 一次性輔助：Verificado 欄空白且備註不含 verificar 者標記為已確認（既有資料遷移用）
function marcarVerificadosIniciales() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let marcados = 0;
  [[CRM.SH.LOTES, 'Notas'], [CRM.SH.OCUP, 'Notas']].forEach(par => {
    const sh = ss.getSheetByName(par[0]);
    if (!sh || sh.getLastRow() < 2) return;
    const vals = sh.getDataRange().getValues();
    const H = {}; vals[0].forEach((h, i) => H[h] = i);
    if (H['Verificado'] == null) return;
    for (let i = 1; i < vals.length; i++) {
      if (!String(vals[i][0] || '')) continue;
      if (String(vals[i][H['Verificado']] || '')) continue;
      if (!/verificar/i.test(String(vals[i][H[par[1]]] || ''))) {
        sh.getRange(i + 1, H['Verificado'] + 1).setValue('sí');
        marcados++;
      }
    }
  });
  Logger.log('✅ 標記 ' + marcados + ' 筆為已確認（備註含 verificar 者維持待確認）');
  return marcados;
}

// ══════════ 選單 ══════════
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏭 PTITP CRM')
    .addItem('Sincronizar leads de la expo ahora', 'sincronizarLeads')
    .addItem('Actualizar pipeline (último contacto / estados)', 'actualizarPipeline')
    .addItem('Enviar tareas de hoy', 'tareasDiarias')
    .addSeparator()
    .addItem('Procesar visitas (confirmar / cancelar)', 'procesarVisitas')
    .addItem('Enviar recordatorios de visitas de mañana', 'recordatoriosVisitas')
    .addSeparator()
    .addItem('Actualizar estados de lotes', 'actualizarLotes')
    .addItem('Marcar verificados iniciales (según notas)', 'marcarVerificadosIniciales')
    .addItem('Enviar reporte semanal de pipeline', 'reporteSemanal')
    .addSeparator()
    .addItem('Instalar automatizaciones', 'crearTriggersCRM')
    .addToUi();
}
