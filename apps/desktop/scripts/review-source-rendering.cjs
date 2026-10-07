
const {app,BrowserWindow,globalShortcut}=require('electron');
const sync=require('node:fs'),fs=sync.promises,path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../..'),output=process.env.AMP_SOURCE_REVIEW_OUTPUT??path.join(root,'artifacts/cpu-appearance-oct7/source-rendering');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(fn,ms=45000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){last=e;}await delay(100);}throw last??new Error('Source review timed out');}
const result={limits:['Actual development main/preload/production renderer in an empty disposable profile.','Test process suppresses global protocol registration and media shortcuts. No installation, account login, user-session migration or provider playback.']};
let window;
async function run(){
 sync.mkdirSync(output,{recursive:true});
 const profile=sync.mkdtempSync(path.join(os.tmpdir(),'amp-source-review-'));
 const data=profile+'-dev';sync.mkdirSync(data);sync.writeFileSync(path.join(data,'provider-sessions.json'),'{}');
 for(const key of ['appData','userData','sessionData','temp'])app.setPath(key,profile);
 app.setAsDefaultProtocolClient=()=>true;globalShortcut.register=()=>false;
 require(path.join(root,'apps/desktop/dist-electron/main.js'));
 await app.whenReady();
 window=await poll(()=>BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.webContents.getURL().includes('index.html')));
 const contents=window.webContents;
 const evaluate=source=>contents.executeJavaScript(source);
 contents.debugger.attach('1.3');await contents.debugger.sendCommand('Runtime.enable');
 const errors=[];contents.debugger.on('message',(_e,method,params)=>{if(method==='Runtime.exceptionThrown')errors.push(params.exceptionDetails.text);});
 await poll(()=>evaluate("!!window.spotCloud?.runtime"));
 result.runtime=await evaluate("(async()=>{const info=await window.spotCloud.runtime.getInfo();return {isPackaged:info.isPackaged,spotifyConfigured:info.oauth.spotify.configured,platform:info.platform};})()");
 assert.equal(result.runtime.isPackaged,false);assert.equal(result.runtime.spotifyConfigured,true);
 assert.equal(app.getPath('userData'),data);result.profileIsolated=true;
 result.onboarding=await poll(()=>evaluate("(()=>{const buttons=[...document.querySelectorAll('button')],skip=buttons.find(b=>b.textContent.includes('Skip for now'));if(!skip)return null;const spotify=buttons.find(b=>b.textContent.includes('Connect Spotify'));return {skipAvailable:true,spotifyEnabled:!!spotify&&!spotify.disabled};})()"));
 assert.equal(result.onboarding.spotifyEnabled,true);
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Skip for now')).click();true");
 await poll(()=>evaluate("document.querySelector('main h2')?.textContent==='Home'"));
 window.setTitle('AMP local source check - empty test profile');window.hide();window.show();
 await evaluate("location.hash='#/settings'");await poll(()=>evaluate("document.querySelector('main h2')?.textContent==='Settings'"));
 result.controls=await evaluate("({labels:[...document.querySelectorAll('[aria-label=\"Background style\"] button')].map(b=>b.querySelector('p').textContent),initial:document.documentElement.dataset.backgroundMode})");
 assert.deepEqual(result.controls.labels,['Album pattern','Solid colour','Ambient drift','Glass only']);
 await evaluate("[...document.querySelectorAll('button')].find(b=>b.querySelector('p')?.textContent==='Ambient drift').click();true");await delay(600);
 window.minimize();await delay(1000);
 result.minimized=await evaluate("({hidden:document.hidden,motion:document.documentElement.dataset.ambientMotion})");result.minimized.native=window.isMinimized();assert.equal(result.minimized.native,true);assert.equal(result.minimized.motion,'paused');
 window.restore();window.showInactive();await delay(400);
 result.restored=await evaluate("({motion:document.documentElement.dataset.ambientMotion})");assert.equal(result.restored.motion,'running');
 result.routes=await evaluate("(async()=>{const samples=[];for(let i=0;i<80;i++){location.hash='#/'+['settings','library','search','playlists'][i%4];await new Promise(r=>setTimeout(r,i<20?80:8));samples.push({opacity:getComputedStyle(document.querySelector('main')).opacity,overflow:document.documentElement.scrollWidth>innerWidth});}location.hash='#/settings';await new Promise(r=>setTimeout(r,150));return samples;})()");
 assert.ok(result.routes.every(x=>x.opacity==='1'&&!x.overflow));
 result.widevine=await poll(async()=>{const value=await evaluate("window.spotCloud.drm.getWidevineStatus()");return value?.ready?{ready:true,version:value.version}:null;});
 result.errors=errors;assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'source-settings.png'),(await contents.capturePage()).toPNG());
 result.success=true;result.pid=process.pid;console.log(JSON.stringify({success:true,spotifyConfigured:result.runtime.spotifyConfigured,widevine:result.widevine,minimize:result.minimized,routes:result.routes.length,errors},null,2));
}
run().catch(e=>{result.success=false;result.error=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{
 sync.mkdirSync(output,{recursive:true});await fs.writeFile(path.join(output,'source-review.json'),JSON.stringify(result,null,2));
 if(!result.success){app.exit(1);return;}app.quit();setTimeout(()=>app.exit(0),1000).unref();
});
setTimeout(()=>{console.error('Source review deadline');app.exit(1);},90000).unref();
