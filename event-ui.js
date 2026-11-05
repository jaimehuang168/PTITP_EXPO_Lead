(function(root){
  'use strict';
  const $=id=>root.document.getElementById(id);
  let options,snapshot={},catalogKey='',reportKey='',reportInitialized=false,editorId='',editorRevision=0,saving=false,wasAdmin=false;
  const date=value=>value&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))?new Intl.DateTimeFormat('es-PY',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'';
  const period=e=>e?.desde&&e?.hasta?date(e.desde)+' – '+date(e.hasta):'Fechas históricas sin definir';
  function appendOption(select,value,label){const option=root.document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
  function linkFor(id){const url=new URL(root.location.href);url.search='';url.hash='';url.searchParams.set('evento',id);return url.toString();}
  function ocrMessage(s){
    const e=s.eventoSeleccionado;
    if(!e)return 'Elegí una actividad disponible para registrar visitantes.';
    if(!e.ocrHabilitado)return 'Escaneo deshabilitado para esta actividad. Podés registrar manualmente con tu cuenta de Google.';
    const dates=date(e.ocrDesde)+' – '+date(e.ocrHasta)+' · Hora de Paraguay.';
    return s.ocr?.activo?'Escaneo habilitado. Verificá los datos antes de guardar. '+dates:'Escaneo: '+dates+' El registro manual sigue disponible.';
  }
  function updateReportDates(){
    const e=snapshot.eventos?.find(e=>e.id===$('rep-evento').value);
    const key=e?e.id+'|'+e.desde+'|'+e.hasta:'all';
    if(key!==reportKey){reportKey=key;$('rep-desde').value=e?.desde||'';$('rep-hasta').value=e?.hasta||'';}
    $('ver-periodo').disabled=!e?.desde||!e?.hasta;
    $('reportes').querySelector('legend').textContent=e?.nombre||'Histórico de todas las actividades';
  }
  function editorChanged(){return $('evento-form').dataset.dirty==='true';}
  function fillEditor(e){
    editorId=e?.id||'evt_'+(root.crypto?.randomUUID?.()||Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,10));
    editorRevision=e?.revision||0;
    $('ev-select').value=e?.id||'';
    $('ev-nombre').value=e?.nombre||'';$('ev-desde').value=e?.desde||'';$('ev-hasta').value=e?.hasta||'';
    $('ev-desde').required=$('ev-hasta').required=!e?.legacyNombre;
    $('ev-visible').checked=e?.visible!==false;$('ev-ocr').checked=e?.ocrHabilitado===true;
    $('ev-ocr-desde').value=e?.ocrDesde||'';$('ev-ocr-hasta').value=e?.ocrHasta||'';
    $('ev-default').checked=e?.id===snapshot.eventoDefaultId;
    $('ev-link').value=e?linkFor(e.id):'';$('ev-copy').disabled=!e;
    $('evento-form').dataset.dirty='false';$('ev-status').textContent=e?'Editando actividad · guardá para aplicar cambios.':'Nueva actividad · el escaneo empieza deshabilitado.';
    toggleOcr();
  }
  function toggleOcr(){
    const enabled=$('ev-ocr').checked;
    $('ev-ocr-fechas').hidden=!enabled;
    for(const id of ['ev-ocr-desde','ev-ocr-hasta'])$(id).required=enabled;
  }
  function render(s){
    snapshot=s;
    const events=s.eventos||[],selected=s.eventoSeleccionado;
    const key=JSON.stringify(events);
    if(key!==catalogKey){
      catalogKey=key;
      const reportValue=$('rep-evento').value,editValue=$('ev-select').value;
      $('evento-selector').replaceChildren();appendOption($('evento-selector'),'','Elegí una actividad');
      $('rep-evento').replaceChildren();appendOption($('rep-evento'),'','Todas las actividades · histórico completo');
      $('ev-select').replaceChildren();appendOption($('ev-select'),'','Nueva actividad');
      for(const e of events){
        const label=e.nombre+' · '+(e.desde||'histórico')+(e.visible?'':' · archivada');
        if(e.visible)appendOption($('evento-selector'),e.id,label);
        appendOption($('rep-evento'),e.id,label);appendOption($('ev-select'),e.id,label);
      }
      if(reportInitialized&&[...$('rep-evento').options].some(o=>o.value===reportValue))$('rep-evento').value=reportValue;
      if([...$('ev-select').options].some(o=>o.value===editValue))$('ev-select').value=editValue;
    }
    if(!reportInitialized&&events.length){$('rep-evento').value=selected?.id||s.eventoDefaultId||'';reportInitialized=true;}
    $('evento-selector').value=selected?.id||'';
    $('evento-selector').disabled=!!s.busy||!!s.eventLoading||!events.some(e=>e.visible);
    $('evento-error').textContent=s.eventoError||'';$('evento-error').hidden=!s.eventoError;
    $('evento').value=selected?.nombre||'';
    root.document.querySelector('.brand-event').textContent=selected?.nombre||'Actividades PTITP';
    root.document.querySelector('.registration-dates').textContent=selected?period(selected)+' · Hora de Paraguay':'Elegí la actividad de este registro';
    $('evento-info').textContent=selected?selected.nombre+' · '+period(selected)+'. Se permite completar registros antes o después del evento.':'';
    root.document.querySelectorAll('[data-event-period]').forEach(el=>{el.textContent=selected?selected.nombre+' · '+period(selected):'Seleccioná una actividad / 請先選擇活動';});
    root.document.querySelectorAll('[data-ocr-period]').forEach(el=>{el.textContent=selected?.ocrHabilitado?date(selected.ocrDesde)+' – '+date(selected.ocrHasta)+' · Paraguay':'Deshabilitado / 未開放';});
    updateReportDates();
    const admin=s.user?.admin===true;
    $('eventos-admin').hidden=!admin;
    if(admin&&!wasAdmin)fillEditor(events.find(e=>e.id===selected?.id)||events[0]);
    if(!admin&&wasAdmin){$('evento-form').reset();$('evento-form').dataset.dirty='false';editorId='';editorRevision=0;}
    wasAdmin=admin;
  }
  async function save(event){
    event.preventDefault();if(saving||!options.getSnapshot().user?.admin)return;
    const form=$('evento-form');if(!form.reportValidity())return;
    const ocr=$('ev-ocr').checked;
    const config={id:editorId,nombre:$('ev-nombre').value.trim(),desde:$('ev-desde').value,hasta:$('ev-hasta').value,
      ocrHabilitado:ocr,ocrDesde:ocr?$('ev-ocr-desde').value:'',ocrHasta:ocr?$('ev-ocr-hasta').value:'',
      visible:$('ev-visible').checked,predeterminado:$('ev-default').checked,revision:editorRevision};
    if(config.predeterminado&&!config.visible){$('ev-status').textContent='La actividad predeterminada debe estar disponible.';return;}
    saving=true;[...form.elements].forEach(el=>{el.disabled=true;});$('ev-status').textContent='Guardando actividad…';
    try{
      const result=await options.saveEvent(config);
      if(!options.getSnapshot().user?.admin)return;
      await options.reload();
      if(!options.getSnapshot().user?.admin)return;
      fillEditor(result.evento);$('ev-status').textContent='Actividad guardada. Compartí su enlace con el equipo.';
    }catch(error){$('ev-status').textContent=error.message||'No se pudo guardar. Conservamos los cambios; reintentá.';}
    finally{saving=false;[...form.elements].forEach(el=>{el.disabled=false;});$('ev-copy').disabled=!$('ev-link').value;}
  }
  function init(config){
    options=config;
    $('evento-selector').addEventListener('change',()=>options.selectEvent($('evento-selector').value));
    $('rep-evento').addEventListener('change',updateReportDates);
    $('evento-nuevo').addEventListener('click',()=>{
      if(saving||!options.getSnapshot().user?.admin)return;
      if(editorChanged()&&!root.confirm('Hay cambios sin guardar. ¿Crear otra actividad y descartarlos?'))return;
      fillEditor(null);$('eventos-admin').open=true;$('ev-nombre').focus();
    });
    $('ev-select').addEventListener('change',()=>{
      if(editorChanged()&&!root.confirm('Hay cambios sin guardar. ¿Descartarlos?')){$('ev-select').value=editorRevision?editorId:'';return;}
      fillEditor(snapshot.eventos.find(e=>e.id===$('ev-select').value));
    });
    $('evento-form').addEventListener('input',()=>{$('evento-form').dataset.dirty='true';});
    $('ev-ocr').addEventListener('change',toggleOcr);
    $('evento-form').addEventListener('submit',save);
    $('ev-refresh').addEventListener('click',async()=>{
      if(saving||!options.getSnapshot().user?.admin)return;
      if(editorChanged()&&!root.confirm('¿Descartar los cambios sin guardar y recargar las actividades?'))return;
      const id=editorRevision?editorId:'';
      $('ev-refresh').disabled=true;
      try{await options.reload();if(options.getSnapshot().user?.admin)fillEditor(options.getSnapshot().eventos.find(e=>e.id===id));}
      finally{$('ev-refresh').disabled=false;}
    });
    $('ev-copy').addEventListener('click',async()=>{
      try{await root.navigator.clipboard.writeText($('ev-link').value);$('ev-status').textContent='Enlace copiado.';}
      catch(error){$('ev-link').select();$('ev-status').textContent='Copiá el enlace seleccionado y compartilo con el equipo.';}
    });
  }
  root.PtitpEvents={init,render,ocrMessage,reportFilter:()=>({eventoId:$('rep-evento').value,evento:''}),officialPeriod:()=>snapshot.eventos?.find(e=>e.id===$('rep-evento').value)};
})(window);
