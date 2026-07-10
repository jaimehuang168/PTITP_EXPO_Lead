// W3 前端測試（demo 模式）：地圖多邊形、Visitas 分頁
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('Index_CRM.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
const{window}=dom;const d=window.document;
let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
setTimeout(()=>{ setTimeout(()=>{
  check(window.parseImg('img:41%,25.5%')[0]===41&&window.parseImg('img:41%,25.5%')[1]===25.5,'X1 座標解析');
  check(window.parseImg('')===null&&window.parseImg('12,34')===null,'X1 無效座標回 null');
  window.verTab('lotes');
  setTimeout(()=>{
    const polys=d.querySelectorAll('#mapa-svg polygon');
    check(polys.length===5,'X2 五個示範地塊都畫出多邊形');
    check(d.querySelector('#mapa-svg .mp-disponible')&&d.querySelector('#mapa-svg .mp-ocupado')&&d.querySelector('#mapa-svg .mp-reservado')&&d.querySelector('#mapa-svg .mp-parcial')&&d.querySelector('#mapa-svg .mp-otro'),'X2 五種狀態色齊備');
    check(d.getElementById('mapa-nota').textContent.indexOf('5 zonas mapeadas')===0,'X2 註記涵蓋率與近似聲明');
    check(polys[0].querySelector('title').textContent.includes('VI-01'),'X2 多邊形含提示資訊');
    // 點多邊形開編輯
    window.abrirLote(polys[0].getAttribute('data-id'));
    check(d.getElementById('velo2').className===''&&d.getElementById('m2-titulo').textContent.includes('VI-01'),'X3 點地塊開編輯表單');
    window.cerrarModal2();
    // Visitas
    window.verTab('vis');
    setTimeout(()=>{
      check(d.querySelectorAll('#lista-vis .vcard').length===2,'X4 參訪卡渲染');
      check(d.querySelector('.est-confirmada')&&d.querySelector('.est-realizada'),'X4 狀態色標');
      check(d.getElementById('lista-vis').textContent.includes('Minuta: Interesado'),'X4 minuta 顯示');
      window.abrirVisita(null);
      check(d.getElementById('m2-titulo').textContent==='Nueva visita','X5 新增參訪表單');
      check(d.getElementById('v-lead')&&d.getElementById('v-lead').options.length>=3,'X5 lead 下拉排除已結案');
      d.getElementById('v-fecha').value='2026-08-01';
      d.getElementById('m2-guardar').onclick();
      setTimeout(()=>{
        check(d.getElementById('toast').textContent.includes('Procesar'),'X5 儲存提示走 Procesar 流程');
        window.abrirVisita('V-1');
        check(d.getElementById('v-estado')&&d.getElementById('v-estado').value==='confirmada','X6 編輯模式含估態與 minuta 欄');
        console.log(`\n═══ Web W3 前端測試: ${pass} 通過 / ${fail} 失敗 ═══`);
        process.exit(fail?1:0);
      },250);
    },250);
  },300);
},250);},50);
