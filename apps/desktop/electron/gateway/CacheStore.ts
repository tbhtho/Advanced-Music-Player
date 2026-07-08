import { promises as fs, writeFileSync } from "node:fs";
import path from "node:path";
import type { CacheEntry } from "./types";

// Hard ceiling on cached entries — beyond this the oldest entries are evicted so a long session
// can't grow memory (and the store.json flush) without bound. Eviction drains down to the
// low-water mark so the O(n log n) oldest-first sort amortizes over many inserts instead of
// firing on every write once the cache sits at the cap.
const MAX_ENTRIES = 600;
const LOW_WATER_ENTRIES = 480;

export class CacheStore {
  private cacheDir: string;
  private memoryCache = new Map<string, CacheEntry>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(userDataPath: string) {
    this.cacheDir = path.join(userDataPath, "gateway-cache");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await this.hydrate();
  }

  get<T>(key: string): T | undefined {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      this.dirty = true;
      this.scheduleFlush();
      return undefined;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs: number, etag?: string): void {
    const now = Date.now();
    this.memoryCache.set(key, {
      key,
      data,
      etag,
      expiresAt: now + ttlMs,
      createdAt: now
    });
    if (this.memoryCache.size > MAX_ENTRIES) {
      this.evictStale(now);
    }
    this.dirty = true;
    this.scheduleFlush();
  }

  /** Drop expired entries, then oldest-first down to the low-water mark. */
  private evictStale(now: number): void {
    for (const [key, entry] of this.memoryCache) {
      if (entry.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }
    if (this.memoryCache.size <= MAX_ENTRIES) {
      return;
    }
    const oldestFirst = [...this.memoryCache.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of oldestFirst.slice(0, this.memoryCache.size - LOW_WATER_ENTRIES)) {
      this.memoryCache.delete(entry.key);
    }
  }

  invalidate(pattern?: RegExp): void {
    if (!pattern) {
      this.memoryCache.clear();
      this.dirty = true;
      this.scheduleFlush();
      return;
    }

    for (const key of this.memoryCache.keys()) {
      if (pattern.test(key)) {
        this.memoryCache.delete(key);
        this.dirty = true;
      }
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 2000);
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
      const now = Date.now();
      const entries = Array.from(this.memoryCache.values()).filter((entry) => entry.expiresAt > now);
      writeFileSync(path.join(this.cacheDir, "store.json"), JSON.stringify(entries, null, 2), "utf8");
      this.dirty = false;
    } catch {
      // Cache flush failure is non-critical.
    }
  }

  private async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    try {
      const now = Date.now();
      const entries = Array.from(this.memoryCache.values()).filter((entry) => entry.expiresAt > now);
      const payload = JSON.stringify(entries, null, 2);
      await fs.writeFile(path.join(this.cacheDir, "store.json"), payload, "utf8");
      this.dirty = false;
    } catch {
      // Cache flush failure is non-critical.
    }
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.cacheDir, "store.json"), "utf8");
      const entries = JSON.parse(raw) as CacheEntry[];
      const now = Date.now();

      for (const entry of entries) {
        if (entry.expiresAt > now) {
          this.memoryCache.set(entry.key, entry);
        }
      }
    } catch {
      // Hydration failure is fine on first run.
    }
  }
}
