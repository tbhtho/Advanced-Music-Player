import type { UnifiedTrack } from "@amp/core";
import type { CacheStore } from "./CacheStore";
import type { GatewayResponse } from "./types";
import { SharedRequests } from "@amp/core";

/*
 * YouTube Music SEARCH via youtubei.js (Innertube). Playback does NOT happen here — it runs through
 * YouTube's official IFrame player in the renderer (see YouTubeIframeAdapter). That's how the
 * reliable YT desktop apps do it: the real player streams the audio, so there's no stream extraction
 * to fight YouTube's anti-bot rate limits (which 403'd the googlevideo media fetch). Search needs no
 * PO token, so this gateway stays light — just an anonymous Innertube.
 */

// youtubei.js is heavy, ESM, and main-process only — import lazily so startup never pays for it and
// a load failure can't take down the whole gateway.
type Innertube = any;

const SEARCH_CACHE_TTL_MS = 30 * 60_000;

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
  private searches = new SharedRequests<GatewayResponse<UnifiedTrack[]>>();

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

  search(query: string, signal?: AbortSignal): Promise<GatewayResponse<UnifiedTrack[]>> {
    return this.searches.run(query.trim().toLowerCase(), (sharedSignal) => this.searchOnce(query, sharedSignal), signal);
  }

  private async searchOnce(query: string, signal: AbortSignal): Promise<GatewayResponse<UnifiedTrack[]>> {
    signal.throwIfAborted();
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
      signal.throwIfAborted();
      const results = await yt.music.search(q, { type: "song" });
      const songs: YouTubeSong[] =
        results.songs?.contents ??
        results.contents?.flatMap((section: any) => section?.contents ?? []) ??
        [];
      const tracks = songs
        .filter((song) => song?.id)
        .slice(0, 20)
        .map((song) => mapYouTubeSong(song));
      signal.throwIfAborted();
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

  private async ensureInnertube(): Promise<Innertube> {
    if (this.innertube) {
      return this.innertube;
    }
    if (this.innertubePromise) {
      return this.innertubePromise;
    }
    this.innertubePromise = (async () => {
      const { Innertube, UniversalCache } = await import("youtubei.js");
      return Innertube.create({ cache: new UniversalCache(false), generate_session_locally: true });
    })();
    try {
      this.innertube = await this.innertubePromise;
      return this.innertube;
    } finally {
      this.innertubePromise = undefined;
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
