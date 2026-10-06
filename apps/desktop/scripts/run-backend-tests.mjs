import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, realpath, symlink, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backendModule, delay, fixtureTrack, wireResponse } from "./backend-fixtures.mjs";

const { SharedRequests, mapConcurrent, abortableDelay } = await import("@amp/core");
const { CacheStore } = await backendModule("gateway/CacheStore.ts");
const { StealthClient } = await backendModule("gateway/StealthClient.ts");
const { ProviderGateway } = await backendModule("gateway/index.ts");
const { SpotifyPartnerGateway } = await backendModule("gateway/SpotifyPartnerGateway.ts");
const { SoundCloudInternalGateway } = await backendModule("gateway/SoundCloudInternalGateway.ts");
const { YouTubeMusicGateway } = await backendModule("gateway/YouTubeMusicGateway.ts");
const { YouTubePlaylistGateway, parseYouTubePlaylistId } = await backendModule("gateway/YouTubePlaylistGateway.ts");
const { AppleMusicCatalog } = await backendModule("gateway/AppleMusicCatalog.ts");
const { readMetadataJson } = await backendModule("gateway/metadataResponse.ts");
const { LocalMusicManager } = await backendModule("localMusic.ts");
const { selectWindowMaterial } = await backendModule("windowMaterial.ts");
const { SpotifyBaseAdapter } = await backendModule("../src/lib/providers/spotifyBaseAdapter.ts");
const { pickBestTwin, scoreStationCandidate, orderStationTracks, trackKey, dedupeAcrossProviders, crossProviderKey } = await backendModule("../src/lib/mixes/composition.ts");
const { net } = await import("electron");

const root = await mkdtemp(path.join(os.tmpdir(), "amp-backend-tests-"));
const caches = [];
let nextDirectory = 0;
const unexpectedFetch = async () => { throw new Error("Unexpected network request in offline regression test"); };
const originalFetch = globalThis.fetch;
globalThis.fetch = unexpectedFetch;
after(async () => {
  globalThis.fetch = originalFetch;
  for (const cache of caches) cache.flushNow();
  await rm(root, { recursive: true, force: true });
});
async function newCache() {
  const directory = path.join(root, `cache-${nextDirectory++}`);
  const cache = new CacheStore(directory);
  caches.push(cache);
  await cache.initialize();
  return { cache, file: path.join(directory, "gateway-cache/store.json"), directory };
}
async function withFetch(fetcher, run) {
  globalThis.fetch = fetcher;
  try { return await run(); } finally { globalThis.fetch = unexpectedFetch; }
}
const json = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
const connection = (token = "fixture-access", expiresAt = new Date(Date.now() + 3600_000).toISOString()) => ({ provider: "spotify", status: "connected", accessToken: token, expiresAt });

test("identical concurrent reads share work, preserve order, and do not retain settled results", async () => {
  const shared = new SharedRequests();
  let calls = 0;
  const operation = async () => { calls++; await delay(5); return ["third", "first", "second"]; };
  const results = await Promise.all(Array.from({ length: 16 }, () => shared.run("key", operation)));
  assert.equal(calls, 1);
  for (const result of results) assert.deepEqual(result, ["third", "first", "second"]);
  await shared.run("key", operation);
  assert.equal(calls, 2);
});

test("one subscriber can cancel without cancelling another subscriber", async () => {
  const shared = new SharedRequests();
  const a = new AbortController();
  let cancelledTransport = false;
  const operation = async (signal) => { signal.addEventListener("abort", () => { cancelledTransport = true; }); await delay(10); return "result"; };
  const cancelled = assert.rejects(shared.run("key", operation, a.signal), { name: "AbortError" });
  const remaining = shared.run("key", operation);
  a.abort();
  await cancelled;
  assert.equal(await remaining, "result");
  assert.equal(cancelledTransport, false);
});

