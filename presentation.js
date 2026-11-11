(function(root){
  'use strict';
  const slides=[
    {file:'pbw-2026.jpeg',title:'PTITP en PBW 2026',detail:'11–13 de noviembre de 2026',alt:'Presentación del Parque Tecnológico Inteligente Taiwán-Paraguay en Paraguay Business Week 2026.'},
    {file:'tres-formas.jpeg',title:'Tres formas de conocer el parque',detail:'PBW 2026 · stand, presentación y visita',alt:'Agenda de las tres formas de conocer el parque: stand, presentación y visita guiada.'},
    {file:'ubicacion-stand.jpeg',title:'Ubicación del stand',detail:'PBW 2026',alt:'Plano para encontrar el stand del PTITP en PBW 2026.'},
    {file:'presentacion-parque.jpeg',title:'Presentación del parque',detail:'11 de noviembre · 17:00',alt:'Invitación a la presentación del parque el 11 de noviembre a las 17:00, con lugar, temas y contacto de confirmación.'},
    {
      file:'visita-guiada.jpeg',
      title:'Visita guiada al parque',
      detail:'13 de noviembre · 14:00',
      alt:'Visita guiada al parque, con punto de encuentro, traslado e inscripción mediante QR.',
      signupUrl:'https://forms.gle/YpHKccuna9sJGA8e6'
    },
    {file:'consulta-empresas.jpeg',title:'Instalá tu empresa',detail:'Formulario de consulta',alt:'Información para empresas interesadas en instalarse en el parque, con código QR de consulta.'},
    {file:'condiciones-alquiler.jpeg',title:'Condiciones de alquiler',detail:'Formulario de interés',alt:'Información sobre condiciones de alquiler del parque, con código QR de registro.'}
  ];
  const $=id=>root.document.getElementById(id);
  let initialized=false,index=0,zoom=1,opener=null;
  function source(slide){return 'assets/presentation/'+slide.file;}
  function applyZoom(){
    const stage=$('presentation-stage'),img=$('presentation-image');if(!img)return;
    stage.dataset.zoomed=String(zoom>1);
    stage.tabIndex=zoom>1?0:-1;
    $('presentation-zoom-hint').hidden=zoom===1;
    const width=img.naturalWidth||1024,height=img.naturalHeight||1280;
    // Explicit stage dimensions avoid percentage-height sizing against an intrinsic grid item.
    const fit=Math.min(width,stage.clientWidth||width,(stage.clientHeight||height)*width/height);
    img.style.width=Math.floor(fit*zoom)+'px';img.style.maxWidth='none';img.style.maxHeight='none';
    if(zoom===1)stage.scrollTop=stage.scrollLeft=0;
    $('presentation-zoom-in').disabled=zoom>=3;$('presentation-zoom-out').disabled=zoom<=1;
  }
  function render(){
    const slide=slides[index],img=root.document.createElement('img');
    img.id='presentation-image';img.alt=slide.alt;img.width=1024;img.height=1280;img.draggable=false;
    $('presentation-image')?.remove();$('presentation-stage').prepend(img);
    $('presentation-dialog-title').textContent=slide.title;
    const signup = $('presentation-signup');
    signup.hidden = !slide.signupUrl;
    if (slide.signupUrl) signup.href = slide.signupUrl;
    else signup.removeAttribute('href');
    $('presentation-counter').textContent=(index+1)+' de '+slides.length;
    $('presentation-previous').disabled=index===0;$('presentation-next').disabled=index===slides.length-1;
    $('presentation-error').hidden=true;$('presentation-retry').hidden=true;
    const current=()=>$('presentation-image')===img;
    img.addEventListener('load',()=>{if(current()){img.hidden=false;$('presentation-error').hidden=true;$('presentation-retry').hidden=true;applyZoom();}});
    img.addEventListener('error',()=>{if(current()){img.hidden=true;$('presentation-error').hidden=false;$('presentation-retry').hidden=false;}});
    img.src=source(slide);applyZoom();
  }
  function show(number,button){
    index=number;zoom=1;opener=button;
    const dialog=$('presentation-dialog');
    if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
    render();$('presentation-close').focus();
  }
  function move(delta){const next=index+delta;if(next<0||next>=slides.length)return;index=next;zoom=1;render();}
  function close(){const dialog=$('presentation-dialog');if(typeof dialog.close==='function')dialog.close();else{dialog.removeAttribute('open');opener?.focus();}}
  function init(){
    if(initialized||!$('presentation-gallery'))return;initialized=true;
    for(const [number,slide] of slides.entries()){
      const card=root.document.createElement('button'),img=root.document.createElement('img'),caption=root.document.createElement('span'),title=root.document.createElement('strong'),detail=root.document.createElement('small');
      card.type='button';card.className='presentation-card';card.dataset.presentationIndex=number;card.setAttribute('aria-label','Mostrar: '+slide.title);
      img.src=source(slide);img.alt='';img.width=1024;img.height=1280;img.loading='lazy';img.decoding='async';
      title.textContent=slide.title;detail.textContent=slide.detail;caption.append(title,detail);card.append(img,caption);
      card.addEventListener('click',()=>show(number,card));
      const gallery = $('presentation-gallery');
      if (slide.signupUrl) {
        const group = root.document.createElement('div');
        const link = $('presentation-signup').cloneNode(true);
        group.className = 'presentation-card-with-link';
        link.removeAttribute('id');
        link.href = slide.signupUrl;
        link.hidden = false;
        group.append(card, link);
        gallery.append(group);
      } else {
        gallery.append(card);
      }
    }
    $('presentation-start').addEventListener('click',event=>show(0,event.currentTarget));
    $('presentation-previous').addEventListener('click',()=>move(-1));$('presentation-next').addEventListener('click',()=>move(1));
    $('presentation-close').addEventListener('click',close);
    $('presentation-dialog').addEventListener('close',()=>{zoom=1;opener?.focus();});
    $('presentation-dialog').addEventListener('keydown',event=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      if(event.target===$('presentation-stage')&&zoom>1&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      if(event.key==='ArrowRight'){event.preventDefault();move(1);}
      else if(event.key==='ArrowLeft'){event.preventDefault();move(-1);}
      else if(event.key==='Escape'){event.preventDefault();close();}
    });
    $('presentation-zoom-in').addEventListener('click',()=>{zoom=Math.min(3,zoom+.5);applyZoom();});
    $('presentation-zoom-out').addEventListener('click',()=>{zoom=Math.max(1,zoom-.5);applyZoom();});
    $('presentation-fit').addEventListener('click',()=>{zoom=1;applyZoom();});
    $('presentation-retry').addEventListener('click',()=>{render();$('presentation-close').focus();});
    root.addEventListener('resize',()=>{if($('presentation-dialog').open)applyZoom();});
  }
  root.PtitpPresentation={init};
})(window);
