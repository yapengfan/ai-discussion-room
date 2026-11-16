import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
const scripts=await Promise.all(['selectors.js','editor.js','send-control.js','deepseek.js','agent.js'].map(file=>readFile(new URL('../browser-connector/'+file,import.meta.url),'utf8')));
test('paragraph-based ChatGPT and Gemini editors submit exact multi-line text despite extra visual line breaks',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const text='第一段 first paragraph\n\n【我】\n第二行\n\n  indented code\n\n结束';
  try{
    for(const [provider,host,editor,send]of[
      ['ChatGPT','chatgpt.com','<div contenteditable="true" role="textbox" aria-label="询问 ChatGPT"><p><br></p></div>','data-testid="send-button"'],
      ['Gemini','gemini.google.com','<rich-textarea><div contenteditable="true" role="textbox"><p><br></p></div></rich-textarea>','aria-label="Send message"']]){
      const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<style>[contenteditable]{width:500px;min-height:40px}</style>${editor}<button ${send} id="send">send</button><script>window.clicks=0;document.querySelector('#send').onclick=()=>window.clicks++;window.chrome={runtime:{id:'fixture',onMessage:{addListener(fn){window.agentListener=fn;}}}};</script>`}));await page.goto(`https://${host}/app/test`);
      await page.evaluate(()=>{const editor=document.querySelector('[contenteditable]');editor.addEventListener('input',event=>{if(event.isTrusted||typeof event.data!=='string')return;editor.replaceChildren(...event.data.split('\n').map(line=>{const p=document.createElement('p');if(line)p.textContent=line;else p.append(document.createElement('br'));return p;}));});});
      for(const script of scripts)await page.addScriptTag({content:script});
      const call=(action,args)=>page.evaluate(({action,args})=>new Promise(r=>agentListener({type:'ROOM_COMMAND',action,args},{id:'fixture'},r)),{action,args:{provider,...args}});
      const snap=await call('SNAPSHOT',{});assert.equal(snap.result.draft,'');
      const result=await call('SUBMIT',{url:page.url(),documentKey:snap.result.documentKey,actionId:'multiline',text});
      assert.equal(result.ok,true,provider+': '+result.error);assert.equal(await page.evaluate(()=>window.clicks),1);
      const read=await page.evaluate(()=>({logical:readEditorText(document.querySelector('[contenteditable]')),visual:document.querySelector('[contenteditable]').innerText}));
      assert.equal(read.logical,text);assert.notEqual(read.visual,text,'fixture must reproduce the prior visual-newline mismatch');await page.close();
    }
  }finally{await browser.close();}
});
test('real non-whitespace content changes still block automatic submission',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<style>[contenteditable]{width:400px;min-height:40px}</style><div contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div><button data-testid="send-button" id="send">send</button><script>window.clicks=0;document.querySelector("#send").onclick=()=>window.clicks++;window.chrome={runtime:{id:"fixture",onMessage:{addListener(fn){window.agentListener=fn;}}}};</script>'}));await page.goto('https://chatgpt.com/');
    await page.evaluate(()=>document.querySelector('[contenteditable]').addEventListener('input',event=>{if(!event.isTrusted)event.target.textContent+='changed';}));
    for(const script of scripts)await page.addScriptTag({content:script});
    const result=await page.evaluate(()=>new Promise(resolve=>agentListener({type:'ROOM_COMMAND',action:'SNAPSHOT',args:{provider:'ChatGPT'}},{id:'fixture'},snap=>agentListener({type:'ROOM_COMMAND',action:'SUBMIT',args:{provider:'ChatGPT',url:location.href,documentKey:snap.result.documentKey,actionId:'corrupt',text:'exact original'}},{id:'fixture'},resolve))));
    assert.equal(result.ok,false);assert.match(result.error,/不一致/);assert.equal(await page.evaluate(()=>window.clicks),0);
  }finally{await browser.close();}
});
