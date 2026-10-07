import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { backendModule } from "./backend-fixtures.mjs";
const {AppUpdates}=await backendModule("appUpdates.ts");
class Engine extends EventEmitter {
  checks=0; downloads=0; installs=[];
  autoDownload=true; autoInstallOnAppQuit=true; allowPrerelease=true; allowDowngrade=true;
  async checkForUpdates(){this.checks++;this.emit("update-available",{version:"0.3.9"});}
  async downloadUpdate(){this.downloads++;this.emit("download-progress",{percent:51.4});this.emit("update-downloaded",{version:"0.3.9"});return ["fixture-only.exe"];}
  quitAndInstall(...args){this.installs.push(args);}
}
function fixture(confirm=async()=>false) {
  const engine=new Engine(),events=[];
  const controller=new AppUpdates(engine,"0.3.8",next=>events.push(next),confirm);
  return {engine,events,controller};
}
test("checking never downloads and closing never installs; unsupported builds do nothing",async()=>{
  const f=fixture();
  assert.equal(f.engine.autoDownload,false);assert.equal(f.engine.autoInstallOnAppQuit,false);
  assert.equal(f.engine.allowPrerelease,false);assert.equal(f.engine.allowDowngrade,false);
  await f.controller.check();assert.equal(f.controller.getState().phase,"available");
  assert.equal(f.engine.downloads,0);assert.deepEqual(f.engine.installs,[]);f.controller.dispose();
  const unsupported=new AppUpdates(undefined,"0.3.8",()=>{},async()=>{throw new Error("Unexpected consent prompt");});
  unsupported.start();await unsupported.check();await unsupported.download();assert.equal(await unsupported.install(),false);
  assert.equal(unsupported.getState().phase,"unsupported");unsupported.dispose();
});
test("repeated checks and downloads share work, progress is bounded, and installation waits for complete download",async()=>{
  const f=fixture(async()=>true);let finish;
  f.engine.downloadUpdate=async()=>{f.engine.downloads++;await new Promise(r=>finish=r);f.engine.emit("update-downloaded");};
  const one=f.controller.check(),two=f.controller.check();assert.equal(one,two);await one;assert.equal(f.engine.checks,1);
  const download=f.controller.download();assert.equal(f.controller.download(),download);await Promise.resolve();await Promise.resolve();
  for(const [percent,expected]of [[150,100],[-4,0],[NaN,0]]){f.engine.emit("download-progress",{percent});assert.equal(f.controller.getState().percent,expected);}
  assert.equal(await f.controller.install(),false);await f.controller.check();assert.equal(f.engine.checks,1);
  finish();await download;assert.equal(f.engine.downloads,1);assert.equal(f.controller.getState().phase,"downloaded");f.controller.dispose();
});
test("installation requires an explicit confirmed request and cancellation keeps the app running",async()=>{
  let accepted=false,prompts=0;
  const f=fixture(async()=>{prompts++;return accepted;});
  assert.equal(await f.controller.install(),false);assert.equal(prompts,0);
  await f.controller.check();await f.controller.download();
  assert.equal(await f.controller.install(),false);assert.equal(prompts,1);assert.deepEqual(f.engine.installs,[]);
  accepted=true;assert.equal(await f.controller.install(),true);assert.deepEqual(f.engine.installs,[[false,true]]);
  f.controller.dispose();
});
test("duplicate install requests cannot prompt or restart twice; disposal prevents a late confirmation",async()=>{
  let finish,prompts=0;
  const f=fixture(()=>{prompts++;return new Promise(r=>finish=r);});
  await f.controller.check();await f.controller.download();
  const install=f.controller.install();assert.equal(await f.controller.install(),false);assert.equal(prompts,1);
  f.controller.dispose();finish(true);assert.equal(await install,false);assert.deepEqual(f.engine.installs,[]);
});
test("failed downloads can be retried and errors do not expose server messages or tokens",async()=>{
  const f=fixture();await f.controller.check();
  f.engine.downloadUpdate=async()=>{f.engine.downloads++;f.engine.emit("error",new Error("https://fixture.invalid?token=secret"));throw new Error("secret");};
  await f.controller.download();assert.equal(f.controller.getState().phase,"error");assert.equal(f.controller.getState().availableVersion,"0.3.9");
  assert.equal(JSON.stringify(f.events).includes("secret"),false);
  f.engine.downloadUpdate=async()=>{f.engine.downloads++;f.engine.emit("update-downloaded");};
  await f.controller.download();assert.equal(f.engine.downloads,2);assert.equal(f.controller.getState().phase,"downloaded");f.controller.dispose();
});
test("malformed or prerelease metadata cannot offer an install",async()=>{
  for(const info of [null,{}, {version:"0.3.9-beta.1"},{version:"javascript:alert(1)"}]){
    const f=fixture();f.engine.checkForUpdates=async()=>f.engine.emit("update-available",info);await f.controller.check();
    assert.equal(f.controller.getState().phase,"error");assert.equal(await f.controller.install(),false);f.controller.dispose();
  }
});
test("automatic checks are delayed and bounded to six hours; disposal removes timers and listeners",async t=>{
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const f=fixture();f.controller.start();f.controller.start();
  t.mock.timers.tick(14999);assert.equal(f.engine.checks,0);
  t.mock.timers.tick(1);await f.controller.check();assert.equal(f.engine.checks,1);
  t.mock.timers.tick(6*60*60*1000);await f.controller.check();assert.equal(f.engine.checks,2);
  f.controller.dispose();t.mock.timers.tick(12*60*60*1000);await Promise.resolve();assert.equal(f.engine.checks,2);
  assert.equal(f.engine.listenerCount("error"),0);
});
test("release configuration uses the public repo, stable NSIS identity, and bundled production updater",async()=>{
  const desktop=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  const root=JSON.parse(await readFile(new URL("../../../package.json",import.meta.url),"utf8"));
  assert.equal(desktop.version,root.version);assert.equal(desktop.build.appId,"com.amp.desktop");
  assert.deepEqual(desktop.build.win.target,["nsis"]);assert.equal(desktop.build.publish.private,false);
  assert.equal(desktop.build.publish.owner,"tbhtho");assert.equal(desktop.build.publish.repo,"Advanced-Music-Player");
  assert.equal(desktop.build.publish.token,undefined);assert.equal(desktop.build.win.verifyUpdateCodeSignature,undefined);
  assert.ok(desktop.dependencies["electron-updater"]);
  const main=await readFile(new URL("../electron/main.ts",import.meta.url),"utf8");
  for(const channel of ["get-state","check","download","install"])assert.ok(main.includes('handleTrustedIpc("spot-cloud:update-'+channel+'"'));
  const workflow=await readFile(new URL("../../../.github/workflows/release.yml",import.meta.url),"utf8");
  assert.ok(workflow.includes("latest.yml"));assert.ok(workflow.includes("*.exe.blockmap"));assert.ok(workflow.includes("SHA256SUMS.txt"));
});
