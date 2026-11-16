(() => {
  if(globalThis.__tongzhuoAgent)return;
  const providers={'chatgpt.com':'ChatGPT','chat.openai.com':'ChatGPT','gemini.google.com':'Gemini','claude.ai':'Claude','chat.deepseek.com':'DeepSeek'};
  const provider=providers[location.hostname],config=SELECTORS[provider];
  const documentKey=crypto.randomUUID(),attempts=new Set();
  const visible=el=>el&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden';
  function find(selectors,enabled=false){for(const s of selectors){const el=[...document.querySelectorAll(s)].find(e=>visible(e)&&(!enabled||(!e.disabled&&e.getAttribute('aria-disabled')!=='true')));if(el)return el;}return null;}
  function findEditor(){
    const excluded='[data-response-body],[data-markdown-text-style="assistant-message"],[data-content-search-unit-key],[data-talvt-turn-state],[data-message-author-role],model-response,user-query,.model-response-text,.font-claude-message,.ds-markdown,[data-message-role]';
    for(const selector of config.editor){const editor=[...document.querySelectorAll(selector)].find(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true'&&!el.closest(excluded));if(editor)return editor;}
    return null;
  }
  const value=readEditorText;
  function snapshot(){const editor=findEditor();const loginRequired=[...document.querySelectorAll('a,button')].some(el=>visible(el)&&!el.closest('[data-message-author-role],model-response,user-query,[data-testid="chat-message"],.markdown,.font-claude-message')&&/^(log in|sign in|登录|登入)$/i.test(el.innerText?.trim()||''));return{...(provider==='DeepSeek'?deepSeekSnapshot(domSnapshot(config),config):domSnapshot(config)),connectorVersion:'0.8.4',documentKey,editor:!!editor,draft:value(editor),sendFound:!!findSendControl(editor,config.send),sendEnabled:!!findSendControl(editor,config.send,true),loginRequired};}
  async function submit(args){
    if(args.provider!==provider || args.documentKey!==documentKey || location.href!==args.url)throw Error('发送前官网页面或会话已变化，请核对。');
    if(attempts.has(args.actionId))throw Error('该任务曾尝试发送，请核对官网。');
    attempts.add(args.actionId);
    const s=snapshot();if(!s.editor||s.loginRequired||s.busy||s.draft.trim())throw Error('官网未就绪、正在生成或已有草稿，请检查。');
    const editor=findEditor();editor.focus();
    if(editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement){const proto=editor instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(editor,args.text);}
    else{const range=document.createRange();range.selectNodeContents(editor);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.execCommand('insertText',false,args.text);}
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:args.text}));editor.dispatchEvent(new Event('change',{bubbles:true}));
    const norm=text=>text.replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ').trim();
    let verified=false;
    for(let i=0;i<10;i++){
      if(norm(value(findEditor()||editor))===norm(args.text)){verified=true;break;}
      await new Promise(r=>setTimeout(r,100));
    }
    if(!verified)throw Error('输入框内容与待发送正文不一致，未点击发送，请检查官网草稿。');
    // DeepSeek also supports Enter on its textarea. Some versions expose an
    // unlabeled icon rather than an accessible Send control. Use that one
    // keyboard action only when no Send control is identified, never after click.
    if(provider==='DeepSeek'&&!findSendControl(editor,config.send)){
      if(location.href!==args.url)throw Error('填入后会话已变化，未发送，请核对。');
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      editor.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      return{attempted:true,method:'deepseek-enter'};
    }
    let button;for(let i=0;i<30;i++){button=findSendControl(findEditor()||editor,config.send,true);if(button)break;await new Promise(r=>setTimeout(r,100));}
    if(location.href!==args.url)throw Error('填入后会话已变化，未点击发送，请核对。');
    if(!button)throw Error(findSendControl(findEditor()||editor,config.send)?'官网发送按钮仍处于禁用状态，未点击发送，请核对。':'未识别到唯一的官网发送控件，未点击发送，请核对。');button.click();return{attempted:true};
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||message.type!=='ROOM_COMMAND')return;
    (async()=>{try{if(message.args?.provider!==provider)throw Error('平台与标签页不匹配。');const result=message.action==='SNAPSHOT'?snapshot():message.action==='SUBMIT'?await submit(message.args):null;if(!result)throw Error('未知操作。');respond({ok:true,result});}catch(error){respond({ok:false,error:error.message});}})();return true;
  });
  globalThis.__tongzhuoAgent=true;
})();
