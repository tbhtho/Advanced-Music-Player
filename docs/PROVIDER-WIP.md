# Provider work in progress

YouTube playlist-link import and Apple Music expansion are **paused and unavailable in AMP** at the owner's request. No new provider controls, routes, accounts, credentials, or playback claims are enabled by this branch. Existing YouTube search and playback are unchanged apart from shared search cancellation/performance handling.

Two partial read-only foundations remain for possible future work:

- `apps/desktop/electron/gateway/YouTubePlaylistGateway.ts`: disconnected public-playlist metadata importer. Its offline fixtures exercise pagination, occurrence ordering, unavailable videos, request sharing, and quota backoff. It is not instantiated or exposed by `ProviderGateway` or the renderer. No live import was verified.
- `apps/desktop/electron/gateway/AppleMusicCatalog.ts`: disconnected catalog metadata client. It is not an AMP playback provider, has no UI or IPC route, and marks catalog songs `playbackVerified: false`. No live catalog or subscription playback was verified.

Resuming either requires a separate owner request. YouTube's official Data API requires a configured project/API key; a visible official player would need additional work before playlist support could be presented as complete. Apple catalog access requires an owner-supplied developer token, while full MusicKit playback also requires user authorization and an Apple Music subscription. No credentials were created or inspected.

Official prerequisites: [YouTube Data API](https://developers.google.com/youtube/v3/getting-started), [YouTube player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality), [Apple MusicKit](https://developer.apple.com/musickit/).
