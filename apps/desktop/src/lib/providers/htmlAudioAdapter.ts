import type {
  PlaybackAdapter,
  PlaybackAdapterEvent,
  PlaybackAdapterListener,
  PlaybackAdapterSnapshot,
  PlaybackContext,
  ProviderCollection,
  TrackCollection
} from "@amp/core";
import type { Provider, UnifiedTrack } from "@amp/core";
import { clampVolume } from "@amp/core";

/*
 * A minimal, shared HTML5 <audio> playback adapter — the whole implementation for providers whose
 * audio is just a URL the browser can play: YouTube (proxied through amp-stream://) and local files
 * (amp-local://). Both keep all their provider-specific fragility OUT of here: the YouTube stream is
 * resolved by the main process behind the protocol, and local files are read off disk. This class
 * only drives the element and translates its media events into PlaybackAdapter events.
 */

export interface HtmlAudioAdapterOptions {
  provider: Provider;
  initialVolume?: number;
  /** Map a track to the URL the <audio> element should load. */
  resolveSrc(track: UnifiedTrack): string | Promise<string>;
  /** Optional live search; providers without one (local) return no results here. */
  search?(query: string): Promise<UnifiedTrack[]>;
}

// PLAY_PROGRESS-style throttle so routine time updates don't re-render every subscriber ~4×/sec
// more than needed (mirrors the SoundCloud stream path).
const POSITION_EMIT_THROTTLE_MS = 240;

const emptyCollection = (provider: Provider): TrackCollection => ({
  id: "",
  provider,
  kind: "likes",
  title: "",
  items: []
});

export class HtmlAudioAdapter implements PlaybackAdapter {
  readonly provider: Provider;
  private audio = document.createElement("audio");
  private listeners = new Set<PlaybackAdapterListener>();
  private snapshot: PlaybackAdapterSnapshot;
  private options: HtmlAudioAdapterOptions;
  private playToken = 0;
  private lastEmitAt = 0;
  private currentTrackId?: string;
  /** Seconds to seek to once metadata loads (resume-from-position); 0 = start from the top. */
  private pendingStartSeconds = 0;

  constructor(options: HtmlAudioAdapterOptions) {
    this.options = options;
    this.provider = options.provider;
    this.snapshot = {
      provider: options.provider,
      status: "idle",
      positionMs: 0,
      durationMs: 0,
      volume: clampVolume(options.initialVolume ?? 0.8)
    };
    this.audio.preload = "auto";
    this.audio.volume = this.snapshot.volume;
    if (typeof document !== "undefined") {
      this.audio.setAttribute("aria-hidden", "true");
      this.audio.style.display = "none";
      document.body.appendChild(this.audio);
    }
    this.bindEvents();
  }

  subscribe(listener: PlaybackAdapterListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async search(query: string): Promise<UnifiedTrack[]> {
    return this.options.search ? this.options.search(query) : [];
  }

  async getCollections(): Promise<ProviderCollection[]> {
    return [];
  }

  async getCollectionTracks(): Promise<TrackCollection> {
    return emptyCollection(this.provider);
  }

  async getLibrary(): Promise<TrackCollection> {
    return emptyCollection(this.provider);
  }

  async play(track: UnifiedTrack, context?: PlaybackContext): Promise<void> {
    const token = ++this.playToken;
    // Resume after pause hands us the saved position; honoring it means play/pause doesn't restart
    // (and re-buffer) the track from 0:00 the way the other adapters avoid.
    const startPositionMs = Math.max(0, context?.positionMs ?? 0);
    this.currentTrackId = track.providerTrackId || track.id;
    this.pendingStartSeconds = startPositionMs > 0 ? startPositionMs / 1000 : 0;
    this.snapshot = {
      ...this.snapshot,
      status: "loading",
      positionMs: startPositionMs,
      durationMs: track.durationMs,
      activeTrackId: this.currentTrackId,
      error: undefined
    };
    this.emit({ type: "state", snapshot: this.snapshot });

    const src = await this.options.resolveSrc(track);
    // A newer play() started while this src resolved — abandon this one so the two don't fight.
    if (token !== this.playToken) {
      return;
    }
    this.audio.src = src;
    this.audio.load();
    await this.audio.play();
  }

  async pause(): Promise<void> {
    this.audio.pause();
  }

  async seek(positionMs: number): Promise<void> {
    if (Number.isFinite(this.audio.duration)) {
      this.audio.currentTime = Math.max(0, positionMs / 1000);
      this.emitState();
    }
  }

  async setVolume(volume: number): Promise<void> {
    const clamped = clampVolume(volume);
    this.snapshot = { ...this.snapshot, volume: clamped };
    this.audio.volume = clamped;
  }

  async teardown(): Promise<void> {
    try {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    } catch {
      // best-effort
    }
    this.snapshot = { ...this.snapshot, status: "idle" };
  }

  private bindEvents(): void {
    this.audio.addEventListener("timeupdate", () => {
      const now = Date.now();
      if (now - this.lastEmitAt < POSITION_EMIT_THROTTLE_MS) {
        return;
      }
      this.lastEmitAt = now;
      this.emitState();
    });
    this.audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
        this.snapshot = { ...this.snapshot, durationMs: Math.round(this.audio.duration * 1000) };
      }
      // Resume-from-position: apply the requested start offset once the element knows its duration.
      if (this.pendingStartSeconds > 0 && Number.isFinite(this.audio.duration)) {
        this.audio.currentTime = Math.min(this.pendingStartSeconds, this.audio.duration);
        this.pendingStartSeconds = 0;
      }
      this.emitState();
    });
    this.audio.addEventListener("playing", () => {
      this.snapshot = { ...this.snapshot, status: "playing" };
      this.emitState();
    });
    this.audio.addEventListener("pause", () => {
      // The native "pause" event also fires at end-of-track; the "ended" handler owns that case.
      if (this.audio.ended) {
        return;
      }
      this.snapshot = { ...this.snapshot, status: "paused" };
      this.emitState();
    });
    this.audio.addEventListener("waiting", () => {
      this.snapshot = { ...this.snapshot, status: "loading" };
      this.emitState();
    });
    this.audio.addEventListener("ended", () => {
      this.emit({ type: "ended", snapshot: { ...this.snapshot, status: "idle" } });
    });
    this.audio.addEventListener("error", () => {
      // Ignore a stale error event from an already-abandoned load: when play() switched to a new
      // track it called load(), which resets audio.error to null. If there's no live error now, this
      // event belongs to the previous src — emitting it would wrongly skip the current (good) track.
      const mediaError = this.audio.error;
      if (!mediaError) {
        return;
      }
      this.emit({
        type: "error",
        snapshot: {
          ...this.snapshot,
          status: "error",
          activeTrackId: this.currentTrackId,
          error: `Couldn't play this track (media error ${mediaError.code}).`
        }
      });
    });
  }

  private emitState(): void {
    this.snapshot = {
      ...this.snapshot,
      positionMs: Math.round((this.audio.currentTime || 0) * 1000),
      activeTrackId: this.currentTrackId
    };
    this.emit({ type: "state", snapshot: this.snapshot });
  }

  private emit(event: PlaybackAdapterEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Local files: served off disk at amp-local://audio/<id>. Search is done over the scanned
 *  library in the store, so this adapter has no live search of its own. */
export function createLocalAdapter(initialVolume?: number): HtmlAudioAdapter {
  return new HtmlAudioAdapter({
    provider: "local",
    initialVolume,
    resolveSrc: (track) => `amp-local://audio/${encodeURIComponent(track.providerTrackId || track.id)}`
  });
}
