export const MEMBER_NAMES=['ChatGPT','Gemini','Claude','DeepSeek'];
export function resolveTargets(text,checked){
  const canonical=new Map(MEMBER_NAMES.map(name=>[name.toLowerCase(),name]));
  const mentions=[...String(text).matchAll(/@(ChatGPT|Gemini|Claude|DeepSeek)(?![A-Za-z0-9_])/gi)].map(m=>canonical.get(m[1].toLowerCase()));
  const requested=mentions.length?mentions:checked;
  return MEMBER_NAMES.filter(name=>requested.includes(name));
}
