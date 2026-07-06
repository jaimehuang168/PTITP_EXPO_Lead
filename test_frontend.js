/**
 * test_frontend.js — jsdom 模擬前端測試 index.html
 *   F1 頁面載入、必要元素存在
 *   F2 必填驗證（缺姓名/分級不送出）
 *   F3 填完整表單送出 → payload 欄位與後端 doPost 期待完全一致
 *   F4 送出成功後表單清空但保留 evento/promotor
 *   F5 斷線 → 存入離線佇列；恢復 → 重送成功、佇列清空
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html','utf8')
  .replace("PEGAR_AQUI_LA_URL_DEL_WEB_APP", "https://script.google.com/macros/s/TEST/exec");

const dom = new JSDOM(html, { runScripts:'dangerously', url:'https://jaimehuang168.github.io/ptitp-expo-leads/', pretendToBeVisual:true });
const { window } = dom;
const { document } = window;

let pass=0, fail=0;
const check=(c,n)=>{ c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n)); };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// mock fetch：可切換成功/失敗
let fetchMode='ok'; const sent=[];
window.fetch = async (url, opts) => {
  if (fetchMode==='fail') throw new Error('network down');
  sent.push({ url, body: JSON.parse(opts.body), contentType: opts.headers['Content-Type'] });
  return { json: async ()=>({ ok:true }) };
};

(async ()=>{
  // F1 基本元素
  check(document.getElementById('f'), 'F1 表單存在');
  check(document.querySelectorAll('.calif input').length===3, 'F1 A/B/C 三個分級按鈕');
  check(document.querySelectorAll('#intereses input').length===7, 'F1 興趣選項 7 個');
  check(document.querySelectorAll('#proximosPasos input').length===6, 'F1 後續動作選項 6 個');

  const $=id=>document.getElementById(id);
  const submit=()=>{ $('f').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})); return sleep(30); };

  // F2 必填驗證
  $('evento').value='Expo Paraguay 2026'; $('promotor').value='María González';
  await submit();
  check(sent.length===0, 'F2 缺姓名時不送出');
  $('nombre').value='Carlos Benítez';
  await submit();
  check(sent.length===0, 'F2 缺 A/B/C 分級時不送出');

  // F3 完整填寫
  $('empresa').value='Textil del Este SA';
  $('cargo').value='Gerente General';
  $('pais').value='Paraguay';
  $('telefono').value='+595 981 123456';
  $('email').value='carlos@textileste.com.py';
  document.querySelector('input[name=tipoOrg][value="Manufactura"]').checked=true;
  $('sector').value='Textil';
  document.querySelectorAll('#intereses input')[0].checked=true;
  document.querySelectorAll('#intereses input')[1].checked=true;
  document.querySelector('input[name=plazo]').checked=true;
  $('superficie').value='5000';
  $('empleos').value='120';
  $('comoNosConocio').value='Cámara o gremio';
  document.querySelector('input[name=calif][value="A - Caliente"]').checked=true;
  $('observaciones').value='Dueño con decisión.';
  document.querySelectorAll('#proximosPasos input')[1].checked=true;
  $('fechaSeguimiento').value='2026-07-08';
  $('responsable').value='Jaime Huang';

  await submit();
  check(sent.length===1, 'F3 完整表單成功送出');
  const p = sent[0].body;
  check(sent[0].contentType.startsWith('text/plain'), 'F3 Content-Type 為 text/plain（避開 CORS preflight）');

  // payload 欄位須與後端 doPost 讀取的 key 一致
  const backendKeys=['evento','promotor','nombre','empresa','cargo','pais','telefono','email',
    'tipoOrg','sector','intereses','plazo','superficie','empleos','comoNosConocio',
    'calificacion','observaciones','proximosPasos','fechaSeguimiento','responsable'];
  const missing = backendKeys.filter(k=>!(k in p));
  check(missing.length===0, 'F3 payload 20 個欄位與後端完全對齊'+(missing.length?` (缺:${missing})`:''));
  check(Array.isArray(p.intereses) && p.intereses.length===2, 'F3 intereses 為陣列(2項)');
  check(p.calificacion==='A - Caliente' && p.superficie==='5000', 'F3 分級與 m² 值正確');

  // F4 送出後清空但保留 evento/promotor
  check($('nombre').value==='' && $('observaciones').value==='', 'F4 送出後訪客欄位清空');
  check($('evento').value==='Expo Paraguay 2026' && $('promotor').value==='María González', 'F4 evento/promotor 保留');
  check(window.localStorage.getItem('ptitp_cola')===null || window.localStorage.getItem('ptitp_cola')==='[]', 'F4 成功送出不進離線佇列');

  // F5 斷線情境
  fetchMode='fail';
  $('nombre').value='Ana Souza';
  document.querySelector('input[name=calif][value="B - Tibio"]').checked=true;
  await submit();
  const cola = JSON.parse(window.localStorage.getItem('ptitp_cola')||'[]');
  check(cola.length===1 && cola[0].nombre==='Ana Souza', 'F5 斷線時問卷存入離線佇列');
  check(document.getElementById('pendientes-btn').style.display==='block', 'F5 顯示「重送待傳」按鈕');

  // 恢復連線重送
  fetchMode='ok';
  document.getElementById('pendientes-btn').click();
  await sleep(30);
  const cola2 = JSON.parse(window.localStorage.getItem('ptitp_cola')||'[]');
  check(cola2.length===0, 'F5 恢復連線後重送成功、佇列清空');
  check(sent.length===2 && sent[1].body.nombre==='Ana Souza', 'F5 重送內容正確');

  console.log(`\n═══ 前端測試結果: ${pass} 通過 / ${fail} 失敗 ═══`);
  process.exit(fail?1:0);
})();