test("last cancellation aborts transport; a late result cannot delete a newer read", async () => {
  const shared = new SharedRequests();
  const controller = new AbortController();
  let oldSignal;
  const rejected = assert.rejects(shared.run("key", async (signal) => { oldSignal = signal; await delay(15); return "old"; }, controller.signal), { name: "AbortError" });
  await delay(1);
  controller.abort();
  await rejected;
  assert.equal(oldSignal.aborted, true);
  let calls = 0;
  const fresh = shared.run("key", async () => { calls++; await delay(30); return "new"; });
  await delay(20);
  const joined = shared.run("key", async () => { calls++; return "wrong"; });
  assert.equal(await fresh, "new");
  assert.equal(await joined, "new");
  assert.equal(calls, 1);
});

test("clearing reads immediately rejects subscribers even if a library ignores abort", async () => {
  const shared = new SharedRequests();
  let release;
  const rejected = assert.rejects(shared.run("key", () => new Promise((resolve) => { release = resolve; })), { name: "AbortError" });
  await delay(1);
  shared.clear();
  await rejected;
  release("stale");
  assert.equal(await shared.run("key", async () => "fresh"), "fresh");
});

test("bounded fan-out retains input order despite out-of-order completion", async () => {
  let running = 0, peak = 0;
  const out = await mapConcurrent([4, 3, 2, 1], 2, async (value) => { peak = Math.max(peak, ++running); await delay(value); running--; return value * 2; });
  assert.deepEqual(out, [8, 6, 4, 2]);
  assert.equal(peak, 2);
  const controller = new AbortController();
  const cancelled = assert.rejects(abortableDelay(5000, controller.signal), { name: "AbortError" });
  controller.abort();
  await cancelled;
});

test("memory-only cache mutations and expiry do not write an empty disk snapshot", async () => {
  const { cache, file } = await newCache();
  cache.setMemoryOnly("soundcloud:stream:fixture", { credential: "fixture-only" }, -1);
  assert.equal(cache.get("soundcloud:stream:fixture"), undefined);
  cache.setMemoryOnly("private", "fixture", 60_000);
  cache.invalidate(/^private/g);
  cache.flushNow();
  await assert.rejects(readFile(file), { code: "ENOENT" });
});

test("replacing a persisted cache value with memory-only scrubs the disk value", async () => {
  const { cache, file } = await newCache();
  cache.set("public", "old", 60_000);
  cache.flushNow();
  cache.setMemoryOnly("public", "private", 60_000);
  cache.flushNow();
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), []);
  assert.equal(cache.get("public"), "private");
});

test("cache enforces count and byte bounds on growth and hydrated legacy stores", async () => {
  const { cache, directory } = await newCache();
  for (let i = 0; i < 1500; i++) cache.set(`entry:${i}`, "x".repeat(32_000), 60_000);
  assert.ok(cache.memoryCache.size <= 600);
  assert.ok(cache.totalBytes <= 8 * 1024 * 1024);
  cache.set("oversized", "x".repeat(5 * 1024 * 1024), 60_000);
  assert.equal(cache.get("oversized"), undefined);
  const entries = Array.from({ length: 1800 }, (_, i) => ({ key: `entry:${i}`, data: "x".repeat(4000), createdAt: i, expiresAt: Date.now() + 60_000 }));
  const file = path.join(directory, "gateway-cache/store.json");
  await writeFile(file, JSON.stringify(entries));
  const hydrated = new CacheStore(directory);
  caches.push(hydrated);
  await Promise.all([hydrated.initialize(), hydrated.initialize()]);
  assert.ok(hydrated.memoryCache.size <= 600);
  assert.ok(hydrated.totalBytes <= 8 * 1024 * 1024);
  assert.ok(hydrated.get("entry:1799"));
});

test("hydration discards legacy signed URLs and authenticated search/collection results", async () => {
  const { directory, file } = await newCache();
  await writeFile(file, JSON.stringify(["soundcloud:stream:old", "spotify:search:old", "spotify:collections", "soundcloud:collection:old", "public"].map((key) => ({ key, data: "fixture", createdAt: Date.now(), expiresAt: Date.now() + 60_000 }))));
  const cache = new CacheStore(directory);
  caches.push(cache);
  await cache.initialize();
  assert.deepEqual([...cache.memoryCache.keys()], ["public"]);
  cache.flushNow();
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).map((entry) => entry.key), ["public"]);
});

