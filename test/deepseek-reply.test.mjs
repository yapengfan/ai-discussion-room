import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {ExtensionBridge} from '../lib/extension-bridge.mjs';

test('DeepSeek sibling action row completes reply and preserves paragraphs, lists and code',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<article><div class="ds-think-content"><div class="ds-markdown">reasoning omitted</div></div><div class="ds-markdown"><p>第一段。</p><p>第二段。</p><ol><li>第一项</li><li>第二项</li></ol><pre><code>const x = 1;\n  use(x);</code><button>复制代码</button></pre></div><div class="footer"><div role="button" class="ds-icon-button"><svg width="16" height="16"></svg></div><div role="button" class="ds-icon-button"><svg width="16" height="16"></svg></div></div></article><textarea placeholder="发送消息"></textarea>');
    for(const f of ['selectors.js','deepseek.js'])await page.addScriptTag({content:await readFile(new URL('../browser-connector/'+f,import.meta.url),'utf8')});
    const snap=()=>page.evaluate(()=>deepSeekSnapshot(domSnapshot(SELECTORS.DeepSeek),SELECTORS.DeepSeek));
    const s=await snap();assert.equal(s.completed,true);assert.equal(s.busy,false);assert.equal(s.assistant.length,1);assert.match(s.assistant[0],/第一段。\n\n第二段。/);assert.match(s.assistant[0],/1\. 第一项\n2\. 第二项/);assert.match(s.assistant[0],/```\nconst x = 1;\n  use\(x\);\n```/);assert.doesNotMatch(s.assistant[0],/reasoning|复制代码/);
    await page.evaluate(()=>{const footer=document.querySelector('.footer');footer.querySelectorAll('[role]').forEach(el=>el.removeAttribute('role'));let target=document.querySelector('article');for(let i=0;i<5;i++){const outer=document.createElement('section');target.replaceWith(outer);outer.append(target);target=outer;}target.append(footer);});
    assert.equal((await snap()).completed,true); // Div controls without role, outside four ancestors.
    await page.evaluate(()=>{document.querySelectorAll('.footer .ds-icon-button').forEach(el=>el.className='ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs');});
    assert.equal((await snap()).completed,true); // Actual current official site uses ds-button--icon.
    await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<article id="latest"><div class="ds-markdown"><p>正在生成的下一条</p></div></article>'));
    assert.equal((await snap()).completed,false); // Old message's footer must not finish this one.
    await page.evaluate(()=>document.querySelector('#latest').insertAdjacentHTML('beforeend','<button aria-label="复制回复">copy</button><button aria-label="停止生成">stop</button>'));
    assert.equal((await snap()).busy,true);assert.equal((await snap()).completed,false);
    await page.locator('button[aria-label="停止生成"]').evaluate(el=>el.remove());assert.equal((await snap()).completed,true);
  }finally{await browser.close();}
});

test('DeepSeek completed reply exits wait and is available for readonly recovery',async()=>{
  const bridge=new ExtensionBridge('.test-data');bridge.select=()=>({tabId:1});
  const url='https://chat.deepseek.com/a/chat/s/test';let polls=0;
  bridge.request=async()=>({url,documentKey:'doc',connectorVersion:'0.8.4',assistant:['old','第一段。\n\n第二段。'],assistantKeys:['old','new'],completed:++polls>=3,busy:false,editor:true,draft:''});
  const real=Date.now;let time=1000;Date.now=()=>time+=3000;
  try{const r=await bridge.wait({provider:'DeepSeek',url,tabId:1,documentKey:'doc',baseline:['old'],assistantKeys:['old']},new AbortController().signal,()=>{});assert.equal(r.text,'第一段。\n\n第二段。');assert.equal((await bridge.readLatest('DeepSeek',1)).text,r.text);}finally{Date.now=real;}
});

test('DeepSeek manual preview can return unconfirmed text without silently accepting it',async()=>{
  const bridge=new ExtensionBridge('.test-data');bridge.select=()=>({tabId:1});bridge.request=async()=>({url:'https://chat.deepseek.com/a/chat/s/test',connectorVersion:'0.8.4',assistant:['核对这条正文'],busy:false,completed:false});
  const result=await bridge.readLatest('DeepSeek',1);assert.equal(result.text,'核对这条正文');assert.equal(result.completed,false);
  await assert.rejects(bridge.readLatest('ChatGPT',1),/尚未确认完成/);
  bridge.request=async()=>({connectorVersion:'0.8.4',assistant:['still streaming'],busy:true,completed:false});await assert.rejects(bridge.readLatest('DeepSeek',1),/尚未确认完成/);
});

test('DeepSeek recycled unkeyed nodes yield the new body even when visible count stays at three',async()=>{
  const bridge=new ExtensionBridge('.test-data');const url='https://chat.deepseek.com/a/chat/s/test';
  const baseline=['first old','second old','third old'];let polls=0;const partials=[];
  bridge.request=async()=>({url,documentKey:'doc',assistant:++polls===1?baseline:polls===2?['second old','third old','new partial']:['second old','third old','new complete'],assistantKeys:[null,null,null],completed:polls>=3,busy:false,editor:true,draft:''});
  const real=Date.now;let time=1000;Date.now=()=>time+=3000;
  try{const r=await bridge.wait({provider:'DeepSeek',url,tabId:1,documentKey:'doc',baseline,assistantKeys:[null,null,null]},new AbortController().signal,p=>partials.push(p));assert.equal(r.text,'new complete');assert.deepEqual(partials,['new partial','new complete']);}finally{Date.now=real;}
});

test('DeepSeek does not import unchanged baseline text or a previously visible old reply',async()=>{
  const bridge=new ExtensionBridge('.test-data');const url='https://chat.deepseek.com/a/chat/s/test';const baseline=['old1','old2','old3'];let polls=0;
  const signal=new AbortController();bridge.request=async()=>{if(++polls===3)signal.abort();return{url,documentKey:'doc',assistant:polls===1?baseline:['old1','old2'],assistantKeys:[null,null,null],completed:true,busy:false,editor:true,draft:''};};
  await assert.rejects(bridge.wait({provider:'DeepSeek',url,documentKey:'doc',baseline,assistantKeys:[null,null,null]},signal.signal,()=>assert.fail('Old text must not be emitted')),/已暂停/);
});
