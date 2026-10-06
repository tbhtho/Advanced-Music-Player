import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const scriptPath = fileURLToPath(import.meta.url);
const defaultDesktopRoot = path.resolve(path.dirname(scriptPath), "..");
const publicKeys = ["SPOTIFY_CLIENT_ID", "SOUNDCLOUD_CLIENT_ID", "DISCORD_CLIENT_ID"];

export async function writeBundledConfig({
  desktopRoot = defaultDesktopRoot,
  repoRoot = path.resolve(desktopRoot, "../.."),
  env = process.env,
  requireSpotify = false
} = {}) {
  const outputPath = path.join(desktopRoot, "dist-electron", "bundled-desktop-config.json");
  for (const envPath of [
    path.join(repoRoot, ".env"), path.join(repoRoot, ".env.local"),
    path.join(desktopRoot, ".env"), path.join(desktopRoot, ".env.local")
  ]) {
    loadEnv({ path: envPath, override: false, processEnv: env, quiet: true });
  }
  const bundledConfig = Object.fromEntries(publicKeys
    .map(key => [key, env[key]?.trim() || ""])
    .filter(([, value]) => value));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Never keep a stale identifier from an earlier build when this build is unconfigured.
  if (requireSpotify && !bundledConfig.SPOTIFY_CLIENT_ID) {
    await fs.rm(outputPath, { force: true });
    throw new Error("Release packaging requires AMP's existing public SPOTIFY_CLIENT_ID. Supply it in the build environment or a local .env file. No Spotify client secret is needed.");
  }
  if (Object.keys(bundledConfig).length === 0) {
    await fs.rm(outputPath, { force: true });
    return { outputPath, written: false };
  }
  await fs.writeFile(outputPath, JSON.stringify(bundledConfig, null, 2), "utf8");
  return { outputPath, written: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = await writeBundledConfig({ requireSpotify: process.argv.includes("--require-spotify") });
    console.log(result.written
      ? "[bundled-config] Wrote " + result.outputPath
      : "[bundled-config] Development build has no bundled public OAuth configuration.");
  } catch (error) {
    console.error("[bundled-config] " + error.message);
    process.exitCode = 1;
  }
}
