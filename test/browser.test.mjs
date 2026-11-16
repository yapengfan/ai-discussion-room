import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {BrowserBridge,domSnapshot,SELECTORS} from '../lib/browser.mjs';

test('real Edge fixtures: three adapters send once, reject drafts, ignore history and capture completed reply',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const provider of ['ChatGPT','Gemini','Claude']){
      const page=await browser.newPage();
      const host={ChatGPT:'chatgpt.com',Gemini:'gemini.google.com',Claude:'claude.ai'}[provider];
      const shell={ChatGPT:{assistant:'<div data-message-author-role="assistant">',close:'</div>',editor:'<textarea id="prompt-textarea"></textarea>',send:'data-testid="send-button"',stop:'data-testid="stop-button"'},Gemini:{assistant:'<model-response><div class="model-response-text">',close:'</div></model-response>',editor:'<rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea>',send:'class="send-button"',stop:'class="stop-button"'},Claude:{assistant:'<div data-testid="chat-message"><div class="font-claude-message">',close:'</div></div>',editor:'<div contenteditable="true" role="textbox"></div>',send:'aria-label="Send message"',stop:'aria-label="Stop response"'}}[provider];
      const response=shell.assistant+'new complete reply<button aria-label="Copy">copy</button>'+shell.close;
      const html=`<style>[contenteditable]{width:400px;min-height:40px}</style><main>${shell.assistant}old history${shell.close}</main>${shell.editor}<button ${shell.send} id="send">send</button><script>window.sends=0;document.querySelector('#send').onclick=()=>{window.sends++;const editor=document.querySelector('textarea,[contenteditable]');if(editor.tagName==='TEXTAREA')editor.value='';else editor.innerText='';const stop=document.createElement('button');stop.setAttribute('id','stop');${provider==='ChatGPT'?"stop.dataset.testid='stop-button'":provider==='Gemini'?"stop.className='stop-button'":"stop.setAttribute('aria-label','Stop response')"};document.body.append(stop);setTimeout(()=>{document.querySelector('main').insertAdjacentHTML('beforeend',${JSON.stringify(response)});stop.remove();},80);};</script>`;
      await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto(`https://${host}/app/test`);
      const bridge=new BrowserBridge('.test-data',{pollInterval:20,replyTimeout:1500,settleMs:50});bridge.pages.set(provider,page);
      const signal=new AbortController().signal;
      const p=await bridge.prepare(provider,page.url(),'hello group',signal);
      assert.deepEqual((await page.evaluate(domSnapshot,SELECTORS[provider])).assistant,['old history']);
      await bridge.submit(p,signal);const reply=await bridge.wait(p,signal,()=>{});
      assert.equal(reply.text,'new complete reply');assert.equal(await page.evaluate(()=>window.sends),1);
      await page.locator('textarea,[contenteditable]').fill('my draft');await assert.rejects(()=>bridge.prepare(provider,page.url(),'new',signal),/草稿/);
      await page.close();
    }
  }finally{await browser.close();}
});
test('unknown completion or unchanged history times out without re-clicking send',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main><div data-message-author-role="assistant">old</div></main><textarea id="prompt-textarea"></textarea><button data-testid="send-button">send</button>'}));await page.goto('https://chatgpt.com/c/test');
    const bridge=new BrowserBridge('.test-data',{replyTimeout:100,pollInterval:20,settleMs:30});bridge.pages.set('ChatGPT',page);
    const signal=new AbortController().signal;const p=await bridge.prepare('ChatGPT',page.url(),'hello',signal);
    await assert.rejects(()=>bridge.wait(p,signal,()=>{}),/超时/);
  }finally{await browser.close();}
});
