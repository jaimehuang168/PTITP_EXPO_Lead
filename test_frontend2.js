// 補充測試：報告按鈕
const fs=require('fs');const{JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://jaimehuang168.github.io/PTITP_EXPO_Lead/',pretendToBeVisual:true});
const{window}=dom;const{document}=window;
let pass=0,fail=0;const check=(c,n)=>{c?(pass++,console.log('✅',n)):(fail++,console.log('❌',n))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const opened=[];window.open=(u)=>{opened.push(u);return{}};
let confirmAns=true;window.confirm=()=>confirmAns;
const fetched=[];window.fetch=async(u)=>{fetched.push(u);return{json:async()=>({ok:true,email:'no configurado (solo guardado en la hoja Reportes)'})}};

(async()=>{
  check(document.getElementById('ver-hoy')&&document.getElementById('ver-expo')&&document.getElementById('enviar-reporte'),'R1 三個報告按鈕存在');

  document.getElementById('ver-hoy').click();
  check(opened[0]&&opened[0].includes('?action=reporte')&&!opened[0].includes('Expo'),'R2 「當日報告」開啟 ?action=reporte');

  document.getElementById('ver-expo').click();
  check(opened[1]&&opened[1].includes('?action=reporteExpo'),'R2 「累計報告」開啟 ?action=reporteExpo');

  // 取消確認 → 不送
  confirmAns=false;
  document.getElementById('enviar-reporte').click();
  await sleep(20);
  check(fetched.length===0,'R3 取消確認時不觸發寄送');

  // 確認 → 送出
  confirmAns=true;
  document.getElementById('enviar-reporte').click();
  await sleep(20);
  check(fetched.length===1&&fetched[0].includes('?action=enviarReporte'),'R3 確認後呼叫 ?action=enviarReporte');
  check(document.getElementById('enviar-reporte').disabled===false,'R3 寄送完按鈕恢復可用');

  console.log(`\n═══ 報告按鈕測試: ${pass} 通過 / ${fail} 失敗 ═══`);
  process.exit(fail?1:0);
})();
