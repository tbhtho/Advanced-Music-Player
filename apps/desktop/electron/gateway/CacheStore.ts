import { promises as fs, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CacheEntry } from "./types";
import { Worker } from "node:worker_threads";

// Bound both entry count and estimated retained memory. Map insertion order gives oldest-first
// eviction without sorting; draining to a low-water mark amortizes cleanup over later inserts.
const MAX_ENTRIES = 600;
const LOW_WATER_ENTRIES = 480;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const LOW_WATER_BYTES = 6 * 1024 * 1024;
const MAX_STORE_BYTES = 32 * 1024 * 1024;

// Conservative accounting avoids serializing every response just to enforce a memory budget.
function estimateBytes(value: unknown, depth = 0): number {
  if (typeof value === "string") return value.length * 2 + 8;
  if (value === null || typeof value !== "object") return 16;
  if (depth > 16) return MAX_CACHE_BYTES;
  if (ArrayBuffer.isView(value)) return value.byteLength + 64;
  let bytes = 64;
  for (const [key, item] of Object.entries(value)) {
    bytes += key.length * 2 + estimateBytes(item, depth + 1) + 16;
    if (bytes > MAX_CACHE_BYTES) break;
  }
  return bytes;
}

export class CacheStore {
  private cacheDir: string;
  private memoryCache = new Map<string, CacheEntry>();
  private memoryOnlyKeys = new Set<string>();
  private dirty = false;
  private revision = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushQueue: Promise<void> = Promise.resolve();
  private writeGeneration = 0;
  private entryBytes = new Map<string, number>();
  private totalBytes = 0;
  private initialization: Promise<void> | undefined;

  constructor(userDataPath: string) {
    this.cacheDir = path.join(userDataPath, "gateway-cache");
  }

  initialize(): Promise<void> {
    this.initialization ??= fs.mkdir(this.cacheDir, { recursive: true }).then(() => this.hydrate());
    return this.initialization;
  }

  get<T>(key: string): T | undefined {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      const persistent = !this.memoryOnlyKeys.has(key);
      this.deleteEntry(key);
      if (persistent) this.markDirty();
      return undefined;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs: number, etag?: string): void {
    this.memoryOnlyKeys.delete(key);
    this.storeEntry(key, data, ttlMs, etag);
  }

  /** Cache credentials and signed media URLs for this process without writing them to disk. */
  setMemoryOnly(key: string, data: unknown, ttlMs: number, etag?: string): void {
    const replacesPersistent = this.memoryCache.has(key) && !this.memoryOnlyKeys.has(key);
    this.memoryOnlyKeys.add(key);
    this.storeEntry(key, data, ttlMs, etag);
    if (replacesPersistent) this.markDirty();
  }

  private storeEntry(key: string, data: unknown, ttlMs: number, etag?: string): void {
    const now = Date.now();
    const bytes = estimateBytes(data) + Buffer.byteLength(key, "utf8") + 128;
    const memoryOnly = this.memoryOnlyKeys.has(key);
    this.deleteEntry(key);
    if (memoryOnly) this.memoryOnlyKeys.add(key);
    if (bytes > MAX_CACHE_BYTES) {
      this.memoryOnlyKeys.delete(key);
      if (!memoryOnly) this.markDirty();
      return;
    }
    this.memoryCache.set(key, {
      key,
      data,
      etag,
      expiresAt: now + ttlMs,
      createdAt: now
    });
    this.entryBytes.set(key, bytes);
    this.totalBytes += bytes;
    if (this.memoryCache.size > MAX_ENTRIES || this.totalBytes > MAX_CACHE_BYTES) {
      this.evictStale(now);
    }
    if (!memoryOnly) this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
    this.revision++;
    this.scheduleFlush();
  }

  private deleteEntry(key: string): void {
    this.totalBytes -= this.entryBytes.get(key) ?? 0;
    this.entryBytes.delete(key);
    this.memoryCache.delete(key);
    this.memoryOnlyKeys.delete(key);
  }

  /** Drop expired entries, then oldest-first down to the low-water mark. */
  private evictStale(now: number): void {
    let removedPersistent = false;
    for (const [key, entry] of this.memoryCache) {
      if (entry.expiresAt <= now) {
        const persistent = !this.memoryOnlyKeys.has(key);
        this.deleteEntry(key);
        removedPersistent ||= persistent;
      }
    }
    if (this.memoryCache.size <= MAX_ENTRIES && this.totalBytes <= MAX_CACHE_BYTES) {
      if (removedPersistent) this.markDirty();
      return;
    }
    // Map insertion order already tracks age (overwrites move to the end), avoiding repeated sorts.
    for (const key of this.memoryCache.keys()) {
      if (this.memoryCache.size <= LOW_WATER_ENTRIES && this.totalBytes <= LOW_WATER_BYTES) break;
      const persistent = !this.memoryOnlyKeys.has(key);
      this.deleteEntry(key);
      removedPersistent ||= persistent;
    }
    if (removedPersistent) this.markDirty();
  }

  invalidate(pattern?: RegExp): void {
    if (!pattern) {
      this.memoryCache.clear();
      this.memoryOnlyKeys.clear();
      this.entryBytes.clear();
      this.totalBytes = 0;
      this.markDirty();
      return;
    }

    let removedPersistent = false;
    for (const key of this.memoryCache.keys()) {
      pattern.lastIndex = 0;
      if (pattern.test(key)) {
        const persistent = !this.memoryOnlyKeys.has(key);
        this.deleteEntry(key);
        removedPersistent ||= persistent;
      }
    }
    if (removedPersistent) this.markDirty();
  }

