import type { TrackCollection, UnifiedTrack } from "@amp/core";
import { SharedRequests } from "@amp/core";
import type { GatewayResponse } from "./types";
import { readMetadataJson } from "./metadataResponse";

interface PlaylistItem {
  snippet?: { title?: string; position?: number; resourceId?: { videoId?: string }; videoOwnerChannelTitle?: string };
}
interface Video {
  id: string;
  snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
  contentDetails?: { duration?: string };
  status?: { embeddable?: boolean; privacyStatus?: string; uploadStatus?: string };
}
export interface YouTubePlaylistCollection extends TrackCollection {
  importSummary: { total: number; imported: number; unavailable: number; private: number; deleted: number; notEmbeddable: number; duplicateOccurrences: number };
}

export function parseYouTubePlaylistId(input: string): string {
  let id = input.trim();
  if (/^https?:/i.test(id)) {
    const url = new URL(id);
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) throw new Error("Paste a YouTube playlist link.");
    id = url.searchParams.get("list") ?? "";
  }
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(id)) throw new Error("A public YouTube playlist link is required.");
  return id;
}

function durationMs(value = ""): number {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  return match ? (Number(match[1] ?? 0) * 86400 + Number(match[2] ?? 0) * 3600 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0)) * 1000 : 0;
}

/** Official public, read-only Data API. No OAuth, media extraction, or credential creation. */
export class YouTubePlaylistGateway {
  private reads = new SharedRequests<GatewayResponse<YouTubePlaylistCollection>>();
  private coolingUntil = 0;
  constructor(private getApiKey: () => string | undefined = () => process.env.YOUTUBE_DATA_API_KEY) {}

  getCollectionTracks(input: string, signal?: AbortSignal): Promise<GatewayResponse<YouTubePlaylistCollection>> {
    let id: string;
    try { id = parseYouTubePlaylistId(input); }
    catch (error) { return Promise.resolve({ ok: false, source: "public", error: (error as Error).message }); }
    return this.reads.run(id, (sharedSignal) => this.fetchPlaylist(id, sharedSignal), signal);
  }

  private async api<T>(operation: string, parameters: Record<string, string>, key: string, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.coolingUntil > Date.now()) throw new Error("YouTube requests are cooling down. Try again later.");
    const url = new URL(`https://www.googleapis.com/youtube/v3/${operation}`);
    for (const [name, value] of Object.entries({ ...parameters, key })) url.searchParams.set(name, value);
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), redirect: "error" });
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const seconds = header ? Number(header) : Number.NaN;
      this.coolingUntil = Date.now() + Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : (Date.parse(header ?? "") - Date.now()) || 60_000);
    }
    if (!response.ok) throw new Error(response.status === 404 ? "Playlist not found or not public." : response.status === 403 ? "YouTube denied the request. Check the configured API key and quota; private playlists require authorization." : `YouTube request failed (${response.status}).`);
    return readMetadataJson<T>(response);
  }

  private async fetchPlaylist(id: string, signal: AbortSignal): Promise<GatewayResponse<YouTubePlaylistCollection>> {
    const key = this.getApiKey()?.trim();
    if (!key) return { ok: false, source: "public", error: "Public playlist import needs a YouTube Data API key configured as YOUTUBE_DATA_API_KEY. No YouTube sign-in is needed." };
    try {
      const info = await this.api<{ items?: Array<{ snippet?: { title?: string } }> }>("playlists", { part: "snippet", id, fields: "items(snippet(title))" }, key, signal);
      if (!info.items?.length) throw new Error("Playlist not found or not public.");
      const entries: PlaylistItem[] = [];
      const seenPages = new Set<string>();
      let pageToken = "";
      do {
        if (seenPages.has(pageToken)) throw new Error("YouTube repeated a playlist page; import was stopped to avoid an incomplete playlist.");
        seenPages.add(pageToken);
        if (seenPages.size > 2000) throw new Error("This playlist has too many pages to import safely.");
        const page = await this.api<{ items?: PlaylistItem[]; nextPageToken?: string }>("playlistItems", { part: "snippet", playlistId: id, maxResults: "50", fields: "nextPageToken,items(snippet(title,position,resourceId(videoId),videoOwnerChannelTitle))", ...(pageToken ? { pageToken } : {}) }, key, signal);
        entries.push(...(page.items ?? []));
        pageToken = page.nextPageToken ?? "";
        if (entries.length > 100_000) throw new Error("This playlist is too large to import safely.");
      } while (pageToken);
      // Fetch each video once, then reconstruct occurrences in playlist order, including repeats.
      const ids = [...new Set(entries.flatMap((entry) => entry.snippet?.resourceId?.videoId ? [entry.snippet.resourceId.videoId] : []))];
      const videos = new Map<string, Video>();
      for (let offset = 0; offset < ids.length; offset += 50) {
        const page = await this.api<{ items?: Video[] }>("videos", { part: "snippet,contentDetails,status", id: ids.slice(offset, offset + 50).join(","), fields: "items(id,snippet(title,channelTitle,thumbnails),contentDetails(duration),status(embeddable,privacyStatus,uploadStatus))" }, key, signal);
        for (const video of page.items ?? []) videos.set(video.id, video);
      }
      const items: UnifiedTrack[] = [];
      const occurrenceCount = entries.filter((entry) => entry.snippet?.resourceId?.videoId).length;
      const summary = { total: entries.length, imported: 0, unavailable: 0, private: 0, deleted: 0, notEmbeddable: 0, duplicateOccurrences: Math.max(0, occurrenceCount - ids.length) };
      for (const entry of entries) {
        const snippet = entry.snippet;
        const video = videos.get(snippet?.resourceId?.videoId ?? "");
        if (!video || video.status?.privacyStatus === "private" || ["deleted", "failed", "rejected"].includes(video.status?.uploadStatus ?? "")) {
          summary.unavailable++;
          if (snippet?.title === "Private video" || video?.status?.privacyStatus === "private") summary.private++;
          else if (snippet?.title === "Deleted video" || video?.status?.uploadStatus === "deleted") summary.deleted++;
          continue;
        }
        if (video.status?.embeddable === false) { summary.notEmbeddable++; continue; }
        const thumbnails = video.snippet?.thumbnails;
        items.push({ id: video.id, provider: "youtube", providerTrackId: video.id, title: video.snippet?.title ?? snippet?.title ?? "YouTube video", creators: [snippet?.videoOwnerChannelTitle ?? video.snippet?.channelTitle ?? "YouTube"], durationMs: durationMs(video.contentDetails?.duration), artworkUrl: thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url, explicit: false, playable: true, externalUrl: `https://www.youtube.com/watch?v=${video.id}` });
      }
      summary.imported = items.length;
      return { ok: true, source: "public", data: { id, provider: "youtube", kind: "playlist", title: info.items[0].snippet?.title ?? "YouTube playlist", items, importSummary: summary } };
    } catch (error) {
      return { ok: false, source: "public", error: signal.aborted ? "YouTube import cancelled." : (error as Error).message };
    }
  }
}
