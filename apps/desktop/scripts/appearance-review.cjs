
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async ({app, window, contents, spec, material}) => {
  const evaluate = source => contents.executeJavaScript(source);
  contents.debugger.attach('1.3'); await contents.debugger.sendCommand('Performance.enable');
  await evaluate(`(() => {
    const store=window.__AMP_TEST_STORE__, tracks=window.__AMP_FIXTURE__.tracks;
    window.__AMP_CAPTURE_COUNTS__={requests:0};
    navigator.mediaDevices.getDisplayMedia=async()=>{window.__AMP_CAPTURE_COUNTS__.requests++;throw new Error('Capture disabled in fixture');};
    store.setState({libraries:{spotify:{provider:'spotify',items:tracks.filter(t=>t.provider==='spotify')},soundcloud:{provider:'soundcloud',items:tracks.filter(t=>t.provider==='soundcloud')}},
      playback:{...store.getState().playback,queue:tracks.slice(0,12),currentIndex:0,status:'paused',positionMs:0,durationMs:180000}});
    location.hash='#/library';
  })()`);
  if(spec.visible) {window.hide();window.show();} await delay(1800);
  console.log(JSON.stringify({windowVisible:window.isVisible(),windowMinimized:window.isMinimized(),rendererHidden:await evaluate("document.hidden")}));
  const candidate=await evaluate("typeof window.__AMP_TEST_STORE__.getState().setBackgroundMode==='function'");
  const metrics=async()=>{
    const perf=await contents.debugger.sendCommand('Performance.getMetrics');
    return {performance:Object.fromEntries(perf.metrics.map(x=>[x.name,x.value])),
      processes:app.getAppMetrics().map(x=>({pid:x.pid,type:x.type,cpu:x.cpu,workingSetKiB:x.memory.workingSetSize,privateKiB:x.memory.privateBytes}))};
  };
  const inspect=()=>evaluate(`(() => {
    const ambient=document.querySelector('.amp-ambient-layer'), style=getComputedStyle(ambient);
    const main=document.querySelector('main'), sidebar=document.querySelector('.amp-sidebar');
    return {hidden:document.hidden,mode:document.documentElement.dataset.backgroundMode,accent:document.documentElement.dataset.accentSource,
      motion:document.documentElement.dataset.ambientMotion,animation:style.animationName,playState:style.animationPlayState,
      transform:style.transform,display:style.display,filter:style.filter,background:style.backgroundImage,
      mainLeft:main.getBoundingClientRect().left,sidebarRight:sidebar.getBoundingClientRect().right,
      mainRadius:getComputedStyle(main).borderRadius,overflow:document.documentElement.scrollWidth>innerWidth,
      prefs:JSON.parse(localStorage.getItem('spot-cloud.ui-prefs')),captureRequests:window.__AMP_CAPTURE_COUNTS__?.requests??0};
  })()`);
  const refinement=await evaluate("typeof window.__AMP_TEST_STORE__.getState().setGlassTransparency==='function'");
  const cases=candidate?[
    {name:'glass-paused',mode:'glass',accent:'artwork',playing:false},
    {name:'album-paused',mode:'album',accent:'artwork',playing:false},
    {name:'ambient-paused',mode:'ambient',accent:'artwork',playing:false},
    {name:'glass-playing',mode:'glass',accent:'artwork',playing:true},
    {name:'ambient-playing',mode:'ambient',accent:'artwork',playing:true},
    {name:'color-playing',mode:'color',accent:'static',playing:true}
  ]:[
    {name:'static-paused',accent:'static',playing:false},
    {name:'artwork-paused',accent:'artwork',playing:false},
    {name:'artwork-playing',accent:'artwork',playing:true},
    {name:'static-playing',accent:'static',playing:true},
    {name:'artwork-frozen-playing',accent:'artwork',playing:true,freeze:true}
  ];
  const samples=[];
  for(const entry of spec.appearanceChecksOnly?[]:cases.filter(entry=>!spec.sampleCases||spec.sampleCases.includes(entry.name))){
    if(spec.visible){window.show();window.moveTop();}
    await evaluate(`(() => {
      const store=window.__AMP_TEST_STORE__, state=store.getState();
      state.setAccentSource(${JSON.stringify(entry.accent)});
      state.setBackgroundMode?.(${JSON.stringify(entry.mode??null)});
      state.setBackgroundColor?.('#315866');
      store.setState({playback:{...state.playback,status:${JSON.stringify(entry.playing?'playing':'paused')},positionMs:10000}});
      clearInterval(window.__AMP_POLL__);
      if(${entry.playing})window.__AMP_POLL__=setInterval(()=>{store.setState({playback:{...store.getState().playback,positionMs:store.getState().playback.positionMs+2500}});},2500);
      document.querySelector('.amp-ambient-layer').style.animationPlayState=${JSON.stringify(entry.freeze?'paused':'')};
    })()`);
    await delay(1200);
    if(spec.visible){window.hide();window.show();window.moveTop();await delay(150);}
    const before=await metrics(), started=performance.now(); await delay(spec.sampleMs??10000);
    const after=await metrics(),seconds=(performance.now()-started)/1000, old=new Map(before.processes.map(x=>[x.pid,x]));
    const processes=after.processes.map(x=>({...x,cpuSeconds:Math.max(0,(x.cpu.cumulativeCPUUsage??0)-(old.get(x.pid)?.cpu.cumulativeCPUUsage??0))}));
    const cpuSeconds=processes.reduce((n,x)=>n+x.cpuSeconds,0),rendererDelta={};
    for(const key of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'])rendererDelta[key]=(after.performance[key]??0)-(before.performance[key]??0);
    const sample={...entry,seconds,cpuSeconds,totalCPUPercentMachine:100*cpuSeconds/seconds/os.cpus().length,
      totalWorkingSetMiB:after.processes.reduce((n,x)=>n+x.workingSetKiB,0)/1024,totalPrivateMiB:after.processes.reduce((n,x)=>n+x.privateKiB,0)/1024,rendererDelta,visual:await inspect(),processes};
    samples.push(sample);console.log(JSON.stringify({case:entry.name,cpuMachine:sample.totalCPUPercentMachine,workingSetMiB:sample.totalWorkingSetMiB,rendererTaskMs:rendererDelta.TaskDuration*1000,styleRecalculations:rendererDelta.RecalcStyleCount,hidden:sample.visual.hidden}));
    await fs.writeFile(path.join(spec.output,entry.name+'.png'),(await contents.capturePage()).toPNG());
  }
  await evaluate("clearInterval(window.__AMP_POLL__);window.__AMP_TEST_STORE__.setState({playback:{...window.__AMP_TEST_STORE__.getState().playback,status:'paused'}})");
  let checks;
  if(refinement)checks=await require("./validate-appearance.cjs")({window,contents,spec,inspect});
  else if(candidate){
    await evaluate("location.hash='#/library'");await delay(150);await evaluate("document.querySelector('.amp-provider-chip[data-provider=spotify]').click()");await delay(100);
    const before=await evaluate("document.querySelector('.amp-provider-chip[aria-pressed=true]').dataset.provider");
    await evaluate("location.hash='#/settings'");await delay(150);await evaluate("location.hash='#/library'");await delay(150);
    const returned=await evaluate("document.querySelector('.amp-provider-chip[aria-pressed=true]').dataset.provider");checks={libraryFilterReproduction:{before,returned,reset:before!==returned}};
  }
  const report={checks,baseline:!candidate,material,visible:spec.visible,logicalProcessors:os.cpus().length,samples,
    limitations:['Synthetic 120-track library and 12-track queue with simulated 2.5s provider ticks; no live playback, accounts, audio, capture or provider network.',
      'CPU is cumulative process CPU delta divided by wall time and logical processors. Summed working sets repeat shared pages; private commit is not physical RAM.',
      'Installed AMP stays unchanged; system load uncontrolled. Same native window size/material; no fixture backdrop window.']};
  await fs.writeFile(path.join(spec.output,'appearance-review.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(spec.output,'preview-window.json'),JSON.stringify({pid:process.pid,bounds:window.getBounds(),nativeMaterial:material},null,2));
  contents.debugger.detach();console.log('Appearance review complete: '+spec.output);
};
