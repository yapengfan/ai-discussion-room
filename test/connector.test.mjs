import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {WebSocket} from 'ws';
import {createApp} from '../server.mjs';
const origin='chrome-extension://'+'a'.repeat(32);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(){await mkdir('.test-data',{recursive:true});const dir=await mkdtemp('.test-data/connector-');const app=await createApp({dataDir:dir,port:0});return{app,dir,close:async()=>{await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}};}
async function pair(app,code=app.bridge.info().code,customOrigin=origin){return fetch(app.url+'/bridge/pair',{method:'POST',headers:{Origin:customOrigin,'Content-Type':'application/json'},body:JSON.stringify({code})});}
async function peer(app,token){const ws=new WebSocket(app.url.replace('http:','ws:')+'/bridge/socket',{origin});await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});const auth=new Promise(r=>ws.once('message',raw=>r(JSON.parse(raw))));ws.send(JSON.stringify({type:'AUTH',token}));assert.equal((await auth).type,'AUTH_OK');return ws;}
test('pairing rejects websites and wrong code, consumes code, pins extension identity',async()=>{
  const h=await setup();try{
    assert.equal((await pair(h.app,h.app.bridge.code,'https://evil.test')).status,403);
    assert.equal((await pair(h.app,'wrong')).status,400);
    const response=await pair(h.app);assert.equal(response.status,200);assert.ok((await response.json()).token);
    assert.equal((await pair(h.app,h.app.bridge.code)).status,400);
    h.app.bridge.resetCode();assert.equal((await pair(h.app,h.app.bridge.code,'chrome-extension://'+'b'.repeat(32))).status,400);
  }finally{await h.close();}
});
test('authenticated RPC binds explicit tab, checks document identity and never substitutes caller text',async()=>{
  const h=await setup();let ws;try{
    const{token}=await(await pair(h.app)).json();ws=await peer(h.app,token);
    ws.send(JSON.stringify({type:'TABS',tabs:[{tabId:12,provider:'Gemini',url:'https://gemini.google.com/app/a',title:'logged in fixture'},{tabId:99,provider:'Gemini',url:'https://evil.test/'}]}));
    await delay(20);assert.equal(h.app.bridge.tabs().length,1);h.app.bridge.bind('Gemini',12);
    const calls=[];ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='COMMAND')return;calls.push(m);const result=m.action==='SNAPSHOT'?{url:'https://gemini.google.com/app/a',documentKey:'doc',connectorVersion:'0.8.4',editor:true,draft:'',busy:false,sendFound:false,assistant:['old']}:{};ws.send(JSON.stringify({type:'RESULT',id:m.id,ok:true,result}));});
    const prepared=await h.app.bridge.prepare('Gemini','https://gemini.google.com/app/a','specific batch',new AbortController().signal);
    await h.app.bridge.submit(prepared,new AbortController().signal);assert.equal(calls.at(-1).args.documentKey,'doc');assert.equal(calls.at(-1).args.text,'specific batch');
    const pending=h.app.bridge.request('UNKNOWN');ws.close();await assert.rejects(()=>pending,/断开/);assert.equal(h.app.bridge.info().connected,false);
  }finally{ws?.terminate();await h.close();}
});
test('invalid auth cannot obtain commands; revocation rotates persistent secret',async()=>{
  const h=await setup();try{
    const{token}=await(await pair(h.app)).json();const ws=new WebSocket(h.app.url.replace('http:','ws:')+'/bridge/socket',{origin});await new Promise(r=>ws.once('open',r));const closed=new Promise(r=>ws.once('close',r));ws.send(JSON.stringify({type:'AUTH',token:'wrong'}));await closed;assert.equal(h.app.bridge.info().connected,false);
    await h.app.bridge.revoke();const stored=JSON.parse(await readFile(join(h.dir,'bridge-key.json'),'utf8'));assert.notEqual(stored.token,token);assert.equal(stored.origin,null);
  }finally{await h.close();}
});
