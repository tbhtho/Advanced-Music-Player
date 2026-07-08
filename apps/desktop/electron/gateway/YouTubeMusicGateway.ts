import type { UnifiedTrack } from "@amp/core";
import type { CacheStore } from "./CacheStore";
import type { GatewayResponse } from "./types";

/*
 * YouTube Music via youtubei.js (Innertube).
 *
 * GROUND TRUTH (from scripts probe, 2026-07-08): modern YouTube no longer exposes streaming URLs on
 * ANY Innertube client — chooseFormat returns formats with neither `url` nor `signatureCipher`.
 * The only thing that yields playable audio is `Innertube.download(videoId, { client: "IOS" })`,
 * and ONLY when the Innertube instance carries a BotGuard PO token (generated via bgutils-js in a
 * jsdom DOM). So we can't hand the renderer a URL — the main process proxies the audio bytes over
 * the amp-stream:// protocol, and this gateway resolves the Node stream for that handler.
 *
 * Everything here is unofficial and can break when YouTube changes — same maintenance posture as
 * the SoundCloud internal gateway. Failures degrade to a clean error, never a crash.
 */

// youtubei.js / bgutils-js / jsdom are heavy, ESM, and main-process only — import lazily so app
// startup never pays for them and a load failure can't take down the whole gateway.
type Innertube = any;

const SEARCH_CACHE_TTL_MS = 30 * 60_000;
// PO tokens are good for a few hours; refresh conservatively and always on a stream failure.
const PO_TOKEN_TTL_MS = 3 * 60 * 60_000;

interface YouTubeSong {
  id?: string;
  title?: string;
  artists?: Array<{ name?: string }>;
  album?: { name?: string };
  duration?: { seconds?: number };
  thumbnail?: { contents?: Array<{ url?: string }> };
  thumbnails?: Array<{ url?: string }>;
}

export class YouTubeMusicGateway {
  private cache: CacheStore;
  private innertube: Innertube | undefined;
  private innertubePromise: Promise<Innertube> | undefined;
  private poToken: string | undefined;
  private visitorData: string | undefined;
  private poTokenAt = 0;

  constructor(cache: CacheStore) {
    this.cache = cache;
  }

  /** Best-effort warm-up; safe to call at startup. Never throws. */
  async initialize(): Promise<void> {
    try {
      await this.ensureInnertube();
    } catch {
      // Lazily retried on first real use.
    }
  }

