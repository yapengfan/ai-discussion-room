function findSendControl(editor, selectors, requireEnabled=false) {
  const visible=el=>el&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden';
  const enabled=el=>!el.disabled&&el.getAttribute('aria-disabled')!=='true';
  const usable=el=>visible(el)&&(!requireEnabled||enabled(el));
  for(const selector of selectors){const known=[...document.querySelectorAll(selector)].find(usable);if(known)return known;}
  const name=el=>{
    const labelled=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||'').join(' ');
    return (el.getAttribute('aria-label')||labelled||el.getAttribute('title')||el.textContent||el.value||'').replace(/\s+/g,' ').trim();
  };
  const names=/^(发送|傳送|发送消息|发送提示|送出|Send|Send message|Send prompt|Submit|Submit prompt)$/i;
  const candidates=[...document.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(el=>usable(el)&&names.test(name(el))&&!el.closest('[data-message-author-role],model-response,user-query,.markdown,.font-claude-message'));
  // Prefer the editor's composer. Never guess among unrelated Send controls.
  let parent=editor?.parentElement;
  while(parent&&parent!==document.body){const local=candidates.filter(el=>parent.contains(el));if(local.length===1)return local[0];if(local.length>1)return null;parent=parent.parentElement;}
  return candidates.length===1?candidates[0]:null;
}
