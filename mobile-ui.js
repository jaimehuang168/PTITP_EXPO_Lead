(function(root){
  'use strict';
  const $=id=>root.document.getElementById(id);
  let snapshot={},feedback=null,ownPending=0,previousUid='',switchTab=()=>{};
  function hasDraft(){
    const form=$('f');if(!form)return false;
    return [...form.elements].some(el=>{
      if(el.tagName==='BUTTON'||['evento','promotor','tarjeta-file'].includes(el.id))return false;
      if(el.type==='checkbox'||el.type==='radio')return el.checked;
      return typeof el.value==='string'&&!!el.value.trim();
    });
  }
  function render(){
    const status=$('mobile-save-status');if(!status)return;
    let text,tone='';
    if(snapshot.busy)text=snapshot.switching?'Cargando actividad…':snapshot.scanning?'Analizando tarjeta…':'Guardando registro…';
    else if(!snapshot.user)text='Iniciá sesión con Google';
    else if(!snapshot.eventoSeleccionado)text='Elegí una actividad disponible';
    else if(snapshot.registroDisponible===false)text='Actividad cerrada · carga por administración';
    else if(feedback){text=feedback.text;tone=feedback.tone;}
    else if(hasDraft())text='Borrador · todavía sin guardar';
    else if(ownPending){text=ownPending===1?'1 registro pendiente de confirmación':ownPending+' registros pendientes';tone='pending';}
    else text='Listo para un nuevo registro';
    status.textContent=(tone==='success'?'✓ ':tone==='pending'?'◷ ':'')+text;
    status.dataset.tone=tone;
  }
  function renderSession(s){
    const uid=s.user?.uid||'';
    if(uid!==previousUid){previousUid=uid;feedback=null;$('acceso').hidden=!!s.user;$('mobile-account').setAttribute('aria-expanded','false');}
    snapshot=s;
    root.document.body.classList.toggle('signed-in',!!s.user);
    $('mobile-account').hidden=!s.user;
    if(!s.user)$('acceso').hidden=false;
    if(s.user){
      const name=s.user.nombre||s.user.email;
      $('mobile-account-name').textContent=name.split(/\s+/)[0];
      $('mobile-avatar').textContent=name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
      $('mobile-account').title=s.user.email;$('mobile-account').setAttribute('aria-label','Ver cuenta: '+s.user.email);
    }
    const reportTab=root.document.querySelector('[data-tab="tab-reportes"]');reportTab.hidden=!s.user?.admin;
    if(!s.user?.admin&&$('tab-reportes').classList.contains('activa'))switchTab('tab-registro');
    render();
  }
  function updateSpace(){
    const details=$('espacio-detalle');if(!details)return;
    const selected=!!root.document.querySelector('#intereses [data-space]:checked');
    details.classList.toggle('has-space',selected);
    if(selected)details.open=true;
    const choice=root.document.querySelector('input[name=calif]:checked')?.value?.[0];
    $('mobile-rating-description').textContent={A:'Proyecto concreto y posibilidad de decidir. Seguimiento prioritario.',B:'Interés real; todavía hay detalles o plazos por definir.',C:'Consulta inicial o búsqueda de información general.'}[choice]||'Elegí según el interés y la posibilidad de avanzar.';
  }
  function status(text,tone){feedback={text,tone};render();}
  function renderQueue(total,own){
    if(ownPending>0&&own===0&&feedback?.tone==='pending')feedback=null;
    ownPending=own;render();
  }
  function reset(){feedback=null;$('espacio-detalle').open=false;updateSpace();render();}
  function resize(){
    const viewport=root.visualViewport;
    const offset=viewport&&Math.abs(viewport.scale-1)<.05?Math.max(0,root.innerHeight-viewport.height-viewport.offsetTop):0;
    root.document.documentElement.style.setProperty('--keyboard-offset',offset+'px');
    const bar=$('mobile-savebar');if(bar&&!bar.hidden)root.document.documentElement.style.setProperty('--savebar-height',Math.ceil(bar.getBoundingClientRect().height)+'px');
  }
  function init(options){
    switchTab=options.switchTab;
    $('mobile-account').addEventListener('click',()=>{
      const open=$('mobile-account').getAttribute('aria-expanded')!=='true';
      $('mobile-account').setAttribute('aria-expanded',String(open));$('acceso').hidden=!open;
      if(open)$('sesion-usuario').focus();
    });
    $('mobile-manual').addEventListener('click',()=>{$('nombre').focus();$('nombre').scrollIntoView?.({block:'center',behavior:'smooth'});});
    $('f').addEventListener('input',()=>{feedback=null;render();});
    $('f').addEventListener('change',()=>{feedback=null;updateSpace();render();});
    $('f').addEventListener('focusin',event=>{
      if(!event.target.matches('input:not([type=radio]):not([type=checkbox]),select,textarea'))return;
      setTimeout(()=>{
        if(root.document.activeElement!==event.target)return;
        resize();const rect=event.target.getBoundingClientRect(),bar=$('mobile-savebar').getBoundingClientRect();
        if(rect.bottom>bar.top-12||rect.top<8)event.target.scrollIntoView?.({block:'center',behavior:'smooth'});
      },150);
    });
    root.visualViewport?.addEventListener('resize',resize);root.visualViewport?.addEventListener('scroll',resize);root.addEventListener('resize',resize);
    if(root.ResizeObserver)new root.ResizeObserver(resize).observe($('mobile-savebar'));
    updateSpace();resize();
  }
  root.PtitpMobile={init,renderSession,renderQueue,status,reset,hasDraft};
})(window);
