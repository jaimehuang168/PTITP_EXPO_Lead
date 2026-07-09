// W1 前端測試（demo 模式：無 google 物件時自動用示範資料）
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('Index_CRM.html','utf8'),{runScripts:'dangerously',pretendToBeVisual:true});
const{window}=dom;const d=window.document;
let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
window.document.addEventListener('DOMContentLoaded',()=>{});
setTimeout(()=>{ setTimeout(()=>{ // 等 demo srv 的 120ms
  check(d.querySelectorAll('.kpi').length===6,'U1 六張 KPI 卡渲染');
  check(d.getElementById('kpis').textContent.includes('7.800'),'U1 加權 m² 千分位顯示');
  check(d.querySelectorAll('#funnel .ffila').length===9,'U1 漏斗九階段');
  check(d.getElementById('ley-suelo').textContent.includes('191.295'),'U1 土地可用率數字');
  // 看板
  check(d.querySelectorAll('#kanban .col').length===9,'U2 看板九欄');
  const cards=d.querySelectorAll('#kanban .card');
  check(cards.length===4,'U2 四張客戶卡');
  check(d.querySelector('.card.cA')&&d.querySelector('.card.cB')&&d.querySelector('.card.cC'),'U2 A/B/C 色條分級');
  check(d.querySelector('.lim.vencida')!==null,'U2 逾期紅字標示');
  check(cards[0].getAttribute('draggable')==='true','U2 卡片可拖拉');
  // Modal
  window.abrirLead('L-1');
  check(d.getElementById('velo').className!=='oculto','U3 點卡開詳情');
  check(d.getElementById('m-nombre').textContent==='Carlos Benítez','U3 詳情姓名');
  check(d.querySelector('#m-contacto a[href^="tel:"]')&&d.querySelector('#m-contacto a[href*="wa.me"]'),'U3 電話/WhatsApp 可點');
  check(d.getElementById('m-etapa').value==='En negociación','U3 階段選單預選當前');
  setTimeout(()=>{
    check(d.getElementById('m-hist').textContent.includes('Llamado inicial'),'U3 活動史載入');
    // 換階段（樂觀更新）
    window.cambiarEtapa('L-3','Contactado');
    setTimeout(()=>{
      const colCont=[...d.querySelectorAll('.col')].find(c=>c.getAttribute('data-etapa')==='Contactado');
      check(colCont.querySelectorAll('.card').length===2,'U4 換階段後看板即時更新');
      // 記聯繫驗證
      window.abrirLead('L-2');
      d.getElementById('m-resumen').value='Reunión de seguimiento';
      window.guardarActividad();
      setTimeout(()=>{
        check(d.getElementById('velo').className==='oculto','U5 記聯繫後關閉 modal');
        check(d.getElementById('toast').textContent.includes('registrado'),'U5 toast 回饋');
        // 分頁切換
        window.verTab('pipe');
        check(d.getElementById('sec-pipe').className!=='oculto'&&d.getElementById('sec-panel').className==='oculto','U6 分頁切換');
        console.log(`\n═══ Web W1 前端測試: ${pass} 通過 / ${fail} 失敗 ═══`);
        process.exit(fail?1:0);
      },200);
    },200);
  },200);
},250);},50);