  async search(query: string): Promise<GatewayResponse<UnifiedTrack[]>> {
    const q = query.trim();
    if (!q) {
      return { ok: true, data: [], source: "internal" };
    }
    const cacheKey = `youtube:search:${q.toLowerCase()}`;
    const cached = this.cache.get<UnifiedTrack[]>(cacheKey);
    if (cached) {
      return { ok: true, data: cached, source: "cache" };
    }

    try {
      const yt = await this.ensureInnertube();
      const results = await yt.music.search(q, { type: "song" });
      const songs: YouTubeSong[] =
        results.songs?.contents ??
        results.contents?.flatMap((section: any) => section?.contents ?? []) ??
        [];
      const tracks = songs
        .filter((song) => song?.id)
        .slice(0, 20)
        .map((song) => mapYouTubeSong(song));
      this.cache.set(cacheKey, tracks, SEARCH_CACHE_TTL_MS);
      return { ok: true, data: tracks, source: "internal" };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "YouTube search failed.",
        source: "internal"
      };
    }
  }

  /**
   * Resolve a playable audio stream for a video id, honoring an optional byte range (for <audio>
   * seeking). Returns a web ReadableStream (fed straight into the protocol handler's Response) plus
   * the metadata the handler needs for Content-Length/Content-Range. Throws on failure so the
   * handler can answer 502/404.
   */
  async getStream(
    videoId: string,
    range?: { start: number; end?: number }
  ): Promise<{
    webStream: ReadableStream<Uint8Array>;
    mimeType: string;
    totalBytes?: number;
    /** The byte range actually served (206), or undefined when the full resource is served (200). */
    servedRange?: { start: number; end: number };
    contentLength?: number;
  }> {
    const attempt = async (yt: Innertube) => {
      // Metadata (mime + byte length) is best-effort via getBasicInfo — NOT getInfo. getInfo parses
      // the whole watch page (related videos, endscreens…), and a single unexpected renderer there
      // throws "Cannot read properties of undefined (reading 'url')" for some videos. getBasicInfo
      // parses only the player response (the same light path yt.download uses internally), so it
      // avoids that class of parser crash. If even it fails, we stream anyway with sane defaults.
      let mimeType = "audio/mp4";
      let totalBytes: number | undefined;
      try {
        const info = await yt.getBasicInfo(videoId, "IOS");
        const format = info.chooseFormat({ type: "audio", quality: "best" });
        if (format?.mime_type) {
          mimeType = format.mime_type.split(";")[0];
        }
        totalBytes =
          typeof format?.content_length === "number"
            ? format.content_length
            : Number(format?.content_length) || undefined;
      } catch {
        // Metadata unavailable — fall through with defaults (audio/mp4, unknown length → full 200).
      }

      // Only honor a byte range when we know the total size — otherwise we can't advertise a valid
      // Content-Range, and serving mid-file bytes under a 200 would corrupt playback. Without a known
      // size a seek simply re-streams from 0 (handled: served=false → the handler answers 200).
      const served = range && totalBytes ? { start: range.start, end: range.end ?? totalBytes - 1 } : undefined;
      // The actual audio comes from yt.download() — NOT info.download(): info.download reuses the
      // already-fetched player data whose formats carry no decipherable URL ("No valid URL to
      // decipher"), whereas yt.download does its own IOS-client resolution that yields a live stream.
      const webStream: ReadableStream<Uint8Array> = await yt.download(videoId, {
        type: "audio",
        quality: "best",
        client: "IOS",
        // youtubei's range end is INCLUSIVE, matching served.end (totalBytes-1 max).
        ...(served ? { range: { start: served.start, end: served.end } } : {})
      });
      const contentLength = served ? served.end - served.start + 1 : totalBytes;
      return { webStream, mimeType, totalBytes, servedRange: served, contentLength };
    };

    try {
      return await attempt(await this.ensureInnertube());
    } catch {
      // Retry ONCE with a fresh PO token, but build it locally so a permanent per-video failure
      // (bad/region-blocked id) can't wipe the shared Innertube that every other track + search
      // relies on. Only promote the fresh instance if the retry actually succeeds.
      const fresh = await this.createInnertube();
      const result = await attempt(fresh);
      this.innertube = fresh;
      this.poTokenAt = Date.now();
      return result;
    }
  }

  private async ensureInnertube(): Promise<Innertube> {
    if (this.innertube && Date.now() - this.poTokenAt < PO_TOKEN_TTL_MS) {
      return this.innertube;
    }
    if (this.innertubePromise) {
      return this.innertubePromise;
    }
    this.innertubePromise = this.createInnertube();
    try {
      this.innertube = await this.innertubePromise;
      return this.innertube;
    } finally {
      this.innertubePromise = undefined;
    }
  }

  private async createInnertube(): Promise<Innertube> {
    const { Innertube, UniversalCache } = await import("youtubei.js");
    const { poToken, visitorData } = await this.generatePoToken();
    this.poToken = poToken;
    this.visitorData = visitorData;
    this.poTokenAt = Date.now();
    return Innertube.create({
      cache: new UniversalCache(false),
      po_token: poToken,
      visitor_data: visitorData,
      generate_session_locally: true
    });
  }

  /** BotGuard PO token via bgutils-js inside a jsdom DOM. Required or download() 403s. */
  private async generatePoToken(): Promise<{ poToken: string; visitorData: string }> {
    const { Innertube } = await import("youtubei.js");
    const { BG } = await import("bgutils-js");
    const { JSDOM } = await import("jsdom");

    const tmp = await Innertube.create({ retrieve_player: false });
    const rawVisitor: string | undefined = tmp.session.context.client.visitorData;
    if (!rawVisitor) {
      throw new Error("Could not obtain YouTube visitor data.");
    }
    const visitorData = rawVisitor;

    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://www.youtube.com/",
      referrer: "https://www.youtube.com/"
    });
    const globalObj = globalThis as any;
    const restore = {
      window: globalObj.window,
      document: globalObj.document
    };
    globalObj.window = dom.window;
    globalObj.document = dom.window.document;
    try {
      const requestKey = "O43z0dpjhgX20SCx4KAo";
      const bgConfig = {
        fetch: (url: any, opts: any) => fetch(url, opts),
        globalObj,
        identifier: visitorData,
        requestKey
      };
      const challenge = await BG.Challenge.create(bgConfig);
      if (!challenge) {
        throw new Error("BotGuard challenge failed.");
      }
      const interpreterJs =
        challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
      if (interpreterJs) {
        // eslint-disable-next-line no-new-func -- BotGuard interpreter, sandboxed to the jsdom globals.
        new Function(interpreterJs)();
      }
      const poTokenResult = await BG.PoToken.generate({
        program: challenge.program,
        globalName: challenge.globalName,
        bgConfig
      });
      if (!poTokenResult?.poToken) {
        throw new Error("Could not generate a YouTube PO token.");
      }
      return { poToken: poTokenResult.poToken, visitorData };
    } finally {
      globalObj.window = restore.window;
      globalObj.document = restore.document;
      dom.window.close();
    }
  }
}

function mapYouTubeSong(song: YouTubeSong): UnifiedTrack {
  const videoId = song.id as string;
  const creators = (song.artists ?? [])
    .map((a) => a?.name)
    .filter((name): name is string => Boolean(name));
  const artworkUrl =
    song.thumbnail?.contents?.[song.thumbnail.contents.length - 1]?.url ??
    song.thumbnails?.[song.thumbnails.length - 1]?.url;
  return {
    id: videoId,
    provider: "youtube",
    providerTrackId: videoId,
    title: song.title ?? "Unknown title",
    creators: creators.length > 0 ? creators : ["YouTube"],
    artworkUrl,
    durationMs: (song.duration?.seconds ?? 0) * 1000,
    explicit: false,
    externalUrl: `https://music.youtube.com/watch?v=${videoId}`,
    playable: true,
    album: song.album?.name
  };
}
