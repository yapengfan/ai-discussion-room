import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Store } from './lib/store.mjs';
import { Engine, PROVIDERS, validUrl } from './lib/engine.mjs';
import { ensureDependencies } from './lib/setup.mjs';
export async function createApp({dataDir,bridge,port=4317}={}) {
  const root=dirname(fileURLToPath(import.meta.url)); dataDir ||= join(root,'data');
  await mkdir(dataDir,{recursive:true});
  bridge ||= new (await import('./lib/extension-bridge.mjs')).ExtensionBridge(dataDir);
  const engine=new Engine(new Store(join(dataDir,'room.json')),bridge);
  const token=randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      if (!engine.state) return json({error:'本地记录正在初始化，请稍候刷新。'},503);
      const origin=`http://${req.headers.host}`;
      const expected=`http://127.0.0.1:${server.address().port}`;
      if (origin!==expected) return json({error:'仅允许本机平台访问。'},403);
      const url=new URL(req.url,expected);
      if (url.pathname==='/bridge/pair') {
        if(!/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin||''))return json({error:'请从浏览器连接组件中配对。'},403);
        res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Private-Network','true');
        if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
        if(req.method!=='POST' || !req.headers['content-type']?.startsWith('application/json') || !bridge.pair)return json({error:'不支持此配对请求。'},400);
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000)return json({error:'配对请求过大。'},413);}
        return json(await bridge.pair(req.headers.origin,JSON.parse(raw).code));
      }
      if ((req.headers.origin && req.headers.origin!==expected) || req.headers['sec-fetch-site']==='cross-site') return json({error:'仅允许本机平台访问。'},403);
      if (url.pathname==='/api/bootstrap' && req.method==='GET') return json({token});
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-room-token']!==token) return json({error:'请刷新本地平台后重试。'},403);
        if (req.method==='GET' && url.pathname==='/api/state') {
          const connections=Object.fromEntries(await Promise.all(Object.keys(PROVIDERS).map(async name=>[name,await bridge.inspect(name)])));
          return json({...engine.state,jobs:engine.state.jobs.map(({prompt,...job})=>job),archives:engine.state.archives.map(a=>({id:a.conversationId,title:a.messages.find(m=>m.speaker==='我')?.text.slice(0,30)||'新对话',count:a.messages.length})),connections,connector:bridge.info?.(),availableTabs:bridge.tabs?.()||[],pumping:engine.pumping,fatal:engine.fatal});
        }
        if (req.method==='GET' && url.pathname==='/api/export') return json({...engine.state,jobs:engine.state.jobs.map(({prompt,...job})=>job)});
        if (req.method!=='POST' || !req.headers['content-type']?.startsWith('application/json')) return json({error:'不支持的请求。'},405);
        let raw=''; for await (const chunk of req) {raw+=chunk; if(Buffer.byteLength(raw)>180000) return json({error:'请求过大。'},413);}
        const body=JSON.parse(raw||'{}');
        if (url.pathname==='/api/connect') {
          if (engine.pumping) throw Error('请先暂停并等待当前操作停止。');
          if (!PROVIDERS[body.provider]) throw Error('未知成员。');
          await bridge.open(body.provider,engine.state.participants[body.provider].url,!!engine.state.participants[body.provider].freshRequired);
        } else if (url.pathname==='/api/bind') {
          if (!PROVIDERS[body.provider]) throw Error('未知成员。');
          const info=bridge.select?bridge.select(body.provider,body.tabId):await bridge.inspect(body.provider);
          if (!body.url && !info.url) throw Error('请先打开该成员的官网窗口，登录并选择会话。');
          const chosen=validUrl(body.provider,body.url||info.url);
          const restoring=!engine.pumping&&['paused','blocked'].includes(engine.state.run?.status)&&chosen===engine.state.participants[body.provider].url;
          if(!restoring)await engine.configure(body.provider,chosen);
          bridge.bind?.(body.provider,body.tabId);
        } else if(url.pathname==='/api/bridge/reset') {bridge.resetCode();
        } else if(url.pathname==='/api/bridge/revoke') {
          if(engine.pumping)throw Error('请先暂停并等待停止。');
          await bridge.revoke();
        } else if (url.pathname==='/api/conversation') await engine.changeConversation(body.id);
        else if (url.pathname==='/api/start') await engine.start(body);
        else if (url.pathname==='/api/message') await engine.interject(body.text);
        else if (url.pathname==='/api/pause') await engine.pause();
        else if (url.pathname==='/api/resume') await engine.resume();
        else if (url.pathname==='/api/end') await engine.end();
        else if (url.pathname==='/api/reopen-review') await engine.reopenReview(body.jobId);
        else if (url.pathname==='/api/recover-reply') return json(await engine.previewReply(body.jobId,body.tabId));
        else if (url.pathname==='/api/resolve') await engine.resolve(body);
        else return json({error:'没有此操作。'},404);
        return json({ok:true});
      }
      const files={'/':'index.html','/app.js':'app.js','/recipients.js':'recipients.js','/style.css':'style.css'};
      if(req.method!=='GET' || !files[url.pathname]) return json({error:'未找到。'},404);
      const name=files[url.pathname];
      res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'});
      res.end(await readFile(join(root,'public',name)));
    } catch(error) {json({error:error.message},400);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  // Bind the single default port before touching stored run state. A second
  // double-click must fail without marking the first instance's run interrupted.
  try { await engine.init();await bridge.init?.(server); } catch(error) { await new Promise(r=>server.close(r)); throw error; }
  return {server,engine,bridge,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{await engine.pause();if(engine.done) await engine.done;await bridge.close();await new Promise(r=>server.close(r));}};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try { await ensureDependencies({root:dirname(fileURLToPath(import.meta.url))}); }
  catch(error) { console.error(error.message); process.exit(1); }
  const app=await createApp({port:Number(process.env.PORT)||4317});
  console.log(`会客厅 v0.8.7\n本地地址：${app.url}\n请在日常浏览器加载 browser-connector 文件夹并配对。按 Ctrl+C 停止。`);
  if(process.env.OPEN_ROOM==='1' && process.platform==='win32') execFile('rundll32.exe',['url.dll,FileProtocolHandler',app.url],{windowsHide:true},()=>{});
  let stopping=false; const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
