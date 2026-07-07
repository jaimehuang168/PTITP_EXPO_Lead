// 報告寄送 UI 測試（v2：收件人+類型+範圍）
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://x.github.io/',pretendToBeVisual:true});
const{window}=dom;const{document}=window;
let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const opened=[];window.open=u=>{opened.push(u);return{}};
let confirmAns=true;window.confirm=()=>confirmAns;
const fetched=[];window.fetch=async u=>{fetched.push(u);return{json:async()=>({ok:true,enviado:'a test'})}};
const $=id=>document.getElementById(id);
const clickEnviar=()=>{$('enviar-reporte').click();return sleep(25)};

(async()=>{
  check($('rep-emails')&&$('rep-tipo')&&$('rep-rango'),'R1 收件人/類型/範圍元素存在');
  document.querySelectorAll('.tabs button').length; // sanity

  $('ver-hoy').click();$('ver-expo').click();
  check(opened[0].includes('?action=reporte')&&opened[1].includes('?action=reporteExpo'),'R1 兩個預覽按鈕正常');

  // 無 email 擋下
  await clickEnviar();
  check(fetched.length===0,'R2 未填 email 不寄送');
  // 無效 email 擋下
  $('rep-emails').value='no-valido';
  await clickEnviar();
  check(fetched.length===0,'R2 無效 email 不寄送');

  // 當日報告
  $('rep-emails').value='jefe@ptitp.com.py, dir@gob.py';
  $('rep-emails').dispatchEvent(new window.Event('change'));
  await clickEnviar();
  check(fetched.length===1&&fetched[0].includes('action=enviarReporteA')&&fetched[0].includes('tipo=dia'),'R3 當日報告呼叫正確');
  check(decodeURIComponent(fetched[0]).includes('jefe@ptitp.com.py,dir@gob.py'),'R3 多收件人正確傳遞');
  check(window.localStorage.getItem('ptitp_rep_emails').includes('jefe@'),'R3 收件人記憶於裝置');

  // 範圍：切換顯示 + 缺日期擋下
  document.querySelector('input[name=repTipo][value=rango]').checked=true;
  document.querySelector('input[name=repTipo][value=rango]').dispatchEvent(new window.Event('change'));
  check($('rep-rango').style.display==='grid','R4 選「rango」顯示日期欄');
  await clickEnviar();
  check(fetched.length===1,'R4 缺日期不寄送');
  $('rep-desde').value='2026-07-09';$('rep-hasta').value='2026-07-05';
  await clickEnviar();
  check(fetched.length===1,'R4 desde>hasta 不寄送');
  $('rep-desde').value='2026-07-05';$('rep-hasta').value='2026-07-08';
  await clickEnviar();
  check(fetched.length===2&&fetched[1].includes('tipo=rango')&&fetched[1].includes('desde=2026-07-05')&&fetched[1].includes('hasta=2026-07-08'),'R4 範圍報告參數正確');

  // 全展期
  document.querySelector('input[name=repTipo][value=expo]').checked=true;
  document.querySelector('input[name=repTipo][value=expo]').dispatchEvent(new window.Event('change'));
  check($('rep-rango').style.display==='none','R5 選「expo」隱藏日期欄');
  await clickEnviar();
  check(fetched.length===3&&fetched[2].includes('tipo=expo'),'R5 全展期報告呼叫正確');

  // PDF 下載按鈕
  document.querySelector('input[name=repTipo][value=dia]').checked=true;
  $('pdf-reporte').click();
  check(opened.length===3&&opened[2].includes('action=reportePdf')&&opened[2].includes('tipo=dia'),'R7 PDF 按鈕開啟下載頁（dia）');
  document.querySelector('input[name=repTipo][value=rango]').checked=true;
  $('rep-desde').value='';$('rep-hasta').value='';
  $('pdf-reporte').click();
  check(opened.length===3,'R7 範圍缺日期不開下載頁');
  $('rep-desde').value='2026-07-05';$('rep-hasta').value='2026-07-08';
  $('pdf-reporte').click();
  check(opened.length===4&&opened[3].includes('tipo=rango')&&opened[3].includes('desde=2026-07-05'),'R7 範圍 PDF 參數正確');

  // 取消確認
  confirmAns=false;
  await clickEnviar();
  check(fetched.length===3,'R6 取消確認不寄送');
  check($('enviar-reporte').disabled===false,'R6 按鈕狀態恢復');

  console.log(`\n═══ 報告寄送 UI 測試: ${pass} 通過 / ${fail} 失敗 ═══`);
  process.exit(fail?1:0);
})();
