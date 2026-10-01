import type { Segment, Source, Transcript, MediaFormat, Sponsor } from './types';
export function timeLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Untimed';
  const s = Math.max(0, Math.floor(value));
  return s >= 3600 ? `${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}` : `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
export function parseTime(text: string): number | null {
  const cleaned = text.trim().replace(/^\[|\]$/g,'');
  if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(cleaned)) return null;
  const parts = cleaned.split(':').map(Number);
  if (parts.slice(1).some(x=>x>=60)) return null;
  return parts.reduce((acc,n)=>acc*60+n,0);
}
export function parseTranscript(text: string): Transcript {
  const segments: Segment[] = text.split(/\r?\n/).filter(l=>l.trim()).map(line=>{
    const m = line.match(/^\s*\[?(\d{1,3}:\d{2}(?::\d{2})?)\]?\s+(.+)$/);
    return { start: m ? parseTime(m[1]) : null, end: null, text: m ? m[2].trim() : line.trim() };
  });
  for(let i=0;i<segments.length-1;i++) if(segments[i].start !== null && segments[i+1].start !== null) segments[i].end=segments[i+1].start;
  return { segments, source:'pasted', complete:false, detail:'User-provided transcript; completeness is not verified.' };
}
export function transcriptText(t: Transcript): string { return t.segments.map(s=>`${s.start===null?'':`[${timeLabel(s.start)}] `}${s.text}`).join('\n'); }
export function safeUrl(raw: string): string | undefined { try { const u=new URL(raw); return u.protocol==='https:' || u.protocol==='http:' ? u.href : undefined; } catch { return undefined; } }
export function safeSources(sources: Source[]): Source[] { const seen=new Set<string>(); return sources.filter(s=>{ const url=safeUrl(s.url); if(!url || seen.has(url))return false;seen.add(url);return true; }); }
export function parseJson<T>(text: string): T { return JSON.parse(text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'')); }
export function abortError(): DOMException { return new DOMException('Stopped','AbortError'); }
export function checkAbort(signal: AbortSignal) { if(signal.aborted) throw abortError(); }
export function sleep(ms: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve,reject)=>{ if(signal?.aborted)return reject(abortError()); const done=()=>{ signal?.removeEventListener('abort',stop);resolve(); };const t=setTimeout(done,ms);const stop=()=>{clearTimeout(t);signal?.removeEventListener('abort',stop);reject(abortError());};signal?.addEventListener('abort',stop,{once:true}); }); }
export function cleanSponsors(items: Sponsor[], duration: number): Sponsor[] {
  return items.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.start>=0&&s.end>s.start&&s.end<=duration&&s.end-s.start<=300&&['clear','uncertain'].includes(s.confidence)).sort((a,b)=>a.start-b.start);
}
export function allowedMediaUrl(raw?: string): boolean { try { const u=new URL(raw!); return u.protocol==='https:' && (u.hostname==='googlevideo.com'||u.hostname.endsWith('.googlevideo.com')); } catch { return false; } }
export function usableFormats(formats: MediaFormat[]): MediaFormat[] { return formats.filter(f=>allowedMediaUrl(f.url)&&!f.signatureCipher&&!f.cipher&&(f.height??0)<=2160); }
export function safeFilename(name: string): string { return name.replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').replace(/[. ]+$/,'').slice(0,120)||'video'; }
