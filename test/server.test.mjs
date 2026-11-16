import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createApp} from '../server.mjs';
test('local HTTP validates origin, token, content type and serves the real shell',async()=>{
  await mkdir('.test-data',{recursive:true});const dir=await mkdtemp(join('.test-data/','server-'));
  const bridge={inspect:async()=>({open:false,ready:false}),close:async()=>{},check:async()=>{throw Error('请先登录');}};
  const app=await createApp({dataDir:dir,bridge,port:0});
  try{
    const html=await fetch(app.url);assert.equal(html.status,200);assert.match(await html.text(),/会客厅/);
    const{token}=await(await fetch(app.url+'/api/bootstrap')).json();
    assert.equal((await fetch(app.url+'/api/state')).status,403);
    const headers={'X-Room-Token':token,'Content-Type':'application/json'};
    assert.equal((await fetch(app.url+'/api/state',{headers})).status,200);
    assert.equal((await fetch(app.url+'/api/start',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:'{}'})).status,403);
    const start=await fetch(app.url+'/api/start',{method:'POST',headers,body:JSON.stringify({text:'hello',targets:['Claude']})});assert.equal(start.status,400);
    assert.equal(app.engine.state.messages.length,0);assert.equal(app.engine.state.run,null);
    const saved=JSON.parse(await readFile(join(dir,'room.json'),'utf8'));assert.equal(saved.version,1);
  }finally{await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}
});
test('HTTP discussion completes across providers and export contains no browser login material',async()=>{
  await mkdir('.test-data',{recursive:true});const dir=await mkdtemp(join('.test-data/','http-'));
  const sent=[];const bridge={inspect:async()=>({open:true,ready:true}),close:async()=>{},check:async()=>{},prepare:async(provider,url,text)=>({provider,url,text}),submit:async p=>sent.push(p),wait:async p=>({text:p.provider+' fixture reply',url:p.url})};
  const app=await createApp({dataDir:dir,bridge,port:0});
  try{
    const{token}=await(await fetch(app.url+'/api/bootstrap')).json();const headers={'X-Room-Token':token,'Content-Type':'application/json'};
    const response=await fetch(app.url+'/api/start',{method:'POST',headers,body:JSON.stringify({text:'one shared question',targets:['ChatGPT','Gemini'],rounds:1})});assert.equal(response.status,200);
    await app.engine.done;assert.equal(sent.length,2);assert.doesNotMatch(sent[1].text,/ChatGPT fixture reply/);assert.match(sent[1].text,/one shared question/);
    const exported=await(await fetch(app.url+'/api/export',{headers})).json();assert.equal(exported.messages.length,3);assert.equal(exported.jobs[0].prompt,undefined);assert.equal(exported.cookies,undefined);
  }finally{await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}
});
test('second instance on the same port does not rewrite the first run state',async()=>{
  await mkdir('.test-data',{recursive:true});const dir=await mkdtemp(join('.test-data/','single-'));
  const bridge={inspect:async()=>({open:false}),close:async()=>{}};const app=await createApp({dataDir:dir,bridge,port:0});
  try{
    const original=await readFile(join(dir,'room.json'),'utf8');
    await assert.rejects(()=>createApp({dataDir:dir,bridge,port:app.server.address().port}),/EADDRINUSE/);
    assert.equal(await readFile(join(dir,'room.json'),'utf8'),original);
  }finally{await app.close();assert.ok(resolve(dir).startsWith(resolve('.test-data')+sep));await rm(dir,{recursive:true,force:true});}
});
