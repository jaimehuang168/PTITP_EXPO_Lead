// 名片掃描前端測試（獨立檔，納入版控）
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://x.github.io/',pretendToBeVisual:true});
dom.window.fetch=async()=>({json:async()=>({ok:true})});
setTimeout(()=>{
  const d=dom.window.document;let f=0;
  const c=(x,n)=>{x?console.log('✅',n):(f++,console.log('❌',n))};
  c(d.getElementById('scan-btn')&&d.getElementById('tarjeta-file'),'S1 掃描按鈕與檔案輸入存在');
  c(d.getElementById('tarjeta-file').getAttribute('capture')==='environment','S1 直接開後鏡頭');
  c(d.getElementById('tarjetaUrl')&&d.getElementById('tarjeta-thumb'),'S1 隱藏欄與縮圖存在');
  dom.window.aplicarDatosTarjeta({nombre:'Lin Wei-Chen',empresa:'Formosa Electronics',cargo:'VP',telefono:'+886 912',email:'w@f.tw',pais:'Taiwan'});
  c(d.getElementById('nombre').value==='Lin Wei-Chen'&&d.getElementById('empresa').value==='Formosa Electronics','S2 辨識結果自動填欄');
  c(d.getElementById('pais').value==='Taiwán','S2 國別正規化 Taiwan→Taiwán');
  c(dom.window.normalizarPais('United States')==='EE.UU.'&&dom.window.normalizarPais('Suiza')==='Otro','S2 國別對映與 fallback');
  d.getElementById('tarjetaUrl').value='https://drive.google.com/test';
  const p=dom.window.datos();
  c(p.tarjetaUrl==='https://drive.google.com/test','S3 payload 含 tarjetaUrl');
  dom.window.limpiar();
  c(d.getElementById('tarjetaUrl').value===''&&d.getElementById('tarjeta-thumb').hidden===true,'S3 limpiar 清除掃描狀態');
  console.log(`\n═══ 名片前端測試: ${pass=8-f} 通過 / ${f} 失敗 ═══`);process.exit(f?1:0);
},60);
