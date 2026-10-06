interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
  onCancelled: Set<() => void>;
}

/** Share identical reads while allowing each caller to cancel independently. No settled cache. */
export class SharedRequests<T> {
  private pending = new Map<string, SharedRequest<T>>();

  run(key: string, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, subscribers: 0, onCancelled: new Set(), promise: Promise.resolve().then(() => operation(controller.signal)) };
      const current = entry;
      controller.signal.addEventListener("abort", () => {
        for (const cancel of [...current.onCancelled]) cancel();
      }, { once: true });
      this.pending.set(key, current);
      void current.promise.finally(() => {
        if (this.pending.get(key) === current) this.pending.delete(key);
      }).catch(() => undefined);
    }
    const current = entry;
    current.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (settle: () => void) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", abort);
        current.onCancelled.delete(sharedAbort);
        current.subscribers--;
        settle();
      };
      const abort = () => {
        finish(() => reject(signal?.reason ?? new DOMException("Cancelled", "AbortError")));
        if (current.subscribers === 0) {
          if (this.pending.get(key) === current) this.pending.delete(key);
          current.controller.abort();
        }
      };
      const sharedAbort = () => finish(() => reject(current.controller.signal.reason));
      signal?.addEventListener("abort", abort, { once: true });
      current.onCancelled.add(sharedAbort);
      current.promise.then((result) => finish(() => resolve(result)), (error) => finish(() => reject(error)));
    });
  }

  clear(): void {
    for (const request of this.pending.values()) request.controller.abort();
    this.pending.clear();
  }
}

/** Keep network fan-out bounded and retain input order, including discovery precedence. */
export async function mapConcurrent<T, R>(items: T[], limit: number, operation: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  }));
  return results;
}

export function abortableDelay(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
