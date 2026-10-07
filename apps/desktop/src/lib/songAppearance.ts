
import { resolveArtwork } from "./desktopBridge";

export type BackgroundMode = "album" | "color" | "ambient" | "glass";
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
      const {accent,palette}=sampleCover(context.getImageData(0,0,24,24).data,24);
      // Six radial fields retain the cover's colour placement in a reusable 256x192 bitmap.
      canvas.width=256;canvas.height=192;
      context.fillStyle="#171719";context.fillRect(0,0,256,192);
      palette.forEach((color,i)=>{
        const x=(i%3+.5)*256/3,y=(Math.floor(i/3)+.5)*96;
        const gradient=context.createRadialGradient(x,y,0,x,y,160);
        gradient.addColorStop(0,"rgba("+color.join(",")+",0.85)");
        gradient.addColorStop(1,"rgba("+color.join(",")+",0)");
        context.fillStyle=gradient;context.fillRect(0,0,256,192);
      });
      return {accent:"rgb("+accent.join(", ")+")",rgb:accent.join(", "),pattern:canvas.toDataURL("image/png")};
    }catch{return undefined;}
  })();
  cache.set(url,request);
  while(cache.size>MAX_CACHED_ARTWORK)cache.delete(cache.keys().next().value!);
  return request;
}
