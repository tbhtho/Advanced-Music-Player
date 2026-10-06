const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../../..');
const output=process.env.AMP_PRODUCTION_REVIEW_OUTPUT ?? path.join(root,'artifacts/memory-glass/production-idle');fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'amp-production-check-'));
fs.mkdirSync(profile+'-dev');fs.writeFileSync(path.join(profile+'-dev','provider-sessions.json'),'{}');
app.setPath('appData',profile);app.setPath('userData',profile);app.setPath('sessionData',profile+'-dev');
const snapshots=[];
import(pathToFileURL(path.join(root,'apps/desktop/dist-electron/main.js')).href).catch(error=>{console.error(error);app.exit(1);});
app.whenReady().then(()=>{
 const start=Date.now();
 const timer=setInterval(async()=>{
  const windows=BrowserWindow.getAllWindows();
  const metrics=app.getAppMetrics().map(item=>({pid:item.pid,type:item.type,name:item.name,serviceName:item.serviceName,memory:item.memory}));
  const snap={elapsedMs:Date.now()-start,windows:windows.map(w=>({title:w.getTitle(),visible:w.isVisible(),rendererPid:w.webContents.getOSProcessId()})),metrics};
  snapshots.push(snap);fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify({root,pid:process.pid,profile,snapshots,limitations:['Production main/renderer/CDM initialization; no accounts, sign-in, provider playback or user profile.','Development executable rather than packaged VMP-signed app.']},null,2));
  if(snap.elapsedMs>=35000){clearInterval(timer);console.log(JSON.stringify(snap,null,2));app.quit();setTimeout(()=>app.exit(0),2000).unref();}
 },5000);
});
