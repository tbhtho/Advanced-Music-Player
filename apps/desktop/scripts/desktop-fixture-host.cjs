const { app, BrowserWindow, ipcMain, session, nativeTheme } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const os = require("node:os");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const spec = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"));
const startedAt = performance.now();
app.setPath("userData", spec.profile);
app.setPath("sessionData", spec.profile);
app.commandLine.appendSwitch("disable-background-timer-throttling");
const pending = new Map();
const counters = { gatewaySearches: 0, gatewayAborts: 0, startupSignals: 0, blockedExternalRequests: 0 };
let material = "opaque";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const track = (id, provider, prefix) => ({ id: `${provider}:${id}`, provider, providerTrackId: String(id), title: `${prefix} ${provider} ${id}`, creators: ["Fixture artist"], durationMs: 180000, explicit: false, playable: true });
ipcMain.handle("amp-fixture", async (_event, method, request) => {
  if (method === "material") return material;
  if (method === "runtime") return { platform: process.platform, isPackaged: false, versions: process.versions, configDirectory: "Isolated fixture", oauth: { spotify: { configured: true, hasStoredSession: true, storageMode: "memory-only", message: "Synthetic fixture" }, soundcloud: { configured: true, hasStoredSession: false, storageMode: "none", message: "Synthetic fixture" } } };
  if (method === "config") return { spotifyClientId: "fixture", soundCloudClientId: "fixture", soundCloudClientSecret: "", soundCloudClientSecretConfigured: false };
  if (method === "refresh") { await delay(40); return request.provider === "spotify" ? { provider: "spotify", accessToken: "fixture-token", expiresAt: new Date(Date.now() + 3600000).toISOString(), displayName: "Fixture listener", sessionSource: "memory", storageMode: "memory-only" } : null; }
  if (method === "finishStartup") { counters.startupSignals++; return { canCustomize: true, isMaximized: false }; }
  if (method !== "gateway") throw new Error("Unsupported fixture bridge method");
  if (request.operation === "cancelRequest") { pending.get(request.variables.requestId)?.abort(); return { ok: true, source: "fixture" }; }
  if (request.operation === "getAudioFeatures") return { ok: true, source: "fixture", data: { matched: false, bpm: null, loudness: null } };
  if (request.operation !== "search") return { ok: true, source: "fixture", data: [] };
  counters.gatewaySearches++;
  const query = request.variables.query;
  const controller = new AbortController();
  if (request.requestId) pending.set(request.requestId, controller);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, query === "slow" ? 300 : request.provider === "soundcloud" ? 30 : 150);
      controller.signal.addEventListener("abort", () => { clearTimeout(timer); counters.gatewayAborts++; reject(new Error("Fixture cancelled")); }, { once: true });
    });
    return { ok: true, source: "fixture", data: Array.from({ length: 6 }, (_, i) => track(`search-${query}-${i}`, request.provider, query)) };
  } catch { return { ok: false, source: "fixture", error: "Cancelled" }; }
  finally { if (request.requestId) pending.delete(request.requestId); }
});

