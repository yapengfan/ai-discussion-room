// DeepSeek-only adapter. Keep the working adapters for other websites untouched.
function deepSeekSnapshot(base, config) {
  const visible=el=>!!(el&&el.getBoundingClientRect().width&&el.getBoundingClientRect().height&&getComputedStyle(el).visibility!=='hidden');
  let nodes=[];
  for(const selector of config.assistant){
    const found=[...document.querySelectorAll(selector)].filter(el=>visible(el)&&!el.closest('[data-message-role="user"],[data-message-author-role="user"],.ds-think-content,[data-testid="thinking"],header,nav'));
    if(found.length){nodes=found;break;}
  }
  nodes=nodes.filter(n=>!nodes.some(other=>other!==n&&other.contains(n)));
  const clean=node=>{
    const clone=node.cloneNode(true);
    clone.querySelectorAll('button,[role="button"],svg,script,style,textarea,input,[aria-hidden="true"],.ds-think-content,[data-testid="thinking"]').forEach(el=>el.remove());
    const text=(el,depth=0)=>{
      if(el.nodeType===3)return el.textContent;
      if(el.nodeType!==1)return '';
      if(el.tagName==='BR')return '\n';
      if(el.tagName==='PRE'){
        const code=el.querySelector('code')?.textContent??el.textContent;
        const longest=Math.max(2,...(code.match(/`+/g)||[]).map(s=>s.length));
        const fence='`'.repeat(longest+1);
        return '\n'+fence+'\n'+code.replace(/\n$/,'')+'\n'+fence+'\n\n';
      }
      if(el.tagName==='LI'){
        const ordered=el.parentElement?.tagName==='OL';
        const index=Number(el.parentElement?.getAttribute('start')||1)+[...el.parentElement.children].indexOf(el);
        return '  '.repeat(depth)+(ordered?index+'. ':'- ')+[...el.childNodes].map(n=>text(n,depth+1)).join('').trim()+'\n';
      }
      const value=[...el.childNodes].map(n=>text(n,depth)).join('');
      if(/^(P|H[1-6]|BLOCKQUOTE)$/.test(el.tagName))return value+'\n\n';
      if(/^(DIV|UL|OL|TR)$/.test(el.tagName))return value+'\n';
      if(el.tagName==='TD'||el.tagName==='TH')return value+'\t';
      return value;
    };
    return text(clone).replace(/\r\n?/g,'\n').trim();
  };
  const last=nodes.at(-1);
  const name=el=>(el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('data-tooltip-content')||el.textContent||'').trim();
  const controls=scope=>[...scope.querySelectorAll('button,[role="button"],.ds-icon-button,.ds-button.ds-button--icon')].filter(el=>visible(el)&&!el.closest('pre,code,.ds-think-content'));
  let busy=base.busy||!!last?.closest('[aria-busy="true"],[data-state="streaming"]');
  // The final action row is a sibling of .ds-markdown, not its child.
  // Only controls after the latest body count. Earlier replies' toolbars
  // cannot finish the latest reply. Stop before the composer.
  const completionTrace=[];
  let completed=false,scope=last?.parentElement;
  for(let level=0;scope&&level<8;level++,scope=scope.parentElement){
    if(scope.querySelector('textarea,[contenteditable="true"]'))break;
    const after=controls(scope).filter(el=>!last.contains(el)&&(last.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING));
    busy ||= after.some(el=>/^(停止|停止生成|停止回答|Stop|Stop generating|Stop response)$/i.test(name(el)));
    const copy=after.some(el=>/^(复制|复制回复|Copy|Copy response)$/i.test(name(el)));
    const icons=after.filter(el=>el.matches('.ds-icon-button,.ds-button.ds-button--icon')&&el.querySelector('svg'));
    completionTrace.push({adapter:"0.8.5",level,tag:scope.tagName,classes:String(scope.className).slice(0,150),controlsAfter:after.map(el=>({tag:el.tagName,role:el.getAttribute('role'),classes:String(el.className).slice(0,100),name:name(el).slice(0,60),icon:!!el.querySelector('svg')}))});
    if(copy||icons.length>=2){completed=true;break;}
  }
  return {...base,assistant:nodes.map(clean),assistantKeys:nodes.map((n,i)=>n.closest('[data-message-id]')?.getAttribute('data-message-id')||base.assistantKeys?.[i]||null),completed:completed&&!busy,busy,completionTrace};
}
