import { registerHooks, stripTypeScriptTypes } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { performance } from "node:perf_hooks";

// Import the actual main-process TypeScript in Node without starting Electron or any account.
// Every network request must be explicitly replaced by a fixture; accidental I/O fails closed.
const electronStub = `export const net = { request() { throw new Error("Unexpected fixture network request"); } };
export class BrowserWindow { constructor() { throw new Error("Fixture attempted to open a window"); } }
export const session = {};`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@amp/core") {
      return next(pathToFileURL(path.join(sourceRoot, "packages/core/src/index.ts")).href, context);
    }
    if (specifier === "electron") {
      return { url: `data:text/javascript,${encodeURIComponent(electronStub)}`, shortCircuit: true };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
      const candidates = /\.js$/.test(specifier)
        ? [specifier.replace(/\.js$/, ".ts")]
        : /\.[cm]?[jt]sx?$/.test(specifier) ? [] : [specifier + ".ts", specifier + ".js"];
      for (const candidate of candidates) {
        const url = new URL(candidate, context.parentURL);
        if (url.protocol === "file:" && existsSync(fileURLToPath(url))) return next(candidate, context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(String(result.source), { mode: "transform" }), shortCircuit: true };
    return result;
  }
});

export const sourceRoot = path.resolve(process.env.AMP_BENCH_SOURCE ?? fileURLToPath(new URL("../../..", import.meta.url)));
export function backendModule(relative) {
  return import(pathToFileURL(path.join(sourceRoot, "apps/desktop/electron", relative)).href);
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const wireResponse = (body, status = 200) => ({ status, statusText: "fixture", headers: {}, body: typeof body === "string" ? body : JSON.stringify(body) });
export function fixtureTrack(id, provider = "soundcloud") {
  return { id: String(id), provider, providerTrackId: String(id), title: `Track ${id}`, creators: ["Fixture artist"], durationMs: 180_000, explicit: false, playable: true };
}

export async function measure(run) {
  global.gc?.();
  const initial = process.memoryUsage();
  const cpu = process.cpuUsage();
  const start = performance.now();
  let previous = start;
  let maxEventLoopGapMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxEventLoopGapMs = Math.max(maxEventLoopGapMs, now - previous);
    previous = now;
  }, 1);
  const details = await run();
  const elapsedMs = performance.now() - start;
  await delay(2);
  clearInterval(timer);
  const consumed = process.cpuUsage(cpu);
  global.gc?.();
  const final = process.memoryUsage();
  return {
    elapsedMs: +elapsedMs.toFixed(2),
    cpuMs: +((consumed.user + consumed.system) / 1000).toFixed(2),
    maxEventLoopGapMs: +maxEventLoopGapMs.toFixed(2),
    heapDeltaBytes: final.heapUsed - initial.heapUsed,
    rssBytes: final.rss,
    ...details
  };
}