async function run() {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => { counters.blockedExternalRequests++; callback({ cancel: true }); });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  let preferred = "opaque", applyMaterial;
  if (spec.nativeModule) {
    const native = await import(pathToFileURL(spec.nativeModule).href);
    preferred = spec.material === "glass" ? native.selectWindowMaterial(process.platform, os.release(), nativeTheme.shouldUseHighContrastColors, nativeTheme.prefersReducedTransparency) : "opaque";
    applyMaterial = native.applyWindowMaterial;
  }
  const window = new BrowserWindow({ width: 1280, height: 860, show: false, frame: false, backgroundColor: preferred === "opaque" ? "#101012" : "#00000000", transparent: preferred !== "opaque", webPreferences: { preload: path.join(__dirname, "desktop-fixture-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, offscreen: true } });
  material = applyMaterial ? applyMaterial(window, preferred) : preferred;
  const contents = window.webContents;
  contents.setFrameRate(60);
  const errors = [];
  contents.on("console-message", (_event, level, message) => { if (level >= 2) { errors.push(message); console.error("Fixture renderer:", message); } });
  contents.on("preload-error", (_event, _file, error) => console.error("Fixture preload:", error.message));
  contents.on("render-process-gone", (_event, details) => errors.push(`Renderer exited: ${details.reason}`));
  await window.loadFile(path.join(spec.build, "index.html"));
  const loadedAt = performance.now() - startedAt;
  const startup = await contents.executeJavaScript(`new Promise((resolve, reject) => {
    const end = performance.now() + 10000;
    const poll = () => {
      const store = window.__AMP_TEST_STORE__;
      if (store?.getState().initialized) resolve({ rendererReadyMs: performance.now() - window.__AMP_FIXTURE__.startupStartedAt, syncingAtReady: store.getState().librarySync.spotify.syncing, cachedTracksAtReady: store.getState().projectTracks.length });
      else if (performance.now() > end) reject(new Error('Fixture startup did not finish: ' + JSON.stringify({state: store ? {bootStage:store.getState().bootStage, error:store.getState().initializationError} : 'no fixture entry', text:document.body.innerText.slice(0,300)})));
      else setTimeout(poll, 5);
    }; poll();
  })`, true);
  startup.hostReadyMs = +(performance.now() - startedAt).toFixed(2);
  await delay(800);
  const searches = await contents.executeJavaScript(`(async () => {
    const store = window.__AMP_TEST_STORE__;
    const initialCalls = window.__AMP_FIXTURE__.fetchCalls;
    const start = performance.now();
    let firstResultMs;
    const unsubscribe = store.subscribe((state) => { if (state.searchResults.length && firstResultMs === undefined) firstResultMs = performance.now() - start; });
    await store.getState().search('probe', 'all');
    unsubscribe();
    const finalMs = performance.now() - start;
    const order = store.getState().searchResults.map((track) => track.provider + ':' + track.providerTrackId);
    const callsBeforeDuplicate = window.__AMP_FIXTURE__.fetchCalls;
    await Promise.all(Array.from({ length: 8 }, () => store.getState().search('duplicate', 'spotify')));
    const duplicateFetches = window.__AMP_FIXTURE__.fetchCalls - callsBeforeDuplicate;
    const slow = store.getState().search('slow', 'all');
    await new Promise((resolve) => setTimeout(resolve, 10));
    await store.getState().search('new', 'all');
    await slow;
    return { firstResultMs, finalMs, order, duplicateFetches, staleResultsDiscarded: store.getState().searchResults.every((track) => track.title.startsWith('new')), fetchAborts: window.__AMP_FIXTURE__.fetchAborts, fetchCalls: window.__AMP_FIXTURE__.fetchCalls - initialCalls };
  })()`, true);
  const expectedOrder = [
    ...Array.from({ length: 18 }, (_, i) => `spotify:search-probe-${i}`),
    ...Array.from({ length: 6 }, (_, i) => `soundcloud:search-probe-${i}`),
    ...Array.from({ length: 6 }, (_, i) => `youtube:search-probe-${i}`)
  ];
  assert.deepEqual(searches.order, expectedOrder, "Search must retain every fixture result in provider order");
  assert.equal(searches.staleResultsDiscarded, true, "Obsolete searches must not overwrite the current query");
  assert.equal(startup.cachedTracksAtReady, 120, "Cached tracks must be usable at startup");
  assert.equal(searches.duplicateFetches, spec.nativeModule ? 1 : 8, "Duplicate search fetch count changed unexpectedly");
  const cpuBefore = process.cpuUsage();
  const menus = await contents.executeJavaScript(`(async () => {
    const samples = [], routeSamples = [];
    let running = true, previous = performance.now();
    const frame = (now) => { samples.push(now - previous); previous = now; if (running) requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    const routes = [['search','Search'], ['library','Library'], ['playlists','Playlists'], ['settings','Settings'], ['', 'Home']];
    for (let round = 0; round < 3; round++) for (const [route,title] of routes) {
      const start = performance.now(); location.hash = '#/' + route;
      await new Promise((resolve,reject) => { const end = start + 3000; const poll = () => {
        if (Array.from(document.querySelectorAll('main h2')).some((node) => node.textContent === title)) requestAnimationFrame(() => resolve());
        else if (performance.now() > end) reject(new Error('Route did not render: ' + title)); else setTimeout(poll, 1);
      }; poll(); });
      routeSamples.push(performance.now() - start);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    running = false;
    const sorted = samples.slice().sort((a,b) => a-b), median = sorted[Math.floor(sorted.length/2)];
    const routesSorted = routeSamples.slice().sort((a,b) => a-b);
    return { frames: samples.length, medianFrameMs: median, p95FrameMs: sorted[Math.floor(sorted.length*.95)], maxFrameMs: Math.max(...samples), framesOver33Ms: samples.filter((value) => value > 33.4).length, approximateMedianFps: 1000 / median, medianMenuCommitMs: routesSorted[Math.floor(routesSorted.length/2)], p95MenuCommitMs: routesSorted[Math.floor(routesSorted.length*.95)] };
  })()`, true);
  const consumed = process.cpuUsage(cpuBefore);
  const processMetrics = app.getAppMetrics().map((item) => ({ type: item.type, cpu: item.cpu.percentCPUUsage, workingSetKiB: item.memory.workingSetSize, privateKiB: item.memory.privateBytes }));
  const memory = app.getAppMetrics().find((item) => item.pid === contents.getOSProcessId())?.memory;
  const visual = await contents.executeJavaScript(`({ material: document.documentElement.dataset.material ?? 'baseline', bodyBackground: getComputedStyle(document.body).backgroundColor, idleBeatWillChange: getComputedStyle(document.getElementById('amp-beat-layer')).willChange, cssBlurLayers: Array.from(document.querySelectorAll('*')).filter((node) => getComputedStyle(node).backdropFilter !== 'none').length, viewport: {width:innerWidth,height:innerHeight}, horizontalOverflow: document.documentElement.scrollWidth > innerWidth })`);
  await delay(300);
  await fs.writeFile(path.join(spec.output, "home.png"), (await contents.capturePage()).toPNG());
  await contents.executeJavaScript("location.hash='#/search'"); await delay(350);
  await fs.writeFile(path.join(spec.output, "search.png"), (await contents.capturePage()).toPNG());
  await contents.executeJavaScript("location.hash='#/playlists'"); await delay(350);
  await fs.writeFile(path.join(spec.output, "playlists.png"), (await contents.capturePage()).toPNG());
  const result = { versions: process.versions, os: os.release(), materialRequested: spec.material, nativeMaterial: material, loadedMs: +loadedAt.toFixed(2), startup, searches, menus, mainCpuDuringMenuMs: (consumed.user + consumed.system)/1000, rendererMemoryKiB: memory, processMetrics, visual, counters, errors, limitations: ["Synthetic data, blocked external requests, fresh disposable profile; no accounts or playback.", "Offscreen BrowserWindow rendering capped at 60 fps; comparable renderer frame timing excludes foreground DWM smoothness and native backdrop GPU cost.", "Secure AMP startup/CDM initialization, installed-binary behavior, provider-network latency, and subscription playback excluded.", "capturePage returns app pixels without the external desktop backdrop."] };
  assert.deepEqual(errors, [], "Fixture renderer reported an error");
  assert.equal(visual.horizontalOverflow, false, "The existing shell must fit the viewport");
  if (spec.nativeModule) {
    assert.equal(startup.syncingAtReady, true, "Readiness must not wait for remote library synchronization");
    assert.equal(visual.idleBeatWillChange, "auto", "Idle audio mode must release its compositor hint");
    assert.equal(visual.cssBlurLayers, 0, "Native glass must not add CSS blur layers");
    assert.ok(searches.fetchAborts >= 1 && counters.gatewayAborts >= 2, "Superseded searches must cancel supported transport work");
  }
  await fs.writeFile(path.join(spec.output, "measurements.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output: spec.output, startup, searches: { firstResultMs: searches.firstResultMs, finalMs: searches.finalMs, duplicateFetches: searches.duplicateFetches }, menus, material, errors }, null, 2));
  window.destroy(); app.quit();
}
run().catch((error) => { console.error(error); app.exit(1); });
setTimeout(() => { console.error("Fixture deadline exceeded"); app.exit(1); }, 45000).unref();