test("a quit-time cache snapshot cannot be overwritten by an older async flush", async () => {
  const { cache, file } = await newCache();
  cache.set("value", "old", 60_000);
  cache.flush();
  cache.set("value", "new", 60_000);
  cache.flushNow();
  await cache.flushQueue;
  assert.equal(JSON.parse(await readFile(file, "utf8"))[0].data, "new");
});

test("gateway waits for cache hydration before dispatching the first request", async () => {
  const gateway = new ProviderGateway(path.join(root, `gateway-${nextDirectory++}`));
  let ready = false, initialized = 0;
  gateway.cache.initialize = async () => { initialized++; await delay(10); ready = true; };
  gateway.youtube.search = async () => { assert.equal(ready, true); return { ok: true, data: [] }; };
  await Promise.all([gateway.request({ provider: "youtube", operation: "search", variables: { query: "a" } }), gateway.request({ provider: "youtube", operation: "search", variables: { query: "b" } })]);
  assert.equal(initialized, 1);
});

test("main-process Spotify search shares token work but isolates accounts and result order", async () => {
  const { cache } = await newCache();
  const gateway = new SpotifyPartnerGateway(cache);
  gateway.operationHashes.set("searchDesktop", "a".repeat(64));
  let tokens = 0, searches = 0;
  gateway.client.request = async (url, init) => {
    await delay(5);
    if (url.includes("clienttoken")) { tokens++; return wireResponse({ granted_token: { token: "fixture-client", expires_after_seconds: 3600 } }); }
    searches++;
    const account = init.headers.Authorization;
    return wireResponse({ data: { searchV2: { tracksV2: { items: ["b", "a"].map((id) => ({ item: { data: { uri: `spotify:track:${id}`, name: `${account === "Bearer fixture-a" ? "A" : "B"}-${id}`, artists: { items: [] }, duration: { totalMilliseconds: 1000 } } } })) } } } });
  };
  const out = await Promise.all(Array.from({ length: 16 }, () => gateway.search(" query ", "fixture-a")));
  assert.equal(tokens, 1); assert.equal(searches, 1);
  assert.deepEqual(out[0].data.map((track) => track.title), ["A-b", "A-a"]);
  assert.equal((await gateway.search("query", "fixture-b")).data[0].title, "B-b");
  assert.equal(searches, 2);
  assert.equal(cache.memoryOnlyKeys.size, 2);
});

test("SoundCloud cancellation does not cache a late response", async () => {
  const { cache } = await newCache();
  const gateway = new SoundCloudInternalGateway(cache);
  gateway.assetBundle = { clientId: "fixture-client", appVersion: "1", appLocale: "en", fetchedAt: Date.now() };
  let release, signal;
  gateway.client.request = (_url, init) => { signal = init.signal; return new Promise((resolve) => { release = resolve; }); };
  const controller = new AbortController();
  const cancelled = assert.rejects(gateway.search("cancel", controller.signal), { name: "AbortError" });
  await delay(1);
  controller.abort(); await cancelled;
  assert.equal(signal.aborted, true);
  release(wireResponse({ collection: [] }));
  await delay(1);
  assert.equal(cache.get("soundcloud:search:cancel"), undefined);
});

test("YouTube search cancellation discards uncancellable library responses", async () => {
  const { cache } = await newCache();
  const gateway = new YouTubeMusicGateway(cache);
  let release;
  gateway.innertube = { music: { search: () => new Promise((resolve) => { release = resolve; }) } };
  const controller = new AbortController();
  const cancelled = assert.rejects(gateway.search("cancel", controller.signal), { name: "AbortError" });
  await delay(1); controller.abort(); await cancelled;
  release({ songs: { contents: [] } }); await delay(1);
  assert.equal(cache.get("youtube:search:cancel"), undefined);
});

