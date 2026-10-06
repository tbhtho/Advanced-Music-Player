import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electronPath from "electron";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(process.env.AMP_BENCH_SOURCE ?? path.join(scripts, "../../.."));
const output = path.resolve(process.env.AMP_BENCH_OUTPUT ?? await mkdtemp(path.join(os.tmpdir(), "amp-desktop-fixture-")));
const fixtureBuild = path.join(output, "build");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "amp-fixture-profile-"));
const setup = 'import { createDemoTrack } from "/amp-fixture-catalog.js";\n' + await readFile(path.join(scripts, "desktop-fixture-setup.mjs"), "utf8");
const catalog = await readFile(path.join(scripts, "demo-catalog.mjs"), "utf8");
if (process.env.AMP_BENCH_REUSE_BUILD !== "1") await build({ configFile: false, root: path.join(sourceRoot, "apps/desktop"), base: "./", logLevel: "warn", plugins: [react(), tailwindcss(), {
  name: "isolated-amp-fixture",
  transformIndexHtml: { order: "pre", handler(html) { return html.replace('src="/src/main.tsx"', 'src="/amp-fixture-entry.js"'); } },
  resolveId(id) { if (id === "/amp-fixture-entry.js" || id === "/amp-fixture-setup.js" || id === "/amp-fixture-catalog.js") return "\0" + id; },
  load(id) {
    if (id === "\0/amp-fixture-setup.js") return setup;
    if (id === "\0/amp-fixture-catalog.js") return catalog;
    if (id === "\0/amp-fixture-entry.js") return 'import "/amp-fixture-setup.js"; import { useAppStore } from "/src/state/useAppStore.ts"; import "/src/main.tsx"; window.__AMP_TEST_STORE__ = useAppStore;';
  }
}], resolve: { alias: { "@": path.join(sourceRoot, "apps/desktop/src"), "@amp/core": path.join(sourceRoot, "packages/core/src/index.ts") } }, build: { outDir: fixtureBuild, emptyOutDir: false } });
let nativeModule;
try {
  await readFile(path.join(sourceRoot, "apps/desktop/electron/windowMaterial.ts"));
  const nativeBuild = path.join(output, "native");
  if (process.env.AMP_BENCH_REUSE_BUILD !== "1") await build({ configFile: false, logLevel: "warn", build: { ssr: path.join(sourceRoot, "apps/desktop/electron/windowMaterial.ts"), outDir: nativeBuild, emptyOutDir: false, rollupOptions: { output: { entryFileNames: "windowMaterial.mjs" } } } });
  nativeModule = path.join(nativeBuild, "windowMaterial.mjs");
} catch (error) { if (error.code !== "ENOENT") throw error; }
const spec = { accentSource: process.env.AMP_BENCH_ACCENT ?? "static", visible: process.env.AMP_BENCH_VISIBLE === "1", hold: process.env.AMP_BENCH_HOLD === "1", profile, build: fixtureBuild, output, nativeModule, material: process.env.AMP_BENCH_MATERIAL ?? "opaque" };
const specification = path.join(output, "fixture-spec.json");
await writeFile(specification, JSON.stringify(spec));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
try { await new Promise((resolve, reject) => {
  const child = spawn(electronPath, [path.join(scripts, "desktop-review-host.cjs"), specification], { stdio: "inherit", env, windowsHide: true });
  child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Isolated fixture exited with code ${code}`)));
}); } finally {
  if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith("amp-fixture-profile-")) throw new Error("Refusing to remove an unexpected fixture profile path");
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
