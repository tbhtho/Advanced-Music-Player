# Provider setup and playback notes

## Spotify

Provide your own Spotify client ID in Settings, with the redirect URI:

```text
http://127.0.0.1:8000/spotify/callback
```

Spotify playback requires Premium; library import does not. AMP has no Spotify crossfade.

## SoundCloud

Search and playback can work without an API key. For configured API access, optionally provide a SoundCloud client ID and secret in Settings, with callback:

```text
musync://soundcloud/callback
```

The optional Local Connect flow reads SoundCloud cookies from the browser profile you select and may briefly start an isolated browser copy to decrypt them. Those cookies are not sent to an AMP server. Provider sessions are stored on this device and can be cleared in Settings.

Encrypted SoundCloud tracks require a packaged, production VMP-signed build, not development mode. The previous README reports that earlier published installers were unsigned; do not assume an old installer supports encrypted tracks. See the [DRM signing runbook](../apps/desktop/DRM-SIGNING.md).

## YouTube and local files

YouTube playback uses the official embedded player. Ads may play without YouTube Premium; videos that prohibit embedding are skipped. These restrictions do not affect local files or other providers.

## Sessions and network access

Provider sessions, playlists, listening history, and preferences are stored on this device. Music requests still go to the selected provider. Discord presence is sent only when enabled. Matching environment variables can also provide provider configuration; do not commit credentials into documentation or source files.

AMP is a personal project. Follow the providers' terms, access only content you are entitled to use, and do not redistribute builds.