test("SoundCloud raw playback metadata is account scoped and never persisted", async () => {
  const { cache, file } = await newCache();
  const gateway = new SoundCloudInternalGateway(cache);
  gateway.assetBundle = { clientId: "fixture-client", appVersion: "1", appLocale: "en", fetchedAt: Date.now() };
  let calls = 0;
  gateway.client.request = async (_url, init) => { calls++; return wireResponse({ id: 1, track_authorization: init.headers.Authorization ?? "anonymous-fixture" }); };
  const track = fixtureTrack(1);
  const a = await gateway.resolveTrackData(track, { Authorization: "OAuth fixture-a" });
  const b = await gateway.resolveTrackData(track, { Authorization: "OAuth fixture-b" });
  const again = await gateway.resolveTrackData(track, { Authorization: "OAuth fixture-a" });
  assert.notEqual(a.data.track_authorization, b.data.track_authorization);
  assert.equal(again.data.track_authorization, a.data.track_authorization);
  assert.equal(calls, 2);
  cache.flushNow();
  await assert.rejects(readFile(file), { code: "ENOENT" });
  gateway.clearSession();
  assert.equal(cache.memoryCache.size, 0);
});

test("transport decodes split UTF-8 once and aborts an idle response without exposing its URL", async () => {
  const originalRequest = net.request;
  let aborted = 0;
  net.request = () => {
    const request = new EventEmitter();
    request.setHeader = () => {}; request.write = () => {}; request.abort = () => { aborted++; };
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.headers = {}; response.statusCode = 200;
      request.emit("response", response);
      const bytes = Buffer.from("fixture 🎵 café");
      response.emit("data", bytes.subarray(0, 10)); response.emit("data", bytes.subarray(10)); response.emit("end");
    });
    return request;
  };
  try {
    assert.equal((await new StealthClient().request("https://fixture.invalid")).body, "fixture 🎵 café");
    net.request = () => { const request = new EventEmitter(); request.setHeader = () => {}; request.end = () => {}; request.abort = () => { aborted++; }; return request; };
    await assert.rejects(new StealthClient().request("https://fixture.invalid?key=fixture", { timeoutMs: 5 }), (error) => error.message === "Request timed out.");
    assert.equal(aborted, 1);
    const controller = new AbortController();
    const cancelled = assert.rejects(new StealthClient().request("https://fixture.invalid", { signal: controller.signal }), { name: "AbortError" });
    controller.abort(); await cancelled; assert.equal(aborted, 2);
  } finally { net.request = originalRequest; }
});

test("Spotify renderer shares repeated search and an expiring-token refresh across distinct searches", async () => {
  let current = connection("fixture-old", new Date(0).toISOString());
  let refreshes = 0, requests = 0;
  const adapter = new SpotifyBaseAdapter({ getConnection: () => current, refreshConnection: async () => { refreshes++; await delay(10); return current = connection("fixture-new"); }, onConnectionIssue() {} });
  await withFetch(async (_url, init) => { requests++; assert.equal(init.headers.get("authorization"), "Bearer fixture-new"); return json({ tracks: { items: [{ id: "b", name: "B" }, { id: "a", name: "A" }] } }); }, async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => adapter.search("fixture")));
    assert.equal(refreshes, 1); assert.equal(requests, 1);
    assert.deepEqual(results[0].map((track) => track.providerTrackId), ["b", "a"]);
    current = connection("fixture-expired", new Date(0).toISOString());
    await Promise.all([adapter.search("one"), adapter.search("two"), adapter.search("three")]);
    assert.equal(refreshes, 2); assert.equal(requests, 4);
  });
});

test("late Spotify 401s reuse an already refreshed token without another refresh", async () => {
  let current = connection("fixture-old"), refreshes = 0;
  const adapter = new SpotifyBaseAdapter({ getConnection: () => current, refreshConnection: async () => { refreshes++; await delay(5); return current = connection("fixture-new"); }, onConnectionIssue() {} });
  await withFetch(async (url, init) => {
    if (init.headers.get("authorization") === "Bearer fixture-old") { if (url.includes("late")) await delay(25); return json({}, 401); }
    return json({ tracks: { items: [] } });
  }, () => Promise.all([adapter.search("early"), adapter.search("late")]));
  assert.equal(refreshes, 1);
});

test("Spotify account invalidation rejects an in-flight search and prevents stale caching", async () => {
  const adapter = new SpotifyBaseAdapter({ getConnection: () => connection(), refreshConnection: async () => connection(), onConnectionIssue() {} });
  let release;
  await withFetch(() => new Promise((resolve) => { release = resolve; }), async () => {
    const cancelled = assert.rejects(adapter.search("fixture"), { name: "AbortError" });
    await delay(1); adapter.clearAccountCaches(); await cancelled;
    release(json({ tracks: { items: [{ id: "stale", name: "Stale" }] } })); await delay(1);
    assert.equal(adapter.searchCache.size, 0);
  });
});

