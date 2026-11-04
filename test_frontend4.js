// Fichas 入口按鈕測試
const fs=require('fs');const{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{runScripts:'dangerously',url:'https://x.github.io/',pretendToBeVisual:true});
let abierto={};dom.window.HTMLFormElement.prototype.submit=function(){abierto=JSON.parse(this.elements.reportRequest.value);};
setTimeout(()=>{
  const d=dom.window.document;let f=0;const c=(x,n)=>{x?console.log('✅',n):(f++,console.log('❌',n))};
  c(d.getElementById('fichas-btn'),'B1 fichas 按鈕存在');
  c(d.getElementById('ver-num').textContent==='v'+JSON.parse(fs.readFileSync('version.json','utf8')).v,'B1 顯示發行版本');
  d.getElementById('rep-token').value='test-admin-token-123456';
  d.getElementById('fichas-btn').click(); // 預設 repTipo=dia
  c(abierto.action==='fichas'&&abierto.tipo==='dia'&&abierto.token==='test-admin-token-123456','B2 點擊以 POST 開啟受保護 fichas 視圖');
  console.log(`\n═══ 前端 fichas 測試: ${3-f} 通過 / ${f} 失敗 ═══`);process.exit(f?1:0);
},80);
