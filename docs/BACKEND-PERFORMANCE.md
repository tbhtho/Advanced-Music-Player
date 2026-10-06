# Responsiveness and search measurements

This branch makes repeated provider searches share work, cancels obsolete searches, returns early results as providers finish, moves local metadata parsing off the main process, bounds retained caches, and makes the cached library usable before remote library synchronization finishes. Station composition rejects weak song matches and unrelated recommendations. The original provider strategies, navigation, controls, playback contracts, DRM configuration, and session validation remain in place.

Renderer search/station internals and restrained neutral glass styling were subsequently authorized by the owner. The styling keeps the existing layout, uses one native window material, and provides an opaque fallback. Purple in the reference was external desktop wallpaper; no purple wallpaper was added to AMP.

YouTube playlist-link import and Apple Music expansion were cancelled before delivery. Their partial metadata classes remain disconnected work in progress, with no new controls, gateway routes, or runtime instances. See [PROVIDER-WIP.md](PROVIDER-WIP.md). Existing YouTube search/playback remains available.

## Method

Baseline: public source commit `59cf03567b624572a24b8fee7d982589e3cb16dd`. Both versions used the same installed dependencies. Measurements were taken on Windows on 2026-10-06 with three interleaved samples per source/mode. [performance-measurements.json](performance-measurements.json) contains the medians, ranges, and every raw sample; no slow baseline sample was discarded.

Backend fixtures import the actual source classes through a test-only loader. They use Node 24.18.0 with explicit garbage collection, 15 ms synthetic network latency, synthetic cache records, and 120 generated WAV files. Network adapters are replaced by deterministic fixtures; Electron network calls fail closed. These measurements exercise request counts, blocking, retained memory, and file work, rather than the real providers' service latency.

The desktop fixture builds the actual React application with a test-only preload and synthetic sessions, 120 cached tracks, fake provider responses, and external network access denied. It launches castLabs Electron `41.10.7+wvcus` in a disposable profile, uses an offscreen window capped at 60 fps, and never loads the production main process, CDM, real accounts, capture, or playback. Opaque and glass runs both exercise the actual window-material helper. The helper selected/applied acrylic on the measured Windows 11 system.

## Results

Values below are medians of three samples. Times are milliseconds unless stated otherwise.

| Fixture | Baseline | Branch | Meaning |
| --- | ---: | ---: | --- |
| Spotify cold operation discovery | 155.20 | 93.34 | Same nine requests; bundle reads bounded to two concurrently. |
| Sixteen identical main-process searches, each provider | 16 requests | 1 request | Spotify client-token requests also fall from 16 to 1. No settled-result cache or cross-session sharing was introduced. |
| Eight identical renderer Spotify searches | 8 requests | 1 request | Shared authenticated reads and refresh work. |
| Desktop first search results, glass | 155.10 | 46.70 | Early provider results become usable. |
| Desktop complete search, glass | 155.10 | 155.30 | Same final 30 results and provider order; single-provider response latency is not claimed to improve. |
| Cached renderer ready, glass | 541.60 | 132.00 | Session validation finishes first; remote library sync continues afterward. All 120 cached tracks are present. |
| Local scan main-loop maximum gap | 127.02 | 15.57 | Tag parsing runs in a disposable worker. |
| Local scan, fresh manager with warmed OS/dependency caches | 260.23 | 229.42 | Worker setup means cold completion remains environment-dependent. |
| Repeated unchanged local scan | 68.73 | 18.68 | Validated metadata avoids tag reads and cache rewrites. |
| Cache growth, 3,000 large records | 68.38 | 18.36 | Maximum main-loop gap falls from 56.50 to 16.01. |
| Cache growth retained heap delta | 17.91 MiB | 3.48 MiB | Retention is bounded by both count and estimated bytes. |
| Legacy 18.50 MiB cache retained heap delta | 18.75 MiB | 3.19 MiB | Large-file hydration runs in a worker and trims before returning entries. |

The most severe local-library problem was concurrent scanning: overlapping calls incremented the generation and repeatedly caused each other to restart. Three overlapping scans took **326.03 / 39,202.10 / 68,366.89 ms** in the baseline, versus **19.17–21.78 ms** on the branch. The branch shares one scan promise and restarts only when configuration actually changes. All runs returned 120 tracks. This baseline is highly variable, so a single percentage would obscure the finding.