test("cancelling a Spotify 429 wait preserves the full provider cooldown", async () => {
  const adapter = new SpotifyBaseAdapter({ getConnection: () => connection(), refreshConnection: async () => connection(), onConnectionIssue() {} });
  let calls = 0;
  await withFetch(async () => { calls++; return json({}, 429, { "retry-after": "90" }); }, async () => {
    const controller = new AbortController();
    const cancelled = assert.rejects(adapter.search("limited", { signal: controller.signal }), { name: "AbortError" });
    await delay(5); controller.abort(); await cancelled;
    assert.ok(adapter.rateLimitedUntil - Date.now() > 85_000);
    const again = new AbortController();
    const cancelledAgain = assert.rejects(adapter.search("next", { signal: again.signal }), { name: "AbortError" });
    await delay(5); again.abort(); await cancelledAgain;
    assert.equal(calls, 1);
  });
});

test("station twins reject wrong artists, unrelated titles, versions and distant durations", () => {
  const seed = { ...fixtureTrack("seed", "spotify"), title: "Song", creators: ["Artist"] };
  const exact = { ...seed, id: "exact", provider: "soundcloud" };
  const decoys = [{ ...exact, creators: ["Decoy"] }, { ...exact, title: "Different" }, { ...exact, title: "Song (Live)" }, { ...exact, durationMs: 300_000 }];
  assert.equal(pickBestTwin(seed, decoys), undefined);
  assert.equal(pickBestTwin(seed, [...decoys, exact]), exact);
});

test("station familiarity and similar duration cannot admit an unrelated song", () => {
  const seed = fixtureTrack("seed", "spotify"), unrelated = { ...fixtureTrack("unrelated"), creators: ["Familiar"] };
  const signals = { seed, hop1Keys: new Set(), hop2Keys: new Set(), neighbourArtistWeight: new Map(), libraryArtists: new Set(["familiar"]) };
  assert.equal(scoreStationCandidate(unrelated, signals), -Infinity);
  const related = { ...unrelated, genre: "Hip Hop" };
  assert.ok(scoreStationCandidate(related, { ...signals, seed: { ...seed, genre: "Hip Hop" } }) >= 0);
});

test("station balances relevant providers without pulling a weak candidate ahead of strong neighbours", () => {
  const tracks = Array.from({ length: 12 }, (_, i) => ({ ...fixtureTrack(i, i < 6 ? "soundcloud" : "spotify"), creators: [`Artist ${i}`] }));
  const scores = new Map(tracks.map((track) => [trackKey(track), track.provider === "spotify" ? 0.1 : 5]));
  assert.ok(orderStationTracks(tracks, scores, "fixture", 6).every((track) => track.provider === "soundcloud"));
  const balanced = orderStationTracks(tracks, new Map(tracks.map((track) => [trackKey(track), 5])), "fixture", 10);
  assert.ok(balanced.filter((track) => track.provider === "spotify").length >= 3);
  const sameSong = { ...tracks[0], provider: "spotify", providerTrackId: "twin" };
  assert.equal(crossProviderKey(sameSong), crossProviderKey(tracks[0]));
  assert.equal(dedupeAcrossProviders([tracks[0], sameSong], "spotify")[0], sameSong);
});

