# AMP - Advanced Music Player

[![CI](https://github.com/tbhtho/Advanced-Music-Player/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tbhtho/Advanced-Music-Player/actions/workflows/ci.yml) [![License: not declared](https://img.shields.io/badge/License-not_declared-lightgrey.svg)](#license) ![Windows x64 release](https://img.shields.io/badge/platform-Windows_x64-blue.svg)

<img src="apps/desktop/build/icon.png" align="right" width="72" alt="AMP play-button icon">

One library and playback queue for Spotify, SoundCloud and your own music.

**[Download AMP 0.3.7 for Windows](https://github.com/tbhtho/Advanced-Music-Player/releases/download/v0.3.7/AMP.Setup.0.3.7.exe)** · [Release notes and checksums](https://github.com/tbhtho/Advanced-Music-Player/releases/tag/v0.3.7)

<p align="center">
  <a href="docs/screenshots/library-0.3.7.png"><img src="docs/screenshots/library-0.3.7.png" width="960" alt="AMP 0.3.7 showing a combined Spotify and SoundCloud Library, a mixed queue and continuous glass surfaces"></a><br>
  <sub>Library and Now Playing, captured from 0.3.7 with fictional demo tracks.</sub>
</p>

<table>
  <tr>
    <td width="50%"><a href="docs/screenshots/home-0.3.5.png"><img src="docs/screenshots/home-0.3.5.png" width="100%" alt="AMP Home showing six daily mixes and song-seeded stations"></a><br><sub>Daily mixes and song stations. Earlier 0.3.5 interface.</sub></td>
    <td width="50%"><a href="docs/screenshots/playlists-0.3.5.png"><img src="docs/screenshots/playlists-0.3.5.png" width="100%" alt="AMP playlist editor containing Spotify and SoundCloud tracks in one Evening collection"></a><br><sub>Mixed-provider playlists. Earlier 0.3.5 interface.</sub></td>
  </tr>
</table>

<details>
<summary>Settings and provider connections</summary>
<p align="center">
  <a href="docs/screenshots/settings-0.3.5.png"><img src="docs/screenshots/settings-0.3.5.png" width="960" alt="AMP Settings showing sample provider connections, appearance preferences and a local music folder"></a><br>
  <sub>Connections, appearance and local music. Earlier 0.3.5 interface.</sub>
</p>
</details>

These are real frontend captures using sample libraries and account states. They do not demonstrate live playback. Select an image for full size. [Capture details](docs/screenshots/README.md).

## Get started

1. Download and run **AMP.Setup.0.3.7.exe**, then launch AMP.
2. Open **Settings** to connect Spotify or SoundCloud, or add a folder of local audio files.
3. Search for music, save tracks to your library, and build a playlist or queue across sources.

Spotify sign-in uses AMP's bundled public app configuration. Development-mode access requires an eligible, allowlisted account; playback requires Premium. SoundCloud search can work without signing in. Windows publisher signing is not configured, so SmartScreen may show a warning. [Provider setup and playback notes](docs/PROVIDER-NOTES.md).

## Features

- **Search and local music:** Spotify, SoundCloud and existing YouTube search, plus local MP3, M4A, FLAC, WAV and OGG files.
- **Library, playlists and queue:** combine sources, reorder the queue, shuffle, seek and adjust volume by provider. A compact mini-player and media-key controls keep playback close.
- **Likes and saves:** Spotify and SoundCloud controls in the player bar, track lists, search results and playlists.
- **Discovery:** song-seeded stations and daily mixes scored by tempo, genre and mood; artist and album pages, with mood and genre filters.
- **Listening stats:** on-device listening history and statistics.
- **SoundCloud downloads:** audio downloads for eligible tracks.
- **Appearance:** continuous glass surfaces, cover-derived accents and an optional Windows audio pulse.
- **Discord:** optional Rich Presence.

Spotify crossfade is unavailable. YouTube uses its existing embedded player: ads may play without Premium, and videos that prohibit embedding are skipped. Encrypted SoundCloud tracks need the packaged production build. Higher CPU and memory use during longer sessions remain under investigation.

[Provider notes](docs/PROVIDER-NOTES.md) · [Development and packaging](docs/DEVELOPMENT.md) · [Release workflow](RELEASING.md)

## License

No repository-wide license is declared. Source access does not grant redistribution permission; do not redistribute builds. Follow provider terms and retain third-party notices.
