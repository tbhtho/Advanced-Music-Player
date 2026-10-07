
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({window,contents,spec,inspect})=>{
  const evaluate=source=>contents.executeJavaScript(source);
  await evaluate("location.hash='#/settings'");await delay(250);
  const controls=await evaluate(`(async()=>{
    const store=window.__AMP_TEST_STORE__,wait=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(selector,value)=>{const node=document.querySelector(selector);if(!node)throw new Error("Missing "+selector);
      Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(node,value);
      node.dispatchEvent(new Event("input",{bubbles:true}));node.dispatchEvent(new Event("change",{bubbles:true}));};
    const result=[];
    for(let repeat=0;repeat<4;repeat++)for(const mode of ["glass","album","color"]){
      set("#amp-background",mode);await wait(40);result.push({mode,actual:store.getState().backgroundMode,blurVisible:!!document.querySelector("#amp-artwork-blur"),colorVisible:!!document.querySelector("#amp-background-color")});
    }
    set("#amp-transparency","38");set("#amp-background-color","#742d53");await wait(80);
    set("#amp-background","album");await wait(60);set("#amp-artwork-blur","9");set("#amp-background-motion","ambient");await wait(200);
    return {result,state:{mode:store.getState().backgroundMode,color:store.getState().backgroundColor,blur:store.getState().artworkBlur,transparency:store.getState().glassTransparency},prefs:JSON.parse(localStorage.getItem("spot-cloud.ui-prefs"))};
  })()`);
  assert.ok(controls.result.every(x=>x.mode===x.actual&&x.blurVisible===(x.mode==="album")&&x.colorVisible===(x.mode==="color")));
  assert.deepEqual(controls.state,{mode:"ambient",color:"#742d53",blur:9,transparency:38});
  contents.reload();await delay(2000);
  const persisted=await evaluate("({mode:window.__AMP_TEST_STORE__.getState().backgroundMode,color:window.__AMP_TEST_STORE__.getState().backgroundColor,blur:window.__AMP_TEST_STORE__.getState().artworkBlur,transparency:window.__AMP_TEST_STORE__.getState().glassTransparency})");
  assert.deepEqual(persisted,controls.state);
  await evaluate(`(()=>{
    const store=window.__AMP_TEST_STORE__;window.__AMP_CAPTURE_COUNTS__={requests:0};
    navigator.mediaDevices.getDisplayMedia=async()=>{window.__AMP_CAPTURE_COUNTS__.requests++;throw new Error('Capture disabled in fixture');};
    store.setState({playback:{...store.getState().playback,queue:window.__AMP_FIXTURE__.tracks.slice(0,12),currentIndex:0,status:'paused',durationMs:180000,positionMs:0}});
    store.getState().setAccentSource('artwork');store.getState().setBackgroundMode('ambient');location.hash='#/library';
  })()`);
  await delay(350);const driftBefore=await inspect();await delay(1100);const driftAfter=await inspect();
  assert.equal(driftAfter.motion,'running');assert.notEqual(driftBefore.transform,driftAfter.transform);
  await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await delay(100);const reduced=await inspect();assert.equal(reduced.motion,'paused');assert.equal(reduced.transform,'none');
  await contents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
  const accessibility=[];
  for(const name of ["prefers-reduced-transparency","forced-colors"]){await contents.debugger.sendCommand("Emulation.setEmulatedMedia",{features:[{name,value:name==="forced-colors"?"active":"reduce"}]});await delay(100);
    const value=await inspect();assert.equal(value.motion,"paused");assert.equal(value.display,"none");accessibility.push({name,motion:value.motion,display:value.display});}
  await contents.debugger.sendCommand("Emulation.setEmulatedMedia",{features:[]});await delay(100);
  window.minimize();await delay(900);const minimized={...await inspect(),nativeMinimized:window.isMinimized(),nativeVisible:window.isVisible()};console.log(JSON.stringify({minimized:{hidden:minimized.hidden,motion:minimized.motion,nativeMinimized:minimized.nativeMinimized,nativeVisible:minimized.nativeVisible}}));assert.equal(minimized.nativeMinimized,true);assert.equal(minimized.motion,'paused');
  window.restore();window.showInactive();await delay(250);const restored=await inspect();assert.equal(restored.hidden,false);assert.equal(restored.motion,'running');
  window.hide();await delay(220);const hidden={...await inspect(),nativeVisible:window.isVisible()};assert.equal(hidden.nativeVisible,false);assert.equal(hidden.motion,'paused');
  window.showInactive();await delay(250);
  const patterns=[];
  await evaluate("window.__AMP_TEST_STORE__.getState().setBackgroundMode('album')");
  for(const index of [0,1,5,0]){
    await evaluate(`window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,currentIndex:${index}}})`);
    await delay(450);
    const pattern=await evaluate(`(()=>{const text=getComputedStyle(document.querySelector('.amp-ambient-layer')).backgroundImage;let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return {hash:hash>>>0,bytes:text.length};})()`);
    patterns.push({index,...pattern});
  }
  assert.equal(patterns[0].hash,patterns[3].hash);assert.notEqual(patterns[0].hash,patterns[1].hash);assert.ok(patterns.every(x=>x.bytes>1000));
  const artwork=await evaluate(`(async()=>{
    const store=window.__AMP_TEST_STORE__;store.getState().setBackgroundMode("album");store.getState().setArtworkBlur(0);await new Promise(r=>setTimeout(r,400));
    const load=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src;});
    const layer=document.querySelector(".amp-ambient-layer");const url=getComputedStyle(layer).backgroundImage.slice(5,-2);
    const actual=await load(url),original=await load(store.getState().playback.queue[0].artworkUrl);
    const pixels=image=>{const canvas=document.createElement("canvas");canvas.width=canvas.height=640;const context=canvas.getContext("2d");context.drawImage(image,0,0,640,640);return context.getImageData(0,0,640,640).data;};
    const a=pixels(actual),b=pixels(original);let mismatches=0,totalDelta=0,maxDelta=0,largeDifferences=0;for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);if(difference)mismatches++;totalDelta+=difference;maxDelta=Math.max(maxDelta,difference);if(difference>12)largeDifferences++;}
    store.getState().setArtworkBlur(12);await new Promise(r=>setTimeout(r,400));const blurred=getComputedStyle(layer).backgroundImage;
    return {width:actual.width,height:actual.height,mismatches,sourceBytes:a.length,meanDelta:totalDelta/a.length,maxDelta,largeDifferenceRatio:largeDifferences/a.length,blurChanged:blurred!=="url("+JSON.stringify(url)+")",cssFilter:getComputedStyle(layer).filter};
  })()`);
  console.log(JSON.stringify({artworkPixelCheck:artwork}));
  assert.equal(artwork.width,640);assert.equal(artwork.height,640);// GPU and software SVG rasterizers round gradients/antialiased glyph edges differently.
  assert.ok(artwork.meanDelta<1 && artwork.largeDifferenceRatio<0.001,"Artwork must preserve original pixels, with only raster rounding tolerance");assert.equal(artwork.blurChanged,true);assert.equal(artwork.cssFilter,"none");
  await evaluate("window.__AMP_TEST_STORE__.getState().setArtworkBlur(2)");await delay(350);
  const opacity=[];
  for(const value of [0,60,45]){await evaluate("window.__AMP_TEST_STORE__.getState().setGlassTransparency("+value+")");await delay(80);
    opacity.push({value,background:await evaluate("getComputedStyle(document.querySelector('.amp-shell'),'::before').backgroundColor")});
    if(value!==45)await fs.writeFile(path.join(spec.output,value===0?"glass-opaque.png":"glass-transparent.png"),(await contents.capturePage()).toPNG());}
  assert.ok(opacity[0].background.endsWith("27)"));assert.ok(opacity[1].background.endsWith("0.4)"));
  await evaluate("window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,currentIndex:11,queue:window.__AMP_TEST_STORE__.getState().playback.queue.map((track,index)=>index===11?{...track,artworkUrl:undefined}:track)}});window.__AMP_TEST_STORE__.getState().setBackgroundMode('ambient')");
  await delay(250);const missing=await evaluate("({image:getComputedStyle(document.querySelector('.amp-ambient-layer')).backgroundImage,motion:document.documentElement.dataset.ambientMotion})");assert.deepEqual(missing,{image:"none",motion:"paused"});
  await evaluate("window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,queue:window.__AMP_TEST_STORE__.getState().playback.queue.map((track,index)=>index===11?{...track,artworkUrl:'data:image/png;base64,invalid'}:track)}})");await delay(400);
  const failed=await evaluate("({image:getComputedStyle(document.querySelector('.amp-ambient-layer')).backgroundImage,motion:document.documentElement.dataset.ambientMotion})");assert.deepEqual(failed,{image:"none",motion:"paused"});
  await evaluate("window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,currentIndex:0}})");await delay(400);
  const libraryFilters=[];
  for(const provider of ["spotify","soundcloud","all"]){
    await evaluate("location.hash='#/library'");await delay(100);await evaluate("document.querySelector('button.amp-provider-chip[data-provider="+provider+"]').click()");await delay(100);
    const before=await evaluate("({selected:document.querySelector('.amp-provider-chip[aria-pressed=true]').dataset.provider,providers:[...new Set(Array.from(document.querySelectorAll('.amp-library-tracks .amp-track-row')).map(x=>x.dataset.provider))]})");
    await evaluate("location.hash='#/settings'");await delay(80);await evaluate("location.hash='#/library'");await delay(100);
    const returned=await evaluate("document.querySelector('.amp-provider-chip[aria-pressed=true]').dataset.provider");contents.reload();await delay(2000);
    const reloaded=await evaluate("document.querySelector('.amp-provider-chip[aria-pressed=true]').dataset.provider");assert.equal(before.selected,provider);assert.ok(before.providers.length>0);if(provider!=="all")assert.deepEqual(before.providers,[provider]);else assert.deepEqual(before.providers.sort(),["soundcloud","spotify"]);assert.equal(returned,provider);assert.equal(reloaded,provider);
    libraryFilters.push({provider,before,returned,reloaded});
  }
  await evaluate(`(()=>{const store=window.__AMP_TEST_STORE__,track=window.__AMP_FIXTURE__.tracks[0];
    const key=track.title.toLowerCase()+"::"+track.creators[0].toLowerCase();
    const features={[key]:{key,bpm:80,loudness:-10,tempoBucket:"chill",genres:["jazz"],status:"ready",fetchedAt:Date.now()}};
    localStorage.setItem("spot-cloud.audio-features",JSON.stringify(features));store.setState({trackFeatures:features});
  })()`);await delay(150);
  await evaluate("Array.from(document.querySelectorAll('.amp-library button')).find(b=>b.textContent==='Chill').click()");await delay(100);
  await evaluate("location.hash='#/settings'");await delay(80);await evaluate("location.hash='#/library'");await delay(100);
  const chipReturned=await evaluate("Array.from(document.querySelectorAll('.amp-library button')).find(b=>b.textContent==='Chill').getAttribute('aria-pressed')");assert.equal(chipReturned,"true");
  contents.reload();await delay(2000);const chipReloaded=await evaluate("Array.from(document.querySelectorAll('.amp-library button')).find(b=>b.textContent==='Chill').getAttribute('aria-pressed')");assert.equal(chipReloaded,"true");
  await evaluate("Array.from(document.querySelectorAll('.amp-library button')).find(b=>b.textContent==='Chill').click()");await delay(100);
  const chipCleared=await evaluate("JSON.parse(localStorage.getItem('spot-cloud.ui-prefs')).libraryChip");assert.equal(chipCleared,null);
  const libraryChip={chipReturned,chipReloaded,chipCleared};
  await evaluate("window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,queue:window.__AMP_FIXTURE__.tracks.slice(0,12),currentIndex:0,status:'paused',durationMs:180000}});window.__AMP_TEST_STORE__.getState().setArtworkBlur(4);window.__AMP_TEST_STORE__.getState().setGlassTransparency(45);window.__AMP_TEST_STORE__.getState().setBackgroundMode('album')");await delay(600);
  await evaluate("(()=>{window.__AMP_CAPTURE_COUNTS__={requests:0};navigator.mediaDevices.getDisplayMedia=async()=>{window.__AMP_CAPTURE_COUNTS__.requests++;throw new Error('Capture disabled in fixture')};})()");
  const captureGuards=await evaluate(`(async()=>{
    const store=window.__AMP_TEST_STORE__,wait=ms=>new Promise(r=>setTimeout(r,ms));
    store.getState().setBackgroundMode('glass');store.getState().setAccentSource('audio');
    store.setState({playback:{...store.getState().playback,status:'playing'}});await wait(100);
    document.querySelector('button[aria-label="Pause"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    await wait(100);const glass=window.__AMP_CAPTURE_COUNTS__.requests;
    store.getState().setBackgroundMode('album');store.getState().setBeatIntensity(0);await wait(80);
    document.querySelector('button[aria-label="Pause"]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    await wait(100);const zero=window.__AMP_CAPTURE_COUNTS__.requests;
    store.getState().setAccentSource('artwork');store.getState().setBeatIntensity(1);
    return {glass,zero};
  })()`);
  assert.equal(captureGuards.glass,0);assert.equal(captureGuards.zero,0);
  await evaluate(`(()=>{
    const store=window.__AMP_TEST_STORE__;window.__AMP_SEEK_CALLS__=[];
    store.setState({seek:async position=>{window.__AMP_SEEK_CALLS__.push(position);},playback:{...store.getState().playback,currentIndex:0,status:'playing',positionMs:10000}});
  })()`);await delay(100);
  const seek=await evaluate(`(async()=>{
    const input=document.querySelector('input[aria-label="Seek"]');
    input.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'55000');
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,35));
    input.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));await new Promise(r=>setTimeout(r,60));
    const store=window.__AMP_TEST_STORE__;store.setState({playback:{...store.getState().playback,positionMs:12000}});
    await new Promise(r=>setTimeout(r,180));
    return {calls:window.__AMP_SEEK_CALLS__,afterStalePoll:Number(input.value)};
  })()`);
  assert.deepEqual(seek.calls,[55000]);assert.ok(seek.afterStalePoll>=55000);
  await delay(2700);await evaluate("window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,positionMs:58000}})");await delay(100);
  const resumedSeek=await evaluate("Number(document.querySelector('input[aria-label=\"Seek\"]').value)");
  assert.ok(resumedSeek>=58000&&resumedSeek<=60000);
  await evaluate("window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,status:'paused',positionMs:0}})");
  const navigation=await evaluate(`(async()=>{
    const samples=[];for(let i=0;i<80;i++){
      location.hash='#/'+['settings','library','search','playlists'][i%4];await new Promise(r=>setTimeout(r,i<20?75:8));
      const main=document.querySelector('main');samples.push({opacity:getComputedStyle(main.querySelector('h2')?.parentElement??main).opacity,overflow:document.documentElement.scrollWidth>innerWidth});
    }location.hash='#/library';await new Promise(r=>setTimeout(r,180));return samples;
  })()`);
  assert.ok(navigation.every(x=>x.opacity==='1'&&!x.overflow));
  await fs.writeFile(path.join(spec.output,'library-final.png'),(await contents.capturePage()).toPNG());
  await evaluate("location.hash='#/settings'");await delay(200);
  await evaluate("document.getElementById('amp-background').closest('.amp-section').scrollIntoView({block:'start'})");await delay(150);
  await fs.writeFile(path.join(spec.output,'settings-final.png'),(await contents.capturePage()).toPNG());
  await evaluate("location.hash='#/library'");await delay(200);
  return {controls,persisted,driftBefore,driftAfter,reduced,accessibility,minimized,restored,hidden,patterns,artwork,opacity,missing,failed,libraryFilters,libraryChip,captureGuards,seek,resumedSeek,navigation};
};
