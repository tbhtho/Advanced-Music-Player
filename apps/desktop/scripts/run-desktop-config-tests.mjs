import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { backendModule } from "./backend-fixtures.mjs";
import { writeBundledConfig } from "./writeBundledConfig.mjs";

const { createStoredProviderRuntimeStatus, requireSpotifyClientId, missingSpotifyConfigMessage } = await backendModule("providerOAuthStatus.ts");
const emptyConfig = { spotifyClientId: "", soundCloudClientId: "", soundCloudClientSecret: "" };
const saved = { encryptedAccessToken: "offline-fixture", storageMode: "local-secure" };
const root = await mkdtemp(path.join(os.tmpdir(), "amp-public-config-tests-"));
after(() => rm(root, { recursive: true, force: true }));
let fixtureId = 0;
async function fixture() {
  const repoRoot = path.join(root, String(fixtureId++));
  const desktopRoot = path.join(repoRoot, "apps", "desktop");
  await mkdir(desktopRoot, { recursive: true });
  return { repoRoot, desktopRoot, file: path.join(desktopRoot, "dist-electron", "bundled-desktop-config.json") };
}

test("a saved Spotify session cannot enable new sign-in without the public client ID", () => {
  for (const session of [undefined, saved]) for (const volatile of [false, true]) {
    const status = createStoredProviderRuntimeStatus("spotify", emptyConfig, session, volatile);
    assert.equal(status.configured, false);
    assert.equal(status.hasStoredSession, Boolean(session));
    assert.equal(status.storageMode, session ? "local-secure" : volatile ? "memory-only" : "none");
    assert.equal(status.message, missingSpotifyConfigMessage);
    assert.throws(() => requireSpotifyClientId("  "), { message: status.message });
  }
  assert.equal(saved.encryptedAccessToken, "offline-fixture", "Readiness must not remove existing sessions");
});

test("a configured Spotify build reports sign-in readiness with or without a session", () => {
  const config = { ...emptyConfig, spotifyClientId: "existing-public-fixture-id" };
  assert.equal(createStoredProviderRuntimeStatus("spotify", config).configured, true);
  assert.equal(createStoredProviderRuntimeStatus("spotify", config, saved).configured, true);
  assert.equal(createStoredProviderRuntimeStatus("spotify", config, undefined, true).storageMode, "memory-only");
  assert.equal(requireSpotifyClientId("  existing-public-fixture-id  "), "existing-public-fixture-id");
});

test("SoundCloud session and desktop OAuth readiness retain their existing behavior", () => {
  assert.equal(createStoredProviderRuntimeStatus("soundcloud", emptyConfig).configured, false);
  assert.equal(createStoredProviderRuntimeStatus("soundcloud", emptyConfig, saved).configured, true);
  assert.equal(createStoredProviderRuntimeStatus("soundcloud", emptyConfig, undefined, true).configured, true);
  assert.equal(createStoredProviderRuntimeStatus("soundcloud", { ...emptyConfig, soundCloudClientId: "fixture", soundCloudClientSecret: "offline-fixture" }).configured, true);
});

test("release configuration rejects a missing Spotify ID and removes stale bundled configuration", async () => {
  const f = await fixture();
  await mkdir(path.dirname(f.file), { recursive: true });
  await writeFile(f.file, '{"SPOTIFY_CLIENT_ID":"stale-fixture"}');
  await assert.rejects(writeBundledConfig({ ...f, env: { SOUNDCLOUD_CLIENT_ID: "fixture" }, requireSpotify: true }), /existing public SPOTIFY_CLIENT_ID/);
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
});

test("packaging writes public identifiers only, with environment precedence and no secrets", async () => {
  const f = await fixture();
  await writeFile(path.join(f.repoRoot, ".env"), "SPOTIFY_CLIENT_ID=existing-file-id\nSOUNDCLOUD_CLIENT_SECRET=offline-secret-fixture\n");
  await writeFile(path.join(f.desktopRoot, ".env.local"), "DISCORD_CLIENT_ID=discord-fixture\n");
  await writeBundledConfig({ ...f, env: { SPOTIFY_CLIENT_ID: " environment-fixture-id ", SPOTIFY_CLIENT_SECRET: "offline-secret-fixture" }, requireSpotify: true });
  const content = await readFile(f.file, "utf8");
  assert.deepEqual(JSON.parse(content), { SPOTIFY_CLIENT_ID: "environment-fixture-id", DISCORD_CLIENT_ID: "discord-fixture" });
  assert.equal(content.includes("secret"), false);
});

test("normal source builds remain available without any OAuth identifier", async () => {
  const f = await fixture();
  assert.equal((await writeBundledConfig({ ...f, env: {} })).written, false);
  await assert.rejects(readFile(f.file), { code: "ENOENT" });
});
