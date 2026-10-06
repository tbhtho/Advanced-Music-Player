import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendModule, delay } from './backend-fixtures.mjs';
const { IdleRelease } = await backendModule('idleRelease.ts');
const { applyWindowMaterial } = await backendModule('windowMaterial.ts');
const { AudioReactor } = await backendModule('../src/lib/audioReactor.ts');

test('hidden helpers retire only after all overlapping operations finish; reuse cancels retirement', async () => {
  let retired = 0;
  const lease = new IdleRelease(() => retired++, 25);
  const one = lease.begin(), two = lease.begin();
  one(); one(); await delay(40); assert.equal(retired, 0);
  two(); await delay(10);
  const reuse = lease.begin(); await delay(40); assert.equal(retired, 0);
  reuse(); await delay(40); assert.equal(retired, 1);
});
test('closed helpers cancel retirement without leaving a callback behind', async () => {
  let retired = 0;
  const lease = new IdleRelease(() => retired++, 10);
  lease.begin()(); lease.cancel(); await delay(25); assert.equal(retired, 0);
});
test('repeated theme events preserve the native compositor and a real material change still applies', async () => {
  const calls = [];
  const window = { isDestroyed:()=>false, setBackgroundMaterial: x => calls.push(['material', x]), setVibrancy: x => calls.push(['vibrancy', x]), setBackgroundColor: x => calls.push(['color', x]) };
  await applyWindowMaterial(window, 'acrylic', async()=>true); const count = calls.length;
  for (let i=0;i<30;i++) await applyWindowMaterial(window, 'acrylic', async()=>true);
  assert.equal(calls.length, count);
  await applyWindowMaterial(window, 'opaque', async()=>true); assert.ok(calls.length > count);
  assert.equal(calls.at(-1)[1], '#171719');
});
test('failed native material stays opaque on repeated events and retries after a real preference change', async () => {
  let blocked = true;
  const window = { isDestroyed:()=>false, setBackgroundMaterial: () => { if(blocked) throw Error('unsupported'); }, setBackgroundColor: () => {} };
  assert.equal(await applyWindowMaterial(window,'acrylic',async()=>true),'opaque'); blocked=false;
  assert.equal(await applyWindowMaterial(window,'acrylic',async()=>true),'opaque');
  await applyWindowMaterial(window,'opaque',async()=>true);
  assert.equal(await applyWindowMaterial(window,'acrylic',async()=>true),'acrylic');
});

test('releasing loopback during pending acquisition stops every arriving track without creating an audio graph', async () => {
  let resolve, stopped=0, contexts=0;
  globalThis.document = { hidden:false, getElementById:()=>null };
  globalThis.window = { setTimeout };
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getDisplayMedia:()=>new Promise(r=>resolve=r)}}});
  globalThis.AudioContext = class { constructor(){contexts++;} };
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  const reactor = new AudioReactor(); reactor.primeLoopback(); reactor.releaseLoopback();
  resolve({getTracks:()=>[{stop:()=>stopped++}]}); await delay(0);
  assert.equal(stopped,1); assert.equal(contexts,0);
});
test('paused capture release closes analysis and its stream while leaving playback untouched', async () => {
  let stopped=0,closed=0;
  const audio = {stop:()=>stopped++,addEventListener:()=>{}};
  const video = {stop:()=>stopped++};
  navigator.mediaDevices.getDisplayMedia=async()=>({getTracks:()=>[audio,video],getVideoTracks:()=>[video],getAudioTracks:()=>[audio]});
  globalThis.AudioContext=class {state='running'; createMediaStreamSource(){return {connect:()=>{}};} createAnalyser(){return {};} suspend(){this.state='suspended';return Promise.resolve();} close(){closed++;return Promise.resolve();} };
  const reactor=new AudioReactor(); reactor.start(); reactor.primeLoopback(); await delay(0);
  assert.equal(stopped,1); reactor.releaseLoopback(); assert.equal(stopped,3); assert.equal(closed,1);
});

test('material changes serialize across asynchronous native application and retain the newest request', async () => {
  const events=[];
  const win={isDestroyed:()=>false,setBackgroundMaterial:()=>{},setBackgroundColor:x=>events.push(x)};
  const native=async()=>{await delay(8);return true;};
  const results=await Promise.all([applyWindowMaterial(win,'acrylic',native),applyWindowMaterial(win,'opaque',native),applyWindowMaterial(win,'acrylic',native)]);
  assert.deepEqual(results,['acrylic','opaque','acrylic']);assert.equal(events.at(-1),'#00000000');
});
