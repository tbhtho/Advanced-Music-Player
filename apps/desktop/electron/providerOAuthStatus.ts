type Provider = "spotify" | "soundcloud";
type StorageMode = "none" | "local-secure" | "memory-only";

interface OAuthConfig {
  spotifyClientId: string;
  soundCloudClientId: string;
  soundCloudClientSecret: string;
}

interface SavedSession {
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  storageMode: StorageMode;
}

export interface ProviderRuntimeOAuthStatus {
  configured: boolean;
  hasStoredSession: boolean;
  storageMode: StorageMode;
  message: string;
}

export const missingSpotifyConfigMessage =
  "This build is missing AMP's Spotify sign-in configuration. Your saved connection is preserved. Use a build with Spotify sign-in configured, or restore the existing public client ID in advanced settings.";

export function requireSpotifyClientId(value: string | undefined): string {
  const clientId = value?.trim();
  if (!clientId) throw new Error(missingSpotifyConfigMessage);
  return clientId;
}

/** Saved tokens do not supply the public app identifier needed for a new PKCE sign-in. */
export function createStoredProviderRuntimeStatus(
  provider: Provider,
  config: OAuthConfig,
  storedSession?: SavedSession,
  hasVolatileSession = false
): ProviderRuntimeOAuthStatus {
  const hasPersistedSession = Boolean(storedSession?.encryptedRefreshToken || storedSession?.encryptedAccessToken);
  const storageMode = hasPersistedSession && storedSession
    ? storedSession.storageMode
    : hasVolatileSession ? "memory-only" : "none";
  const hasSoundCloudDesktopOAuth = Boolean(config.soundCloudClientId && config.soundCloudClientSecret);
  const configured = provider === "spotify"
    ? Boolean(config.spotifyClientId.trim())
    : hasSoundCloudDesktopOAuth || hasPersistedSession || hasVolatileSession;

  if (!configured) {
    return {
      configured: false,
      hasStoredSession: hasPersistedSession,
      storageMode,
      message: provider === "spotify"
        ? missingSpotifyConfigMessage
        : "SoundCloud API sign-in needs a client ID and secret configured in Settings. Public SoundCloud search and playback still work without it."
    };
  }
  if (hasPersistedSession && storedSession) {
    return { configured: true, hasStoredSession: true, storageMode, message: "Ready to reconnect on this device." };
  }
  if (hasVolatileSession) {
    return { configured: true, hasStoredSession: false, storageMode, message: "Connected for this app session only." };
  }
  return {
    configured: true,
    hasStoredSession: false,
    storageMode: "none",
    message: provider === "soundcloud"
      ? "Ready to connect inside AMP and sync your SoundCloud likes plus playlists."
      : "Ready to connect and sync your library."
  };
}
