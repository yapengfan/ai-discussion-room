import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createApp} from '../server.mjs';
test('actual UI only checks and sends Gemini for both mention and checkbox selection',async()=>{
  await mkdir('.test-data',{recursive:true});const dir=await mkdtemp('.test-data/recipients-');const checks=[],sent=[];
  const bridge={inspect:async()=>({open:true,ready:true}),check:async name=>{checks.push(name);if(!['Gemini','DeepSeek'].includes(name))throw Error('ChatGPT 尚未就绪');return{assistant:[]};},prepare:async(provider,url,text)=>({provider,url,text}),submit:async p=>sent.push(p.provider),wait:async p=>({text:p.provider+' fixture response',url:p.url}),close:async()=>{}};
  const app=await createApp({dataDir:dir,bridge,port:0});const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.goto(app.url);await page.waitForFunction(()=>document.getElementById('service').textContent.includes('已连接'));
    await page.locator('#prompt').fill('@Gemini 你好');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Gemini fixture response'));
    assert.deepEqual(checks,['Gemini']);assert.deepEqual(sent,['Gemini']);
    // Let UI observe completion before starting a fresh discussion.
    await page.waitForFunction(()=>document.getElementById('send').textContent.includes('发起'));
    await page.locator('input[value="ChatGPT"]').uncheck();await page.locator('input[value="Claude"]').uncheck();
    await page.locator('#prompt').fill('only checked Gemini');await page.locator('#send').click();await page.waitForFunction(()=>document.getElementById('messageCount')?.textContent==='not-used'||document.querySelectorAll('.message').length===4);
    assert.deepEqual(checks,['Gemini','Gemini']);assert.deepEqual(sent,['Gemini','Gemini']);
    await page.waitForFunction(()=>document.getElementById('send').textContent.includes('发起'));
    const oldId=app.engine.state.conversationId;
    await page.locator('#newConversation').click();await page.waitForFunction(()=>document.querySelectorAll('.message').length===0);
    assert.equal(await page.locator('#conversationList option').count(),2);
    await page.locator('#prompt').fill('@DeepSeek 新话题');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('DeepSeek fixture response'));
    assert.equal(sent.at(-1),'DeepSeek');await page.waitForFunction(()=>document.getElementById('send').textContent.includes('发起'));
    await page.locator('#conversationList').selectOption(oldId);await page.waitForFunction(()=>document.querySelectorAll('.message').length===4);
    assert.doesNotMatch(await page.locator('#messages').textContent(),/新话题/);
    await page.screenshot({path:'.test-data/new-conversation-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#newConversation').isVisible(),true);
    await page.screenshot({path:'.test-data/new-conversation-mobile.png',fullPage:true});
  }finally{await browser.close();await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}
});
