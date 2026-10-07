import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require=createRequire(new URL("../package.json",import.meta.url));
const {NsisUpdater}=require("electron-updater");
const {NodeHttpExecutor}=createRequire(require.resolve("electron-builder"))("builder-util");
const {configureRequestUrl,configureRequestOptions}=createRequire(require.resolve("electron-updater"))("builder-util-runtime");
// Same streaming download path as ElectronHttpExecutor, using Node HTTP for the local fixture.
class FixtureHttpExecutor extends NodeHttpExecutor {
  download(url,destination,options){return options.cancellationToken.createPromise((resolve,reject,onCancel)=>{
    const request={headers:options.headers};configureRequestUrl(url,request);configureRequestOptions(request);
    this.doDownload(request,{destination,options,onCancel,responseHandler:null,callback:error=>error?reject(error):resolve(destination)},0);
  });}
}
const root=await mkdtemp(path.join(os.tmpdir(),"amp-updater-http-test-"));
const bytes=Buffer.from("MZ offline fixture only; this is not an executable installer.");
const validHash=createHash("sha512").update(bytes).digest("base64");
let hash=validHash,metadataRequests=0,fileRequests=0,quitHandlers=0;
const server=createServer((req,res)=>{
  if(req.url.startsWith("/latest.yml")){metadataRequests++;res.writeHead(200,{"content-type":"text/yaml"});res.end("version: 0.3.9\nfiles:\n  - url: AMP.Setup.0.3.9.exe\n    sha512: "+hash+"\n    size: "+bytes.length+"\npath: AMP.Setup.0.3.9.exe\nsha512: "+hash+"\nreleaseDate: '2026-10-07T00:00:00Z'\n");}
  else if(req.url==="/AMP.Setup.0.3.9.exe"){fileRequests++;res.writeHead(200,{"content-type":"application/octet-stream","content-length":bytes.length});res.end(bytes);}
  else {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const url="http://127.0.0.1:"+server.address().port;
try {
  for(const [index,valid]of [[0,true],[1,false]]){
    const dir=path.join(root,String(index));await mkdir(path.join(dir,"user"),{recursive:true});
    const config=path.join(dir,"app-update.yml");
    await writeFile(config,"provider: generic\nurl: "+url+"\nupdaterCacheDirName: amp-fixture\n");
    const adapter={version:"0.3.8",name:"AMP",isPackaged:true,appUpdateConfigPath:config,userDataPath:path.join(dir,"user"),baseCachePath:path.join(dir,"cache"),
      whenReady:()=>Promise.resolve(),quit:()=>{throw new Error("Test attempted to quit/install");},relaunch:()=>{throw new Error("Test attempted to relaunch");},onQuit:()=>{quitHandlers++;}};
    const updater=new NsisUpdater(null,adapter);updater.httpExecutor=new FixtureHttpExecutor();updater.logger=null;
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowDowngrade=false;updater.allowPrerelease=false;updater.disableDifferentialDownload=true;
    updater.setFeedURL({provider:"generic",url});hash=valid?validHash:Buffer.alloc(64).toString("base64");
    let downloaded=false;updater.on("update-downloaded",()=>downloaded=true);
    const before=fileRequests;const result=await updater.checkForUpdates();
    assert.equal(result.updateInfo.version,"0.3.9");assert.equal(fileRequests,before,"A release check must not download");
    if(valid){const files=await updater.downloadUpdate();assert.deepEqual(await readFile(files[0]),bytes);assert.equal(downloaded,true);}
    else {await assert.rejects(updater.downloadUpdate(),/checksum mismatch/i);assert.equal(downloaded,false);}
    assert.equal(quitHandlers,0,"Downloaded updates must not register automatic install on quit");updater.removeAllListeners();
  }
  console.log(JSON.stringify({actualNsisUpdater:true,metadataRequests,fileRequests,checkDoesNotDownload:true,validChecksumDownloaded:true,invalidChecksumRejected:true,noInstallOrRestart:true}));
} finally {
  await new Promise(r=>server.close(r));
  if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith("amp-updater-http-test-"))throw new Error("Unexpected test cleanup path");
  await rm(root,{recursive:true,force:true,maxRetries:3});
}
