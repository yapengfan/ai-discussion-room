import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,validUrl} from '../lib/engine.mjs';
function setup(initial=null,overrides={}) {
  const writes=[];const store={load:async()=>structuredClone(initial),save:async state=>{writes.push(structuredClone(state));}};
  const calls=[];const bridge={check:async()=>{},prepare:async(provider,url,text)=>{calls.push({provider,url,text});return{provider,url,text};},submit:async()=>{},wait:async p=>({text:`${p.provider} 的回复`,url:p.url}),...overrides};
  return{engine:new Engine(store,bridge),writes,calls,bridge};
}
test('parallel rounds freeze shared context and persist intent before each send',async()=>{
  const h=setup();await h.engine.init();
  h.bridge.submit=async p=>assert.equal(h.writes.at(-1).jobs.findLast(j=>j.provider===p.provider).status,'sending');
  await h.engine.start({text:'讨论这个想法',targets:['ChatGPT','Gemini','Claude'],rounds:2});await h.engine.done;
  assert.equal(h.calls.length,6);assert.equal(h.engine.state.messages.length,7);assert.equal(h.engine.state.run.status,'completed');
  assert.equal(h.calls[0].text.replaceAll('ChatGPT','AI'),h.calls[1].text.replaceAll('Gemini','AI'));assert.doesNotMatch(h.calls[1].text,/ChatGPT 的回复/);assert.match(h.calls[3].text,/Gemini 的回复/);assert.doesNotMatch(h.calls[3].text,/ChatGPT 的回复/);
});
test('concurrent start is rejected before touching the browser twice',async()=>{
  const h=setup();await h.engine.init();const results=await Promise.allSettled([h.engine.start({text:'one',targets:['Claude']}),h.engine.start({text:'two',targets:['Claude']})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await h.engine.done;assert.equal(h.calls.length,1);
});
test('ambiguous submit blocks without retry, manual recovery can continue',async()=>{
  let submits=0;const h=setup(null,{submit:async p=>{submits++;if(p.provider==='ChatGPT')throw Error('timeout after click');}});await h.engine.init();
  await h.engine.start({text:'hello',targets:['ChatGPT','Gemini']});await h.engine.done;
  assert.equal(h.engine.state.run.status,'blocked');assert.equal(submits,2);assert.equal(h.engine.state.participants.ChatGPT.cursor,0);assert.equal(h.engine.state.participants.Gemini.cursor,1);
  await assert.rejects(()=>h.engine.resume(),/核对/);
  const job=h.engine.unresolved();await h.engine.resolve({jobId:job.id,action:'accept',text:'官网的实际回复'});
  assert.equal(h.engine.state.participants.ChatGPT.cursor,1);h.bridge.submit=async()=>{};
  await h.engine.resume();await h.engine.done;assert.equal(h.calls.length,2);assert.equal(h.engine.state.run.status,'completed');
});
test('restart converts in-flight work to review instead of re-sending',async()=>{
  const h=setup();await h.engine.init();const state=structuredClone(h.engine.state);
  state.run={id:'r',status:'running',index:0,targets:['Claude'],rounds:1};state.jobs=[{id:'j',provider:'Claude',status:'waiting',toSeq:1}];
  const next=setup(state);await next.engine.init();assert.equal(next.engine.unresolved().id,'j');assert.equal(next.calls.length,0);assert.equal(next.engine.state.run.status,'blocked');
});
test('draft/preflight error pauses safely without cursor advance',async()=>{
  const h=setup(null,{prepare:async()=>{throw Error('draft exists');}});await h.engine.init();await h.engine.start({text:'hi',targets:['Claude']});await h.engine.done;
  assert.equal(h.engine.state.run.status,'paused');assert.equal(h.engine.state.jobs[0].status,'cancelled');assert.equal(h.engine.state.participants.Claude.cursor,0);
});
test('late user interjection reaches all selected members after current turn',async()=>{
  let release;let entered;const waiting=new Promise(r=>entered=r);const hold=new Promise(r=>release=r);
  const h=setup(null,{wait:async p=>{if(!release)return{text:'reply',url:p.url};entered();await hold;release=null;return{text:'reply',url:p.url};}});
  await h.engine.init();await h.engine.start({text:'hello',targets:['ChatGPT','Gemini']});await waiting;
  await h.engine.interject('补充一个关键条件');release();await h.engine.done;
  assert.equal(h.calls.length,4);assert.doesNotMatch(h.calls[1].text,/补充一个关键条件/);assert.match(h.calls[2].text,/补充一个关键条件/);assert.match(h.calls[3].text,/补充一个关键条件/);
});
test('pause during reply wait becomes uncertain; skip does not acknowledge context',async()=>{
  let entered;const waiting=new Promise(r=>entered=r);
  const h=setup(null,{wait:async(p,signal)=>{entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));throw Error('paused');}});
  await h.engine.init();await h.engine.start({text:'hi',targets:['Claude']});await waiting;await h.engine.pause();await h.engine.done;
  assert.ok(h.engine.unresolved());await h.engine.resolve({jobId:h.engine.unresolved().id,action:'skip'});
  assert.equal(h.engine.state.participants.Claude.cursor,0);await h.engine.end();assert.equal(h.engine.state.run.status,'ended');
});
test('official URL validation rejects lookalikes, local files and credentials',()=>{
  for(const url of ['https://chatgpt.com.evil.com/','http://chatgpt.com/','file:///etc/passwd','https://u:p@chatgpt.com/'])assert.throws(()=>validUrl('ChatGPT',url));
  assert.equal(validUrl('Gemini','https://gemini.google.com/app/a'),'https://gemini.google.com/app/a');
});
test('blocked discussion rejects new interjections instead of silently storing undelivered messages',async()=>{
  const h=setup(null,{submit:async()=>{throw Error('send control missing');}});await h.engine.init();await h.engine.start({text:'original',targets:['ChatGPT']});await h.engine.done;
  const count=h.engine.state.messages.length;await assert.rejects(()=>h.engine.interject('can you see this'),/等待核对/);assert.equal(h.engine.state.messages.length,count);
});
test('Gemini submits and completes while ChatGPT is still waiting',async()=>{
  let release;const hold=new Promise(r=>release=r);let gemDone;const completed=new Promise(r=>gemDone=r);
  const h=setup(null,{wait:async p=>{if(p.provider==='ChatGPT')await hold;else gemDone();return{text:p.provider+' reply',url:p.url};}});await h.engine.init();await h.engine.start({text:'shared',targets:['ChatGPT','Gemini']});
  await completed;assert.equal(h.calls.length,2);release();await h.engine.done;assert.equal(h.engine.state.run.status,'completed');
});
test('reading a pending reply is preview-only and never commits cursor or sends',async()=>{
  const h=setup(null,{submit:async()=>{throw Error('unknown result');},readLatest:async(provider,tabId)=>({provider,text:'already on website',url:'https://claude.ai/new',tabId})});await h.engine.init();await h.engine.start({text:'hi',targets:['Claude']});await h.engine.done;
  const count=h.engine.state.messages.length;const preview=await h.engine.previewReply(h.engine.unresolved().id,9);assert.equal(preview.text,'already on website');assert.equal(h.engine.state.messages.length,count);assert.equal(h.engine.state.participants.Claude.cursor,0);
});
test('a skipped latest reply can be recovered after ending without restarting or lowering the cursor',async()=>{
  const h=setup(null,{submit:async()=>{throw Error('unknown');},readLatest:async()=>({provider:'Claude',text:'website response',url:'https://claude.ai/new'})});await h.engine.init();await h.engine.start({text:'hello',targets:['Claude']});await h.engine.done;
  const job=h.engine.unresolved();await h.engine.resolve({jobId:job.id,action:'skip'});await h.engine.end();h.engine.state.participants.Claude.cursor=20;
  assert.equal((await h.engine.previewReply(job.id,5)).text,'website response');await h.engine.resolve({jobId:job.id,action:'accept',text:'website response'});
  assert.equal(h.engine.state.run.status,'ended');assert.equal(h.engine.state.participants.Claude.cursor,20);assert.equal(h.engine.state.messages.at(-1).text,'website response');
  await assert.rejects(()=>h.engine.resolve({jobId:job.id,action:'accept',text:'duplicate'}),/失效/);
});

