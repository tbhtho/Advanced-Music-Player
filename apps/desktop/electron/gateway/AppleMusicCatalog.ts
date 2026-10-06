import { SharedRequests } from "@amp/core";
import type { GatewayResponse } from "./types";
import { readMetadataJson } from "./metadataResponse";

export interface AppleMusicSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  externalUrl?: string;
  artworkUrl?: string;
  // Catalog access is not subscription playback authorization.
  playbackVerified: false;
}
interface CatalogResource {
  id: string;
  type: string;
  attributes?: { name?: string; artistName?: string; albumName?: string; durationInMillis?: number; url?: string; artwork?: { url?: string } };
}
interface CatalogPage { data?: CatalogResource[]; next?: string }

/** Credential-gated, read-only foundation. Never signs tokens or creates accounts in the client. */
export class AppleMusicCatalog {
  private reads = new SharedRequests<GatewayResponse<AppleMusicSong[]>>();
  private coolingUntil = 0;
  constructor(private getDeveloperToken: () => string | undefined = () => process.env.APPLE_MUSIC_DEVELOPER_TOKEN) {}

  search(query: string, storefront: string, signal?: AbortSignal): Promise<GatewayResponse<AppleMusicSong[]>> {
    const term = query.trim();
    return this.reads.run(`search:${storefront}:${term.toLowerCase()}`, (sharedSignal) => this.read(async (token) => {
      if (!term) return [];
      const page = await this.api<{ results?: { songs?: CatalogPage } }>(`/v1/catalog/${this.storefront(storefront)}/search?types=songs&limit=25&term=${encodeURIComponent(term)}`, token, sharedSignal);
      return (page.results?.songs?.data ?? []).filter((item) => item.type === "songs").map(mapSong);
    }), signal);
  }

  getPlaylistTracks(link: string, signal?: AbortSignal): Promise<GatewayResponse<AppleMusicSong[]>> {
    return this.reads.run(`playlist:${link}`, (sharedSignal) => this.read(async (token) => {
      const url = new URL(link);
      if (url.protocol !== "https:" || url.hostname !== "music.apple.com") throw new Error("An Apple Music public playlist link is required.");
      const parts = url.pathname.split("/").filter(Boolean);
      const country = this.storefront(parts[0] ?? "");
      const id = parts.at(-1) ?? "";
      if (parts[1] !== "playlist" || !/^pl\.[A-Za-z0-9._-]+$/.test(id)) throw new Error("An Apple Music public playlist link is required.");
      const prefix = `/v1/catalog/${country}/playlists/${encodeURIComponent(id)}/tracks`;
      let next: string | undefined = `${prefix}?limit=100`;
      const seenPages = new Set<string>();
      const songs: AppleMusicSong[] = [];
      while (next) {
        const pageUrl = new URL(next, "https://api.music.apple.com");
        if (pageUrl.origin !== "https://api.music.apple.com" || pageUrl.pathname !== prefix || pageUrl.username || pageUrl.password) throw new Error("Apple Music returned an untrusted playlist page.");
        if (seenPages.has(pageUrl.href) || seenPages.size >= 1000) throw new Error("Apple Music pagination did not complete safely.");
        seenPages.add(pageUrl.href);
        const page: CatalogPage = await this.api(pageUrl.href, token, sharedSignal);
        songs.push(...(page.data ?? []).filter((item) => item.type === "songs").map(mapSong));
        next = page.next;
      }
      return songs;
    }), signal);
  }

  private storefront(country: string): string {
    if (!/^[a-z]{2}$/.test(country)) throw new Error("An Apple Music storefront country is required.");
    return country;
  }

  private async read(operation: (token: string) => Promise<AppleMusicSong[]>): Promise<GatewayResponse<AppleMusicSong[]>> {
    const token = this.getDeveloperToken()?.trim();
    if (!token) return { ok: false, source: "public", error: "Apple Music catalog access requires an owner-supplied developer token. Subscription playback also requires MusicKit user authorization and an active Apple Music subscription." };
    try { return { ok: true, source: "public", data: await operation(token) }; }
    catch (error) { return { ok: false, source: "public", error: (error as Error).message }; }
  }

  private async api<T>(input: string, token: string, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (Date.now() < this.coolingUntil) throw new Error("Apple Music is cooling down after a rate limit.");
    const url = new URL(input, "https://api.music.apple.com");
    if (url.origin !== "https://api.music.apple.com" || !url.pathname.startsWith("/v1/catalog/") || url.username || url.password) throw new Error("Untrusted Apple Music API URL.");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), redirect: "error" });
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds = retry ? Number(retry) : Number.NaN;
      this.coolingUntil = Date.now() + Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : (Date.parse(retry ?? "") - Date.now()) || 60_000);
    }
    if (!response.ok) throw new Error(response.status === 404 ? "Apple Music catalog playlist is unavailable or private." : `Apple Music catalog request failed (${response.status}).`);
    return readMetadataJson<T>(response);
  }
}

function mapSong(resource: CatalogResource): AppleMusicSong {
  const item = resource.attributes;
  return { id: resource.id, title: item?.name ?? "Apple Music song", artist: item?.artistName ?? "Unknown artist", album: item?.albumName, durationMs: item?.durationInMillis ?? 0, externalUrl: item?.url, artworkUrl: item?.artwork?.url?.replace("{w}", "256").replace("{h}", "256"), playbackVerified: false };
}