Large-cache hydration has a deliberate tradeoff: completion rises from 33.81 to 109.98 ms and total CPU from 31 to 125 ms; worker allocation increases peak RSS from about 131 to 151 MB. The maximum sampled main-loop gap drops from 20.71 to 15.58 ms, and retained heap falls substantially. The optimization targets main-process responsiveness and retained memory, not faster large-file completion or lower peak process memory.

Memory-only cache changes now produce no persistence file, rather than an empty two-byte snapshot. Spotify authenticated cache keys use a token hash and remain memory-only. SoundCloud raw track metadata is memory-only because it can contain track authorization; legacy sensitive provider records are excluded during hydration. Token refresh and account-generation guards prevent old results crossing account changes. Existing provider cooldowns remain; Spotify honors the full Retry-After value and aborted callers do not erase a cooldown.

## Desktop and visual checks

Home, Search, and Playlists were captured and inspected at 1280 × 860. The fixture asserts no overflow, renderer errors, missing cached tracks, stale query results, wrong provider ordering, or incomplete search results. It checks cancellation through the renderer bridge and main gateway. The final glass run passed these assertions. Existing tabs and controls remain; no new YouTube import or Apple controls are present.

Ordinary menu commits were approximately unchanged: 15.6 ms baseline, 15.7 ms opaque, and 16.2 ms glass. Median frames were 16.7 ms in all modes, close to the imposed 60 fps cap. One baseline sample had a 7.6-second navigation/frame stall; its cause was not isolated and it remains in the raw data. These results do not establish a general menu FPS improvement.

Renderer working set was 134,988 KiB baseline, 130,592 opaque, and 132,420 glass. GPU working set was 169,384 / 163,972 / 166,904 KiB, while GPU private bytes **increased** from 395,052 to 407,892 / 405,356 KiB. These small and mixed changes do not establish an overall app RAM or GPU-memory reduction. No CSS backdrop blur layers are used, and the idle full-window animation no longer retains a permanent will-change hint.

Offscreen screenshots capture AMP pixels and alpha, not the external desktop or the complete DWM blur. Foreground native-backdrop appearance/cost, actual user wallpaper, first-ever OS/dependency-cold startup, production CDM startup, real account refresh, playback, and real provider latency remain unmeasured. The installed AMP 0.3.4 binary uses an older source/runtime and was not launched, restarted, or upgraded. These are updated-source results.

Native material selection follows [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window) and [nativeTheme](https://www.electronjs.org/docs/latest/api/native-theme): acrylic on supported Windows, under-window vibrancy on macOS, and opaque fallback on unsupported systems or high-contrast/reduced-transparency preferences. macOS appearance was not tested on this Windows host. Actual YouTube library transport does not expose AbortSignal, so obsolete YouTube responses are discarded without physically stopping that transport.

## Reproduce

From the branch root with frozen-lock dependencies installed:

```powershell
corepack pnpm verify
corepack pnpm audit --json
node --expose-gc apps/desktop/scripts/benchmark-backend.mjs
$env:AMP_BENCH_MATERIAL = 'opaque' # or 'glass'
$env:AMP_BENCH_OUTPUT = Join-Path $env:TEMP 'amp-desktop-review'
corepack pnpm benchmark:desktop
```

To measure the baseline using the same fixture scripts/dependencies, set `AMP_BENCH_SOURCE` to a separate checkout of the baseline commit before running either benchmark. Use separate output directories per mode and retain each sample. Remove that environment variable for branch measurements. `AMP_BENCH_REUSE_BUILD=1` reuses only an already-built fixture of the same source version. The desktop harness removes only its validated disposable profile directory. It may need permission to launch its hidden, isolated Electron child when the sandbox blocks GPU/renderer process creation.

Release validation also reproduced a Windows 8.3 directory-alias failure under Node 22.18.0. Local audio and artwork checks now use the same native canonical paths as scanning, while retaining the folder whitelist. A regression verifies that retargeting a configured directory alias rejects its previously scanned audio.

Regression gates passed: the existing core, feature, mix, playback-guard, captcha and remote-like suites; **32 additional backend tests**; TypeScript; and the production build. Full dependency audit reports **zero vulnerabilities**. Dependencies, lockfile, signing/release configuration, stats/export features, license choice, and existing migration/presentation work were not changed. The original dirty F: checkout was preserved; implementation uses an isolated Git worktree.