test("public YouTube import preserves paginated order and repeats while reporting inaccessible entries", async () => {
  let requests = 0;
  const entry = (id, title = id) => ({ snippet: { title, resourceId: { videoId: id }, videoOwnerChannelTitle: "Fixture" } });
  await withFetch(async (input, init) => {
    const url = new URL(input); requests++;
    assert.equal(url.origin, "https://www.googleapis.com"); assert.equal(init.redirect, "error");
    if (url.pathname.endsWith("/playlists")) return json({ items: [{ snippet: { title: "Fixture playlist" } }] });
    if (url.pathname.endsWith("/playlistItems")) return json(url.searchParams.has("pageToken") ? { items: [entry("a"), entry("private", "Private video"), entry("deleted", "Deleted video"), entry("blocked")] } : { items: [entry("b"), entry("a")], nextPageToken: "next" });
    return json({ items: ["a", "b", "blocked"].map((id) => ({ id, snippet: { title: id, channelTitle: "Fixture" }, contentDetails: { duration: "PT3M2S" }, status: { privacyStatus: "public", embeddable: id !== "blocked" } })) });
  }, async () => {
    const gateway = new YouTubePlaylistGateway(() => "fixture-key");
    const [result, same] = await Promise.all([gateway.getCollectionTracks("https://www.youtube.com/playlist?list=PLfixture12345"), gateway.getCollectionTracks("PLfixture12345")]);
    assert.equal(result.ok, true); assert.equal(same.ok, true); assert.equal(requests, 4);
    assert.deepEqual(result.data.items.map((track) => track.providerTrackId), ["b", "a", "a"]);
    assert.equal(result.data.items[0].durationMs, 182_000);
    assert.deepEqual(result.data.importSummary, { total: 6, imported: 3, unavailable: 2, private: 1, deleted: 1, notEmbeddable: 1, duplicateOccurrences: 1 });
  });
});

test("YouTube import rejects foreign links, missing credentials and repeated pages", async () => {
  assert.throws(() => parseYouTubePlaylistId("https://youtube.com.attacker.invalid/playlist?list=PLfixture12345"));
  assert.throws(() => parseYouTubePlaylistId("http://youtube.com/playlist?list=PLfixture12345"));
  assert.equal((await new YouTubePlaylistGateway(() => undefined).getCollectionTracks("PLfixture12345")).ok, false);
  await withFetch(async (input) => json(new URL(input).pathname.endsWith("/playlists") ? { items: [{}] } : { items: [], nextPageToken: "same" }), async () => {
    const result = await new YouTubePlaylistGateway(() => "fixture-key").getCollectionTracks("PLfixture12345");
    assert.equal(result.ok, false); assert.match(result.error, /repeated/);
  });
});

test("YouTube quota backoff prevents additional requests and never exposes its API key", async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json({ secret: "fixture-key" }, 429, { "retry-after": "120" }); }, async () => {
    const gateway = new YouTubePlaylistGateway(() => "fixture-key");
    const first = await gateway.getCollectionTracks("PLfixture12345");
    const second = await gateway.getCollectionTracks("PLfixture67890");
    assert.equal(first.ok, false); assert.match(second.error, /cooling/); assert.equal(calls, 1);
    assert.ok(!first.error.includes("fixture-key"));
    assert.ok(gateway.coolingUntil - Date.now() > 115_000);
  });
});

test("Apple Music foundation stays credential gated and catalog-only", async () => {
  const unavailable = await new AppleMusicCatalog(() => undefined).search("fixture", "us");
  assert.equal(unavailable.ok, false); assert.match(unavailable.error, /developer token/);
  await withFetch(async (_input, init) => { assert.equal(init.headers.Authorization, "Bearer fixture-developer"); return json({ results: { songs: { data: [{ id: "1", type: "songs", attributes: { name: "Fixture song", artistName: "Fixture artist", artwork: { url: "https://fixture.invalid/{w}x{h}.jpg" } } }] } } }); }, async () => {
    const result = await new AppleMusicCatalog(() => "fixture-developer").search("fixture", "us");
    assert.equal(result.ok, true); assert.equal(result.data[0].playbackVerified, false);
    assert.equal(result.data[0].artworkUrl, "https://fixture.invalid/256x256.jpg");
  });
});

test("Apple playlist pagination preserves repeats and rejects foreign next-page URLs", async () => {
  const prefix = "/v1/catalog/us/playlists/pl.fixture/tracks";
  await withFetch(async (input) => json(new URL(input).searchParams.has("offset") ? { data: [{ id: "1", type: "songs" }] } : { data: [{ id: "2", type: "songs" }, { id: "1", type: "songs" }], next: `${prefix}?offset=2` }), async () => {
    const result = await new AppleMusicCatalog(() => "fixture-token").getPlaylistTracks("https://music.apple.com/us/playlist/fixture/pl.fixture");
    assert.deepEqual(result.data.map((song) => song.id), ["2", "1", "1"]);
  });
  let calls = 0;
  await withFetch(async () => { calls++; return json({ data: [], next: "https://attacker.invalid/steal" }); }, async () => {
    const result = await new AppleMusicCatalog(() => "fixture-token").getPlaylistTracks("https://music.apple.com/us/playlist/fixture/pl.fixture");
    assert.equal(result.ok, false); assert.match(result.error, /untrusted/); assert.equal(calls, 1);
  });
});

