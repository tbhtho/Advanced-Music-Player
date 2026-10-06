<p align="center">
  <img src="apps/desktop/build/icon.png" width="112" alt="AMP play-button icon">
</p>

# AMP - Advanced Music Player

[![CI](https://github.com/tbhtho/Advanced-Music-Player/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tbhtho/Advanced-Music-Player/actions/workflows/ci.yml)
[![License: not declared](https://img.shields.io/badge/License-not_declared-lightgrey.svg)](#license)
![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)

Spotify, SoundCloud, YouTube, and your local music in one library, with mixed playlists and a single queue.

## Get AMP

**Windows:** [Download AMP 0.3.5](https://github.com/tbhtho/Advanced-Music-Player/releases/download/v0.3.5/AMP.Setup.0.3.5.exe) · [Release notes and checksums](https://github.com/tbhtho/Advanced-Music-Player/releases/tag/v0.3.5).

The installer uses production castLabs VMP signing. Windows publisher signing is not configured, so SmartScreen may show a warning. To run the current source, follow the [development setup](docs/DEVELOPMENT.md).

<p align="center">
  <a href="docs/screenshots/playlists-0.3.5.png"><img src="docs/screenshots/playlists-0.3.5.png" width="960" alt="AMP 0.3.5 playlist editor with compact controls and sample Spotify and SoundCloud tracks"></a><br>
  <sub>Mixed-provider playlists with compact controls.</sub>
</p>

<table>
  <tr>
    <td width="50%"><a href="docs/screenshots/home-0.3.5.png"><img src="docs/screenshots/home-0.3.5.png" width="100%" alt="AMP 0.3.5 Home showing daily mixes and song stations with sample tracks"></a><br><sub>Daily mixes and song stations.</sub></td>
    <td width="50%"><a href="docs/screenshots/settings-0.3.5.png"><img src="docs/screenshots/settings-0.3.5.png" width="100%" alt="AMP 0.3.5 Settings showing sample provider connections, appearance options and local music folders"></a><br><sub>Provider connections, appearance and local music.</sub></td>
  </tr>
</table>

Screenshots show the released 0.3.5 interface with sample tracks, playlists and account states. Select an image to view it at full size. [Capture details](docs/screenshots/README.md).

## Quick start

1. Launch AMP and open **Settings** to connect the providers you want to use.
2. Search SoundCloud and YouTube without signing in, or connect Spotify with your own client ID. Spotify playback requires Premium.
3. Add tracks or your own audio files to the library, mix them into playlists, and play them from one queue.

See [provider setup and playback notes](docs/PROVIDER-NOTES.md) for account setup, browser-session handling, and provider limits.

## Features

- Unified search across Spotify, SoundCloud and YouTube (SoundCloud + YouTube work without signing in)
- Play your own local audio files (mp3, m4a, flac, wav, ogg…) alongside everything else
- One library and playlists that freely mix every source
- Like/save on Spotify and SoundCloud, everywhere - player bar, lists, search, playlists
- Song-seeded radio and daily mixes, scored by tempo / genre / vibe
- Artist and album pages, mood + genre filters, on-device listening stats
- SoundCloud audio downloads for eligible tracks, optional Discord Rich Presence
- Windows audio-reactive gradient (beat-synced)

## Playback notes

Spotify does not support crossfade in AMP. YouTube uses its official embedded player: non-Premium accounts may hear ads, and videos that block embedding are skipped. Encrypted SoundCloud tracks require a packaged, production VMP-signed build; development builds cannot play them.

AMP is a personal project. Use only content you are entitled to access, follow the providers' terms, and do not redistribute builds.

## Documentation

- [Provider setup and playback notes](docs/PROVIDER-NOTES.md)
- [Development and packaging](docs/DEVELOPMENT.md)
- [Release workflow](RELEASING.md)
- [SoundCloud DRM signing](apps/desktop/DRM-SIGNING.md)

## License

No repository-wide license is declared in this checkout. Source access does not establish redistribution permission; retain provider terms and third-party notices.
