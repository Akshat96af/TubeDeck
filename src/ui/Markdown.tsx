import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useMemo,useEffect,useRef } from 'react';
import { suggestionFragment } from '../shared/search-suggestions';
import type { Source } from '../shared/types';
import { parseTime, safeUrl } from '../shared/utils';
export function Markdown({text,sources=[],seek}:{text:string;sources?:Source[];seek?:(time:number)=>void}){
  const html=useMemo(()=>{
    const raw=marked.parse(text,{async:false,breaks:true}) as string;
    const clean=DOMPurify.sanitize(raw,{ALLOWED_TAGS:['p','br','strong','em','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','hr','a','del','table','thead','tbody','tr','td','th'],ALLOWED_ATTR:['href','title']});
    const d=new DOMParser().parseFromString(clean,'text/html');
    for(const a of d.querySelectorAll('a')){const href=safeUrl(a.getAttribute('href')||'');if(!href||!sources.some(s=>s.url===href)){a.replaceWith(d.createTextNode(a.textContent||''));}else{a.setAttribute('target','_blank');a.setAttribute('rel','noopener noreferrer');}}
    const walker=d.createTreeWalker(d.body,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
    for(const node of nodes){if(node.parentElement?.closest('a,code,pre'))continue;const text=node.textContent||'';const regex=/\[(\d{1,3}:\d{2}(?::\d{2})?)\]/g;let match,last=0;const frag=d.createDocumentFragment();
      while((match=regex.exec(text))){const time=parseTime(match[1]);if(time===null)continue;frag.append(text.slice(last,match.index));const b=d.createElement('button');b.className='time-link';b.dataset.time=String(time);b.textContent=match[1];b.setAttribute('aria-label',`Jump to ${match[1]}`);frag.append(b);last=regex.lastIndex;}
      if(last){frag.append(text.slice(last));node.replaceWith(frag);}
    }return d.body.innerHTML;
  },[text,sources]);
  return <div className="markdown" onClick={e=>{const t=(e.target as Element).closest<HTMLElement>('[data-time]');if(t)seek?.(Number(t.dataset.time));}} dangerouslySetInnerHTML={{__html:html}}/>;
}
export function Sources({sources}:{sources:Source[]}){return sources.length>0?<div className="sources"><span className="eyebrow">Sources</span>{sources.filter(s=>safeUrl(s.url)).map((s,i)=><a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"><span>{i+1}</span>{s.title}</a>)}</div>:null;}
export function SearchSuggestions({html}:{html?:string}){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{if(ref.current){const root=ref.current.shadowRoot||ref.current.attachShadow({mode:'open'});root.replaceChildren(...(html?[suggestionFragment(html)]:[]));}},[html]);return <div className="search-suggestions" ref={ref}/>;}
