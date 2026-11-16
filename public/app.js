import {resolveTargets} from './recipients.js';
const $=id=>document.getElementById(id);
let token, state, refreshing=false, busy=false, noticeTimer, feedKey='';
const members=[['ChatGPT','G','gpt','思路与推演'],['Gemini','✦','gem','联想与发现'],['Claude','C','cla','分析与表达'],['DeepSeek','D','deep','推理与探索']];
const memberSelectionKey='tongzhuo.memberSelection.v1';
const memberInputs=[...document.querySelectorAll('input[name="member"]')];
let memberSelectionRestored=false;
function restoreMemberSelection(){
  let selected=null;
  try{const saved=JSON.parse(localStorage.getItem(memberSelectionKey));if(Array.isArray(saved)&&saved.every(name=>typeof name==='string'))selected=saved;}catch{}
  if(selected===null&&Array.isArray(state?.run?.targets))selected=state.run.targets;
  if(selected!==null)memberInputs.forEach(input=>input.checked=selected.includes(input.value));
  memberSelectionRestored=true;
}
for(const input of memberInputs)input.addEventListener('change',()=>{
  try{localStorage.setItem(memberSelectionKey,JSON.stringify(memberInputs.filter(el=>el.checked).map(el=>el.value)));}catch{}
});
const statusText={preparing:'正在准备',sending:'正在发送',waiting:'等待回复',needs_review:'结果待核对',completed:'已完成',cancelled:'已停止',skipped:'已跳过',running:'讨论进行中',pausing:'正在暂停',paused:'讨论已暂停',blocked:'等待人工核对',ended:'本次已结束'};
function reviewJob(){return state?.jobs.find(j=>j.status==='needs_review')||state?.jobs.findLast(j=>j.status==='skipped'&&!j.recoveryDismissed&&j.runId===state.run?.id&&state.jobs.findLast(last=>last.provider===j.provider)===j);}
function notify(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,8000);}
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Room-Token':token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw Error(data.error||'操作失败');return data;}
async function action(fn){if(busy)return;busy=true;try{await fn();await refresh();}catch(e){notify(e.message);}finally{busy=false;renderControls();}}
function textEl(tag,cls,text){const el=document.createElement(tag);el.className=cls;el.textContent=text;return el;}
for(const [name,icon,cls,desc] of members){
  const card=document.createElement('article');card.className='member-card';card.dataset.member=name;
  card.innerHTML=`<div class="member-top"><span class="avatar ${cls}">${icon}</span><div class="member-name">${name}<small>${desc}</small></div><i class="connection"></i></div><p class="member-state">尚未连接</p><select class="official-tabs" aria-label="${name} 官网标签页"></select><div class="member-buttons"><button data-open="${name}">打开官网</button><button data-bind="${name}">使用所选会话</button></div>`;
  $('memberCards').append(card);
}
$('memberCards').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const card=button.closest('.member-card');const provider=card.dataset.member;
  if(button.dataset.open)action(async()=>{button.disabled=true;try{await api('connect',{provider});notify(`已打开 ${provider}。请在日常浏览器中打开要继续的对话，再选择标签页并使用该会话。`);}finally{button.disabled=false;}});
  else if(button.dataset.bind)action(async()=>{await api('bind',{provider,tabId:Number(card.querySelector('select').value)});notify(`已采用 ${provider} 当前会话。`);});

});
function renderControls(){if(!state)return;const run=state.run;$('newConversation').disabled=busy||state.pumping||['running','pausing','paused','blocked'].includes(run?.status);$('conversationList').disabled=$('newConversation').disabled;const active=['running','pausing','paused','blocked'].includes(run?.status);$('send').disabled=busy||['pausing','blocked'].includes(run?.status);$('prompt').readOnly=run?.status==='blocked';$('send').textContent=run?.status==='blocked'?'请先核对上轮':active?'加入讨论 ↑':'发起讨论 ↑';$('prompt').disabled=false;$('pause').hidden=!['running','pausing'].includes(run?.status);$('pause').disabled=run?.status==='pausing';$('resume').hidden=run?.status!=='paused';$('resume').disabled=state.pumping;$('end').hidden=!['paused','blocked'].includes(run?.status);$('end').disabled=state.pumping||!!state.jobs.find(j=>j.status==='needs_review');$('composerHint').textContent=run?.status==='blocked'?'当前轮次尚未确认，暂不接收新发言':active?'你可以随时补充 · 新发言将交给后续成员':'选择成员 · @名字可单独邀请 · Ctrl + Enter 发送';document.querySelectorAll('input[name="member"],#rounds').forEach(el=>el.disabled=active);}
function render(){
  const conversations=[{id:state.conversationId,title:state.messages.find(m=>m.speaker==='我')?.text.slice(0,30)||'新对话'},...(state.archives||[])];
  const list=$('conversationList');const listKey=JSON.stringify(conversations);
  if(list.dataset.signature!==listKey){list.dataset.signature=listKey;list.replaceChildren(...conversations.map(c=>new Option(c.title,c.id)));}
  list.value=state.conversationId;
  $('conversationTitle').textContent=conversations[0].title;
  $('service').lastChild.textContent=' 本地服务已连接';
  const connector=state.connector;
  $('bridgeStatus').textContent=connector?.connected?`组件 v${connector.workerVersion||'未知'} 已连接 · 请选择官网标签页`:connector?.paired?'组件已配对，正在等待浏览器连接':'首次使用：在日常浏览器加载连接组件，然后输入下方配对码';
  $('pairCode').textContent=connector?.connected?'已连接':connector?.expiresAt>Date.now()?connector.code:'请刷新配对码';
  for(const [name]of members){
    const card=document.querySelector(`[data-member="${name}"]`),c=state.connections[name],p=state.participants[name],matched=c?.url===p.url;
    card.querySelector('[data-open]').textContent=p.freshRequired?'打开新对话':'打开官网';
    card.querySelector('.connection').classList.toggle('ready',c?.ready&&matched);
    card.querySelector('.member-state').textContent=!state.connector?.connected?'等待连接组件':!c?.open?(p.freshRequired?'新对话：打开官网新建聊天，再使用该会话':'请选择已登录的官网标签页'):!c.ready?(c.reason||c.error||'网页未就绪，请检查官网输入框'):!matched?'会话有变化，请重新选择':`已选定 · 官网脚本 v${c.connectorVersion||'未知'}`;
    const select=card.querySelector('select'),old=select.value;
    const tabs=(state.availableTabs||[]).filter(t=>t.provider===name);
    const signature=JSON.stringify(tabs.map(t=>[t.tabId,t.title,t.url]));
    if(select.dataset.signature!==signature){select.dataset.signature=signature;select.replaceChildren();if(!tabs.length){const o=new Option('未找到官网标签页','');select.append(o);}for(const t of tabs){const o=new Option(t.title||t.url,String(t.tabId));o.title=t.url;select.append(o);}if(tabs.some(t=>String(t.tabId)===old))select.value=old;else if(c?.tabId)select.value=String(c.tabId);}
  }
  const key=JSON.stringify(state.messages.map(m=>[m.id,m.text]));
  if(key!==feedKey){feedKey=key;const nearBottom=$('feed').scrollHeight-$('feed').scrollTop-$('feed').clientHeight<100;$('messages').replaceChildren();
    for(const message of state.messages){const meta=members.find(m=>m[0]===message.speaker);const article=textEl('article','message'+(meta?'':' me'),'');article.append(textEl('div','avatar '+(meta?.[2]||''),meta?.[1]||'你'));const content=textEl('div','message-content','');const head=textEl('div','message-head',message.speaker==='我'?'你':message.speaker);head.append(textEl('time','',new Date(message.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));content.append(head,textEl('div','message-body',message.text));article.append(content);$('messages').append(article);}
    $('welcome').hidden=!!state.messages.length;if(nearBottom)$('feed').scrollTop=$('feed').scrollHeight;
  }
  const run=state.run;$('runBar').hidden=!run;if(run){$('runStatus').textContent=statusText[run.status]||run.status;$('runDetail').textContent=`${run.targets.join(' · ')} / ${run.rounds} 轮 / 已完成 ${run.finishedTurns?.length??run.index} 次发言 · 同轮并行`;}
  const live=state.jobs.filter(j=>['preparing','sending','waiting'].includes(j.status));$('liveReply').hidden=!live.length;$('liveReply').textContent=live.map(j=>`${j.provider} · ${statusText[j.status]}${j.partial?'\n'+j.partial:'…'}`).join('\n\n');
  $('checkDeepSeekReply').hidden=!state.jobs.some(j=>j.provider==='DeepSeek'&&j.status==='waiting'&&j.partial)||state.jobs.some(j=>j.status==='needs_review');
  const review=reviewJob();$('acceptReply').textContent=review?.provider==='DeepSeek'?'确认完成并录入':'录入回复';$('review').hidden=!review;if(review){$('reviewText').textContent=review.status==='skipped'?`${review.provider} 的已跳过轮次可补收：读取官网最新回复，核对后录入。不会重新发送或自动继续讨论。`:`${review.provider}：${review.error} 平台不会自动重发。请打开官网核对，录入完整回复或跳过这一轮。`;$('skipReply').textContent=review.status==='skipped'?'暂不补收':'跳过这一轮';}
  $('activity').replaceChildren();if(!state.jobs.length)$('activity').append(textEl('p','muted','讨论开始后，这里会显示每位成员的进展。'));
  for(const job of state.jobs.slice(-5).reverse()){const el=textEl('div','activity-item','');el.append(textEl('strong','',`${job.provider} · 第 ${job.round} 轮`),document.createElement('br'),document.createTextNode(statusText[job.status]||job.status),textEl('time','',new Date(job.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));$('activity').append(el);}
  renderControls();if(state.fatal)notify(state.fatal);
}
async function refresh(){if(refreshing)return;refreshing=true;try{state=await api('state');if(!memberSelectionRestored)restoreMemberSelection();render();}catch(e){$('service').lastChild.textContent=' 本地服务未连接';}finally{refreshing=false;}}
$('newConversation').addEventListener('click',()=>action(async()=>{await api('conversation',{});$('prompt').value='';$('recoveryText').value='';notify('已保存旧聊天。请点击成员的打开官网，在官网新建对话后使用该会话。');}));
$('conversationList').addEventListener('change',event=>{const id=event.target.value;action(async()=>{await api('conversation',{id});$('prompt').value='';$('recoveryText').value='';notify('已切换对话，请重新选择对应的官网会话。');});});
$('composer').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const text=$('prompt').value.trim();if(['running','paused','blocked'].includes(state?.run?.status)){await api('message',{text});}else{const targets=resolveTargets(text,[...document.querySelectorAll('input[name="member"]:checked')].map(el=>el.value));await api('start',{text,targets,rounds:Number($('rounds').value)});}$('prompt').value='';});});
$('prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('composer').requestSubmit();}});
document.querySelectorAll('[data-suggestion]').forEach(b=>b.addEventListener('click',()=>{$('prompt').value=b.dataset.suggestion;$('prompt').focus();}));
$('refreshPair').addEventListener('click',()=>action(()=>api('bridge/reset',{})));
$('revokePair').addEventListener('click',()=>action(async()=>{if(confirm('解除配对后平台将无法操作浏览器。确定吗？'))await api('bridge/revoke',{});}));
for(const op of ['pause','resume','end'])$(op).addEventListener('click',()=>action(()=>api(op,{})));
$('checkDeepSeekReply').addEventListener('click',()=>action(async()=>{
  await api('pause',{});
  let snapshot;for(let i=0;i<50;i++){snapshot=await api('state');if(!snapshot.pumping)break;await new Promise(r=>setTimeout(r,200));}
  if(snapshot.pumping)throw Error('正在暂停，请稍后使用读取官网最新回复。');
  state=snapshot;render();
  const job=reviewJob();if(job?.provider!=='DeepSeek')throw Error('请先核对当前未确认的轮次。');
  const tabId=Number(document.querySelector('[data-member="DeepSeek"] select').value);
  const reply=await api('recover-reply',{jobId:job.id,tabId});$('recoveryText').value=reply.text;
  $('review').scrollIntoView({block:'nearest'});notify('已停止本地等待并读取正文。请核对官网已完整回复，再点击确认完成并录入。');
}));
$('readReply').addEventListener('click',()=>action(async()=>{const job=reviewJob();const select=document.querySelector(`[data-member="${job.provider}"] select`);const reply=await api('recover-reply',{jobId:job.id,tabId:Number(select.value)});$('recoveryText').value=reply.text;notify(reply.completed===false?`已读取 ${reply.provider} 正文，但网页完成标志仍未确认。请在官网核对完整后，再点击录入回复。`:`已读取 ${reply.provider} 官网最新回复，请核对后点击录入回复。`);}));
$('acceptReply').addEventListener('click',()=>action(async()=>{const job=reviewJob();await api('resolve',{jobId:job?.id,action:'accept',text:$('recoveryText').value});$('recoveryText').value='';}));
$('skipReply').addEventListener('click',()=>action(async()=>{if(!confirm('跳过不会撤回官网消息，也不会把未核对的内容标记为已读。请确认已检查官网，之后继续讨论可能再次提供这些上下文。'))return;const job=reviewJob();await api('resolve',{jobId:job?.id,action:'skip'});}));
$('export').addEventListener('click',()=>action(async()=>{const data=await api('export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`AI会客厅讨论-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
try{const r=await fetch('/api/bootstrap');if(!r.ok)throw Error();({token}=await r.json());await refresh();setInterval(refresh,1500);}catch{notify('无法连接本地服务，请确认启动窗口仍在运行，再刷新页面。');}
