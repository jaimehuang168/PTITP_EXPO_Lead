const assert=require('node:assert/strict');
const {createGoogleSession}=require('./google-session.js');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const events=[{id:'one-2026',nombre:'Primera',visible:true,ocrHabilitado:true},{id:'two-2027',nombre:'Segunda',visible:true,ocrHabilitado:false}];
function config(id='one-2026'){return{auth:{configured:true,firebase:{}},eventos:events,eventoDefaultId:'one-2026',eventoSeleccionado:events.find(e=>e.id===id)||null,ocr:{activo:id==='one-2026'}};}
function fixture(){
  const pending=[],configs=[];let delayed=false,configDelayed=false,offline=false,callback=()=>{};
  const user={uid:'one',getIdToken:async()=> 'fixture-token'},auth={currentUser:user};
  const sdk={initializeApp:()=>({}),getAuth:()=>auth,setPersistence:async()=>{},browserSessionPersistence:'session',onIdTokenChanged:(a,cb)=>{callback=cb;cb(user);}};
  const session=createGoogleSession({apiUrl:'https://example.test/exec',loadSdk:async()=>sdk,fetch:async(url,options)=>{
    if(!options?.body){if(offline)throw new TypeError('offline');const result={ok:true,json:async()=>config(new URL(url).searchParams.get('eventoId')||undefined)};return configDelayed?new Promise(resolve=>configs.push(()=>resolve(result))):result;}
    const payload=JSON.parse(options.body),body={ok:true,usuario:{uid:user.uid,email:'one@example.com'},...config(payload.eventoId)};
    return delayed?new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>body}))):{ok:true,json:async()=>body};
  }});
  return{session,pending,configs,delay:()=>{delayed=true;},delayConfigs:()=>{configDelayed=true;},offline:()=>{offline=true;},refreshUser:()=>callback(user)};
}
(async()=>{
  const f=fixture();await f.session.start();await tick();assert.equal(f.session.getSnapshot().user.uid,'one');
  f.delay();const refresh=f.session.refresh();await tick();assert.equal(f.pending.length,1);
  await f.session.selectEvent('two-2027');assert.equal(f.session.getSnapshot().ocr.activo,false);
  f.pending.shift()();await refresh;
  assert.equal(f.session.getSnapshot().eventoSeleccionado.id,'two-2027','a late session refresh cannot restore the old activity');
  assert.equal(f.session.getSnapshot().ocr.activo,false,'a late old OCR permission cannot enable a new event');
  f.offline();assert.equal(await f.session.selectEvent('one-2026'),false);assert.equal(f.session.getSnapshot().eventoSeleccionado.id,'two-2027','network failure keeps the prior activity');assert.equal(f.session.getSnapshot().eventLoading,false);
  const snapshot=f.session.getSnapshot();snapshot.eventos[0].nombre='Changed';snapshot.eventoSeleccionado.nombre='Changed';snapshot.ocr.activo=true;
  assert.equal(f.session.getSnapshot().eventoSeleccionado.nombre,'Segunda');assert.equal(f.session.getSnapshot().ocr.activo,false);
  const g=fixture();await g.session.start();await tick();g.delayConfigs();g.delay();
  const selection=g.session.selectEvent('two-2027');await tick();
  const concurrentRefresh=g.session.refresh();await tick();
  g.configs.shift()();await selection;assert.equal(g.session.getSnapshot().eventoSeleccionado.id,'two-2027');
  g.pending.shift()();await concurrentRefresh;
  assert.equal(g.session.getSnapshot().eventoSeleccionado.id,'two-2027','a refresh started during selection cannot undo the completed selection');
  console.log('PASS selection isolation from late session responses, preserved selection on network failure, independent snapshots');
})().catch(error=>{console.error(error);process.exitCode=1;});