test('new conversations archive history and isolate cursors, switching back restores exact records',async()=>{
  const h=setup();h.bridge.bindings=new Map([['ChatGPT',1]]);await h.engine.init();
  await h.engine.start({text:'old topic',targets:['ChatGPT']});await h.engine.done;
  const old=structuredClone(h.engine.state);await h.engine.changeConversation();
  assert.notEqual(h.engine.state.conversationId,old.conversationId);assert.equal(h.engine.state.messages.length,0);assert.equal(h.engine.state.jobs.length,0);assert.equal(h.engine.state.participants.ChatGPT.cursor,0);assert.equal(h.bridge.bindings.size,0);
  await assert.rejects(h.engine.start({text:'new topic',targets:['ChatGPT']}),/旧对话/);
  h.bridge.check=async()=>({assistant:[]});await h.engine.start({text:'new topic',targets:['DeepSeek']});await h.engine.done;
  assert.doesNotMatch(h.calls.at(-1).text,/old topic/);
  const newer=h.engine.state.conversationId;await h.engine.changeConversation(old.conversationId);
  assert.deepEqual(h.engine.state.messages,old.messages);assert.deepEqual(h.engine.state.participants,old.participants);
  assert.equal(h.engine.state.archives[0].conversationId,newer);
  const restored=setup(h.engine.state);await restored.engine.init();assert.deepEqual(restored.engine.state.archives,h.engine.state.archives);
});
test('conversation switches refuse pending sends and failed saves retain current data',async()=>{
  const h=setup();await h.engine.init();h.engine.addMessage('我','keep me');
  h.engine.pumping=true;await assert.rejects(h.engine.changeConversation(),/结束/);h.engine.pumping=false;
  h.engine.state.jobs.push({status:'needs_review'});await assert.rejects(h.engine.changeConversation(),/核对/);h.engine.state.jobs=[];
  const before=structuredClone(h.engine.state);h.engine.store.save=async()=>{throw Error('disk failure');};await assert.rejects(h.engine.changeConversation(),/disk failure/);assert.deepEqual(h.engine.state,before);
});
test('DeepSeek official host is strict and old room migration adds its participant',async()=>{
  assert.equal(validUrl('DeepSeek','https://chat.deepseek.com/a/chat/s'),'https://chat.deepseek.com/a/chat/s');
  for(const u of ['https://chat.deepseek.com.evil.test/','https://deepseek.com/','https://u:p@chat.deepseek.com/'])assert.throws(()=>validUrl('DeepSeek',u));
  const h=setup();await h.engine.init();const old=structuredClone(h.engine.state);delete old.participants.DeepSeek;delete old.conversationId;delete old.archives;
  const migrated=setup(old);await migrated.engine.init();assert.equal(migrated.engine.state.participants.DeepSeek.cursor,0);assert.ok(migrated.engine.state.conversationId);
});

