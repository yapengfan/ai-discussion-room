import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {domSnapshot,SELECTORS} from '../lib/browser.mjs';
import {ExtensionBridge} from '../lib/extension-bridge.mjs';
test('current ChatGPT turn-state markup captures separate assistant replies, excluding isolate shell and user turns',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{const page=await browser.newPage();await page.setContent('<main><div class="isolate"><div data-turn-key="user"><div class="group/user-message">user text</div></div><div data-turn-key="old"><div data-talvt-turn-state="complete"><p>old answer</p><div class="turn-action-controls"><button aria-label="复制">copy</button></div></div></div><div data-turn-key="new"><div data-talvt-turn-state="complete"><p>latest answer</p><div class="turn-action-controls"><button aria-label="复制">copy</button></div></div></div><div contenteditable="true"></div></div></main>');
    const state=await page.evaluate(domSnapshot,SELECTORS.ChatGPT);assert.deepEqual(state.assistant,['old answer','latest answer']);assert.deepEqual(state.assistantKeys,['old','new']);assert.equal(state.completed,true);
  }finally{await browser.close();}
});
test('reply wait detects a new turn key when virtualized history keeps node count unchanged',async()=>{
  const bridge=new ExtensionBridge('.');const began=Date.now();let polls=0;
  bridge.request=async()=>({url:'https://chatgpt.com/c/test',documentKey:'doc',assistant:['new response'],assistantKeys:['new'],completed:true,busy:false,editor:true,draft:''});
  // Override only polling time for a bounded test, keeping completion logic intact.
  const realDate=Date.now;Date.now=()=>began+(++polls)*9000;
  try{const reply=await bridge.wait({provider:'ChatGPT',tabId:1,url:'https://chatgpt.com/c/test',documentKey:'doc',baseline:['old response'],assistantKeys:['old']},new AbortController().signal,()=>{});assert.equal(reply.text,'new response');}finally{Date.now=realDate;}
});
test('response-body selection excludes user prompt and page captions while keeping complete formatted answer',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<main><div class="isolate"><div data-turn-key="turn"><div data-talvt-turn-state="complete"><div data-content-search-unit-key="turn:1:user"><h6>你说：</h6><div>用户邀请你作为 ChatGPT 参与群聊，外层提示词不能被捕获</div></div><div data-content-search-unit-key="turn:2:assistant"><h6>ChatGPT 说：</h6><div data-response-body="reply-id"><div data-markdown-text-style="assistant-message"><p>你好，Gemini！</p><p>这里是第二段。<strong>加粗文字</strong>也应保留。</p><pre>code line 1\n  code line 2</pre></div></div></div><div class="turn-action-controls"><button aria-label="复制">复制</button></div></div></div></div></main>');
    const snapshot=await page.evaluate(domSnapshot,SELECTORS.ChatGPT);
    assert.equal(snapshot.assistant.length,1);assert.equal(snapshot.assistant[0],'你好，Gemini！\n这里是第二段。加粗文字也应保留。\ncode line 1\n  code line 2');
    assert.deepEqual(snapshot.assistantKeys,['reply-id']);assert.equal(snapshot.completed,true);assert.doesNotMatch(snapshot.assistant[0],/你说|ChatGPT 说|用户邀请|复制/);
  }finally{await browser.close();}
});
