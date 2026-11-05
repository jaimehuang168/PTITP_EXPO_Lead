const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');const {installBrowserAuth}=require('./test_helpers/browser-auth.cjs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));let failed=0;
const catalog=()=>[{id:'pbw-2026',nombre:'EXPO PBW',desde:'2026-11-10',hasta:'2026-11-14',visible:true,ocrHabilitado:true,ocrDesde:'2026-11-06',ocrHasta:'2026-11-14',revision:1},{id:'future-2027',nombre:'Feria futura',desde:'2027-03-10',hasta:'2027-03-14',visible:true,ocrHabilitado:false,ocrDesde:'',ocrHasta:'',revision:1}];
async function test(name,run,{url='https://example.test/',admin=false}={}){
  let dom,auth;const sent=[],events=catalog();let mode='ok',opened;
  try{
    dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true,url,beforeParse(w){
      for(const file of ['mobile-ui.js','event-ui.js'])if(fs.existsSync(file))w.eval(fs.readFileSync(file,'utf8'));
      auth=installBrowserAuth(w,{admin,eventos:events});
      w.fetch=async(url,options)=>{if(!options?.body)return{ok:true,json:async()=>({v:'1.14.0'})};const payload=JSON.parse(options.body);sent.push(payload);if(mode==='offline')throw new TypeError('network unavailable');
        if(payload.accion==='guardarEvento'){const e={...payload.eventoConfig,revision:1};events.push(e);return{ok:true,json:async()=>({ok:true,evento:e,eventos:events})};}
        return{ok:true,json:async()=>({ok:true})};};
      w.confirm=()=>true;w.HTMLFormElement.prototype.submit=function(){opened=JSON.parse(this.elements.reportRequest.value);};
    }});
    await tick();await run(dom.window,dom.window.document,{sent,events,auth,setMode:value=>mode=value,get opened(){return opened;}});console.log('PASS '+name);
  }catch(error){failed++;console.error('FAIL '+name+': '+error.message);}finally{dom?.window.close();}
}
(async()=>{
  await test('event-specific links select the right metadata and do not grant another event OCR',async(w,d)=>{
    const selector=d.getElementById('evento-selector');assert(selector,'a reusable event selector must exist');
    assert.equal(selector.value,'future-2027');assert.equal(d.getElementById('evento').value,'Feria futura');assert.equal(d.getElementById('scan-btn').disabled,true);assert.match(d.querySelector('.brand-event').textContent,/Feria futura/);
  },{url:'https://example.test/?evento=future-2027'});
  await test('invalid event links keep registration closed until an explicit valid choice',async(w,d)=>{
    assert(d.getElementById('evento-selector'));assert.equal(d.getElementById('enviar').disabled,true);assert(d.getElementById('evento-error').textContent);
  },{url:'https://example.test/?evento=unknown'});
  await test('cancelled activity switches preserve every draft field',async(w,d)=>{
    const selector=d.getElementById('evento-selector');assert(selector);let asked=0;w.confirm=()=>{asked++;return false;};
    d.getElementById('email').value='draft@example.com';selector.value='future-2027';selector.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
    assert.equal(asked,1);assert.equal(selector.value,'pbw-2026');assert.equal(d.getElementById('email').value,'draft@example.com');
  });
  await test('queued records keep their original activity when the operator changes exhibitions',async(w,d,c)=>{
    assert(d.getElementById('evento-selector'));c.setMode('offline');d.getElementById('nombre').value='Old activity visitor';d.querySelector('[name=calif]').checked=true;d.getElementById('enviar').click();await tick();
    const queued=w.eval('getCola()');assert.equal(queued[0].eventoId,'pbw-2026');
    const selector=d.getElementById('evento-selector');selector.value='future-2027';selector.dispatchEvent(new w.Event('change',{bubbles:true}));await tick();
    assert.equal(d.getElementById('evento').value,'Feria futura');assert.equal(w.eval('getCola()')[0].eventoId,'pbw-2026');
    c.setMode('ok');await w.reintentar(true);assert.equal(c.sent.at(-1).eventoId,'pbw-2026');
  });
  await test('report requests carry the selected stable activity ID',async(w,d,c)=>{
    const selector=d.getElementById('rep-evento');assert([...selector.options].some(o=>o.value==='future-2027'));
    selector.value='future-2027';selector.dispatchEvent(new w.Event('change',{bubbles:true}));d.getElementById('ver-hoy').click();await tick();
    assert.equal(c.opened.eventoId,'future-2027');assert.equal(d.getElementById('rep-desde').value,'2027-03-10');assert.equal(d.getElementById('rep-hasta').value,'2027-03-14');
  },{admin:true});
  await test('administrator can create an event with OCR off and receive its permanent link',async(w,d,c)=>{
    const create=d.getElementById('evento-nuevo');assert(create,'an administrator event editor must exist');create.click();
    d.getElementById('ev-nombre').value='Feria nueva';d.getElementById('ev-desde').value='2027-08-01';d.getElementById('ev-hasta').value='2027-08-05';
    assert.equal(d.getElementById('ev-ocr').checked,false);d.getElementById('evento-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
    const payload=c.sent.find(p=>p.accion==='guardarEvento');assert(payload);assert.equal(payload.eventoConfig.ocrHabilitado,false);assert(payload.idToken);assert(payload.eventoConfig.id);
    assert.match(d.getElementById('ev-link').value,/\?evento=/);
  },{admin:true});
  await test('operators cannot invoke administrator event settings through the UI',async(w,d,c)=>{
    const form=d.getElementById('evento-form');assert(form);form.dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(c.sent.filter(p=>p.accion==='guardarEvento').length,0);
  });
  await test('version refresh cleanup preserves an activity link and guide location',async(w,d)=>{
    assert.equal(new URL(w.location.href).searchParams.get('evento'),'future-2027');assert.equal(new URL(w.location.href).searchParams.has('v'),false);assert.equal(w.location.hash,'#guia');assert.equal(d.getElementById('evento-selector').value,'future-2027');
  },{url:'https://example.test/?evento=future-2027&v=123#guia'});
  await test('a report keeps its clicked activity and dates while Google renews its token',async(w,d,c)=>{
    let release;c.auth.auth.currentUser.getIdToken=()=>new Promise(resolve=>release=resolve);
    d.getElementById('ver-periodo').click();await tick();
    d.getElementById('rep-evento').value='future-2027';d.getElementById('rep-evento').dispatchEvent(new w.Event('change'));
    release('renewed-fixture');await tick();
    assert.equal(c.opened.eventoId,'pbw-2026');assert.equal(c.opened.desde,'2026-11-10');assert.equal(c.opened.hasta,'2026-11-14');
  },{admin:true});
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);process.exitCode=1;});
