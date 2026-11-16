import { join } from 'node:path';
import { validUrl } from './engine.mjs';
const delay = ms => new Promise(r => setTimeout(r, ms));
export const SELECTORS = {
  ChatGPT: { editor: ['#prompt-textarea', '[role="textbox"][contenteditable="true"][aria-label]', '[contenteditable="true"][data-placeholder]', 'textarea'], assistant: ['[data-response-body]', '[data-markdown-text-style="assistant-message"]', '[data-talvt-turn-state]', '[data-message-author-role="assistant"]', 'main div.isolate'], user: '[data-message-author-role="user"]', send: ['button[aria-label="发送"]','button[aria-label="Send"]','button[title="发送"]','button[title="Send"]','[role="button"][aria-label="发送"]','[role="button"][aria-label="Send"]','[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="发送提示"]'], stop: ['[data-testid="stop-button"]','button[aria-label="Stop streaming"]'] },
  Gemini: { editor: ['rich-textarea [contenteditable="true"]', '[role="textbox"][contenteditable="true"]'], assistant: ['model-response', '.model-response-text'], user: 'user-query', send: ['button[aria-label="发送"]','button[aria-label="Send"]','button[data-test-id="send-button"]','button.send-button','button[aria-label="Send message"]','button[aria-label="发送消息"]'], stop: ['button[aria-label="Stop response"]','button[aria-label="停止回答"]','button.stop-button'] },
  DeepSeek: { editor: ['textarea#chat-input','textarea[placeholder]','[contenteditable="true"][role="textbox"]'], assistant: ['[data-message-role="assistant"] .ds-markdown','[data-message-author-role="assistant"] .ds-markdown','.ds-markdown'], user: '[data-message-role="user"]', send: ['button[aria-label="发送"]','[role="button"][aria-label="发送"]','button[aria-label="Send"]','[role="button"][aria-label="Send message"]','button[type="submit"]'], stop: ['button[aria-label="停止生成"]','[role="button"][aria-label="停止生成"]','button[aria-label="Stop generating"]'] },
  Claude: { editor: ['[contenteditable="true"][role="textbox"]','div[contenteditable="true"]'], assistant: ['.font-claude-message', '[data-testid*="assistant-message"]'], user: '[data-testid="user-message"]', send: ['button[aria-label="Send message"]','button[aria-label="发送消息"]','button[data-testid="send-button"]'], stop: ['button[aria-label="Stop response"]','button[aria-label="停止回复"]'] }
};

