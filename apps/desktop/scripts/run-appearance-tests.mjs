
import { test } from "node:test";
import assert from "node:assert/strict";
import { backendModule, delay } from "./backend-fixtures.mjs";
const { sampleCover, normalizeBackgroundColor, getArtworkAppearance }=await backendModule("../src/lib/songAppearance.ts");
const prefs=await backendModule("../src/lib/localStore.ts");
const { AudioReactor }=await backendModule("../src/lib/audioReactor.ts");
const values=new Map();
globalThis.window={localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},setTimeout};
test("old static and cover preferences migrate to still backgrounds while preserving other preferences",()=>{
  values.set("spot-cloud.ui-prefs",JSON.stringify({accentSource:"static",volume:.42,shuffle:true}));
  assert.equal(prefs.loadBackgroundMode(),"glass");
  prefs.saveBackgroundColor("#Ab34Ef");prefs.saveBackgroundMode("ambient");
  const saved=JSON.parse(values.get("spot-cloud.ui-prefs"));
  assert.equal(saved.volume,.42);assert.equal(saved.shuffle,true);assert.equal(saved.accentSource,"static");
  assert.equal(prefs.loadBackgroundColor(),"#ab34ef");assert.equal(prefs.loadBackgroundMode(),"ambient");
  values.set("spot-cloud.ui-prefs",JSON.stringify({accentSource:"audio",backgroundMode:"unknown",backgroundColor:"url(secret)"}));
  assert.equal(prefs.loadBackgroundMode(),"album");assert.equal(prefs.loadBackgroundColor(),"#26313d");
  assert.equal(normalizeBackgroundColor("#abc"),"#26313d");
});
test("cover sampling retains spatial colour differences and safely handles transparent artwork",()=>{
  const size=24,data=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;data[i]=x<12?200:10;data[i+1]=x<12?20:180;data[i+2]=40;data[i+3]=255;}
  const result=sampleCover(data,size);assert.equal(result.palette.length,6);
  assert.ok(result.palette[0][0]>result.palette[2][0]);assert.ok(result.palette[2][1]>result.palette[0][1]);
  assert.ok(Math.max(...result.accent)>=170);
  assert.deepEqual(sampleCover(new Uint8ClampedArray(24*24*4),24).accent,[232,228,218]);
});
test("cover bitmaps are reused and bounded to eight cached covers",async()=>{
  let loads=0,bitmaps=0;
  globalThis.Image=class{set src(value){loads++;queueMicrotask(()=>this.onload());}};
  const data=new Uint8ClampedArray(24*24*4).fill(180);
  const context={drawImage(){},getImageData(){return {data};},fillRect(){},createRadialGradient(){return {addColorStop(){}};}};
  globalThis.document={createElement:()=>({getContext:()=>context,toDataURL:()=>{bitmaps++;return "data:image/png;base64,fixture";}})};
  const first=await getArtworkAppearance("data:cover0");assert.equal(await getArtworkAppearance("data:cover0"),first);
  assert.equal(loads,1);assert.equal(bitmaps,1);
  for(let i=1;i<=8;i++)await getArtworkAppearance("data:cover"+i);
  await getArtworkAppearance("data:cover0");assert.equal(loads,10);
});
test("pending or failed audio capture has no display-refresh animation loop",async()=>{
  let frames=0,resolve;
  globalThis.document={hidden:false,getElementById:()=>null};
  globalThis.requestAnimationFrame=()=>{frames++;return 1;};
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{mediaDevices:{getDisplayMedia:()=>new Promise(r=>resolve=r)}}});
  const reactor=new AudioReactor();reactor.start();reactor.primeLoopback();await delay(120);
  assert.equal(frames,0);reactor.releaseLoopback();
  resolve({getTracks:()=>[{stop(){}}]});await delay(0);
});
test("audio analysis is capped, unchanged silence does not rewrite CSS, and release stops processing",async()=>{
  let samples=0,writes=0,stops=0;
  const style={setProperty(){writes++;},willChange:"auto"};
  globalThis.document={hidden:false,getElementById:()=>({isConnected:true,style})};
  const audio={stop(){stops++;},addEventListener(){}},video={stop(){stops++;}};
  navigator.mediaDevices.getDisplayMedia=async()=>({getTracks:()=>[audio,video],getVideoTracks:()=>[video],getAudioTracks:()=>[audio]});
  globalThis.AudioContext=class{state="running";sampleRate=48000;createMediaStreamSource(){return {connect(){}};}
    createAnalyser(){return {fftSize:512,frequencyBinCount:256,getByteFrequencyData(data){samples++;data.fill(0);}};}
    close(){return Promise.resolve();}suspend(){this.state="suspended";return Promise.resolve();}};
  const reactor=new AudioReactor();reactor.start();reactor.primeLoopback();await delay(220);
  assert.ok(samples>=2&&samples<=5);assert.ok(writes<=2);reactor.releaseLoopback();
  const before=samples;await delay(90);assert.equal(samples,before);assert.equal(stops,3);assert.equal(style.willChange,"auto");
});

test("native minimize suspends work even when Page Visibility is stale, and late initial queries cannot undo an event",async()=>{
  const {isWindowActive,subscribeWindowActivity}=await backendModule("../src/lib/windowActivity.ts");
  const previousWindow=globalThis.window,previousDocument=globalThis.document;
  let event,resolveState,removed=0,queries=0,notifications=0;
  globalThis.document={hidden:false,addEventListener(){},removeEventListener(){}};
  globalThis.window={spotCloud:{windowControls:{getState(){queries++;return new Promise(r=>resolveState=r);},
    onVisibilityChanged(callback){event=callback;return ()=>{removed++;event=undefined;};}}}};
  const unsubscribe=subscribeWindowActivity(()=>notifications++);
  try {
    assert.equal(isWindowActive(),true);event(false);assert.equal(isWindowActive(),false);
    resolveState({isVisible:true});await delay(0);assert.equal(isWindowActive(),false);
    event(true);assert.equal(isWindowActive(),true);assert.equal(queries,1);assert.ok(notifications>=3);
  }finally{unsubscribe();globalThis.window=previousWindow;globalThis.document=previousDocument;}
  assert.equal(removed,1);
});
