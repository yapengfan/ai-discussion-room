import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createApp} from '../server.mjs';

test('member choices persist through reloads, tabs, empty selection and new conversations',async()=>{
  await mkdir('.test-data',{recursive:true});const dir=await mkdtemp('.test-data/preferences-');
  const app=await createApp({dataDir:dir,port:0,bridge:{inspect:async()=>({open:false,ready:false}),close:async()=>{}}});
  const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext();
  try{
    app.engine.state.run={id:'previous',status:'completed',targets:['DeepSeek'],rounds:1,index:1,finishedTurns:[0]};
    const page=await context.newPage();const ready=()=>page.waitForFunction(()=>document.querySelector('#service').textContent.includes('已连接'));
    const chosen=()=>page.locator('input[name="member"]:checked').evaluateAll(els=>els.map(el=>el.value));
    await page.goto(app.url);await ready();assert.deepEqual(await chosen(),['DeepSeek']);
    await page.locator('input[value="ChatGPT"]').check();await page.locator('input[value="DeepSeek"]').uncheck();
    await page.reload();await ready();assert.deepEqual(await chosen(),['ChatGPT']);
    const tab=await context.newPage();await tab.goto(app.url);await tab.waitForFunction(()=>document.querySelector('#service').textContent.includes('已连接'));assert.deepEqual(await tab.locator('input[name="member"]:checked').evaluateAll(els=>els.map(el=>el.value)),['ChatGPT']);await tab.close();
    // Mention-based invitations must not change the checkbox preference.
    await page.locator('#prompt').fill('@Gemini hello');await page.reload();await ready();assert.deepEqual(await chosen(),['ChatGPT']);
    await page.locator('#newConversation').click();await page.waitForFunction(()=>document.querySelector('#conversationList').options.length===2);assert.deepEqual(await chosen(),['ChatGPT']);
    await page.locator('input[value="ChatGPT"]').uncheck();await page.reload();await ready();assert.deepEqual(await chosen(),[]);
    assert.equal(app.engine.state.messages.length,0);
    await page.evaluate(()=>localStorage.setItem('tongzhuo.memberSelection.v1','broken json'));await page.reload();await ready();assert.deepEqual(await chosen(),['ChatGPT','Gemini','Claude']);
  }finally{await browser.close();await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}
});
