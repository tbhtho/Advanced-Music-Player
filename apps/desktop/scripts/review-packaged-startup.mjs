import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const exe=path.resolve(process.argv[2]);
const output=path.resolve(process.argv[3]);
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'amp-package-review-'));
await fs.writeFile(path.join(profile,'provider-sessions.json'),'{}');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function poll(f,ms=60000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const v=await f();if(v)return v;}catch(e){last=e;}await delay(200);}throw last??new Error('Timed out waiting for packaged app');}
async function connect(url){
 const ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map(),events=[];
 ws.addEventListener('message',event=>{const msg=JSON.parse(String(event.data));if(msg.id){const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}}else events.push(msg);});
 return {ws,events,send(method,params={}){return new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>{pending.delete(next);reject(new Error('Inspector timed out: '+method));},15000);pending.set(next,{resolve,reject,timer});ws.send(JSON.stringify({id:next,method,params}));});},async event(method){return poll(()=>{const i=events.findIndex(e=>e.method===method);return i<0?null:events.splice(i,1)[0].params;},15000);}};
}
const mainPort=await port(), rendererPort=await port();
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;for(const key of ['SPOTIFY_CLIENT_ID','SOUNDCLOUD_CLIENT_ID','SOUNDCLOUD_CLIENT_SECRET','DISCORD_CLIENT_ID'])delete env[key];
const child=spawn(exe,[`--inspect-brk=127.0.0.1:${mainPort}`,`--remote-debugging-port=${rendererPort}`,'--remote-debugging-address=127.0.0.1'],{env,cwd:path.dirname(exe),windowsHide:true,stdio:['ignore','pipe','pipe']});
let main,renderer,exited=false;const diagnostics=[];
child.stdout.on('data',d=>diagnostics.push(String(d)));child.stderr.on('data',d=>diagnostics.push(String(d)));child.on('exit',()=>{exited=true;});
const evaluation=(client,expression)=>client.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}).then(r=>{if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;});
let result={exe,profile,pid:child.pid,limits:['Original packaged executable and app.asar; debugger used only to isolate test paths and suppress global protocol/media-key registration.','Empty disposable profile; no provider sign-in, real account migration, media playback, or live high-memory case.']};
try {
 const targets=await poll(async()=>{const v=await (await fetch(`http://127.0.0.1:${mainPort}/json/list`)).json();return v.length?v:null;},15000);
 main=await connect(targets[0].webSocketDebuggerUrl);
 await main.send('Runtime.enable');await main.send('Debugger.enable');await main.send('Runtime.runIfWaitingForDebugger');
 const paused=await main.event('Debugger.paused');
 const expression=`(()=>{const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');globalThis.__AMP_PACKAGE_REVIEW__=e;const a=e.app;for(const key of ['appData','userData','sessionData','temp'])a.setPath(key,${JSON.stringify(profile)});a.setAsDefaultProtocolClient=()=>true;e.globalShortcut.register=()=>false;return {isPackaged:a.isPackaged,version:a.getVersion(),profile:a.getPath('userData')};})()`;
 const setup=await main.send('Debugger.evaluateOnCallFrame',{callFrameId:paused.callFrames[0].callFrameId,expression,returnByValue:true});
 if(setup.exceptionDetails)throw new Error('Isolation failed before application entry: '+JSON.stringify(setup.exceptionDetails));
 result.isolation=setup.result.value;assert.equal(result.isolation.isPackaged,true);assert.equal(result.isolation.version,'0.3.7');assert.equal(result.isolation.profile,profile);
 await main.send('Debugger.resume');
 const rendererTarget=await poll(async()=>{const v=await(await fetch(`http://127.0.0.1:${rendererPort}/json/list`)).json();return v.find(t=>t.type==='page'&&t.url.startsWith('file:')&&t.url.includes('index.html'));});
 renderer=await connect(rendererTarget.webSocketDebuggerUrl);await renderer.send('Runtime.enable');await renderer.send('Page.enable');
 result.runtime=await poll(async()=>evaluation(renderer,`(async()=>{if(!window.spotCloud)return null;const r=await window.spotCloud.runtime.getInfo(),c=await window.spotCloud.config.get();return {isPackaged:r.isPackaged,versions:r.versions,configDirectory:r.configDirectory,spotifyConfigured:r.oauth.spotify.configured,spotifyUserOverridePresent:!!c.spotifyClientId,soundCloudSecretBundled:!!c.soundCloudClientSecret};})()`));
 assert.equal(result.runtime.isPackaged,true);assert.equal(result.runtime.configDirectory,profile);assert.equal(result.runtime.spotifyConfigured,true);result.bundledSpotify=await evaluation(main,`({present:!!process.env.SPOTIFY_CLIENT_ID})`);assert.equal(result.bundledSpotify.present,true);assert.equal(result.runtime.soundCloudSecretBundled,false);
 result.onboarding=await poll(()=>evaluation(renderer,`(()=>{const buttons=[...document.querySelectorAll('button')],skip=buttons.find(b=>b.textContent.includes('Skip for now'));if(!skip)return null;const spotify=buttons.find(b=>b.textContent.includes('Connect Spotify'));return {skipAvailable:true,spotifyConnectEnabled:!!spotify&&!spotify.disabled};})()`));
 assert.equal(result.onboarding.spotifyConnectEnabled,true);
 await evaluation(renderer,`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Skip for now')).click();true`);
 await poll(()=>evaluation(renderer,`document.querySelector('main h2')?.textContent==='Home'`));
 const routeNames=[['','Home'],['search','Search'],['library','Library'],['playlists','Playlists'],['settings','Settings']];result.routes=[];
 for(let i=0;i<15;i++){const [route,title]=routeNames[i%routeNames.length];await evaluation(renderer,`location.hash=${JSON.stringify('#/'+route)};true`);await poll(()=>evaluation(renderer,`document.querySelector('main h2')?.textContent===${JSON.stringify(title)}`),6000);const state=await evaluation(renderer,`({route:location.hash,opacity:getComputedStyle(document.querySelector('main h2').parentElement).opacity,overflow:document.documentElement.scrollWidth>innerWidth})`);assert.equal(state.opacity,'1');assert.equal(state.overflow,false);result.routes.push(state);}
 result.interrupted=await evaluation(renderer,`(async()=>{for(let i=0;i<60;i++){location.hash='#/'+['search','library','settings','playlists'][i%4];await new Promise(r=>setTimeout(r,8));}location.hash='#/library';await new Promise(r=>setTimeout(r,350));const main=document.querySelector('main'),side=document.querySelector('.amp-sidebar');return {title:main.querySelector('h2')?.textContent,opacity:getComputedStyle(main.querySelector('h2').parentElement).opacity,overflow:document.documentElement.scrollWidth>innerWidth,mainLeft:main.getBoundingClientRect().left,sidebarRight:side.getBoundingClientRect().right,radius:getComputedStyle(main).borderRadius};})()`);
 assert.equal(result.interrupted.title,'Library');assert.equal(result.interrupted.opacity,'1');assert.equal(result.interrupted.overflow,false);assert.equal(result.interrupted.mainLeft,result.interrupted.sidebarRight);assert.equal(result.interrupted.radius,'0px');
 result.drm=await poll(async()=>{const status=await evaluation(renderer,`window.spotCloud.drm.getWidevineStatus()`);return status?.ready?status:null;},45000);
 result.main=await evaluation(main,`(()=>{const e=globalThis.__AMP_PACKAGE_REVIEW__;return {version:e.app.getVersion(),profile:e.app.getPath('userData'),components:e.components.status(),windows:e.BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),visible:w.isVisible(),destroyed:w.isDestroyed()}))};})()`);
 result.rendererExceptions=renderer.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text);assert.deepEqual(result.rendererExceptions,[]);
 const image=await renderer.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(output,'packaged-library.png'),Buffer.from(image.data,'base64'));
 result.success=true;console.log(JSON.stringify({success:true,pid:child.pid,isPackaged:result.runtime.isPackaged,version:result.main.version,spotifyConfigured:result.runtime.spotifyConfigured,widevineReady:result.drm.ready,components:result.main.components,navigationChecks:75,rendererExceptions:result.rendererExceptions,output},null,2));
} catch(error){result.success=false;result.error=error.stack;console.error(error);process.exitCode=1;}
finally {
 await fs.writeFile(path.join(output,'packaged-review.json'),JSON.stringify(result,null,2));
 await fs.writeFile(path.join(output,'packaged-review-diagnostics.log'),diagnostics.join(''));
 if(main){try{await evaluation(main,'globalThis.__AMP_PACKAGE_REVIEW__.app.quit();true');}catch{}}
 renderer?.ws.close();main?.ws.close();await delay(1000);if(!exited)child.kill();
 // Keep this test-only profile for inspection; the report records it and the tested process exits.
}