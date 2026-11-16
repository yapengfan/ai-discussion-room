// Read the editor's logical paragraphs. innerText adds presentation-dependent
// blank lines between <p> elements; textContent drops their boundaries entirely.
function readEditorText(editor) {
  if (!editor) return '';
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value;
  const blocks=new Set(['P','DIV','LI','PRE','BLOCKQUOTE']);
  function read(node) {
    if(node.nodeType===Node.TEXT_NODE)return node.textContent;
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    if(node.tagName==='BR') {
      if(node.classList.contains('ProseMirror-trailingBreak') || (node.parentElement?.childNodes.length===1))return '';
      return '\n';
    }
    const children=[...node.childNodes];
    if(!children.some(child=>blocks.has(child.tagName)))return children.map(read).join('');
    const lines=[];let inline='';
    for(const child of children) {
      if(blocks.has(child.tagName)) {if(inline){lines.push(inline);inline='';}lines.push(read(child));}
      else if(child.nodeType===Node.TEXT_NODE && !child.textContent.trim())continue;
      else inline+=read(child);
    }
    if(inline)lines.push(inline);
    return lines.join('\n');
  }
  return read(editor).replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ');
}
