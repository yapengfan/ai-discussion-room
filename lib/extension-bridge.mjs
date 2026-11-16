import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { validUrl } from './engine.mjs';
const extensionOrigin = value => /^chrome-extension:\/\/[a-p]{32}$/.test(value || '');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));

export class ExtensionBridge {
  constructor(dataDir) { this.dataDir=dataDir;this.pending=new Map();this.bindings=new Map();this.inventory=[]; }
  async init(server) {
    this.server=server;
    const keyFile=join(this.dataDir,'bridge-key.json');
    try {this.credentials=JSON.parse(await readFile(keyFile,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;this.credentials={token:randomBytes(32).toString('hex'),origin:null};await writeFile(keyFile,JSON.stringify(this.credentials),'utf8');}
    this.code=String(randomInt(100000,1000000));this.expires=Date.now()+300000;
    this.wss=new WebSocketServer({noServer:true,maxPayload:1000000});
    server.on('upgrade',(req,socket,head)=>{
      const expected=`127.0.0.1:${server.address().port}`;
      if(req.url!=='/bridge/socket' || req.headers.host!==expected || !extensionOrigin(req.headers.origin)){socket.destroy();return;}
      this.wss.handleUpgrade(req,socket,head,ws=>this.accept(ws,req.headers.origin));
    });
  }
  info() {return{connected:!!this.socket,paired:!!this.credentials.origin,workerVersion:this.workerVersion||'未知',code:this.code,expiresAt:this.expires};}
  async pair(origin,code) {
    if(!this.attemptWindow || Date.now()-this.attemptWindow>60000){this.attemptWindow=Date.now();this.attempts=0;}
    if(++this.attempts>10)throw Error('配对尝试过多，请一分钟后再试。');
    if(!extensionOrigin(origin) || !equal(code,this.code) || Date.now()>this.expires)throw Error('配对码不正确或已过期，请在平台刷新配对码。');
    if(this.credentials.origin && this.credentials.origin!==origin)throw Error('已有另一连接组件配对，请先在平台解除配对。');
    this.credentials.origin=origin;await writeFile(join(this.dataDir,'bridge-key.json'),JSON.stringify(this.credentials),'utf8');
    this.expires=0;
    return{token:this.credentials.token};
  }
  async revoke(){
    this.credentials={token:randomBytes(32).toString('hex'),origin:null};
    await writeFile(join(this.dataDir,'bridge-key.json'),JSON.stringify(this.credentials),'utf8');
    this.socket?.close(1000,'revoked');this.socket=null;this.inventory=[];this.bindings.clear();this.resetCode();
  }
  resetCode(){this.code=String(randomInt(100000,1000000));this.expires=Date.now()+300000;}
  accept(ws,origin){
    let authenticated=false;
    const authTimer=setTimeout(()=>ws.close(1008,'authentication required'),5000);
    ws.on('error',()=>{});
    ws.on('message',raw=>{
      try{
        const m=JSON.parse(raw.toString());
        if(!authenticated){
          if(m.type!=='AUTH' || origin!==this.credentials.origin || !equal(m.token,this.credentials.token)){ws.close(1008,'invalid credentials');return;}
          if(this.socket && this.socket!==ws){ws.close(1008,'another connection is active');return;}
          authenticated=true;clearTimeout(authTimer);this.workerVersion=m.version||'未知';this.socket=ws;this.inventory=[];this.bindings.clear();ws.send(JSON.stringify({type:'AUTH_OK'}));return;
        }
        if(m.type==='PING'){ws.send(JSON.stringify({type:'PONG'}));return;}
        if(m.type==='TABS'){
          this.inventory=(Array.isArray(m.tabs)?m.tabs:[]).filter(tab=>{try{return Number.isInteger(tab.tabId)&&!!validUrl(tab.provider,tab.url);}catch{return false;}}).map(({tabId,provider,url,title,documentKey})=>({tabId,provider,url,title:String(title||'').slice(0,150),documentKey}));return;
        }
        if(m.type==='RESULT'){
          const item=this.pending.get(m.id);if(!item || item.ws!==ws)return;
          clearTimeout(item.timer);this.pending.delete(m.id);m.ok?item.resolve(m.result):item.reject(Error(m.error||'连接组件操作失败。'));
        }
      }catch{ws.close(1008,'invalid message');}
    });
    ws.on('close',()=>{clearTimeout(authTimer);if(this.socket!==ws)return;this.socket=null;this.inventory=[];this.bindings.clear();for(const [id,p]of this.pending){clearTimeout(p.timer);p.reject(Error('浏览器连接已断开，执行结果需要核对。'));this.pending.delete(id);}});
  }
  request(action,args={}) {
    const ws=this.socket;if(!ws)return Promise.reject(Error('请先加载浏览器连接组件并配对。'));
    const id=randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);const error=Error('浏览器响应超时，请检查官网，平台不会自动重发。');error.code='BROWSER_RPC_TIMEOUT';reject(error);},15000);
      this.pending.set(id,{ws,timer,resolve,reject});ws.send(JSON.stringify({type:'COMMAND',id,action,args}));
    });
  }
  tabs(){return this.inventory;}
  select(provider,tabId){
    const tab=this.inventory.find(t=>t.provider===provider && t.tabId===Number(tabId));if(!tab)throw Error('请在平台选择一个已打开的官网标签页。');
    return tab;
  }
  bind(provider,tabId){const tab=this.select(provider,tabId);this.bindings.set(provider,tab.tabId);return tab;}
  async open(provider,url,forceNew=false){return this.request('OPEN',{provider,url:validUrl(provider,url),forceNew});}
  async inspect(provider){
    const tab=this.inventory.find(t=>t.provider===provider && t.tabId===this.bindings.get(provider));
    if(!tab)return{open:false,ready:false};
    try{const info=await this.request('SNAPSHOT',{provider,tabId:tab.tabId});const current=info.connectorVersion==='0.8.4';return{open:true,ready:current&&info.editor&&!info.loginRequired,url:info.url,tabId:tab.tabId,connectorVersion:info.connectorVersion||'未知',sendFound:info.sendFound,sendEnabled:info.sendEnabled,editorDetected:info.editor,loginRequired:info.loginRequired,...(provider==='DeepSeek'?{replyCompleted:!!info.completed,replyBusy:!!info.busy,replyCount:info.assistant?.length,completionTrace:info.completionTrace||[]}:{}),reason:!current?'官网连接脚本需要刷新；请重新加载组件，再刷新此官网':info.loginRequired?'官网显示登录入口，请确认账号状态':!info.editor?'未识别到官网输入框，请刷新官网或更新连接组件':''};}
    catch(error){const reason=/(Receiving end does not exist|Could not establish connection)/i.test(error.message||'')?'官网连接脚本未加载，请刷新该官网标签页；若刚更新组件，请先重新加载组件。':error.message;return{open:true,ready:false,url:tab.url,reason,error:error.message};}
  }
  async check(provider,url){
    const tab=this.inventory.find(t=>t.provider===provider && t.tabId===this.bindings.get(provider));
    if(!tab)throw Error(`请先为 ${provider} 选择并使用日常浏览器里的标签页。`);
    const info=await this.request('SNAPSHOT',{provider,tabId:tab.tabId});
    if(info.connectorVersion!=='0.8.4')throw Error(`${provider} 官网运行的连接脚本尚未更新，请重新加载组件并刷新官网。`);
    if(validUrl(provider,info.url)!==validUrl(provider,url))throw Error(`${provider} 会话已改变，请结束当前讨论后重新选择。`);
    if(info.loginRequired)throw Error(`${provider} 官网显示登录入口，请在官网确认账号状态。`);
    if(!info.editor)throw Error(`${provider} 未识别到可用输入框，请刷新官网；如果已登录，则需要修正网页适配。`);
    if(info.busy)throw Error(`${provider} 正在生成，请等官网完成。`);
    return{...info,provider,tabId:tab.tabId};
  }
  async prepare(provider,url,text,signal){
    if(signal.aborted)throw Error('已暂停。');const p=await this.check(provider,url);
    if(p.draft.trim())throw Error(`${provider} 输入框有草稿，请先处理。`);
    // Gemini can show a microphone instead of Send while its editor is empty.
    // Check the actual send control after filling, inside the guarded SUBMIT.
    return{...p,text,baseline:p.assistant,actionId:randomUUID()};
  }
  async submit(p,signal){if(signal.aborted)throw Error('已暂停。');return this.request('SUBMIT',{provider:p.provider,tabId:p.tabId,url:p.url,documentKey:p.documentKey,text:p.text,actionId:p.actionId});}
  async wait(p,signal,onPartial){
    const started=Date.now();let previous='',stableSince=0,seenBusy=false,acceptedUrl=p.url;
    while(Date.now()-started<240000){
      if(signal.aborted)throw Error('已暂停等待，官网可能仍在生成，请核对。');
      const s=await this.request('SNAPSHOT',{provider:p.provider,tabId:p.tabId});
      const currentUrl=validUrl(p.provider,s.url);
      if(s.documentKey!==p.documentKey)throw Error('官网页面已刷新，请核对回复。');
      if(currentUrl!==acceptedUrl){if(acceptedUrl===p.url && ['/','/app','/new'].includes(new URL(p.url).pathname))acceptedUrl=currentUrl;else throw Error('官网会话已切换，请核对。');}
      if(p.provider==='DeepSeek'&&Date.now()-started>10000&&s.draft?.trim()&&!s.busy)throw Error('DeepSeek 未确认发送，官网仍有草稿。请检查官网；不会自动再发。');
      seenBusy ||= s.busy;
      const oldKeys=new Set((p.assistantKeys||[]).filter(Boolean));
      const newIndex=(s.assistantKeys||[]).findLastIndex(key=>key&&!oldKeys.has(key));
      let reply=newIndex>=0?s.assistant[newIndex]:(s.assistant.length>p.baseline.length?s.assistant.at(-1):'');
      // DeepSeek recycles visible replies and has no stable message IDs. A
      // newly generated last body can replace a baseline node at the same count.
      if(!reply&&p.provider==='DeepSeek'){
        const latest=s.assistant.at(-1);
        if(latest?.trim()&&!p.baseline.includes(latest))reply=latest;
      }
      if(reply && reply!==previous){previous=reply;stableSince=Date.now();onPartial(reply);}
      if(reply && Date.now()-stableSince>=(seenBusy?2500:8000) && (seenBusy||s.completed) && !s.busy && s.editor && !s.draft.trim())return{text:reply,url:currentUrl};
      await new Promise(r=>setTimeout(r,700));
    }
    throw Error('等待回复超时，请核对官网。不会自动重发。');
  }
  async readLatest(provider,tabId){const tab=this.select(provider,tabId);const s=await this.request('SNAPSHOT',{provider,tabId:tab.tabId});if(s.connectorVersion!=='0.8.4')throw Error('请更新组件并刷新官网后再读取。');if(s.busy||(provider!=='DeepSeek'&&!s.completed))throw Error('官网回复尚未确认完成，请稍后核对。');const text=s.assistant.at(-1);if(!text)throw Error('未识别到官网回复，请保留会话以便排查。');return{provider,text,url:s.url,completed:!!s.completed,replyCount:s.assistant.length,latestKey:s.assistantKeys?.at(-1)||null};}
  async close(){for(const ws of this.wss.clients)ws.terminate();await new Promise(r=>this.wss.close(r));}
}
