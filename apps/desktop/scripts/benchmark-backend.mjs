import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backendModule, delay, measure, wireResponse } from "./backend-fixtures.mjs";

const { CacheStore } = await backendModule("gateway/CacheStore.ts");
const { SpotifyPartnerGateway } = await backendModule("gateway/SpotifyPartnerGateway.ts");
const { SoundCloudInternalGateway } = await backendModule("gateway/SoundCloudInternalGateway.ts");
const { YouTubeMusicGateway } = await backendModule("gateway/YouTubeMusicGateway.ts");
const { LocalMusicManager } = await backendModule("localMusic.ts");
const root = await mkdtemp(path.join(os.tmpdir(), "amp-backend-bench-"));
const caches = [];
async function cacheAt(name) {
  const cache = new CacheStore(path.join(root, name));
  await cache.initialize();
  caches.push(cache);
  return cache;
}
const results = { node: process.version, fixtureNetworkLatencyMs: 15, samples: {} };
try {
  results.samples.spotifyDiscoveryCold = await measure(async () => {
    const gateway = new SpotifyPartnerGateway(await cacheAt("spotify-cold"));
    let requests = 0;
    gateway.client.request = async (url) => {
      requests++;
      await delay(15);
      return wireResponse(/^https:\/\/open\.spotify\.com\/?$/.test(url)
        ? Array.from({ length: 8 }, (_, i) => `<script src="https://open.spotify.com/bundle-${i}.js"></script>`).join("")
        : `searchDesktop:"${"a".repeat(64)}"`);
    };
    await gateway.initialize();
    return { requests, ready: gateway.operationHashes.has("searchDesktop") };
  });
  results.samples.spotifyDiscoveryWarm = await measure(async () => {
    const cache = await cacheAt("spotify-warm");
    cache.set("spotify:operation-hashes", [{ name: "searchDesktop", hash: "a".repeat(64), fetchedAt: Date.now() }], 60_000);
    const gateway = new SpotifyPartnerGateway(cache);
    let requests = 0;
    gateway.client.request = async () => { requests++; throw new Error("Unexpected warm discovery I/O"); };
    await gateway.initialize();
    return { requests, discoveredOperations: gateway.operationHashes.size };
  });
  for (const [provider, Gateway] of [["spotify", SpotifyPartnerGateway], ["soundcloud", SoundCloudInternalGateway], ["youtube", YouTubeMusicGateway]]) {
    results.samples[`${provider}DuplicateSearch`] = await measure(async () => {
      const cache = await cacheAt(provider + "-search");
      const gateway = new Gateway(cache);
      let searchRequests = 0;
      let tokenRequests = 0;
      if (provider === "spotify") {
        gateway.operationHashes.set("searchDesktop", "a".repeat(64));
        gateway.client.request = async (url) => {
          await delay(15);
          if (url.includes("clienttoken")) {
            tokenRequests++;
            return wireResponse({ granted_token: { token: "fixture-client-token", expires_after_seconds: 3600 } });
          }
          searchRequests++;
          return wireResponse({ data: { searchV2: { tracksV2: { items: [{ item: { data: { id: "one", name: "One", duration: { totalMilliseconds: 123_000 }, artists: { items: [{ profile: { name: "Fixture" } }] } } } }] } } } });
        };
      } else if (provider === "soundcloud") {
        gateway.assetBundle = { clientId: "fixture-client-id", appVersion: "1", appLocale: "en", fetchedAt: Date.now() };
        gateway.client.request = async () => {
          searchRequests++;
          await delay(15);
          return wireResponse({ collection: [{ id: 1, title: "One", duration: 123_000, user: { username: "Fixture" }, policy: "ALLOW", media: { transcodings: [] } }] });
        };
      } else {
        gateway.innertube = { music: { search: async () => { searchRequests++; await delay(15); return { songs: { contents: [{ id: "abcdefghijk", title: "One", artists: [{ name: "Fixture" }] }] } }; } } };
      }
      const search = () => provider === "spotify" ? gateway.search("fixture query", "fixture-access-token") : gateway.search("fixture query");
      const outcomes = await Promise.all(Array.from({ length: 16 }, search));
      const warm = await search();
      return { searchRequests, tokenRequests, allSucceeded: outcomes.every((r) => r.ok), warmSource: warm.source, resultCount: outcomes[0].data?.length ?? 0 };
    });
  }
  results.samples.memoryOnlyCache = await measure(async () => {
    const cache = await cacheAt("memory-only");
    for (let i = 0; i < 400; i++) cache.setMemoryOnly(`soundcloud:stream:v2:${i}`, { url: `https://fixture.invalid/${i}` }, 60_000);
    cache.flushNow();
    const persisted = await readFile(path.join(root, "memory-only/gateway-cache/store.json"), "utf8").catch(() => undefined);
    return { persistedBytes: persisted?.length ?? 0, entries: cache.memoryCache.size };
  });
  const directory = path.join(root, "hydrate/gateway-cache");
  await mkdir(directory, { recursive: true });
  const entries = Array.from({ length: 2400 }, (_, i) => ({ key: `fixture:${i}`, data: "x".repeat(8000), expiresAt: Date.now() + 60_000, createdAt: Date.now() + i }));
  const payload = JSON.stringify(entries);
  await writeFile(path.join(directory, "store.json"), payload);
  results.samples.cacheHydration = await measure(async () => {
    const cache = new CacheStore(path.join(root, "hydrate"));
    caches.push(cache);
    await cache.initialize();
    return { fileBytes: payload.length, entries: cache.memoryCache.size };
  });
  results.samples.cacheGrowth = await measure(async () => {
    const cache = await cacheAt("growth");
    for (let i = 0; i < 3000; i++) cache.set(`fixture:${i}`, { text: String(i) + "x".repeat(32_000) }, 60_000);
    cache.flushNow();
    return { entries: cache.memoryCache.size, persistedBytes: (await readFile(path.join(root, "growth/gateway-cache/store.json"))).byteLength };
  });
  const music = path.join(root, "music");
  await mkdir(music);
  // Valid PCM WAV fixtures exercise the real metadata parser without user audio or playback.
  const wav = Buffer.alloc(44 + 8000);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34);
  wav.write("data", 36); wav.writeUInt32LE(8000, 40);
  await Promise.all(Array.from({ length: 120 }, (_, i) => writeFile(path.join(music, `Song ${String(i).padStart(3, "0")}.wav`), wav)));
  const local = new LocalMusicManager(path.join(root, "local"));
  await local.initialize();
  await local.addFolder(music);
  results.samples.localScanCold = await measure(async () => ({ tracks: (await local.scan()).length }));
  results.samples.localScanWarm = await measure(async () => ({ tracks: (await local.scan()).length }));
  results.samples.localScanConcurrent = await measure(async () => {
    const scans = await Promise.all(Array.from({ length: 3 }, () => local.scan()));
    return { counts: scans.map((s) => s.length) };
  });
  console.log(JSON.stringify(results, null, 2));
} finally {
  for (const cache of caches) cache.flushNow();
  await rm(root, { recursive: true, force: true });
}
