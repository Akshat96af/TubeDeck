import DOMPurify from 'dompurify';
/** Provider-supplied search attribution. Scripts, event handlers and embedded frames are removed. */
export function suggestionFragment(html:string):DocumentFragment{
  const clean=DOMPurify.sanitize(`<div>${html}</div>`,{RETURN_DOM_FRAGMENT:true,ALLOWED_TAGS:['div','span','style','a','p','svg','path'],ALLOWED_ATTR:['class','style','href','target','rel','viewBox','width','height','d','fill','xmlns','aria-label']});
  for(const a of clean.querySelectorAll('a')){try{if(!['https:','http:'].includes(new URL(a.href).protocol))throw new Error();a.target='_blank';a.rel='noopener noreferrer';}catch{a.removeAttribute('href');}}
  return clean;
}
