const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {installBrowserAuth,user}=require('./test_helpers/browser-auth.cjs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
let failures=0;
async function test(name,run){
  let dom,controller;const sent=[];
  try{
    dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://example.test/',pretendToBeVisual:true,beforeParse(w){
      if(fs.existsSync('mobile-ui.js'))w.eval(fs.readFileSync('mobile-ui.js','utf8'));
      controller=installBrowserAuth(w,{admin:false});
      w.fetch=async(url,options)=>{if(!options?.body)return{ok:true,json:async()=>({v:'1.13.0'})};const payload=JSON.parse(options.body);sent.push(payload);return{ok:true,json:async()=>({ok:true})};};
    }});
    await tick();await run(dom.window,dom.window.document,controller,sent);console.log('PASS '+name);
  }catch(error){failures++;console.error('FAIL '+name+': '+error.message);}
  finally{dom?.window.close();}
}
(async()=>{
  await test('separate space interests expand details and preserve optional values in the actual submission',async(w,d,controller,sent)=>{
    const nave=d.querySelector('#intereses input[value="Nave estándar"]');
    const terreno=d.querySelector('#intereses input[value="Terreno"]');
    assert(nave&&terreno,'land and standard factory must be individually selectable');
    nave.checked=true;nave.dispatchEvent(new w.Event('change',{bubbles:true}));
    assert.equal(d.getElementById('espacio-detalle').open,true);
    d.getElementById('nombre').value='Mobile visitor';d.getElementById('cargo').value='Director';
    d.getElementById('superficie').value='1200';d.querySelector('input[name=plazo][value="6-12 meses"]').checked=true;
    terreno.checked=true;terreno.dispatchEvent(new w.Event('change',{bubbles:true}));
    const optional=d.getElementById('contacto-detalle');assert(optional);optional.open=false;
    d.querySelector('input[name=calif][value="B - Tibio"]').checked=true;
    d.getElementById('enviar').click();await tick();
    assert.equal(sent.length,1);assert.deepEqual(Array.from(sent[0].intereses),['Nave estándar','Terreno']);
    assert.equal(sent[0].cargo,'Director');assert.equal(sent[0].superficie,'1200');assert.equal(sent[0].plazo,'6-12 meses');
    assert.equal(w.eval('getCola()').length,0,'server-confirmed mobile submit leaves no pending record');
  });
  await test('ordinary-user keyboard navigation skips the hidden administrator tab',async(w,d)=>{
    const admin=d.querySelector('[data-tab="tab-reportes"]');assert(admin,'report navigation must be a distinct administrator tab');
    assert.equal(admin.hidden,true);
    const help=d.querySelector('[data-tab="tab-guia"]');help.focus();help.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(d.querySelector('.tabs button.activa').dataset.tab,'tab-registro');
    assert.equal(d.activeElement.dataset.tab,'tab-registro');
    d.getElementById('nombre').value='Unsent draft';
    d.querySelector('[data-tab="tab-materiales"]').click();assert.equal(d.getElementById('mobile-savebar').hidden,true);
    d.querySelector('[data-tab="tab-registro"]').click();assert.equal(d.getElementById('nombre').value,'Unsent draft');
    assert.equal(d.getElementById('mobile-savebar').hidden,false);
  });
  await test('revoking administrator access while reports are open returns to registration',async(w,d,controller)=>{
    controller.setUser(user('admin','jaimehuang168@gmail.com','Jaime'));await tick();
    const admin=d.querySelector('[data-tab="tab-reportes"]');assert(admin,'report tab must exist');
    assert.equal(admin.hidden,false);admin.click();assert(d.getElementById('tab-reportes').classList.contains('activa'));
    controller.setUser(user('operator-next','other@example.com'));await tick();
    assert.equal(admin.hidden,true);assert.equal(d.getElementById('reportes').hidden,true);
    assert(d.getElementById('tab-registro').classList.contains('activa'));assert.equal(d.getElementById('mobile-savebar').hidden,false);
  });
  await test('an unresolved OCR request blocks mobile save until it finishes',async(w,d,controller,sent)=>{
    let finish;
    w.fetch=async(url,options)=>{const payload=JSON.parse(options.body);sent.push(payload);if(payload.accion==='ocrTarjeta')return new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({ok:true,datos:{nombre:'Card visitor'}})});});return{ok:true,json:async()=>({ok:true})};};
    Object.defineProperty(d.getElementById('tarjeta-file'),'files',{value:[new w.File(['card'],'card.jpg',{type:'image/jpeg'})],configurable:true});
    w.comprimirImagen=async()=>({b64:'/9j/AAAA',thumb:'data:image/jpeg;base64,/9j/AAAA'});
    d.getElementById('nombre').value='Existing draft';d.querySelector('input[name=calif]').checked=true;
    const scan=w.escanearTarjeta();await tick();
    try{
      assert.equal(d.getElementById('enviar').disabled,true,'save cannot create a record while the card is being analyzed');
      d.getElementById('f').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
      assert.equal(sent.filter(p=>p.accion!=='ocrTarjeta').length,0);
    }finally{finish?.();await scan;}
    assert.equal(d.getElementById('enviar').disabled,false);
  });
  await test('an unresolved save blocks starting a second card scan',async(w,d)=>{
    let finish;w.fetch=async()=>new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({ok:true})});});
    d.getElementById('nombre').value='Visitor being saved';d.querySelector('input[name=calif]').checked=true;
    d.getElementById('enviar').click();await tick();
    try{assert.equal(d.getElementById('scan-btn').disabled,true,'a second card cannot race with an unfinished save');}
    finally{finish?.();await tick();}
  });
  await test('confirmed queue retry replaces the earlier pending feedback with a server-confirmed status',async(w,d)=>{
    let fail=true;w.fetch=async()=>{if(fail)throw new TypeError('network down');return{ok:true,json:async()=>({ok:true})};};
    d.getElementById('nombre').value='Offline mobile visitor';d.querySelector('input[name=calif]').checked=true;
    d.getElementById('enviar').click();await tick();
    assert.equal(w.eval('getCola()').length,1);assert.match(d.getElementById('mobile-save-status').textContent,/Pendiente/);
    fail=false;await w.reintentar(true);
    assert.equal(w.eval('getCola()').length,0);
    assert.doesNotMatch(d.getElementById('mobile-save-status').textContent,/Pendiente/);
    assert.match(d.getElementById('mobile-save-status').textContent,/confirmado.*Google Sheets/);
  });
  await test('keyboard adjustment does not scroll back to a field after the user focuses a rating',async(w,d)=>{
    let scrolls=0;const name=d.getElementById('nombre');name.scrollIntoView=()=>{scrolls++;};
    d.getElementById('mobile-savebar').getBoundingClientRect=()=>({top:0});
    name.focus();d.querySelector('input[name=calif]').focus();
    await new Promise(resolve=>setTimeout(resolve,190));
    assert.equal(scrolls,0,'an obsolete keyboard adjustment must not move the screen away from the current control');
  });
  await test('sign-out asks before discarding an email-only draft and cancel preserves the account and field',async(w,d,controller)=>{
    let confirmations=0;w.confirm=()=>{confirmations++;return false;};
    d.getElementById('email').value='unsent@example.com';d.getElementById('email').dispatchEvent(new w.Event('input',{bubbles:true}));
    d.getElementById('salir-google').click();await tick();
    assert.equal(confirmations,1,'every entered contact field must count as an unsent draft');
    assert.equal(d.getElementById('email').value,'unsent@example.com');assert(controller.auth.currentUser);
  });
  if(failures)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
