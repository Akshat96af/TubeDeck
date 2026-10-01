import { ALL_FORMATS, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource, WebMOutputFormat } from 'mediabunny';
import { allowedMediaUrl, checkAbort, usableFormats } from '../shared/utils';
import type { MediaFormat } from '../shared/types';

export interface DownloadChoice { video:MediaFormat; audio?:MediaFormat; extension:'mp4'|'webm' }
export function choices(formats:MediaFormat[]):DownloadChoice[]{
  const safe=usableFormats(formats);
  return safe.filter(f=>f.mimeType.startsWith('video/')&&f.height).flatMap(video=>{
    const extension=video.mimeType.startsWith('video/webm')?'webm' as const:'mp4' as const;
    const audio=safe.filter(f=>f.mimeType.startsWith(`audio/${extension}`)).sort((a,b)=>(b.bitrate??0)-(a.bitrate??0))[0];
    return video.audioQuality?[{video,extension}]:audio?[{video,audio,extension}]:[];
  }).sort((a,b)=>(b.video.height??0)-(a.video.height??0)||(b.video.bitrate??0)-(a.video.bitrate??0));
}
/** Repackages encoded packets without upscaling or re-encoding. Streams writes to disk. */
export async function remux(choice:DownloadChoice,writable:FileSystemWritableFileStream,signal:AbortSignal,progress:(seconds:number,bytes:number)=>void){
  checkAbort(signal);
  const inputs:Input[]=[];let output:Output|undefined;let written=0;
  const open=(url:string)=>{if(!allowedMediaUrl(url))throw new Error('Unsupported media host.');const input=new Input({formats:ALL_FORMATS,source:new UrlSource(url,{maxCacheSize:16*1024*1024,parallelism:2,getRetryDelay:()=>null})});inputs.push(input);return input;};
  const stop=()=>{inputs.forEach(i=>i.dispose());};signal.addEventListener('abort',stop,{once:true});
  try{
    const videoInput=open(choice.video.url!),audioInput=choice.audio?open(choice.audio.url!):videoInput;
    const [video,audio]=await Promise.all([videoInput.getPrimaryVideoTrack(),audioInput.getPrimaryAudioTrack()]);
    if(!video||!audio)throw new Error('This source does not provide both video and audio.');
    const [vc,ac,vconfig,aconfig]=await Promise.all([video.getCodec(),audio.getCodec(),video.getDecoderConfig(),audio.getDecoderConfig()]);
    const format=choice.extension==='webm'?new WebMOutputFormat():new Mp4OutputFormat({fastStart:false});
    if(!vc||!ac||!vconfig||!aconfig||!format.getSupportedCodecs().includes(vc)||!format.getSupportedCodecs().includes(ac))throw new Error('These source codecs cannot be combined in this container.');
    const target=new StreamTarget(new WritableStream({async write(chunk){checkAbort(signal);await writable.write(chunk);written=Math.max(written,chunk.position+chunk.data.byteLength);}}),{chunked:true,chunkSize:2*1024*1024});
    output=new Output({format,target});const vs=new EncodedVideoPacketSource(vc),as=new EncodedAudioPacketSource(ac);
    output.addVideoTrack(vs);output.addAudioTrack(as);await output.start();
    const vi=new EncodedPacketSink(video).packets(),ai=new EncodedPacketSink(audio).packets();
    let v=await vi.next(),a=await ai.next(),videoCount=0,audioCount=0,last=0;
    if(v.done||a.done)throw new Error('The source contains an empty audio or video track.');
    while(!v.done||!a.done){
      checkAbort(signal);
      if(!v.done&&(a.done||v.value.timestamp<=a.value.timestamp)){
        await vs.add(v.value,videoCount++===0?{decoderConfig:vconfig}:undefined);last=Math.max(last,v.value.timestamp);v=await vi.next();if(v.done)vs.close();
      }else if(!a.done){await as.add(a.value,audioCount++===0?{decoderConfig:aconfig}:undefined);a=await ai.next();if(a.done)as.close();}
      progress(last,written);
    }
    checkAbort(signal);await output.finalize();checkAbort(signal);await writable.close();progress(last,written);
  }catch(e){await output?.cancel().catch(()=>{});await writable.abort().catch(()=>{});checkAbort(signal);throw e;}
  finally{signal.removeEventListener('abort',stop);inputs.forEach(i=>i.dispose());}
}
