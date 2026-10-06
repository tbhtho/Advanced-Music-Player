<p align="center">
  <img src="apps/desktop/build/icon.png" width="112" alt="AMP play-button icon">
</p>

# AMP — Advanced Music Player

Spotify, SoundCloud, YouTube, and your local music in one library, with mixed playlists and a single queue.

## Get AMP

**Windows:** [Release downloads](https://github.com/tbhtho/Advanced-Music-Player/releases).

No installer has been published in this repository yet. To run the current source, follow the [development setup](docs/DEVELOPMENT.md). Release installers use the name `AMP Setup x.y.z.exe`.

## Quick start

1. Launch AMP and open **Settings** to connect the providers you want to use.
2. Search SoundCloud and YouTube without signing in, or connect Spotify with your own client ID. Spotify playback requires Premium.
3. Add tracks or your own audio files to the library, mix them into playlists, and play them from one queue.

See [provider setup and playback notes](docs/PROVIDER-NOTES.md) for account setup, browser-session handling, and provider limits.

## Features

- Search Spotify, SoundCloud, and YouTube together.
- Mix online tracks and local MP3, M4A, FLAC, WAV, and OGG files in playlists.
- Save likes on Spotify and SoundCloud from search, lists, playlists, or the player.
- Discover song-seeded radio and daily mixes, with artist and album pages and mood or genre filters.
- See listening stats recorded on this device.
- Download eligible SoundCloud audio and optionally show Discord Rich Presence.

## Playback notes

Spotify does not support crossfade in AMP. YouTube uses its official embedded player: non-Premium accounts may hear ads, and videos that block embedding are skipped. Encrypted SoundCloud tracks require a packaged, production VMP-signed build; development builds cannot play them.

AMP is a personal project. Use only content you are entitled to access, follow the providers' terms, and do not redistribute builds.

## Documentation

- [Provider setup and playback notes](docs/PROVIDER-NOTES.md)
- [Development and packaging](docs/DEVELOPMENT.md)
- [Release workflow](RELEASING.md)
- [SoundCloud DRM signing](apps/desktop/DRM-SIGNING.md)
