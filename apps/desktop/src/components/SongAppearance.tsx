
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/state/useAppStore";
import { audioReactor } from "@/lib/audioReactor";
import { isWindowActive, subscribeWindowActivity } from "@/lib/windowActivity";
import { getArtworkAppearance, getArtworkBackground, type ArtworkAppearance } from "@/lib/songAppearance";

const DEFAULT_ACCENT="#e8e4da";
export function SongAppearance() {
  const artworkUrl=useAppStore(s=>s.playback.queue[s.playback.currentIndex]?.artworkUrl);
  const accentSource=useAppStore(s=>s.accentSource);
  const backgroundMode=useAppStore(s=>s.backgroundMode);
  const backgroundColor=useAppStore(s=>s.backgroundColor);
  const artworkBlur=useAppStore(s=>s.artworkBlur);
  const glassTransparency=useAppStore(s=>s.glassTransparency);
  const [background,setBackground]=useState<{url:string;pattern:string}>();
  const platform=useAppStore(s=>s.runtime?.platform);
  const beatIntensity=useAppStore(s=>s.beatIntensity);
  const status=useAppStore(s=>s.playback.status);
  const [appearance,setAppearance]=useState<ArtworkAppearance>();
  const needsArtwork=accentSource!=="static" || backgroundMode==="album" || backgroundMode==="ambient";
  const layerRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    let active=true;
    if(!needsArtwork || !artworkUrl){setAppearance(undefined);return;}
    setAppearance(undefined);
    void getArtworkAppearance(artworkUrl).then(value=>{if(active)setAppearance(value);});
    return ()=>{active=false;};
  },[artworkUrl,needsArtwork]);
  useEffect(()=>{
    document.documentElement.style.setProperty("--glass-opacity",String(1-glassTransparency/100));
    return ()=>{document.documentElement.style.removeProperty("--glass-opacity");};
  },[glassTransparency]);
  useEffect(()=>{
    let active=true;
    if(!artworkUrl || (backgroundMode!=="album" && backgroundMode!=="ambient")){setBackground(undefined);return;}
    // Debounce slider drags. Previous artwork is hidden immediately when the track changes.
    const timer=setTimeout(()=>{void getArtworkBackground(artworkUrl,artworkBlur).then(pattern=>{if(active)setBackground(pattern?{url:artworkUrl,pattern}:undefined);});},100);
    return ()=>{active=false;clearTimeout(timer);};
  },[artworkUrl,artworkBlur,backgroundMode]);
  useEffect(()=>{
    const root=document.documentElement;
    root.style.setProperty("--acid",accentSource==="static"?DEFAULT_ACCENT:(appearance?.accent??DEFAULT_ACCENT));
    root.style.setProperty("--song-rgb",accentSource==="static"?"232, 228, 218":(appearance?.rgb??"232, 228, 218"));
    root.style.setProperty("--beat-intensity",String(beatIntensity));
    root.dataset.accentSource=accentSource;
    root.dataset.backgroundMode=backgroundMode;
  },[appearance,accentSource,backgroundMode,beatIntensity]);

  useEffect(()=>{
    const root=document.documentElement, layer=layerRef.current;
    if(!layer)return;
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    const transparency=matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast=matchMedia("(forced-colors: active)");
    let timer:ReturnType<typeof setTimeout>|undefined, elapsed=0,previous=performance.now();
    const tick=()=>{
      const now=performance.now();elapsed+=Math.min(1000,now-previous);previous=now;
      const phase=elapsed/40000*Math.PI*2;
      layer.style.transform="translate3d("+(Math.sin(phase)*3).toFixed(3)+"%, "+(Math.sin(phase*.7)*2).toFixed(3)+"%, 0) scale(1.06)";
      // One element, two samples per second. No rAF, animated filters, gradient stops or React state.
      timer=setTimeout(tick,500);
    };
    const sync=()=>{
      clearTimeout(timer);
      const moving=backgroundMode==="ambient" && !!background && background.url===artworkUrl && isWindowActive() && !reduced.matches && !transparency.matches && !contrast.matches;
      root.dataset.ambientMotion=moving?"running":"paused";
      layer.style.willChange=moving?"transform":"auto";
      if(moving){previous=performance.now();tick();}
      else layer.style.transform="none";
    };
    const unsubscribeActivity=subscribeWindowActivity(sync);
    for(const query of [reduced,transparency,contrast])query.addEventListener("change",sync);
    return ()=>{
      clearTimeout(timer);unsubscribeActivity();
      for(const query of [reduced,transparency,contrast])query.removeEventListener("change",sync);
      layer.style.willChange="auto";
    };
  },[backgroundMode,background,artworkUrl]);

  useEffect(()=>{
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    const transparency=matchMedia("(prefers-reduced-transparency: reduce)");
    const contrast=matchMedia("(forced-colors: active)");
    let releaseTimer:ReturnType<typeof setTimeout>|undefined;
    const eligible=()=>accentSource==="audio" && backgroundMode!=="glass" && beatIntensity>0 &&
      platform==="win32" && !reduced.matches && !transparency.matches && !contrast.matches;
    const sync=()=>{
      clearTimeout(releaseTimer);
      if(eligible() && status==="playing" && isWindowActive())audioReactor.start();
      else {
        audioReactor.stop();
        if(!eligible() || !isWindowActive())audioReactor.releaseLoopback();
        else releaseTimer=setTimeout(()=>audioReactor.releaseLoopback(),1500);
      }
    };
    const prime=(event:PointerEvent)=>{
      if(!eligible() || !isWindowActive())return;
      const button=event.target instanceof Element?event.target.closest("button"):null;
      if(status==="playing" || /\bplay\b/i.test(button?.getAttribute("aria-label")??button?.textContent??""))audioReactor.primeLoopback();
    };
    const unsubscribeActivity=subscribeWindowActivity(sync);
    window.addEventListener("pointerdown",prime,{capture:true});
    for(const query of [reduced,transparency,contrast])query.addEventListener("change",sync);
    return ()=>{
      clearTimeout(releaseTimer);unsubscribeActivity();
      window.removeEventListener("pointerdown",prime,{capture:true});
      for(const query of [reduced,transparency,contrast])query.removeEventListener("change",sync);
      audioReactor.stop();
    };
  },[accentSource,backgroundMode,beatIntensity,platform,status]);
  useEffect(()=>()=>audioReactor.releaseLoopback(),[]);
  const style=backgroundMode==="color"?{backgroundColor,backgroundImage:"none"}:
    background?.url===artworkUrl && background?{backgroundImage:'url("'+background.pattern+'")'}:undefined;
  return <div ref={layerRef} className="amp-ambient-layer" data-artwork={background?.url===artworkUrl && !!background?"ready":"missing"} aria-hidden style={style}/>;
}
