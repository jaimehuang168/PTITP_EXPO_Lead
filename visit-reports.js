(function (root) {
  'use strict';

  const document = root.document;
  const byId = id => document.getElementById(id);
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const safeCount = value => Number.isFinite(value) ? Math.max(0, value) : 0;
  const classes = {
    prioritario: {label:'Prioritario', className:'is-priority'},
    calificar: {label:'Por calificar', className:'is-review'},
    exploracion: {label:'En exploración', className:'is-exploring'}
  };

  function metric(label, value) {
    const item = create('div', 'visit-report-metric');
    item.append(create('dt', '', label), create('dd', '', safeCount(value)));
    return item;
  }

  function plot(serie) {
    const list = create('ul', 'visit-report-bars');
    const max = Math.max(1, ...serie.map(item => safeCount(item.cantidad)));
    for (const item of serie) {
      const row = create('li', 'visit-report-bar-row');
      const count = safeCount(item.cantidad);
      const track = create('span', 'visit-report-bar-track');
      track.setAttribute('aria-hidden', 'true');
      const fill = create('span', 'visit-report-bar-fill');
      fill.style.width = (100 * count / max) + '%';
      track.append(fill);
      row.append(create('span', 'visit-report-bar-label', item.nombre), track,
        create('span', 'visit-report-bar-value', count));
      list.append(row);
    }
    return list;
  }

  function addDetails(list, name, value) {
    if (!value) return;
    const pair = create('div');
    pair.append(create('dt', '', name), create('dd', '', value));
    list.append(pair);
  }

  function prospectCard(item) {
    const article = create('article', 'visit-report-prospect');
    const priority = classes[item.prioridad] || classes.calificar;
    article.classList.add(priority.className);
    const heading = create('div', 'visit-report-prospect-heading');
    const label = create('span', 'visit-report-priority', priority.label);
    const state = create('span', 'visit-report-state', item.estado || 'Pendiente');
    heading.append(label, state);
    article.append(heading, create('h4', '', item.empresa), create('p', 'visit-report-action', item.accion));
    if (item.responsable || item.proximoContacto) {
      const tracking = [
        item.responsable && 'Responsable: ' + item.responsable,
        item.proximoContacto && 'Próximo contacto: ' + item.proximoContacto
      ].filter(Boolean).join(' · ');
      article.append(create('p', 'visit-report-tracking', tracking));
    }
    const details = create('details', 'visit-report-details');
    details.setAttribute('data-visit-no-print', '');
    details.append(create('summary', '', 'Ver detalles del prospecto'));
    const list = create('dl', 'visit-report-details-grid');
    addDetails(list, 'Interés declarado', item.interes);
    addDetails(list, 'Superficie declarada', item.superficie);
    addDetails(list, 'Plazo', item.plazo);
    addDetails(list, 'Contacto', item.nombre);
    addDetails(list, 'Correo', item.correo);
    addDetails(list, 'Teléfono / WhatsApp', item.telefono);
    addDetails(list, 'ID de solicitud', item.id);
    details.append(list);
    article.append(details);
    return article;
  }

  function trackingUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://docs.google.com' && url.pathname.startsWith('/spreadsheets/d/')
        ? url.href : '';
    } catch {
      return '';
    }
  }

  function init(options) {
    const panel = byId('panel-visitas');
    const select = byId('rep-evento');
    const report = byId('tab-reportes');
    const content = byId('visit-report-content');
    const message = byId('visit-report-message');
    const refresh = byId('visit-report-refresh');
    const print = byId('visit-report-print');
    const link = byId('visit-report-link');
    const filtros = byId('visit-report-filters');
    const queue = byId('visit-report-queue');
    let key = null;
    let revision = 0;
    let data = null;
    let selected = 'todos';

    function context() {
      const snapshot = options.getSnapshot();
      if (!report.classList.contains('activa') || !snapshot.user?.admin || !snapshot.user.uid ||
          options.isOffline(snapshot)) return null;
      return {eventId:select.value, key:snapshot.user.uid + '|' + select.value};
    }

    function resetContent() {
      data = null;
      content.hidden = true;
      print.hidden = true;
      link.hidden = true;
      link.removeAttribute('href');
      filtros.replaceChildren();
      queue.replaceChildren();
      byId('visit-report-period').textContent = '';
      byId('visit-report-meta').textContent = '';
      byId('visit-report-disposition').textContent = '';
      byId('visit-report-summary').replaceChildren();
      byId('visit-report-demand').replaceChildren();
    }

    function renderQueue() {
      for (const button of filtros.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.priority === selected));
      }
      const items = data.prospectos.filter(item => selected === 'todos' || item.prioridad === selected);
      queue.replaceChildren();
      if (items.length) queue.append(...items.map(prospectCard));
      else queue.append(create('p', 'visit-report-empty', 'No hay prospectos en esta selección.'));
    }

    function render(result) {
      data = result;
      const {totales, demanda, prioridades, prospectos} = result;
      byId('visit-report-period').textContent = result.evento;
      byId('visit-report-summary').append(
        metric('Solicitudes de visita', totales.solicitudes), metric('Personas inscriptas', totales.personas),
        metric('Oportunidades comerciales', totales.oportunidades), metric('Con permiso y canal', totales.contactables)
      );
      byId('visit-report-demand').append(plot(demanda));
      byId('visit-report-meta').textContent = [result.ultimoRegistro && 'Última inscripción ' + result.ultimoRegistro, 'Consulta ' + result.actualizado + ' · Hora de Paraguay'].filter(Boolean).join(' / ');
      byId('visit-report-disposition').textContent = [
        totales.aprobadas + ' aprobadas', totales.espera + ' en espera',
        totales.porRevisar + ' por revisar', totales.noSeleccionadas + ' no seleccionadas'
      ].join(' · ');
      const exclusions = byId('visit-report-exclusions');
      const pendingConsent = totales.noAutorizadas + totales.sinPermiso + totales.sinCanal;
      exclusions.hidden = !pendingConsent;
      exclusions.textContent = pendingConsent
        ? 'Solicitudes fuera de la lista por falta de permiso o canal válido (' + pendingConsent + ').' : '';
      const choices = [{id:'todos',nombre:'Todos',cantidad:prospectos.length}, ...prioridades];
      for (const filter of choices) {
        const button = create('button', 'visit-report-filter', filter.nombre + ' ' + filter.cantidad);
        button.type = 'button';
        button.dataset.priority = filter.id;
        button.addEventListener('click', () => {
          selected = filter.id;
          renderQueue();
        });
        filtros.append(button);
      }
      const href = trackingUrl(result.urlSeguimiento);
      if (href) {
        link.href = href;
        link.hidden = false;
      }
      renderQueue();
      content.hidden = false;
      print.hidden = false;
      message.textContent = '';
    }

    async function load() {
      const current = context();
      if (!current?.eventId) return;
      const currentRevision = ++revision;
      resetContent();
      refresh.disabled = true;
      panel.setAttribute('aria-busy', 'true');
      message.textContent = 'Cargando visitas y prospectos…';
      try {
        const result = await options.fetchReport(current.eventId);
        if (currentRevision !== revision || context()?.key !== current.key) return;
        if (result.disponible) render(result);
        else message.textContent = 'Esta actividad no tiene un panel de visitas vinculado.';
      } catch (error) {
        if (currentRevision === revision && context()?.key === current.key) {
          resetContent();
          message.textContent = error.message || 'No se pudo cargar el panel. Volvé a intentar.';
        }
      } finally {
        if (currentRevision === revision && context()?.key === current.key) {
          refresh.disabled = false;
          panel.removeAttribute('aria-busy');
        }
      }
    }

    function sync() {
      const current = context();
      if ((current?.key ?? null) === key) return;
      key = current?.key ?? null;
      revision++;
      selected = 'todos';
      resetContent();
      panel.removeAttribute('aria-busy');
      panel.hidden = !current;
      refresh.hidden = !current?.eventId;
      refresh.disabled = false;
      message.textContent = current && !current.eventId ? 'Elegí una actividad para ver sus visitas.' : '';
      if (current?.eventId) load();
    }

    select.addEventListener('change', sync);
    refresh.addEventListener('click', load);
    print.addEventListener('click', () => {
      if (!data || context()?.key !== key) return;
      document.body.classList.add('printing-visit-report');
      root.print();
    });
    root.addEventListener('afterprint', () => document.body.classList.remove('printing-visit-report'));
    return {sync};
  }

  root.PtitpVisitReports = {init};
})(window);
