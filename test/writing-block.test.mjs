import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {domSnapshot,SELECTORS} from '../lib/browser.mjs';
test('assistant writing block is captured and never chosen as the user composer',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<style>[contenteditable]{width:500px;min-height:40px}</style><main><div class="isolate"><div data-turn-key="new"><div data-talvt-turn-state="complete"><div data-response-body="writing-id"><form><div role="textbox" contenteditable="true" aria-label="开始写作"><p>这是完整的写作块回复。</p><p>第二段也应被收录。</p></div></form><button aria-label="复制">copy</button></div></div></div><form><div role="textbox" aria-label="询问 ChatGPT" contenteditable="true" id="composer"></div><button type="button" aria-label="发送" id="send">↑</button></form></div></main><script>window.clicks=0;document.querySelector("#send").onclick=()=>window.clicks++;window.chrome={runtime:{id:"fixture",onMessage:{addListener(fn){window.agentListener=fn;}}}};</script>'}));await page.goto('https://chatgpt.com/c/test');
    const raw=await page.evaluate(domSnapshot,SELECTORS.ChatGPT);assert.deepEqual(raw.assistant,['这是完整的写作块回复。\n第二段也应被收录。']);assert.deepEqual(raw.assistantKeys,['writing-id']);assert.equal(raw.completed,true);
    for(const file of ['selectors.js','editor.js','send-control.js','deepseek.js','agent.js'])await page.addScriptTag({content:await readFile(new URL('../browser-connector/'+file,import.meta.url),'utf8')});
    const call=(action,args)=>page.evaluate(({action,args})=>new Promise(r=>agentListener({type:'ROOM_COMMAND',action,args},{id:'fixture'},r)),{action,args:{provider:'ChatGPT',...args}});
    const snap=await call('SNAPSHOT',{});assert.equal(snap.result.editor,true);assert.equal(snap.result.draft,'');
    const result=await call('SUBMIT',{url:page.url(),documentKey:snap.result.documentKey,actionId:'next',text:'new user message'});assert.equal(result.ok,true,result.error);assert.equal(await page.evaluate(()=>clicks),1);
    assert.equal(await page.locator('#composer').innerText(),'new user message');assert.equal(await page.getByRole('textbox',{name:'开始写作',exact:true}).innerText(),'这是完整的写作块回复。\n\n第二段也应被收录。');
  }finally{await browser.close();}
});
