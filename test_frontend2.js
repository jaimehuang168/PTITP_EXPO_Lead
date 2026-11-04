// 報告寄送 UI 測試（管理密鑰 + Config 收件人 + 類型 + 範圍）
const fs=require('fs');const{JSDOM}=require('jsdom');
let authControl;
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://x.github.io/',pretendToBeVisual:true,beforeParse(w){authControl=require('./test_helpers/browser-auth.cjs').installBrowserAuth(w,{signedIn:false,admin:false});}});
const{window}=dom;const{document}=window;
let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const opened=[];window.open=u=>{opened.push(u);return{}};
window.HTMLFormElement.prototype.submit=function(){
  const payload=JSON.parse(this.elements.reportRequest.value);
  check(this.method==='post' && !this.action.includes('token='),'Report credentials stay out of the URL');
  opened.push(payload);
};
let confirmAns=true;window.confirm=()=>confirmAns;
const fetched=[];window.fetch=async (u,o)=>{fetched.push({url:u,body:o&&o.body?JSON.parse(o.body):null,method:o&&o.method});return{json:async()=>({ok:true,enviado:'a test'})}};
const $=id=>document.getElementById(id);
const clickEnviar=()=>{$('enviar-reporte').click();return sleep(25)};

(async()=>{
  await sleep(25);
  check(!$('rep-token')&&$('rep-tipo')&&$('rep-rango'),'R1 Google 身分取代共用管理密鑰');
  document.querySelectorAll('.tabs button').length; // sanity

  $('ver-hoy').click();$('ver-expo').click();
  check(opened.length===0,'R1 未填管理密鑰不開啟報告');

  // 無管理密鑰擋下
  await clickEnviar();
  check(fetched.length===0,'R2 未填管理密鑰不寄送');
  authControl.setUser(authControl.user());await sleep(25);
  await clickEnviar();
  check(fetched.length===0,'R2 一般 Google 使用者不可寄送');

  // 當日報告
  authControl.setUser(authControl.user('operator-uid','jaimehuang168@gmail.com'));await sleep(25);
  $('ver-hoy').click();$('ver-expo').click();
  await sleep(25);
  check(opened[0].idToken==='firebase-fixture-operator-uid'&&opened[1].idToken==='firebase-fixture-operator-uid'&&opened[0].evento==='EXPO PBW','R3 預覽使用管理員 Google 身分與活動');
  await clickEnviar();
  check(fetched.length===1&&fetched[0].method==='POST'&&fetched[0].body.accion==='enviarReporteA'&&fetched[0].body.tipo==='dia','R3 當日報告使用 POST 呼叫正確');
  check(!('emails' in fetched[0].body)&&fetched[0].body.idToken==='firebase-fixture-operator-uid','R3 不傳任意收件人且附 Google 身分');
  check(window.sessionStorage.getItem('ptitp_rep_token')===null,'R3 不保存舊管理密鑰');

  // 範圍：切換顯示 + 缺日期擋下
  document.querySelector('input[name=repTipo][value=rango]').checked=true;
  document.querySelector('input[name=repTipo][value=rango]').dispatchEvent(new window.Event('change'));
  check($('rep-rango').style.display==='grid','R4 選「rango」顯示日期欄');
  $('rep-desde').value='';$('rep-hasta').value='';
  await clickEnviar();
  check(fetched.length===1,'R4 缺日期不寄送');
  $('rep-desde').value='2026-07-09';$('rep-hasta').value='2026-07-05';
  await clickEnviar();
  check(fetched.length===1,'R4 desde>hasta 不寄送');
  $('rep-desde').value='2026-07-05';$('rep-hasta').value='2026-07-08';
  await clickEnviar();
  check(fetched.length===2&&fetched[1].body.tipo==='rango'&&fetched[1].body.desde==='2026-07-05'&&fetched[1].body.hasta==='2026-07-08','R4 範圍報告參數正確');

  // 全展期
  document.querySelector('input[name=repTipo][value=expo]').checked=true;
  document.querySelector('input[name=repTipo][value=expo]').dispatchEvent(new window.Event('change'));
  check($('rep-rango').style.display==='none','R5 選「expo」隱藏日期欄');
  await clickEnviar();
  check(fetched.length===3&&fetched[2].body.tipo==='expo','R5 全展期報告呼叫正確');

  // PDF 下載按鈕
  document.querySelector('input[name=repTipo][value=dia]').checked=true;
  $('pdf-reporte').click();
  await sleep(25);
  check(opened.length===3&&opened[2].action==='reportePdf'&&opened[2].tipo==='dia'&&opened[2].idToken==='firebase-fixture-operator-uid','R7 PDF 按鈕以 POST 開啟受保護下載頁（dia）');
  document.querySelector('input[name=repTipo][value=rango]').checked=true;
  $('rep-desde').value='';$('rep-hasta').value='';
  $('pdf-reporte').click();
  check(opened.length===3,'R7 範圍缺日期不開下載頁');
  $('rep-desde').value='2026-07-05';$('rep-hasta').value='2026-07-08';
  $('pdf-reporte').click();
  await sleep(25);
  check(opened.length===4&&opened[3].tipo==='rango'&&opened[3].desde==='2026-07-05','R7 範圍 PDF 參數正確');

  // 取消確認
  confirmAns=false;
  await clickEnviar();
  check(fetched.length===3,'R6 取消確認不寄送');
  check($('enviar-reporte').disabled===false,'R6 按鈕狀態恢復');

  console.log(`\n═══ 報告寄送 UI 測試: ${pass} 通過 / ${fail} 失敗 ═══`);
  process.exit(fail?1:0);
})();
