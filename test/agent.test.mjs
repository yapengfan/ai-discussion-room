import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
test('connector content agent sends once, preserves drafts, rejects duplicate and changed document',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const [provider,host,editor,assistant,send]of[
      ['ChatGPT','chatgpt.com','<div contenteditable="true" role="textbox" aria-label="询问 ChatGPT"></div>','<div data-message-author-role="assistant">old</div>','aria-label="发送"'],
      ['Gemini','gemini.google.com','<rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea>','<model-response><div class="model-response-text">old</div></model-response>','class="send-button"'],
      ['DeepSeek','chat.deepseek.com','<textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea>','<div data-message-role="user">user prompt</div><div class="ds-think-content"><div class="ds-markdown">private reasoning</div></div><div class="ds-markdown">old</div>','aria-label="发送"'],
      ['Claude','claude.ai','<div contenteditable="true" role="textbox"></div>','<div class="font-claude-message">old</div>','aria-label="Send message"']]){
      const dynamicSend=provider==='Gemini';
      const sendMarkup=dynamicSend?'':`<button ${send} id="send">send</button>`;
      const script=dynamicSend?`window.clicks=0;document.querySelector('[contenteditable]').addEventListener('input',()=>{if(document.querySelector('#send'))return;const b=document.createElement('button');b.id='send';b.setAttribute('aria-label','发送');b.textContent='send';b.onclick=()=>window.clicks++;document.body.append(b);});`:`window.clicks=0;document.querySelector('#send').onclick=()=>window.clicks++;`;
      const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<meta charset="utf-8"><style>[contenteditable]{width:400px;min-height:40px}</style><main>${assistant}</main>${editor}${sendMarkup}<script>${script}window.chrome={runtime:{id:'fixture',onMessage:{addListener(fn){window.agentListener=fn;}}}};</script>`}));await page.goto(`https://${host}/app/test`);
      for(const file of ['selectors.js','editor.js','send-control.js','deepseek.js','agent.js'])await page.addScriptTag({content:await readFile(new URL('../browser-connector/'+file,import.meta.url),'utf8')});
      const command=async(action,args={})=>page.evaluate(({action,args})=>new Promise(r=>window.agentListener({type:'ROOM_COMMAND',action,args},{id:'fixture'},r)),{action,args:{provider,...args}});
      const snap=await command('SNAPSHOT');assert.equal(snap.ok,true);
      for(const file of ['selectors.js','editor.js','send-control.js','deepseek.js','agent.js'])await page.addScriptTag({content:await readFile(new URL('../browser-connector/'+file,import.meta.url),'utf8')});
      assert.equal((await command('SNAPSHOT')).result.documentKey,snap.result.documentKey);assert.deepEqual(snap.result.assistant,['old']);if(dynamicSend)assert.equal(snap.result.sendFound,false);
      const args={provider,url:page.url(),documentKey:snap.result.documentKey,actionId:'a',text:'a real fixture prompt\nsecond line'};
      const submitted=await command('SUBMIT',args);assert.equal(submitted.ok,true,provider+': '+submitted.error);assert.equal(await page.evaluate(()=>window.clicks),1);
      assert.equal((await command('SUBMIT',args)).ok,false);assert.equal(await page.evaluate(()=>window.clicks),1);
      assert.equal((await command('SUBMIT',{...args,actionId:'b',documentKey:'wrong'})).ok,false);
      assert.equal((await command('SUBMIT',{...args,actionId:'c'})).ok,false); // Existing draft remains untouched.
      assert.match(await page.locator('textarea,[contenteditable]').evaluate(el=>el.value??el.innerText),/fixture prompt/);
      await page.close();
    }
  }finally{await browser.close();}
});