export function domSnapshot(config) {
  const visible = el => !!(el && el.getBoundingClientRect().width && el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden');
  const clean = node => {
    const clone=node.cloneNode(true);
    clone.querySelectorAll('button,svg,nav,textarea,input,[aria-hidden="true"],[data-testid*="toolbar"],[data-content-search-unit-key$=":user"],[data-chatgpt-search-unit-key$=":user"],[data-message-author-role="user"],[class*="user-message"],[data-message-role="user"],[data-testid="thinking"],.ds-think-content,.turn-action-controls').forEach(el=>el.remove());
    const blocks=new Set(['P','DIV','LI','UL','OL','H1','H2','H3','H4','H5','H6','PRE','BLOCKQUOTE','TR']);
    const text=node=>{
      if(node.nodeType===3)return node.textContent;
      if(node.nodeType!==1)return '';
      if(node.tagName==='BR')return '\n';
      const value=[...node.childNodes].map(text).join('');
      return value+(blocks.has(node.tagName)?'\n':'');
    };
    return text(clone).replace(/\r\n?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  };
  let nodes = [];
  for (const selector of config.assistant) {
    const found = [...document.querySelectorAll(selector)].filter(el=>visible(el)&&!el.closest('header,nav')&&(selector!=='main div.isolate'||!el.querySelector('textarea,[contenteditable="true"]')));
    if (found.length) { nodes = found; break; }
  }
  nodes = nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
  nodes=nodes.filter(n=>!n.closest('[data-message-author-role="user"], [class*="user-message"], [data-content-search-unit-key$=":user"], [data-message-role="user"], .ds-think-content'));
  const assistant = nodes.map(node => {
    const body = node.matches('model-response') ? node.querySelector('.model-response-text') || node : node;
    return clean(body);
  });
  const last=nodes.at(-1);
  const completed=last?.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state')==='complete'||!!(last?.closest('[data-talvt-turn-state]')||last)?.querySelector('button[aria-label*="Copy"],button[aria-label*="复制"],[data-testid*="copy"],[data-testid*="turn-actions"]');
  return { url: location.href, assistant, assistantKeys:nodes.map(el=>el.getAttribute('data-response-body')||el.closest('[data-turn-key]')?.getAttribute('data-turn-key')||el.getAttribute('data-message-id')||null), assistantStates:nodes.map(el=>el.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state')), completed, busy: config.stop.some(s => [...document.querySelectorAll(s)].some(visible)) };
}

export class BrowserBridge {
  constructor(dataDir, options = {}) { this.dataDir = dataDir; this.options = options; this.pages = new Map(); }
  async browser() {
    if (this.context) return this.context;
    if (!this.launching) this.launching = (async () => {
      let chromium;
      try { ({ chromium } = await import('playwright')); }
      catch (_) { throw Error('本地浏览器依赖缺失或损坏，请停止服务，再运行“启动群聊室.cmd”修复。'); }
      const channel = this.options.channel || process.env.BROWSER_CHANNEL || 'msedge';
      if (!['msedge','chrome'].includes(channel)) throw Error('BROWSER_CHANNEL 只支持 msedge 或 chrome。');
      this.context = await chromium.launchPersistentContext(join(this.dataDir, 'browser-profile'), {
        channel, headless: false, viewport: null, args: ['--no-first-run'], timeout: 30000
      });
      this.context.on('close', () => { this.context = null; this.pages.clear(); });
      return this.context;
    })().finally(() => { this.launching = null; });
    return this.launching;
  }
  async open(provider, url) {
    url = validUrl(provider, url);
    const context = await this.browser();
    let page = this.pages.get(provider);
    if (!page || page.isClosed()) {
      page = context.pages().find(p => { try { return validUrl(provider, p.url()) === url; } catch { return false; } });
      if (!page) { page = await context.newPage(); this.pages.set(provider,page); await page.goto(url, {waitUntil:'domcontentloaded',timeout:45000}); }
      this.pages.set(provider,page);
    }
    await page.bringToFront(); return { url: page.url() };
  }
  page(provider) {
    const page = this.pages.get(provider);
    if (!page || page.isClosed()) throw Error(`请先打开 ${provider} 账号窗口并登录。`);
    return page;
  }
  async find(page, selectors, enabled = false) {
    for (const selector of selectors) {
      const loc = page.locator(selector); const count = await loc.count();
      for (let i = 0; i < count; i++) { const el = loc.nth(i); if (await el.isVisible() && (!enabled || await el.isEnabled())) return el; }
    }
    return null;
  }
  async check(provider, url) {
    const page = this.page(provider);
    if (validUrl(provider,page.url()) !== validUrl(provider,url)) throw Error(`${provider} 网页地址已变化，请在成员卡片点击“采用当前会话”。`);
    const config = SELECTORS[provider];
    if (!await this.find(page,config.editor,true)) throw Error(`${provider} 尚未就绪：请检查登录、验证码或网页输入框。`);
    const state = await page.evaluate(domSnapshot,config);
    if (state.busy) throw Error(`${provider} 正在生成，请等官网回复完成后再开始。`);
    return {page,state};
  }
  async inspect(provider) {
    try { const page=this.page(provider); const url=validUrl(provider,page.url());
      const editor=await this.find(page,SELECTORS[provider].editor,true);
      return {open:true,ready:!!editor,url};
    } catch { return {open:false,ready:false}; }
  }
  async prepare(provider, url, text, signal) {
    if (signal.aborted) throw Error('已暂停。');
    const {page,state} = await this.check(provider,url);
    const editor=await this.find(page,SELECTORS[provider].editor,true);
    const draft=await editor.evaluate(el=>el.value ?? el.innerText ?? el.textContent ?? '');
    if (draft.trim()) throw Error(`${provider} 输入框里有草稿，请先处理，平台不会覆盖。`);
    const button=await this.find(page,SELECTORS[provider].send);
    return {provider,page,url,text,baseline:state.assistant,editor};
  }
  async submit(p, signal) {
    if(signal?.aborted) throw Error('已暂停。');
    if (validUrl(p.provider,p.page.url()) !== p.url) throw Error('准备后目标网页发生变化，请核对。');
    await p.editor.fill(p.text,{timeout:8000});
    const button=await this.find(p.page,SELECTORS[p.provider].send,true);
    if (!button) throw Error('已填入，但没有找到可点击的发送按钮，请核对官网。');
    if(signal?.aborted) throw Error('已暂停，官网输入框可能已有内容，请核对。');
    await button.click({timeout:8000}); // no keyboard-send fallback or retry
  }
  async wait(p, signal, onPartial) {
    const started=Date.now(); const timeout=this.options.replyTimeout || 240000;
    let previous='', stableSince=0, seenBusy=false, acceptedUrl=p.url;
    while (Date.now()-started < timeout) {
      if (signal.aborted) throw Error('已暂停等待；官网可能仍在生成，请核对后继续。');
      const current=await p.page.evaluate(domSnapshot,SELECTORS[p.provider]);
      const url=validUrl(p.provider,current.url);
      // A new conversation may obtain its ID after its first send. Existing
      // conversation changes are never silently treated as the same session.
      const homePaths=['/','/app','/new'];
      if (url!==acceptedUrl) {
        if (acceptedUrl===p.url && homePaths.includes(new URL(p.url).pathname)) acceptedUrl=url;
        else throw Error('等待期间切换了官网会话，请人工核对。');
      }
      seenBusy ||= current.busy;
      const changed=current.assistant.length>p.baseline.length;
      const reply=changed ? current.assistant.at(-1) : '';
      if (reply && reply!==previous) { previous=reply;stableSince=Date.now();onPartial(reply); }
      const quiet=reply && reply===previous && Date.now()-stableSince >= (this.options.settleMs || (seenBusy ? 2500 : 8000));
      if (quiet && (seenBusy || current.completed) && !current.busy && await this.find(p.page,SELECTORS[p.provider].editor,true)) {
        const editor=await this.find(p.page,SELECTORS[p.provider].editor,true);
        const draft=await editor.evaluate(el=>el.value ?? el.innerText ?? el.textContent ?? '');
        if (!draft.trim()) return {text:reply,url};
      }
      await delay(this.options.pollInterval || 700);
    }
    throw Error('等待回复超时，无法确定官网是否已完成；不会自动重发。');
  }
  async close() { if (this.context) await this.context.close(); }
}