test("provider metadata parsing bounds response size and hides malformed response bodies", async () => {
  await assert.rejects(readMetadataJson(new Response("x".repeat(4 * 1024 * 1024 + 1))), /size limit/);
  await assert.rejects(readMetadataJson(new Response("fixture-secret-invalid-json")), (error) => !error.message.includes("fixture-secret"));
});

test("local scans reuse unchanged metadata across restarts, refresh modified files and remove stale paths", async () => {
  const directory = path.join(root, `local-${nextDirectory++}`), folder = path.join(directory, "music");
  await mkdir(folder, { recursive: true });
  const wav = Buffer.alloc(8044);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(8000, 40);
  await writeFile(path.join(folder, "Fixture.wav"), wav);
  const manager = new LocalMusicManager(directory);
  await manager.addFolder(folder);
  const [first, joined] = await Promise.all([manager.scan(), manager.scan()]);
  assert.equal(first, joined); assert.equal(first[0].durationMs, 1000);
  const cacheFile = path.join(directory, "local-metadata.json");
  const cacheTime = (await stat(cacheFile)).mtimeMs;
  await manager.scan(); assert.equal((await stat(cacheFile)).mtimeMs, cacheTime);
  const restarted = new LocalMusicManager(directory);
  assert.deepEqual(JSON.parse(JSON.stringify(await restarted.scan())), JSON.parse(JSON.stringify(first)));
  const longer = Buffer.concat([wav, Buffer.alloc(8000)]); longer.writeUInt32LE(longer.length - 8, 4); longer.writeUInt32LE(16000, 40);
  await writeFile(path.join(folder, "Fixture.wav"), longer);
  assert.equal((await restarted.scan())[0].durationMs, 2000);
  assert.equal(restarted.resolveAudioPath(first[0].id), await realpath(path.join(folder, "Fixture.wav")));
  await restarted.removeFolder(folder);
  assert.deepEqual(await restarted.scan(), []);
  assert.equal(restarted.resolveAudioPath(first[0].id), undefined);
});

test("local audio resolves configured directory aliases and rejects an alias retargeted outside its scanned folder", async () => {
  const directory = path.join(root, `local-alias-${nextDirectory++}`);
  const folder = path.join(directory, "music"), other = path.join(directory, "other");
  const alias = path.join(directory, "configured-folder");
  await mkdir(folder, { recursive: true });
  await mkdir(other, { recursive: true });
  await writeFile(path.join(folder, "Fixture.mp3"), "Fixture metadata is intentionally unreadable");
  await symlink(folder, alias, process.platform === "win32" ? "junction" : "dir");
  const manager = new LocalMusicManager(directory);
  await manager.addFolder(alias);
  const tracks = await manager.scan();
  assert.equal(tracks.length, 1);
  assert.equal(manager.resolveAudioPath(tracks[0].id), await realpath(path.join(folder, "Fixture.mp3")));
  await unlink(alias);
  await symlink(other, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(manager.resolveAudioPath(tracks[0].id), undefined);
});

test("native glass respects OS support, high contrast and reduced transparency", () => {
  assert.equal(selectWindowMaterial("win32", "10.0.22621", false, false), "acrylic");
  assert.equal(selectWindowMaterial("win32", "10.0.19045", false, false), "opaque");
  assert.equal(selectWindowMaterial("darwin", "25.0.0", false, false), "vibrancy");
  assert.equal(selectWindowMaterial("win32", "10.0.26200", true, false), "opaque");
  assert.equal(selectWindowMaterial("darwin", "25.0.0", false, true), "opaque");
  assert.equal(selectWindowMaterial("linux", "6.0.0", false, false), "opaque");
});
