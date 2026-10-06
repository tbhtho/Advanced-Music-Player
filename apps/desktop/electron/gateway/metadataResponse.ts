/** Bound public API metadata before buffering and do not echo provider payloads in errors. */
export async function readMetadataJson<T>(response: Response, maxBytes = 4 * 1024 * 1024): Promise<T> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new Error("Provider metadata exceeded the size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider returned no metadata.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Provider metadata exceeded the size limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T; }
  catch { throw new Error("Provider returned invalid metadata."); }
}
