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
  'Estado (derivado)', 'm² ocupados (derivado)'];
const H_OCUP = ['OcupID', 'Empresa', 'LeadID', 'Tipo', 'Lotes involucrados', 'm² arrendados',
  'Esquina 1', 'Esquina 2', 'Esquina 3', 'Esquina 4', 'Fecha inicio', 'Fecha fin', 'Notas'];
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

  // Fase 3 遷移：舊 Lotes 表補推導欄
  const shl = ss.getSheetByName(CRM.SH.LOTES);
  if (shl && shl.getLastRow() > 0) {
    let hl = shl.getDataRange().getValues()[0];
    ['Estado (derivado)', 'm² ocupados (derivado)'].forEach(c => {
      if (hl.indexOf(c) === -1) { shl.getRange(1, hl.length + 1).setValue(c); hl = hl.concat([c]); }
    });
  }
  if (!tieneParam('Emails reporte semanal'))
    cfg.appendRow(['Emails reporte semanal', '', 'lunes 8:30; si queda vacío usa "Emails resumen diario"']);

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

  const dest = _validarEmailsCRM(_cfgCRM('Emails resumen diario'));
  if (dest) {
    MailApp.sendEmail({
      to: dest,
      subject: `[PTITP CRM] Tareas ${hoy} — ${vencidas.length} vencidas, ${paraHoy.length} hoy, ${aFrios.length} leads A fríos`,
      body: cuerpo,
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
  const opciones = { to: lead.email, subject: _rellenar(pl.asunto, m), body: _rellenar(pl.cuerpo, m) };
  if (adjuntos.length) opciones.attachments = adjuntos;
  const cc = _validarEmailsCRM(_cfgCRM('Email copia visitas'));
  if (cc) opciones.cc = cc;
  MailApp.sendEmail(opciones);
}

// ══════════ Fase 3：地籍與租用種子資料 ══════════
// 來源：園區平面圖 PDF（AutoCAD Loteamiento）+ 衛星圖標註。
// 面積為 PDF 所載；地塊編號與對應為推估，Notas 標「verificar」者請人工校正。
// 座標格式 img:x%,y% = 衛星圖（mapa_satelital.jpg）上的相對位置，供 Fase 4 疊圖；
// 取得 DWG 或任一 GPS 錨點後可批次換算 WGS84。
function _sembrarLotes(ss) {
  const shL = ss.getSheetByName(CRM.SH.LOTES);
  if (shL && shL.getLastRow() <= 1) {
    const L = [
      // 北側工業帶（台東街–台灣大道間），Block XIII–XVII
      ['XIII-05', 'XIII', 'industrial', 2320, '', '', '', '', 'numeración a verificar con CAD'],
      ['XIII-06', 'XIII', 'industrial', 4524, '', '', '', '', 'verificar'],
      ['XIII-09', 'XIII', 'industrial', 1160, '', '', '', '', 'verificar'],
      ['XIV-05', 'XIV', 'industrial', 2120, '', '', '', '', 'verificar'],
      ['XIV-06', 'XIV', 'industrial', 4134, '', '', '', '', 'verificar'],
      ['XV-05', 'XV', 'industrial', 2120, '', '', '', '', 'verificar'],
      ['XV-06', 'XV', 'industrial', 4134, '', '', '', '', 'verificar'],
      ['XVI-05', 'XVI', 'industrial', 2120, '', '', '', '', 'verificar'],
      ['XVI-06', 'XVI', 'industrial', 4134, '', '', '', '', 'verificar'],
      ['XVII-05', 'XVII', 'industrial', 2120, '', '', '', '', 'verificar'],
      ['XVII-06', 'XVII', 'industrial', 4134, '', '', '', '', 'verificar'],
      // 南側大地塊（花蓮街一帶）
      ['SUR-01', 'S', 'industrial', 15449, 'img:29%,50%', 'img:37%,50%', 'img:37%,63%', 'img:29%,63%', 'zona K y K — verificar'],
      ['SUR-02', 'S', 'industrial', 15756, 'img:39%,50%', 'img:46%,50%', 'img:46%,63%', 'img:39%,63%', 'zona POLOS — verificar'],
      ['SUR-03', 'S', 'industrial', 21477.25, 'img:52%,50%', 'img:58%,50%', 'img:58%,62%', 'img:52%,62%', 'zona Maruri — verificar'],
      ['SUR-04', 'S', 'industrial', 13752, '', '', '', '', 'verificar'],
      ['SUR-05', 'S', 'industrial', 10920, '', '', '', '', 'verificar'],
      ['SUR-06', 'S', 'industrial', 5460, '', '', '', '', 'verificar'],
      ['SUR-07', 'S', 'industrial', 8558.25, 'img:85%,71%', 'img:92%,71%', 'img:92%,80%', 'img:85%,80%', 'zona 成運/Master Bus — verificar'],
      // 服務性小地塊
      ['SRV-01', 'S', 'industrial', 306.25, '', '', '', '', 'verificar'],
      ['SRV-02', 'S', 'industrial', 1618.75, '', '', '', '', 'verificar'],
      ['SRV-03', 'S', 'industrial', 1400, '', '', '', '', 'verificar'],
      ['SRV-04', 'S', 'industrial', 1400, '', '', '', '', 'verificar'],
      ['SRV-05', 'S', 'industrial', 1618.85, '', '', '', '', 'verificar'],
      // TELECEL 租區
      ['TELECEL-01', 'E', 'industrial', 2700, '', '', '', '', 'área arrendada a TELECEL según plano'],
      // 綠地 / 公設 / 管理
      ['VERDE-01', 'E', 'área verde', '', '', '', '', '', 'lote verde recreativo (plano)'],
      ['INFRA-PTAR', 'NE', 'infraestructura', '', 'img:78%,6%', 'img:87%,6%', 'img:87%,16%', 'img:78%,16%', 'planta de tratamiento de aguas'],
      ['INFRA-RET', 'NO', 'reserva', '', 'img:2%,6%', 'img:8%,6%', 'img:8%,16%', 'img:2%,16%', '舊洪池預定地 / retención pluvial'],
      ['ADMIN-01', 'E', 'administrativo PSC', 4176, '', '', '', '', 'lote administrativo PTITP; construcción disponible 2.016 m²'],
      ['EDIF-ADM', 'E', 'administrativo PSC', '', 'img:69%,22%', 'img:76%,22%', 'img:76%,30%', 'img:69%,30%', '舊行政大樓 / centro administrativo'],
      ['EDIF-VIS', 'E', 'administrativo PSC', '', 'img:86%,33%', 'img:91%,33%', 'img:91%,42%', 'img:86%,42%', '願景館 / centro de visitantes'],
      ['EDIF-REST', 'E', 'administrativo PSC', 400, '', '', '', '', 'restaurante'],
      ['EDIF-CAP', 'E', 'administrativo PSC', 2300, '', '', '', '', 'centro de capacitación e incubación'],
      ['EDIF-DORM', 'E', 'administrativo PSC', 340, '', '', '', '', 'dormitorio; anexos 95/240/280/231 m²'],
      ['EDIF-G7', 'C', 'industrial', '', 'img:47%,26%', 'img:60%,26%', 'img:60%,46%', 'img:47%,46%', '7號廠房 / galpón 7 (dentro de reserva Julong)'],
    ];
    L.forEach(r => shL.appendRow(r.concat(['', ''])));
  }

  const shO = ss.getSheetByName(CRM.SH.OCUP);
  if (shO && shO.getLastRow() <= 1) {
    const O = [
      ['O-001', 'TELECEL', '', 'alquilado', 'TELECEL-01', 2700, '', '', '', '', '', '', 'según plano — verificar contrato'],
      ['O-002', 'Gauss (高斯)', '', 'alquilado', 'XVII-06(verificar)', '', 'img:56%,4%', 'img:61%,4%', 'img:61%,15%', 'img:56%,15%', '', '', 'galpón norte arrendado — verificar lote y m²'],
      ['O-003', 'K y K', '', 'alquilado', 'SUR-01(parcial)', '', 'img:29%,51%', 'img:36%,51%', 'img:36%,62%', 'img:29%,62%', '', '', 'seed inicial — verificar'],
      ['O-004', 'POLOS', '', 'alquilado', 'SUR-02(parcial)', '', 'img:39%,51%', 'img:46%,51%', 'img:46%,62%', 'img:39%,62%', '', '', 'seed inicial — verificar'],
      ['O-005', 'Maruri', '', 'alquilado', 'SUR-03(parcial)', '', 'img:53%,51%', 'img:57%,51%', 'img:57%,61%', 'img:53%,61%', '', '', 'seed inicial — verificar'],
      ['O-006', 'Cintas', '', 'alquilado', 'SUR-04(parcial), SUR-06(parcial)', '', '', '', '', '', '', '', 'dos naves según satélite — verificar'],
      ['O-007', 'Julong (聚隆)', '', 'reservado', 'XIV-05, XIV-06, XV-05, XV-06, EDIF-G7', '', 'img:40%,25%', 'img:68%,25%', 'img:68%,48%', 'img:40%,48%', '', '', 'reserva según satélite (incl. galpón 7) — verificar alcance'],
      ['O-008', 'Master Bus (成運)', '', 'reservado', 'SUR-07(parcial), XVI-05(verificar), XVI-06(verificar)', '', '', '', '', '', '', '', 'ensamblaje buses eléctricos; bloques reservados según plano'],
      ['O-009', 'Elon', '', 'reservado', 'XIII-05(verificar)', '', '', '', '', '', '', '', 'ELON BLOCK según plano'],
    ];
    O.forEach(r => shO.appendRow(r));
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
  lv.slice(1).forEach(r => {
    if (String(r[HL['Tipo de uso']]).toLowerCase() !== 'industrial') return;
    const m2 = Number(r[HL['m² catastral']]) || 0;
    catTotal += m2;
    const est = String(r[HL['Estado (derivado)']]);
    if (est === 'ocupado' || est === 'reservado') catOcupado += m2;
    if (est === 'parcial') lotesParciales++;
  });

  const contrato = { alquilado: 0, reservado: 0, negociacion: 0 };
  ov.slice(1).forEach(r => {
    const m2 = Number(r[HO['m² arrendados']]) || 0;
    const t = String(r[HO['Tipo']] || '').toLowerCase();
    if (t.indexOf('alquilado') === 0) contrato.alquilado += m2;
    else if (t.indexOf('reservado') === 0) contrato.reservado += m2;
    else contrato.negociacion += m2;
  });

  return { catTotal, catOcupado, catDisponible: catTotal - catOcupado, lotesParciales, contrato };
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
      body: 'Adjunto el reporte semanal de pipeline del PTITP.\n\n— Sistema de Seguimiento PTITP',
      attachments: [pdf],
    });
  }
  Logger.log('✅ 週報產生完成');
  return html;
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
    .addItem('Enviar reporte semanal de pipeline', 'reporteSemanal')
    .addSeparator()
    .addItem('Instalar automatizaciones', 'crearTriggersCRM')
    .addToUi();
}