  private scheduleFlush(): void {
    if (!this.dirty) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, 2000);
    this.flushTimer.unref?.();
  }

  private writeSnapshotSync(entries: CacheEntry[]): void {
    const targetPath = path.join(this.cacheDir, "store.json");
    const temporaryPath = `${targetPath}.${process.pid}.sync.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(entries), "utf8");
      renameSync(temporaryPath, targetPath);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }

  /**
   * Flush immediately and SYNCHRONOUSLY (quit path) — the debounce timer alone loses the last ~2s
   * of writes, and an async write started inside `before-quit` can be cut off mid-flight when the
   * process exits. The payload is small (bounded by MAX_ENTRIES), so blocking a few ms is fine.
   */
  flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.dirty) {
      return;
    }
    try {
      this.writeGeneration += 1;
      const revision = this.revision;
      const now = Date.now();
      const entries = Array.from(this.memoryCache.values()).filter(
        (entry) => entry.expiresAt > now && !this.memoryOnlyKeys.has(entry.key)
      );
      this.writeSnapshotSync(entries);
      if (this.revision === revision) {
        this.dirty = false;
      }
    } catch {
      // Cache flush failure is non-critical.
    }
  }

  private flush(): void {
    if (!this.dirty) {
      return;
    }

    const revision = this.revision;
    const generation = ++this.writeGeneration;
    const now = Date.now();
    const entries = Array.from(this.memoryCache.values()).filter(
      (entry) => entry.expiresAt > now && !this.memoryOnlyKeys.has(entry.key)
    );
    const payload = JSON.stringify(entries);
    const targetPath = path.join(this.cacheDir, "store.json");
    const temporaryPath = `${targetPath}.${process.pid}.${generation}.tmp`;

    const run = this.flushQueue.then(async () => {
      try {
        await fs.writeFile(temporaryPath, payload, "utf8");
        // renameSync runs in this continuation without an await between the generation check and
        // replace. flushNow can therefore invalidate a pending snapshot without a stale async
        // rename landing after the quit-time write.
        if (generation === this.writeGeneration) {
          renameSync(temporaryPath, targetPath);
          if (this.revision === revision) {
            this.dirty = false;
          } else {
            this.scheduleFlush();
          }
        }
      } catch {
        // Cache flush failure is non-critical; keep dirty so a later mutation can retry.
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      }
    });
    this.flushQueue = run.catch(() => undefined);
  }

  private async hydrate(): Promise<void> {
    try {
      const storePath = path.join(this.cacheDir, "store.json");
      const size = (await fs.stat(storePath)).size;
      if (size > MAX_STORE_BYTES) { this.markDirty(); return; }
      // Old/unbounded stores can be large. Parse and trim them off the Electron event loop.
      const entries = size > 4 * 1024 * 1024
        ? await this.readLargeStore(storePath)
        : JSON.parse(await fs.readFile(storePath, "utf8")) as CacheEntry[];
      if (!Array.isArray(entries)) return;
      const now = Date.now();
      let scrubbedSensitiveEntry = false;

      for (const entry of entries) {
        // Older releases persisted signed SoundCloud URLs and DRM/OAuth material in store.json.
        // Never hydrate those values and rewrite the store without them.
        if (!entry || typeof entry.key !== "string" || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.expiresAt)) continue;
        if (/^soundcloud:(stream:|track:|me-library:|collections|collection:)/.test(entry.key) || /^spotify:(search|collection)/.test(entry.key)) {
          scrubbedSensitiveEntry = true;
          continue;
        }
        if (entry.expiresAt > now) {
          this.deleteEntry(entry.key);
          this.memoryCache.set(entry.key, entry);
          const bytes = estimateBytes(entry.data) + Buffer.byteLength(entry.key, "utf8") + 128;
          this.entryBytes.set(entry.key, bytes);
          this.totalBytes += bytes;
        }
      }
      const before = this.memoryCache.size;
      this.evictStale(now);
      if (before !== this.memoryCache.size) scrubbedSensitiveEntry = true;
      if (scrubbedSensitiveEntry) {
        this.dirty = true;
        this.revision += 1;
        this.scheduleFlush();
      }
    } catch {
      // Hydration failure is fine on first run.
    }
  }

  private async readLargeStore(storePath: string): Promise<CacheEntry[]> {
    // The worker reads only the disposable metadata store and discards legacy sensitive entries.
    const worker = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      const fs = require("node:fs");
      try {
        const entries = JSON.parse(fs.readFileSync(workerData.path, "utf8"));
        if (!Array.isArray(entries)) throw new Error("Invalid cache");
        const valid = entries.filter(e => e && typeof e.key === "string" && Number.isFinite(e.createdAt) && e.expiresAt > Date.now()
          && !/^soundcloud:(stream:|track:|me-library:|collections|collection:)/.test(e.key) && !/^spotify:(search|collection)/.test(e.key))
          .sort((a,b) => b.createdAt - a.createdAt).slice(0, workerData.limit).reverse();
        parentPort.postMessage(valid);
      } catch { parentPort.postMessage([]); }
    `, { eval: true, workerData: { path: storePath, limit: MAX_ENTRIES } });
    try {
      return await new Promise<CacheEntry[]>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", () => reject(new Error("Cache hydration worker stopped before returning metadata")));
      });
    } finally {
      await worker.terminate();
      // Rewrite trimmed stores even if all retained entries are public and unexpired.
      this.markDirty();
    }
  }
}
