const $=id=>document.getElementById(id);
async function status(){const s=await chrome.storage.local.get('connectionStatus');$('status').textContent=s.connectionStatus||'尚未配对，请先启动本地平台。';}
async function send(message){$('status').textContent='正在连接……';try{const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'组件未响应');$('status').textContent='操作成功，正在检查连接……';setTimeout(status,1000);}catch(e){$('status').textContent=e.message;}}
$('pair').onclick=()=>send({type:'PAIR',code:$('code').value.trim()});$('reconnect').onclick=()=>send({type:'RECONNECT'});$('disconnect').onclick=()=>send({type:'DISCONNECT'});status();
