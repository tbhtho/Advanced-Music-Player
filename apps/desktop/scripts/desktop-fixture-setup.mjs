// This module exists only in the isolated fixture build, before production app modules evaluate.
const delay = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
const track = (id, provider = "spotify", prefix = "Fixture") => ({ id: `${provider}:${id}`, provider, providerTrackId: String(id), title: `${prefix} song ${id}`, creators: [`Fixture artist ${Number(id) % 8}`], durationMs: 180000, explicit: false, playable: true });
const tracks = Array.from({ length: 120 }, (_, i) => track(i, i % 2 ? "soundcloud" : "spotify"));
const now = new Date().toISOString();
localStorage.clear();
localStorage.setItem("spot-cloud.ui-prefs", JSON.stringify({ onboardingComplete: true, accentSource: "static", discordPresenceEnabled: false }));
localStorage.setItem("spot-cloud.project-tracks", JSON.stringify(tracks.map((item) => ({ id: `fixture-project-${item.id}`, ownerId: "local-user", provider: item.provider, providerTrackId: item.providerTrackId, source: "library-sync", track: item, createdAt: now, updatedAt: now }))));
localStorage.setItem("spot-cloud.playlists", JSON.stringify([{ id: "fixture-playlist", ownerId: "local-user", title: "Evening collection", entries: tracks.slice(0, 24).map((item, i) => ({ id: `fixture-entry-${i}`, playlistId: "fixture-playlist", sortOrder: i, track: item })), createdAt: now, updatedAt: now }]));

window.__AMP_FIXTURE__ = { track, tracks, fetchCalls: 0, fetchAborts: 0, startupStartedAt: performance.now() };
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? input);
  if (url.origin !== "https://api.spotify.com") throw new Error("External requests are disabled in the isolated fixture.");
  window.__AMP_FIXTURE__.fetchCalls++;
  const searching = url.pathname.endsWith("/search");
  const query = url.searchParams.get("q") ?? "";
  try { await delay(searching ? query === "slow" ? 300 : 90 : 120, init.signal); }
  catch (error) { window.__AMP_FIXTURE__.fetchAborts++; throw error; }
  const items = tracks.filter((item) => item.provider === "spotify").map((item) => ({ id: item.providerTrackId, name: item.title, duration_ms: item.durationMs, artists: [{ id: "fixture-artist", name: item.creators[0] }] }));
  let body;
  if (searching) body = { tracks: { items: Array.from({ length: 18 }, (_, i) => ({ id: `search-${query}-${i}`, name: `${query} Spotify ${i}`, duration_ms: 180000, artists: [{ name: "Fixture artist" }] })) } };
  else if (url.pathname.endsWith("/me/playlists")) body = { items: [] };
  else if (url.pathname.endsWith("/me/tracks")) body = { total: items.length, items: items.map((item) => ({ track: item })) };
  else if (url.pathname.endsWith("/artists")) body = { artists: [] };
  else throw new Error(`Unsupported fixture catalog path: ${url.pathname}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

// Fail closed if a fixture accidentally attempts playback or an external script/embed.
HTMLMediaElement.prototype.play = async () => { throw new Error("Playback is disabled in the fixture."); };
navigator.mediaDevices.getDisplayMedia = async () => { throw new Error("Capture is disabled in the fixture."); };
