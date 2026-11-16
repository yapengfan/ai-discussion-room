const SERVER='http://127.0.0.1:4317';
let socket,connecting=false,authorized=false,keepalive,retry,inventoryTimer;
const providers={'chatgpt.com':'ChatGPT','chat.openai.com':'ChatGPT','gemini.google.com':'Gemini','claude.ai':'Claude','chat.deepseek.com':'DeepSeek'};
function providerOf(url){try{const u=new URL(url);return u.protocol==='https:'?providers[u.hostname]:null;}catch{return null;}}
async function inventory(){
  const tabs=(await chrome.tabs.query({})).filter(t=>providerOf(t.url)).map(t=>({tabId:t.id,provider:providerOf(t.url),url:t.url,title:t.title}));
  if(authorized && socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'TABS',tabs}));
}
async function operate(action,args){
  if(!Object.values(providers).includes(args.provider))throw Error('未知 AI 成员。');
  if(action==='OPEN'){
    const parsed=new URL(args.url);if(parsed.username||parsed.password||parsed.port||providerOf(args.url)!==args.provider)throw Error('目标地址不是所选 AI 官网。');
    const tabs=await chrome.tabs.query({});const existing=!args.forceNew&&tabs.find(t=>t.url===args.url);
    const tab=existing?await chrome.tabs.update(existing.id,{active:true}):await chrome.tabs.create({url:args.url});
    await inventory();return{tabId:tab.id,url:tab.url||args.url};
  }
  if(!['SNAPSHOT','SUBMIT'].includes(action))throw Error('不支持此连接操作。');
  const tab=await chrome.tabs.get(args.tabId);if(providerOf(tab.url)!==args.provider)throw Error('标签页已关闭或平台发生变化。');
  if(action==='SUBMIT'){
    if(!args.actionId || typeof args.text!=='string' || args.text.length>80000)throw Error('发送任务无效。');
    const reservation=journalQueue.then(async()=>{
    const {journal={}}=await chrome.storage.session.get('journal');
    if(journal[args.actionId])throw Error('此发送任务曾执行过，请核对官网；不会重复点击发送。');
    journal[args.actionId]=Date.now();
    const entries=Object.entries(journal).sort((a,b)=>b[1]-a[1]).slice(0,100);
    await chrome.storage.session.set({journal:Object.fromEntries(entries)});
    });journalQueue=reservation.catch(()=>{});await reservation;
  }
  const message={type:'ROOM_COMMAND',action,args};
  let result;
  try {result=await chrome.tabs.sendMessage(tab.id,message);}
  catch(error){
    // Only a read-only snapshot may attach a missing page agent and retry.
    // SUBMIT is journaled above and is never replayed after uncertain delivery.
    if(action!=='SNAPSHOT'||!/(Receiving end does not exist|Could not establish connection)/i.test(error.message||''))throw error;
    const current=await chrome.tabs.get(tab.id);
    if(providerOf(current.url)!==args.provider||current.url!==tab.url)throw Error('官网标签页已切换，请重新选择会话。');
    try{
      await chrome.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',files:['selectors.js','editor.js','send-control.js','deepseek.js','agent.js']});
      result=await chrome.tabs.sendMessage(tab.id,message);
    }catch(attachError){throw Error('官网连接脚本未能加载。请确认组件获准访问该官网，再刷新官网标签页。详情：'+attachError.message);}
  }
  if(!result?.ok)throw Error(result?.error||'官网未响应，请刷新该官网标签页后重试。');
  return result.result;
}
async function connect(){
  if(connecting || socket?.readyState===WebSocket.OPEN)return;connecting=true;
  const {bridgeToken}=await chrome.storage.local.get('bridgeToken');if(!bridgeToken){connecting=false;return;}
  const ws=new WebSocket('ws://127.0.0.1:4317/bridge/socket');socket=ws;let authenticated=false;
  ws.onopen=()=>ws.send(JSON.stringify({type:'AUTH',token:bridgeToken,version:chrome.runtime.getManifest?.().version||'未知'}));
  ws.onmessage=async event=>{
    try{
      const m=JSON.parse(event.data);
      if(m.type==='AUTH_OK'){
        connecting=false;authenticated=true;authorized=true;await chrome.storage.local.set({connectionStatus:'已连接本地平台'});
        chrome.action.setBadgeText({text:'ON'});chrome.action.setBadgeBackgroundColor({color:'#256b58'});
        await inventory();clearInterval(keepalive);clearInterval(inventoryTimer);
        keepalive=setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'PING'}));},20000);
        inventoryTimer=setInterval(inventory,5000);return;
      }
      if(!authenticated || m.type!=='COMMAND')return;
      const execute=async()=>{
        try{const result=await operate(m.action,m.args||{});if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'RESULT',id:m.id,ok:true,result}));}
        catch(error){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'RESULT',id:m.id,ok:false,error:error.message}));}
      };
      // Mutating commands are serialized per tab. Snapshot reads never wait
      // behind another provider's submit, whose UI may be background-throttled.
      if(m.action==='SNAPSHOT'){void execute();}
      else {const key=m.args?.tabId??m.args?.provider;const task=(tabQueues.get(key)||Promise.resolve()).then(execute);tabQueues.set(key,task);void task.finally(()=>{if(tabQueues.get(key)===task)tabQueues.delete(key);});}
    }catch{}
  };
  ws.onerror=()=>{};
  ws.onclose=()=>{if(socket!==ws)return;connecting=false;authorized=false;socket=null;clearInterval(keepalive);clearInterval(inventoryTimer);chrome.action.setBadgeText({text:'OFF'});chrome.storage.local.set({connectionStatus:'未连接，请确认平台已启动并配对'});clearTimeout(retry);retry=setTimeout(connect,4000);};
}
const tabQueues=new Map();let journalQueue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('popup.html')))return;
  (async()=>{
    try{
      if(message.type==='PAIR'){
        const response=await fetch(SERVER+'/bridge/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:String(message.code||'')})});const result=await response.json();if(!response.ok)throw Error(result.error||'配对失败');
        await chrome.storage.local.set({bridgeToken:result.token});socket?.close();socket=null;connecting=false;await connect();respond({ok:true});
      }else if(message.type==='RECONNECT'){await connect();respond({ok:true});}
      else if(message.type==='DISCONNECT'){await chrome.storage.local.remove('bridgeToken');socket?.close();respond({ok:true});}
    }catch(error){respond({ok:false,error:error.message});}
  })();return true;
});
chrome.tabs.onUpdated.addListener(()=>inventory());chrome.tabs.onRemoved.addListener(()=>inventory());
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('reconnect',{periodInMinutes:.5});connect();});
chrome.runtime.onStartup.addListener(connect);chrome.alarms.onAlarm.addListener(connect);connect();
