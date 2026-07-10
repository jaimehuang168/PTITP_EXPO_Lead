// W2 前端測試（demo 模式）
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('Index_CRM.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
const{window}=dom;const d=window.document;
window.confirm=()=>true;
let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
setTimeout(()=>{ setTimeout(()=>{
  // 編輯客戶
  window.abrirLead('L-1');
  window.modoEditarLead();
  check(d.getElementById('m-editor').className==='m-bloque','V1 編輯模式開啟');
  check(d.getElementById('ed-empresa').value==='Textil del Este SA'&&d.getElementById('ed-sup').value==='5000','V1 表單帶入現值');
  check(d.getElementById('ed-calif').value.charAt(0)==='A','V1 評級下拉預選');
  d.getElementById('ed-empresa').value='Textil Este SRL';
  d.getElementById('ed-prob').value='75';
  window.guardarLead();
  setTimeout(()=>{
    check(window.buscar('L-1').empresa==='Textil Este SRL'&&window.buscar('L-1').prob==='75','V1 儲存後本地資料同步');
    // Lotes 分頁
    window.verTab('lotes');
    check(d.getElementById('sec-lotes').className!=='oculto','V2 Lotes 分頁切換');
    setTimeout(()=>{
      check(d.querySelectorAll('#lista-lotes .lfila').length===5,'V2 地塊清單渲染');
      check(d.querySelectorAll('#lista-ocup .ocard').length===2,'V2 租用卡渲染');
      check(d.getElementById('lotes-resumen').textContent.includes('191.295'),'V2 摘要含可用 m²');
      check(d.querySelector('.est-parcial')&&d.querySelector('.est-reservado'),'V2 狀態色標');
      check(d.querySelectorAll('.pend').length>=2,'V2b 待確認 ⚠ 標記（lote 與 ocupación）');
      check(d.getElementById('lotes-resumen').textContent.includes('provisorios')||d.querySelector('#lotes-resumen .aviso-pend'),'V2b 摘要含資料未定警語');
      // 搜尋
      d.getElementById('buscar-lote').value='XII';
      window.pintarLotes();
      check(d.querySelectorAll('#lista-lotes .lfila').length===1,'V3 搜尋過濾');
      // 編輯 lote modal
      window.abrirLote('XII-05');
      check(d.getElementById('velo2').className===''&&d.getElementById('l-m2').value==='2800','V4 Lote 編輯表單帶值');
      check(d.getElementById('l-verif')&&d.getElementById('l-verif').value==='sí','V4b 表單含確認狀態欄位');
      check(d.getElementById('m2-borrar-fila').className==='botones','V4 既有 lote 顯示刪除鈕');
      window.cerrarModal2();
      // 新增 ocupación modal
      window.abrirOcup(null);
      check(d.getElementById('m2-titulo').textContent==='Nueva ocupación','V5 新增租用表單');
      check(d.getElementById('m2-borrar-fila').className.includes('oculto'),'V5 新增模式無刪除鈕');
      d.getElementById('o-empresa').value='TestCo';
      d.getElementById('m2-guardar').onclick();
      setTimeout(()=>{
        check(d.getElementById('toast').textContent.includes('guardada'),'V5 儲存回饋');
        console.log(`\n═══ Web W2 前端測試: ${pass} 通過 / ${fail} 失敗 ═══`);
        process.exit(fail?1:0);
      },250);
    },250);
  },250);
},250);},50);
