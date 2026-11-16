var SELECTORS = {
  ChatGPT: { editor: ['#prompt-textarea', '[role="textbox"][contenteditable="true"][aria-label]', '[contenteditable="true"][data-placeholder]', 'textarea'], assistant: ['[data-response-body]', '[data-markdown-text-style="assistant-message"]', '[data-talvt-turn-state]', '[data-message-author-role="assistant"]', 'main div.isolate'], user: '[data-message-author-role="user"]', send: ['button[aria-label="发送"]','button[aria-label="Send"]','button[title="发送"]','button[title="Send"]','[role="button"][aria-label="发送"]','[role="button"][aria-label="Send"]','[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label="发送提示"]'], stop: ['[data-testid="stop-button"]','button[aria-label="Stop streaming"]'] },
  Gemini: { editor: ['rich-textarea [contenteditable="true"]', '[role="textbox"][contenteditable="true"]'], assistant: ['model-response', '.model-response-text'], user: 'user-query', send: ['button[aria-label="发送"]','button[aria-label="Send"]','button[data-test-id="send-button"]','button.send-button','button[aria-label="Send message"]','button[aria-label="发送消息"]'], stop: ['button[aria-label="Stop response"]','button[aria-label="停止回答"]','button.stop-button'] },
  DeepSeek: { editor: ['textarea#chat-input','textarea[placeholder]','[contenteditable="true"][role="textbox"]'], assistant: ['[data-message-role="assistant"] .ds-markdown','[data-message-author-role="assistant"] .ds-markdown','.ds-markdown'], user: '[data-message-role="user"]', send: ['button[aria-label="发送"]','[role="button"][aria-label="发送"]','button[aria-label="Send"]','[role="button"][aria-label="Send message"]','button[type="submit"]'], stop: ['button[aria-label="停止生成"]','[role="button"][aria-label="停止生成"]','button[aria-label="Stop generating"]'] },
  Claude: { editor: ['[contenteditable="true"][role="textbox"]','div[contenteditable="true"]'], assistant: ['.font-claude-message', '[data-testid*="assistant-message"]'], user: '[data-testid="user-message"]', send: ['button[aria-label="Send message"]','button[aria-label="发送消息"]','button[data-testid="send-button"]'], stop: ['button[aria-label="Stop response"]','button[aria-label="停止回复"]'] }
};

function domSnapshot(config) {
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
