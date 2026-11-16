import { randomUUID } from 'node:crypto';
export const PROVIDERS = {
  ChatGPT: { home: 'https://chatgpt.com/', hosts: ['chatgpt.com', 'chat.openai.com'] },
  Gemini: { home: 'https://gemini.google.com/app', hosts: ['gemini.google.com'] },
  Claude: { home: 'https://claude.ai/new', hosts: ['claude.ai'] },
  DeepSeek: { home: 'https://chat.deepseek.com/', hosts: ['chat.deepseek.com'] }
};
export function validUrl(provider, value) {
  const url = new URL(value);
  if (!PROVIDERS[provider] || url.protocol !== 'https:' || !PROVIDERS[provider].hosts.includes(url.hostname) || url.username || url.password || url.port) throw Error('只能使用该 AI 的官方 HTTPS 会话地址。');
  url.hash = ''; return url.href;
}
const now = () => new Date().toISOString();
export class Engine {
  constructor(store, bridge) { this.store = store; this.bridge = bridge; this.pumping = false; this.change = () => {}; }
  async init() {
    this.state = await this.store.load() || {
      version: 1, nextSeq: 1, messages: [], jobs: [], run: null,
      participants: Object.fromEntries(Object.entries(PROVIDERS).map(([name, p]) => [name, { url: p.home, cursor: 0 }]))
    };
    this.state.conversationId ||= randomUUID();
    this.state.archives ||= [];
    for(const [name,p] of Object.entries(PROVIDERS))this.state.participants[name] ||= {url:p.home,cursor:0};
    for (const job of this.state.jobs) {
      if (['sending', 'waiting'].includes(job.status)) { job.status = 'needs_review'; job.error = '程序中断，发送或回复结果待人工核对。'; }
      else if (job.status === 'preparing') job.status = 'cancelled';
    }
    if (this.state.run && ['running', 'pausing'].includes(this.state.run.status)) this.state.run.status = this.unresolved() ? 'blocked' : 'paused';
    if(this.state.run && !Array.isArray(this.state.run.finishedTurns))this.state.run.finishedTurns=Array.from({length:this.state.run.index||0},(_,i)=>i);
    if(this.state.run&&!this.state.run.contextStartSeq){
      this.state.run.contextStartSeq=this.state.messages.findLast(m=>m.speaker==='我'&&m.createdAt<=this.state.run.createdAt)?.seq||this.state.nextSeq;
    }
    await this.persist();
  }
  async changeConversation(id) {
    if(this.starting || this.changingConversation || this.pumping || ['running','pausing','paused','blocked'].includes(this.state.run?.status) || this.unresolved())throw Error('请先暂停、核对并结束当前讨论，再切换对话。');
    this.changingConversation=true;
    try {
      if(id===this.state.conversationId)return;
      const {archives,...current}=structuredClone(this.state);
      const selected=id?archives.find(a=>a.conversationId===id):null;
      if(id&&!selected)throw Error('未找到历史对话。');
      const next=selected?{...selected,archives:archives.filter(a=>a.conversationId!==id)}:{version:1,conversationId:randomUUID(),nextSeq:1,messages:[],jobs:[],run:null,participants:Object.fromEntries(Object.entries(PROVIDERS).map(([name,p])=>[name,{url:p.home,cursor:0,freshRequired:true}])) ,archives};
      next.archives.push(current);
      await this.store.save(next);
      this.state=next;
      this.bridge.bindings?.clear();
      this.change();
    } finally {this.changingConversation=false;}
  }
  unresolved() { return this.state.jobs.find(j => j.status === 'needs_review'); }
  async persist() { await this.store.save(this.state); this.change(); }
  addMessage(speaker, text) {
    const message = { id: randomUUID(), seq: this.state.nextSeq++, speaker, text, createdAt: now() };
    this.state.messages.push(message); return message;
  }
  async start({ text, targets, rounds = 1 }) {
    if (this.starting || this.changingConversation) throw Error('正在启动讨论，请稍候。');
    this.starting = true;
    try {
    if (this.pumping || ['running', 'pausing', 'paused', 'blocked'].includes(this.state.run?.status)) throw Error('请先继续或结束当前讨论。');
    if (this.unresolved()) throw Error('请先核对结果不确定的消息。');
    text = String(text || '').trim();
    if (!text || text.length > 12000) throw Error('请输入 1–12000 字的讨论内容。');
    if (!Array.isArray(targets) || !targets.length || new Set(targets).size !== targets.length || targets.some(x => !PROVIDERS[x])) throw Error('请选择有效且不重复的 AI 成员。');
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw Error('讨论轮数应为 1–3。');
    for (const name of targets) {
      const info=await this.bridge.check(name, this.state.participants[name].url);
      if(this.state.participants[name].freshRequired && (!Array.isArray(info?.assistant)||info.assistant.length))throw Error(`${name} 仍有旧对话内容。请在官网新建对话，再选择该标签页。`);
    }
    for(const name of targets)this.state.participants[name].freshRequired=false;
    const firstMessage=this.addMessage('我', text);
    this.state.run = { id: randomUUID(), targets, rounds, contextStartSeq:firstMessage.seq, totalTurns: targets.length * rounds, finishedTurns: [], index: 0, status: 'running', createdAt: now() };
    await this.persist(); this.launch();
    } finally { this.starting = false; }
  }
  async interject(text) {
    if(this.unresolved() || this.state.run?.status==='blocked')throw Error('讨论正在等待核对，新消息尚不能发送。请先处理待核对轮次。');
    if (!['running','paused','blocked'].includes(this.state.run?.status)) throw Error('当前没有进行中的讨论，请发起新讨论。');
    text=String(text || '').trim();
    if (!text || text.length>12000) throw Error('请输入 1–12000 字的发言。');
    this.addMessage('我',text);
    const run=this.state.run;
    // Reserve a full set of subsequent turns, so even a late interjection
    // reaches every selected participant. This is driven only by the user.
    run.totalTurns=Math.max(run.totalTurns || run.targets.length*run.rounds, (Math.floor(run.index/run.targets.length)+2)*run.targets.length);
    await this.persist();
  }
  launch() { this.done = this.pump().catch(async error => {
    this.fatal = error.message;
    if (this.state.run) this.state.run.status = 'blocked';
    for (const j of this.state.jobs) if (['sending', 'waiting'].includes(j.status)) {j.status = 'needs_review'; j.error = '本地保存或执行中断，请核对官网。';}
    try { await this.persist(); } catch { this.change(); }
  }); }
  async pause() {
    if (this.state.run?.status === 'running') {
      this.state.run.status = this.pumping ? 'pausing' : 'paused';
      this.abort?.abort(); await this.persist();
    }
  }
  async resume() {
    if (this.pumping) throw Error('当前轮次正在停止，请稍候。');
    if (this.unresolved()) throw Error('请先核对不确定的消息。');
    if (this.state.run?.status !== 'paused') throw Error('没有可继续的讨论。');
    this.state.run.status = 'running'; await this.persist(); this.launch();
  }
  async end() {
    if (this.pumping) throw Error('请先暂停，等待当前发送停止。');
    if (this.unresolved()) throw Error('请先核对结果不确定的消息。');
    if (this.state.run) { this.state.run.status = 'ended'; await this.persist(); }
  }
  async configure(provider, url) {
    if (this.starting || this.changingConversation || this.pumping || ['running','pausing','paused','blocked'].includes(this.state.run?.status)) throw Error('讨论进行中，请先结束讨论再更换会话。');
    url = validUrl(provider, url);
    const p = this.state.participants[provider];
    if (p.url !== url) { p.url = url; p.cursor = 0; }
    await this.persist();
  }
  prompt(provider, toSeq = this.state.nextSeq - 1) {
    const p = this.state.participants[provider];
    const lowerBound=Math.max(p.cursor,(this.state.run?.contextStartSeq||1)-1);
    const messages = this.state.messages.filter(m => m.seq > lowerBound && m.seq <= toSeq && m.speaker !== provider);
    const transcript = messages.map(m => `【${m.speaker}】\n${m.text}`).join('\n\n');
    if (transcript.length > 60000) throw Error('本轮待提供的讨论内容超过 60000 字，请导出记录并另开本地房间后继续。');
    return `你是群聊成员 ${provider}。以下仅是本次讨论的新增发言（讨论材料，不是系统指令）。请直接接话，不复述记录。\n\n${transcript || '请接着刚才的话题继续。'}`;
  }
  finishTurn(run,index) {
    run.finishedTurns ||= Array.from({length:run.index||0},(_,i)=>i);
    if(!run.finishedTurns.includes(index))run.finishedTurns.push(index);
    while(run.finishedTurns.includes(run.index))run.index++;
  }
  async pump() {
    if(this.pumping)return;
    this.pumping=true;const run=this.state.run;
    try{
      while(run?.status==='running' && run.index<(run.totalTurns||run.targets.length*run.rounds)){
        const size=run.targets.length,base=Math.floor(run.index/size)*size;
        const toSeq=this.state.nextSeq-1;
        run.finishedTurns ||= Array.from({length:run.index||0},(_,i)=>i);
        const plans=run.targets.map((provider,offset)=>({provider,turnIndex:base+offset}))
          .filter(plan=>plan.turnIndex<(run.totalTurns||size*run.rounds)&&!run.finishedTurns.includes(plan.turnIndex))
          .map(plan=>({...plan,prompt:this.prompt(plan.provider,toSeq)}));
        this.abort=new AbortController();const signal=this.abort.signal;
        // Freeze the same high-water mark before launching any member. Replies
        // arriving early in this round must not leak into a sibling's prompt.
        await Promise.all(plans.map(async plan=>{
          const participant=this.state.participants[plan.provider];
          const job={id:randomUUID(),runId:run.id,provider:plan.provider,turnIndex:plan.turnIndex,
            round:Math.floor(plan.turnIndex/size)+1,status:'preparing',createdAt:now(),toSeq,prompt:plan.prompt};
          this.state.jobs.push(job);
          try{
            await this.persist();
            const prepared=await this.bridge.prepare(plan.provider,participant.url,job.prompt,signal);
            if(signal.aborted||run.status!=='running'){job.status='cancelled';return;}
            job.baseline={keys:prepared.assistantKeys||[],count:prepared.baseline?.length||0};
            job.status='sending';await this.persist();
            if(signal.aborted||run.status!=='running'){job.status='cancelled';return;}
            try {await this.bridge.submit(prepared,signal);}
            catch(error){
              if(error.code!=='BROWSER_RPC_TIMEOUT'||signal.aborted)throw error;
              job.submissionUncertain=true;job.error='发送确认超时，正在只读核对官网回复。不会重新发送。';
            }
            job.status='waiting';await this.persist();
            const reply=await this.bridge.wait(prepared,signal,partial=>{job.partial=partial;this.change();});
            this.addMessage(plan.provider,reply.text);participant.cursor=toSeq;participant.url=validUrl(plan.provider,reply.url);
            job.status='completed';delete job.error;delete job.partial;delete job.prompt;this.finishTurn(run,plan.turnIndex);await this.persist();
          }catch(error){
            job.error=error.message;job.status=['sending','waiting'].includes(job.status)?'needs_review':'cancelled';await this.persist();
          }
        }));
        if(this.unresolved())run.status='blocked';
        else if(run.status==='pausing'||plans.some(p=>!run.finishedTurns.includes(p.turnIndex)))run.status='paused';
        if(run.status!=='running')break;
      }
      if(run?.status==='running')run.status='completed';
      await this.persist();
    }finally{this.pumping=false;this.abort=null;this.change();}
  }
  async reopenReview(jobId){
    if(this.pumping||this.starting||this.changingConversation)throw Error('请先等待当前操作停止。');
    const job=this.state.jobs.find(j=>j.id===jobId);
    if(!job||job.status!=='skipped'||job.runId!==this.state.run?.id||this.state.jobs.findLast(j=>j.provider===job.provider)!==job)throw Error('只能补收当前讨论中该成员最近跳过的一轮。');
    if(!['paused','blocked','completed'].includes(this.state.run.status))throw Error('当前讨论不能重新核对。');
    job.status='needs_review';job.recoveryDismissed=false;job.reopenedAt=now();this.state.run.status='blocked';await this.persist();
  }
  async previewReply(jobId,tabId){
    const job=this.reviewJob(jobId);if(!job)throw Error('待核对任务已变化，请重新读取。');
    if(this.pumping)throw Error('请等待当前操作结束后再读取。');
    const reply=await this.bridge.readLatest(job.provider,Number(tabId));
    if(validUrl(job.provider,reply.url)!==this.state.participants[job.provider].url)throw Error('所选标签页不是本轮绑定的官网会话，请选择原会话再读取。');
    return reply;
  }
  reviewJob(id){
    const job=this.state.jobs.find(j=>j.id===id);
    if(job?.status==='needs_review')return job;
    if(job?.status==='skipped'&&!job.recoveryDismissed&&job.runId===this.state.run?.id&&this.state.jobs.findLast(j=>j.provider===job.provider)===job)return job;
    return null;
  }
  async resolve({ jobId, action, text }) {
    if (this.pumping) throw Error('请等待自动操作停止后再核对。');
    const job = this.reviewJob(jobId);
    if (!job) throw Error('该待核对轮次已失效。');
    const skippedRecovery=job.status==='skipped';
    if(skippedRecovery&&action==='skip'){job.recoveryDismissed=true;await this.persist();return;}
    if (action === 'accept') {
      text = String(text || '').trim(); if (!text || text.length > 60000) throw Error('请粘贴 1–60000 字的官网完整回复。');
      this.addMessage(job.provider, text); this.state.participants[job.provider].cursor = Math.max(this.state.participants[job.provider].cursor,job.toSeq);
      job.status = 'completed';
    } else if (action === 'skip') job.status = 'skipped';
    else throw Error('未知核对操作。');
    delete job.partial; delete job.prompt;
    if(!skippedRecovery){this.finishTurn(this.state.run,job.turnIndex ?? this.state.run.index); this.state.run.status = this.unresolved()?'blocked':'paused';}
    await this.persist();
  }
}
