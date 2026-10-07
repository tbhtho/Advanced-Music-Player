
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({window,contents,spec,inspect})=>{
  const evaluate=source=>contents.executeJavaScript(source);
  await evaluate("location.hash='#/settings'");await delay(250);
  const controls=await evaluate(`(async()=>{
    const result=[];
    for(let repeat=0;repeat<4;repeat++)for(const label of ['Glass only','Album pattern','Ambient drift','Solid colour']){
      const button=Array.from(document.querySelectorAll('button')).find(b=>b.querySelector('p')?.textContent===label);
      if(!button)throw new Error('Missing mode control '+label);
      button.click();await new Promise(r=>setTimeout(r,35));
      result.push({label,pressed:button.getAttribute('aria-pressed'),mode:window.__AMP_TEST_STORE__.getState().backgroundMode});
    }
    const input=document.querySelector('input[aria-label="Background colour"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#742d53');
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,80));
    return {result,color:window.__AMP_TEST_STORE__.getState().backgroundColor,prefs:JSON.parse(localStorage.getItem('spot-cloud.ui-prefs'))};
  })()`);
  assert.ok(controls.result.every(x=>x.pressed==='true'));assert.equal(controls.color,'#742d53');
  await fs.writeFile(path.join(spec.output,'settings-color.png'),(await contents.capturePage()).toPNG());
  contents.reload();await delay(2000);
  const persisted=await evaluate("({mode:window.__AMP_TEST_STORE__.getState().backgroundMode,color:window.__AMP_TEST_STORE__.getState().backgroundColor})");
  assert.equal(persisted.mode,'color');assert.equal(persisted.color,'#742d53');
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
  window.minimize();await delay(900);const minimized={...await inspect(),nativeMinimized:window.isMinimized(),nativeVisible:window.isVisible()};console.log(JSON.stringify({minimized:{hidden:minimized.hidden,motion:minimized.motion,nativeMinimized:minimized.nativeMinimized,nativeVisible:minimized.nativeVisible}}));assert.equal(minimized.nativeMinimized,true);assert.equal(minimized.motion,'paused');
  window.restore();window.showInactive();await delay(250);const restored=await inspect();assert.equal(restored.hidden,false);assert.equal(restored.motion,'running');
  window.hide();await delay(220);const hidden={...await inspect(),nativeVisible:window.isVisible()};assert.equal(hidden.nativeVisible,false);assert.equal(hidden.motion,'paused');
  window.showInactive();await delay(250);
  const patterns=[];
  await evaluate("window.__AMP_TEST_STORE__.getState().setBackgroundMode('album')");
  for(const index of [0,1,5,0]){
    await evaluate(`window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,currentIndex:${index}}})`);
    await delay(220);
    const pattern=await evaluate(`(()=>{const text=getComputedStyle(document.querySelector('.amp-ambient-layer')).backgroundImage;let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return {hash:hash>>>0,bytes:text.length};})()`);
    patterns.push({index,...pattern});
  }
  assert.equal(patterns[0].hash,patterns[3].hash);assert.notEqual(patterns[0].hash,patterns[1].hash);assert.ok(patterns.every(x=>x.bytes>1000));
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
  await fs.writeFile(path.join(spec.output,'settings-final.png'),(await contents.capturePage()).toPNG());
  await evaluate("location.hash='#/library'");await delay(200);
  return {controls,persisted,driftBefore,driftAfter,reduced,minimized,restored,hidden,patterns,captureGuards,seek,resumedSeek,navigation};
};
