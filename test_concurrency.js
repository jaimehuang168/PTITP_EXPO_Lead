// Eight real worker threads share a synchronous Sheet/ScriptLock model.
// This exercises the production doPost code; it does not measure Google latency or quotas.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
if(isMainThread){
  const shared=new SharedArrayBuffer(32*4);
  const state=new Int32Array(shared);
  const workers=Array.from({length:8},(_,i)=>new Worker(__filename,{workerData:{shared,id:i+1}}));
  const results=workers.map(w=>new Promise((resolve,reject)=>{w.on('message',resolve);w.on('error',reject);w.on('exit',c=>{if(c)reject(new Error('worker exit '+c));});}));
  Promise.all(results).then(all=>{
    assert.equal(Atomics.load(state,2),8,'exactly eight durable records');
    assert.equal(Atomics.load(state,3),8,'every append flushed before release');
    all.forEach(r=>{assert(r.first.ok);assert(r.retry.ok&&r.retry.duplicate);});
    console.log('PASS eight concurrent workers + retries: 8 records, 0 duplicates, 0 lost');
  }).catch(e=>{console.error(e);process.exitCode=1;});
}else{
  const state=new Int32Array(workerData.shared);let owned=false,dirty=false;
  const source=fs.readFileSync('Code.gs','utf8');let headers;
  const ctx=vm.createContext({Date,Math,JSON,
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}),flush:()=>{assert(owned);if(dirty){Atomics.add(state,3,1);dirty=false;}}},
    LockService:{getScriptLock:()=>({tryLock(ms){const end=Date.now()+ms;while(Atomics.compareExchange(state,0,0,1)!==0){if(Date.now()>end)return false;Atomics.wait(state,0,1,20);}owned=true;return true;},releaseLock(){assert(owned&&!dirty);owned=false;Atomics.store(state,0,0);Atomics.notify(state,0);}})},
    Utilities:{formatDate:()=> '2026-11-10'},Logger:{log:()=>{}},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
  });
  const sheet={getLastRow:()=>Atomics.load(state,2)+1,getDataRange:()=>({getValues:()=>[headers,...Array.from({length:Atomics.load(state,2)},(_,i)=>{const row=Array(26).fill('');row[25]='worker_request_'+Atomics.load(state,4+i);return row;})]}),appendRow(row){assert(owned);Atomics.wait(state,1,0,35);const n=Atomics.load(state,2);Atomics.store(state,4+n,Number(row[25].split('_').pop()));Atomics.add(state,2,1);dirty=true;}};
  vm.runInContext(source,ctx);headers=vm.runInContext('HEADERS',ctx);
  const payload={nombre:'Worker',calificacion:'A',evento:'EXPO PBW',promotor:'Operator',requestId:'worker_request_'+workerData.id};
  const post=()=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(payload)}}).text);
  parentPort.postMessage({first:post(),retry:post()});
}
