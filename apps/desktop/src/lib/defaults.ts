import { type Provider, type ProviderConnection } from "@amp/core";

/**
 * Default, honest provider connection state.
 *
 * - Spotify needs a connected Premium account before any full-track playback works.
 * - SoundCloud search + playback work WITHOUT signing in (public web client_id),
 *   so we never imply a login is required. Signing in only adds personal likes/playlists.
 * - YouTube and Local have no account concept at all — they're always available, so they
 *   start "connected" and simply skip every OAuth/sign-in surface in the UI.
 */
export function createDefaultConnections(): Record<Provider, ProviderConnection> {
  return {
    spotify: {
      provider: "spotify",
      status: "disconnected",
      issue: "Connect your Spotify Premium account to play full tracks and load your library.",
      storageMode: "none"
    },
    soundcloud: {
      provider: "soundcloud",
      status: "disconnected",
      issue:
        "Search and play public SoundCloud tracks without signing in. Signing in is optional and only adds your personal likes and playlists.",
      storageMode: "none"
    },
    youtube: {
      provider: "youtube",
      status: "connected",
      displayName: "YouTube Music",
      storageMode: "none"
    },
    local: {
      provider: "local",
      status: "connected",
      displayName: "Local files",
      storageMode: "none"
    }
  };
}
