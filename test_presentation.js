const assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {installBrowserAuth}=require('./test_helpers/browser-auth.cjs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
let failures=0;
async function test(name,run){
  let dom;const sent=[];
  try{
    dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://example.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
      for(const file of ['mobile-ui.js','presentation.js'])if(fs.existsSync(file))w.eval(fs.readFileSync(file,'utf8'));
      installBrowserAuth(w,{admin:false});
      w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
      w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
      w.fetch=async(url,options)=>{if(options?.body)sent.push(JSON.parse(options.body));return{ok:true,json:async()=>({v:'1.16.0',ok:true})};};
    }});
    await tick();await run(dom.window,dom.window.document,sent);console.log('PASS '+name);
  }catch(error){failures++;console.error('FAIL '+name+': '+error.message);}finally{dom?.window.close();}
}
(async()=>{
  await test('staff can open all seven supplied posters without submitting or losing a registration draft',async(w,d,sent)=>{
    const tab=d.querySelector('[data-tab="tab-presentacion"]');assert(tab,'presentation must be a distinct tab');
    d.getElementById('nombre').value='Unsent visitor';d.getElementById('email').value='draft@example.com';tab.click();
    assert(d.getElementById('tab-presentacion').classList.contains('activa'));assert(d.getElementById('mobile-savebar').hidden);
    const cards=[...d.querySelectorAll('[data-presentation-index]')];assert.equal(cards.length,7);
    for(const card of cards){card.click();assert(d.getElementById('presentation-dialog').open);assert(d.getElementById('presentation-image').getAttribute('src').startsWith('assets/presentation/'));d.getElementById('presentation-close').click();}
    d.querySelector('[data-tab="tab-registro"]').click();assert.equal(d.getElementById('nombre').value,'Unsent visitor');assert.equal(d.getElementById('email').value,'draft@example.com');assert.equal(sent.length,0);
  });
  await test('presentation navigation stays within bounds and resets zoom on each new poster',async(w,d)=>{
    assert(d.getElementById('presentation-start'));d.getElementById('presentation-start').click();
    assert.equal(d.getElementById('presentation-previous').disabled,true);assert.match(d.getElementById('presentation-counter').textContent,/1.*7/);
    d.getElementById('presentation-zoom-in').click();assert.equal(d.getElementById('presentation-stage').dataset.zoomed,'true');
    d.getElementById('presentation-next').click();assert.equal(d.getElementById('presentation-stage').dataset.zoomed,'false');
    for(let i=0;i<8;i++)d.getElementById('presentation-next').click();assert.match(d.getElementById('presentation-counter').textContent,/7.*7/);assert(d.getElementById('presentation-next').disabled);
    d.getElementById('presentation-previous').click();assert.match(d.getElementById('presentation-counter').textContent,/6.*7/);
  });
  await test('keyboard navigation and closing return focus to the original poster button',async(w,d)=>{
    const card=d.querySelector('[data-presentation-index="2"]');assert(card);card.focus();card.click();
    const dialog=d.getElementById('presentation-dialog');dialog.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.match(d.getElementById('presentation-counter').textContent,/4.*7/);
    dialog.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));assert.match(d.getElementById('presentation-counter').textContent,/3.*7/);
    d.getElementById('presentation-close').click();assert.equal(dialog.open,false);assert.equal(d.activeElement,card);
  });
  await test('a failed image shows a retry and clears its error when a different poster is selected',async(w,d)=>{
    assert(d.getElementById('presentation-start'));d.getElementById('presentation-start').click();d.getElementById('presentation-image').dispatchEvent(new w.Event('error'));
    assert.equal(d.getElementById('presentation-error').hidden,false);assert.equal(d.getElementById('presentation-retry').hidden,false);
    d.getElementById('presentation-next').click();assert.equal(d.getElementById('presentation-error').hidden,true);
  });
  await test('keyboard users can pan an enlarged poster without changing the slide',async(w,d)=>{
    d.querySelector('[data-tab="tab-presentacion"]').click();d.getElementById('presentation-start').click();d.getElementById('presentation-zoom-in').click();
    const stage=d.getElementById('presentation-stage'),key=new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true});stage.dispatchEvent(key);
    assert.match(d.getElementById('presentation-counter').textContent,/1.*7/);assert.equal(key.defaultPrevented,false,'native scrolling must receive the arrow key');
    stage.focus();assert.equal(d.activeElement,stage,'the enlarged image region must be keyboard focusable');assert.equal(stage.dataset.zoomed,'true');
  });
  await test('fit keeps the complete poster inside a short landscape stage and recalculates after rotation',async(w,d)=>{
    const stage=d.getElementById('presentation-stage');let width=844,height=198;
    Object.defineProperties(stage,{clientWidth:{get:()=>width},clientHeight:{get:()=>height}});
    d.getElementById('presentation-start').click();
    const fittedWidth=()=>parseFloat(d.getElementById('presentation-image').style.width);
    assert(fittedWidth()>0,'fit must use the available stage dimensions');
    assert(fittedWidth()<=width&&fittedWidth()*1280/1024<=height,'the entire original aspect ratio must fit');
    width=390;height=658;w.dispatchEvent(new w.Event('resize'));
    assert(fittedWidth()>=389&&fittedWidth()<=390,'rotation should use the wider available image size');
    d.getElementById('presentation-zoom-in').click();assert(fittedWidth()>width);
    d.getElementById('presentation-fit').click();assert(fittedWidth()<=width);assert.equal(stage.dataset.zoomed,'false');
  });
  if(failures)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
