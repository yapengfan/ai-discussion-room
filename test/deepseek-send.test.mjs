import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';

test('DeepSeek unlabeled send uses exactly one Enter after verified fill, other providers never use it',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const [provider,host,editor] of [['DeepSeek','chat.deepseek.com','<textarea id="chat-input" placeholder="发送消息"></textarea>'],['ChatGPT','chatgpt.com','<div role="textbox" contenteditable="true" aria-label="询问 ChatGPT"></div>']]){
      const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<style>textarea,[contenteditable]{width:400px;min-height:50px}</style>${editor}<div role="button" class="ds-icon-button"><svg></svg></div><script>window.keys=0;window.sent='';document.querySelector('textarea,[contenteditable]').addEventListener('keydown',e=>{if(e.key==='Enter'){keys++;sent=e.target.value||e.target.textContent;e.target.value='';}});window.chrome={runtime:{id:'fixture',onMessage:{addListener(fn){window.listener=fn;}}}};</script>`}));
      await page.goto(`https://${host}/`);
      for(const file of ['selectors.js','editor.js','send-control.js','deepseek.js','agent.js'])await page.addScriptTag({content:await readFile(new URL('../browser-connector/'+file,import.meta.url),'utf8')});
      const call=(action,args={})=>page.evaluate(({action,args})=>new Promise(r=>listener({type:'ROOM_COMMAND',action,args},{id:'fixture'},r)),{action,args:{provider,...args}});
      const snapshot=(await call('SNAPSHOT')).result;const args={url:page.url(),documentKey:snapshot.documentKey,actionId:'unique',text:'仅发送新的这一条\n保留换行'};
      const result=await call('SUBMIT',args);
      assert.equal(result.ok,provider==='DeepSeek');assert.equal(await page.evaluate(()=>keys),provider==='DeepSeek'?1:0);
      if(provider==='DeepSeek')assert.equal(await page.evaluate(()=>sent),args.text);
      assert.equal((await call('SUBMIT',args)).ok,false);assert.equal(await page.evaluate(()=>keys),provider==='DeepSeek'?1:0);
      await page.close();
    }
  }finally{await browser.close();}
});
