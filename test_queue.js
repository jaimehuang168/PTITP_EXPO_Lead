const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,10));
let resolveRequest, calls=0;
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/',runScripts:'dangerously',beforeParse(w){
  require('./test_helpers/browser-auth.cjs').installBrowserAuth(w);
  w.scrollTo=()=>{};
  w.fetch=async(url,opts)=>{
    if(!opts?.body)return {ok:true,json:async()=>({ok:true})};
    calls++;return new Promise(resolve=>{resolveRequest=()=>resolve({ok:true,json:async()=>({ok:true})});});
  };
}});
const w=dom.window;
w.eval('window.setCola = setCola; window.getCola = getCola;');
(async()=>{
  await tick();
  const first={operadorUid:'operator-uid',requestId:'queue_first_001',nombre:'First',calificacion:'A'};
  const second={operadorUid:'operator-uid',requestId:'queue_second_002',nombre:'Second',calificacion:'B'};
  w.setCola([first]);
  const run=w.reintentar();await tick();
  w.setCola([...w.getCola(),second]);
  const overlap=w.reintentar();await tick();
  assert.equal(calls,1,'overlapping flushes share one request');
  resolveRequest();await Promise.all([run,overlap]);
  assert.equal(w.getCola().length,1,'newly queued entry survives an in-flight flush');
  assert.equal(w.getCola()[0].requestId,second.requestId);
  assert.equal(w.document.getElementById('evento').value,'EXPO PBW');
  assert(w.document.querySelector('.registration-dates').textContent.includes('2026'),'event period comes from the selected catalog entry');
  assert.equal(w.document.getElementById('rep-desde').value,'2026-11-10');
  // A page closing during the request must already have a durable copy.
  const d=w.document;d.getElementById('nombre').value='Durable';d.getElementById('promotor').value='Operator';
  d.querySelector('input[name=calif]').checked=true;
  d.getElementById('f').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert(w.getCola().some(p=>p.nombre==='Durable'),'persist before awaiting the server');
  resolveRequest();await tick();
  // Storage-full must retain form and must not attempt a network write.
  const originalSet=w.Storage.prototype.setItem;const before=calls;
  w.Storage.prototype.setItem=()=>{throw new Error('Storage full');};
  d.getElementById('nombre').value='Keep this visitor';d.querySelector('input[name=calif]').checked=true;
  d.getElementById('f').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.equal(calls,before);assert.equal(d.getElementById('nombre').value,'Keep this visitor');
  w.Storage.prototype.setItem=originalSet;
  console.log('PASS queue race, durable submit, storage failure, PBW defaults');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>w.close());
