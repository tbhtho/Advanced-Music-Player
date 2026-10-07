
import { resolveArtwork } from "./desktopBridge";

export type BackgroundMode = "album" | "color" | "ambient" | "glass";
export const ARTWORK_BITMAP_SIZE = 640;
export const ARTWORK_BLUR_DEFAULT = 6;
export const ARTWORK_BLUR_MAX = 24;
export const GLASS_TRANSPARENCY_DEFAULT = 45;
export const GLASS_TRANSPARENCY_MAX = 60;
export function normalizeAppearanceNumber(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(max, value))) : fallback;
}
export const DEFAULT_BACKGROUND_COLOR = "#26313d";
export const BACKGROUND_MODES: readonly BackgroundMode[] = ["album", "color", "ambient", "glass"];
export function normalizeBackgroundColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : DEFAULT_BACKGROUND_COLOR;
}
export interface ArtworkAppearance { accent: string; rgb: string; pattern: string; }
const cache = new Map<string, Promise<ArtworkAppearance | undefined>>();
const MAX_CACHED_ARTWORK = 8;

/** Extract a bounded spatial colour field once per cover, never per animation frame. */
export function sampleCover(data: Uint8ClampedArray, size: number): { accent: [number, number, number]; palette: number[][] } {
  let r=0, g=0, b=0, count=0;
  for(let i=0;i<data.length;i+=4){
    const max=Math.max(data[i],data[i+1],data[i+2]), min=Math.min(data[i],data[i+1],data[i+2]);
    if(data[i+3]>0 && max>45 && (max-min)/max>0.28){r+=data[i];g+=data[i+1];b+=data[i+2];count++;}
  }
  if(count<4){r=g=b=count=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>0){r+=data[i];g+=data[i+1];b+=data[i+2];count++;}}
  if(count===0)return {accent:[232,228,218],palette:Array.from({length:6},()=>[56,60,68])};
  const lift=Math.max(r,g,b)/count;
  const scale=lift>0 && lift<170 ? 170/lift : 1;
  const accent:[number,number,number]=[r,g,b].map(x=>Math.min(255,Math.round(x/count*scale))) as [number,number,number];
  const palette=[];
  for(let row=0;row<2;row++)for(let col=0;col<3;col++){
    const sum=[0,0,0];let n=0;
    for(let y=Math.floor(row*size/2);y<Math.floor((row+1)*size/2);y++)
      for(let x=Math.floor(col*size/3);x<Math.floor((col+1)*size/3);x++){
        const i=(y*size+x)*4;if(!data[i+3])continue;
        for(let c=0;c<3;c++)sum[c]+=data[i+c];n++;
      }
    palette.push(n?sum.map(x=>Math.round(x/n)):[56,60,68]);
  }
  return {accent,palette};
}

export function getArtworkAppearance(url: string): Promise<ArtworkAppearance | undefined> {
  const cached=cache.get(url);
  if(cached){cache.delete(url);cache.set(url,cached);return cached;}
  const request=(async()=>{
    try {
      const source=/^https?:/i.test(url) ? (await resolveArtwork({artworkUrl:url,cacheKey:url})).dataUrl : url;
      if(!source)return undefined;
      const image=new Image();image.decoding="async";image.crossOrigin="anonymous";
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Artwork unavailable"));image.src=source;});
      const canvas=document.createElement("canvas");canvas.width=canvas.height=24;
      const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return undefined;
      context.drawImage(image,0,0,24,24);
      const {accent}=sampleCover(context.getImageData(0,0,24,24).data,24);
      // Preserve actual cover geometry and lettering in a bounded reusable bitmap.
      canvas.width=canvas.height=ARTWORK_BITMAP_SIZE;
      context.drawImage(image,0,0,ARTWORK_BITMAP_SIZE,ARTWORK_BITMAP_SIZE);
      return {accent:"rgb("+accent.join(", ")+")",rgb:accent.join(", "),pattern:canvas.toDataURL("image/png")};
    }catch{return undefined;}
  })();
  cache.set(url,request);
  while(cache.size>MAX_CACHED_ARTWORK)cache.delete(cache.keys().next().value!);
  return request;
}

const blurredCache=new Map<string, Promise<string | undefined>>();
const MAX_BLURRED_ARTWORK=4;
/** Bake blur only when the cover or control changes; moving the image never reruns a filter. */
export function getArtworkBackground(url: string, amount: number): Promise<string | undefined> {
  const blur=normalizeAppearanceNumber(amount,ARTWORK_BLUR_DEFAULT,ARTWORK_BLUR_MAX);
  const key=url+"\0"+blur;
  const cached=blurredCache.get(key);
  if(cached){blurredCache.delete(key);blurredCache.set(key,cached);return cached;}
  const request=(async()=>{
    const appearance=await getArtworkAppearance(url);
    if(!appearance || blur===0)return appearance?.pattern;
    try {
      const image=new Image();image.decoding="async";
      await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Artwork unavailable"));image.src=appearance.pattern;});
      const canvas=document.createElement("canvas");canvas.width=canvas.height=ARTWORK_BITMAP_SIZE;
      const context=canvas.getContext("2d");if(!context)return undefined;
      const padding=blur*3;
      context.filter="blur("+blur+"px)";
      context.drawImage(image,-padding,-padding,ARTWORK_BITMAP_SIZE+padding*2,ARTWORK_BITMAP_SIZE+padding*2);
      return canvas.toDataURL("image/png");
    }catch{return undefined;}
  })();
  blurredCache.set(key,request);
  while(blurredCache.size>MAX_BLURRED_ARTWORK)blurredCache.delete(blurredCache.keys().next().value!);
  return request;
}