test('each new discussion sends its current question, never historical backlog even after rebinding',async()=>{
  const h=setup();await h.engine.init();await h.engine.start({text:'OLD_TOPIC',targets:['ChatGPT','Gemini']});await h.engine.done;
  h.engine.state.participants.Gemini.cursor=0;
  await h.engine.start({text:'CURRENT_TOPIC',targets:['ChatGPT','Gemini','DeepSeek'],rounds:2});await h.engine.done;
  for(const call of h.calls.slice(2))assert.doesNotMatch(call.text,/OLD_TOPIC/);
  for(const call of h.calls.slice(2,5)){assert.match(call.text,/CURRENT_TOPIC/);assert.doesNotMatch(call.text,/的回复/);}
  for(const call of h.calls.slice(5)){assert.doesNotMatch(call.text,/CURRENT_TOPIC/);assert.match(call.text,/的回复/);assert.doesNotMatch(call.text,new RegExp('【'+call.provider+'】'));}
});

test('send acknowledgement timeout reconciles a website reply without resubmission',async()=>{
  let submits=0,reads=0;const h=setup(null,{submit:async()=>{submits++;const e=Error('late acknowledgement');e.code='BROWSER_RPC_TIMEOUT';throw e;},wait:async p=>{reads++;return{text:'already generated on website',url:p.url};}});
  await h.engine.init();await h.engine.start({text:'one question',targets:['ChatGPT']});await h.engine.done;
  assert.equal(submits,1);assert.equal(reads,1);assert.equal(h.engine.state.run.status,'completed');assert.equal(h.engine.state.jobs[0].submissionUncertain,true);assert.equal(h.engine.state.jobs[0].error,undefined);assert.equal(h.engine.state.messages.at(-1).text,'already generated on website');
});
test('uncertain send with no readable reply stays reviewable and never retries',async()=>{
  let submits=0;const h=setup(null,{submit:async()=>{submits++;const e=Error('timeout');e.code='BROWSER_RPC_TIMEOUT';throw e;},wait:async()=>{throw Error('no complete response');}});
  await h.engine.init();await h.engine.start({text:'hi',targets:['ChatGPT']});await h.engine.done;assert.equal(submits,1);assert.equal(h.engine.state.run.status,'blocked');assert.equal(h.engine.state.jobs[0].status,'needs_review');assert.equal(h.engine.state.participants.ChatGPT.cursor,0);
});
test('reopening dismissed latest reply only enables local review, without sending or resuming',async()=>{
  let submits=0;const h=setup(null,{submit:async()=>{submits++;throw Error('unknown result');}});await h.engine.init();await h.engine.start({text:'hi',targets:['ChatGPT']});await h.engine.done;
  const job=h.engine.state.jobs[0];await h.engine.resolve({jobId:job.id,action:'skip'});await h.engine.resolve({jobId:job.id,action:'skip'});assert.equal(job.recoveryDismissed,true);
  await h.engine.reopenReview(job.id);assert.equal(job.status,'needs_review');assert.equal(submits,1);assert.equal(h.engine.state.run.status,'blocked');
  await h.engine.resolve({jobId:job.id,action:'accept',text:'actual reply'});assert.equal(h.engine.state.run.status,'paused');assert.equal(h.engine.state.messages.at(-1).text,'actual reply');await assert.rejects(h.engine.reopenReview(job.id),/最近跳过/);
});
