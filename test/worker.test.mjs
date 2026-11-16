import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {WebSocket} from 'ws';
import {createApp} from '../server.mjs';
test('actual worker protocol pairs, inventories tabs, executes once and retains journal through restart',async()=>{
  await mkdir('.test-data',{recursive:true});const dir=await mkdtemp('.test-data/worker-');const app=await createApp({dataDir:dir,port:0});
  const origin='chrome-extension://'+'a'.repeat(32);let handler,clicks=0,missing=false,denyInjection=false;const injections=[];let releaseSlow,enteredSlow;const slowEntered=new Promise(r=>enteredSlow=r);const slowHold=new Promise(r=>releaseSlow=r);
  const local={},session={};const area=data=>({get:async key=>({[key]:data[key]}),set:async patch=>Object.assign(data,patch),remove:async key=>delete data[key]});
  const event={addListener(){}};const sockets=[];
  const chrome={runtime:{id:'a'.repeat(32),getURL:p=>origin+'/'+p,onMessage:{addListener(fn){handler=fn;}},onInstalled:event,onStartup:event},alarms:{create(){},onAlarm:event},action:{setBadgeText(){},setBadgeBackgroundColor(){}},storage:{local:area(local),session:area(session)},tabs:{query:async()=>[{id:7,url:'https://chatgpt.com/c/test',title:'fixture'}],get:async id=>({id,url:id===8?'https://gemini.google.com/app/test':'https://chatgpt.com/c/test'}),onUpdated:event,onRemoved:event,sendMessage:async(id,message)=>{if(missing)throw Error('Could not establish connection. Receiving end does not exist.');if(message.action==='SUBMIT'&&message.args.actionId==='slow'){enteredSlow();await slowHold;}if(message.action==='SUBMIT')clicks++;return{ok:true,result:{url:'https://chatgpt.com/c/test',documentKey:'fixture',editor:true,draft:'',busy:false,sendFound:true,assistant:[]}};}}};
  chrome.scripting={executeScript:async spec=>{injections.push(spec);if(denyInjection)throw Error('Cannot access contents of url');missing=false;}};
  class Socket extends WebSocket{constructor(){super(app.url.replace('http:','ws:')+'/bridge/socket',{origin});sockets.push(this);}}
  const source=await readFile(new URL('../browser-connector/worker.js',import.meta.url),'utf8');
  const boot=()=>vm.runInNewContext(source,{chrome,URL,WebSocket:Socket,fetch:(url,opts)=>fetch(app.url+'/bridge/pair',{...opts,headers:{...opts.headers,Origin:origin}}),setTimeout:(fn,ms)=>setTimeout(fn,ms).unref(),clearTimeout,setInterval:(fn,ms)=>setInterval(fn,ms).unref(),clearInterval,console});
  const message=value=>new Promise(r=>handler(value,{id:chrome.runtime.id,url:origin+'/popup.html'},r));
  const connected=async()=>{for(let i=0;i<100;i++){if(app.bridge.info().connected && app.bridge.tabs().length)return;await new Promise(r=>setTimeout(r,10));}throw Error('worker did not connect');};
  try{
    boot();const result=await message({type:'PAIR',code:app.bridge.info().code});assert.equal(result.ok,true);await connected();
    assert.equal(app.bridge.tabs()[0].tabId,7);
    missing=true;await app.bridge.request('SNAPSHOT',{provider:'ChatGPT',tabId:7});assert.equal(injections.length,1);assert.deepEqual(Array.from(injections[0].files),['selectors.js','editor.js','send-control.js','deepseek.js','agent.js']);assert.equal(injections[0].target.tabId,7);assert.equal(clicks,0);
    missing=true;denyInjection=true;await assert.rejects(()=>app.bridge.request('SNAPSHOT',{provider:'ChatGPT',tabId:7}),/连接脚本未能加载/);denyInjection=false;missing=false;
    const attempts=injections.length;missing=true;await assert.rejects(()=>app.bridge.request('SUBMIT',{provider:'ChatGPT',tabId:7,actionId:'uncertain',text:'do not retry'}),/Receiving end/);assert.equal(injections.length,attempts);assert.equal(clicks,0);missing=false;await assert.rejects(()=>app.bridge.request('SUBMIT',{provider:'ChatGPT',tabId:7,actionId:'uncertain',text:'do not retry'}),/曾执行/);
    const args={provider:'ChatGPT',tabId:7,actionId:'fixed',text:'hello'};
    await app.bridge.request('SUBMIT',args);await assert.rejects(()=>app.bridge.request('SUBMIT',args),/曾执行/);assert.equal(clicks,1);
    const slow=app.bridge.request('SUBMIT',{provider:'ChatGPT',tabId:7,actionId:'slow',text:'hold'});await slowEntered;
    try {
      await Promise.race([Promise.all([app.bridge.request('SNAPSHOT',{provider:'Gemini',tabId:8}),app.bridge.request('SUBMIT',{provider:'Gemini',tabId:8,actionId:'fast',text:'parallel'})]),new Promise((_,reject)=>setTimeout(()=>reject(Error('sibling blocked behind slow submit')),1000).unref())]);
      assert.equal(clicks,2);
    }finally{releaseSlow();await slow;}
    assert.equal(clicks,3);
    for(const ws of sockets)ws.terminate();await new Promise(r=>setTimeout(r,20));boot();await connected();
    await assert.rejects(()=>app.bridge.request('SUBMIT',args),/曾执行/);assert.equal(clicks,3);
    await message({type:'DISCONNECT'});
  }finally{delete local.bridgeToken;for(const ws of sockets)ws.terminate();await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}
});
