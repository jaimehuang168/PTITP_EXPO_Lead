// Fichas 入口按鈕測試
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://x.github.io/',pretendToBeVisual:true});
let abierto='';dom.window.open=u=>{abierto=u;return null};
setTimeout(()=>{
  const d=dom.window.document;let f=0;const c=(x,n)=>{x?console.log('✅',n):(f++,console.log('❌',n))};
  c(d.getElementById('fichas-btn'),'B1 fichas 按鈕存在');
  c(d.getElementById('ver-num').textContent==='v1.9.1','B1 版本 1.9.1');
  d.getElementById('fichas-btn').click(); // 預設 repTipo=dia
  c(abierto.includes('action=fichas')&&abierto.includes('tipo='),'B2 點擊開啟 fichas 視圖: '+abierto.slice(-35));
  console.log(`\n═══ 前端 fichas 測試: ${3-f} 通過 / ${f} 失敗 ═══`);process.exit(f?1:0);
},80);
