# AMP 0.3.7 memory, flicker, and continuous glass findings

Measured on Windows on 2026-10-06. The initial candidate was reviewed locally; the user subsequently approved release 0.3.7 after the final track-bloom polish.

## Source and preservation

- Working copy: `F:\Development\Finished\AMP-development`, branch `amp-memory-glass`.
- Exact baseline: local functional 0.3.6 commit `425a17901c220ae85f35c69ca89617e8cbcf9703`, imported from the previous `amp-spotify-patch` checkout. No GitHub pull or unapproved presentation branch merge was used.
- Original MuSync HEAD: `a18b1859b9aaf4d0bc1831344c0fdc541f7509ae`. Its five dirty core files were inventoried and SHA256 hashed before editing. Their normalized contents match original HEAD; their line endings remain untouched. The final SHA256 check matches all five original bytes.
- The isolated copy has its own Git objects (`git fsck` passed; no objects alternates remain). Source and development output are beside MuSync, not under Documents\Codex.
- The completed shared-request/cache/local-library improvements, public Spotify client-ID bundling, and OAuth readiness checks are inherited from exact 0.3.6. Their source, core package, lockfile, provider implementations, and auth grants were not changed by this task.
- BloxMesh was read only. Its current attached-canvas materials/layout and Windows acrylic policy were references. No BloxMesh files were edited.
- Release 0.3.7 publication was approved after design review. No replacement installation, new provider integration, autoplay feature, or game controls were performed. YouTube and Apple expansion remain deferred.

## Concrete process and memory findings

The initial read-only Windows process snapshot found no running AMP or Electron app. The reported fourteen entries therefore could not be classified from the user's live session. Do not call them fourteen app instances.

Source enforces a single-instance lock per profile. Development and installed profiles intentionally differ, so one of each can coexist. Spotify uses one shared Web Playback SDK instance. SoundCloud can retain a stream-resolution browser page and a separate Local Connect likes page; its widget fallback also uses an iframe. Chromium adds GPU, network, media/CDM and site-isolated renderer helpers. The actual fourteen-entry case still needs the process recorder while that case is running.

One initial 0.3.6 offline fixture sample had four processes and 456.8 MiB summed working sets, 457.6 MiB private committed bytes. The more extensive matched review sample had 484.3 / 495.9 MiB; the candidate's corresponding sample had 498.6 / 456.3 MiB. These are single samples, with mixed changes, not proof of an app-wide RAM reduction. Final glass/opaque fixture runs overlapped and are suitable for layout assertions, not controlled performance comparisons.

Production main/renderer/CDM startup was also exercised for 35 seconds in an empty isolated profile, without accounts or playback. The pre-native-helper build had four processes, 495.4 MiB summed working sets and 256.3 MiB private committed bytes. The completed candidate's fresh snapshot at 36.9 seconds had four processes, **509.5 MiB summed working sets and 271.6 MiB private committed bytes**. Raw snapshots are in `artifacts/memory-glass/production-idle-final/measurements.json`. This remains a development executable, not a packaged VMP-signed playback acceptance test.

Working sets include shared pages repeatedly when summed; private committed bytes are not physical RAM or Task Manager's private working-set column. No 100–250 MB target, percentage RAM improvement, or fix of the user's 1–1.5 GB session is claimed.

Run the recorder while the reported case exists:

```powershell
cd F:\Development\Finished\AMP-development
& .\apps\desktop\scripts\Measure-AMP.ps1 -Samples 12 -IntervalSeconds 5
```

It records main instances, descendant roles and memory totals without full command lines or credentials. It does not start, stop or modify apps. If Windows denies process-query access, run it with an account allowed to inspect those processes.

## Implemented fixes

- SoundCloud's resolver and Local Connect likes browser pages retire after two idle minutes. Leases protect overlapping operations and human-check work. Persistent authenticated partitions remain; the helper is recreated on demand. No playback iframe or media stream is destroyed by this timer. Actual SoundCloud acceptance still needs packaged/live testing.
- Audio-reactive capture is released after pause/failed play and immediately when the app is hidden or the mode is disabled. Generation checks stop streams that arrive after cancellation. Ordinary paused navigation/playlist clicks do not prime capture. The analysis graph remains separate from provider playback.
- Repeated native-theme notifications leave an already applied backdrop alone. Asynchronous material changes serialize, and failed native application stays on an opaque fallback until a real preference change. No repeated persistent native helper is created.
- Route pages render fully opaque immediately. On unchanged 0.3.6 the first post-navigation frame was only 0.01–1.1% opaque in all 15 switches; candidate frames were 100% opaque in all 15. This directly reproduces and removes a navigation-related background flash. Recurring flicker during continuous playback is not yet reproduced.
- Library/main canvas has zero outer margin and zero corner radius. Sidebar, track list, Now Playing and transport use one continuous surface family, with subtle separators. Toolbar inset is retained for readability; the list spans the canvas. AMP's identity and provider colors remain.

## Native preview and verification

The real React application runs in a visible castLabs Electron 41.10.7+wvcus window. Native Windows acrylic uses the same bounded composition policy as BloxMesh, with `thickFrame`/resizing enabled and an opaque failure/accessibility fallback. The standard Electron backdrop call alone did not establish the requested transparent appearance on this host. The one-shot native helper has an eight-second timeout and exits after application; panels add no CSS backdrop filters.

The final preview is an isolated **synthetic-data fixture**: 120 tracks and a paused synthetic queue; provider network, credentials, capture analysis and audio playback are disabled. A separate temporary test-backdrop window helps visual inspection and adds one fixture renderer. It is not the user's wallpaper and is not production app overhead. Native window capture verifies UI rendering; window capture does not reliably include the external desktop/compositor blur. A screen capture returned an unrelated desktop despite Electron's focus flag; that file was discarded and that capture path removed. Full visible desktop-blur appearance remains a human visual acceptance check.

Current preview capture: `artifacts/memory-glass/balanced-ambient/native-window.png`. The earlier native-thick-frame capture remains as review history.

```powershell
cd F:\Development\Finished\AMP-development
$env:AMP_BENCH_OUTPUT = Join-Path $PWD 'artifacts\memory-glass\balanced-ambient'
$env:AMP_BENCH_MATERIAL = 'glass'
$env:AMP_BENCH_VISIBLE = '1'
$env:AMP_BENCH_HOLD = '1'
$env:AMP_BENCH_ACCENT = 'artwork'
node .\apps\desktop\scripts\review-desktop.mjs
```

Window minimize/maximize/close controls and navigation/filter/selection interactions work in the fixture. Playback/account actions are intentionally excluded. Closing the preview also closes its own test backdrop and removes only its disposable profile.

Validation passed:

- `corepack pnpm verify`: existing queue, feature, mix, playback-guard, captcha and remote-like tests; 32 backend regressions; eight desktop-configuration tests; seven resource/material regressions; TypeScript; production renderer/main/preload build and public config bundling.
- Fifteen ordinary route switches plus 60 interrupted switches; Library settles correctly with no horizontal overflow. Glass and opaque fallback layouts passed. No renderer errors.
- Native preview captured and inspected at 1280 × 860. All source/renderer changes remain editable in the nearby copy. Production output: `apps/desktop/dist` and `apps/desktop/dist-electron`.
- `git diff --check`, isolated Git object integrity, and all five original byte hashes passed.

Build output and assertions do not establish live Spotify refresh/playback, real SoundCloud helper recreation, encrypted SoundCloud playback, the fourteen-process case, or macOS compositor behavior. Working 0.3.6 auth/provider source is preserved; no sessions were copied or inspected. The next acceptance run should record idle, Spotify playback, SoundCloud playback, pause/hide and repeated provider switches in the user's actual 0.3.6 case.

## Runtime direction

There is no evidence yet that migration away from Electron is necessary. Spotify's official SDK is a browser player and requires encrypted-media support; AMP's encrypted SoundCloud path also depends on castLabs production CDM/VMP signing. A Rust/WebView alternative has not been verified against either path, so no migration was started. Preserve the working playback implementation until a separate compatibility spike succeeds.

References: [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk), [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window), AMP's existing `DRM-SIGNING.md`, and BloxMesh's read-only native material source.

## Reconnection check at 17:28 UTC

Execution access remained available and the existing source/build/evidence were preserved. All five original MuSync byte hashes were checked again and still match. Two fresh process samples found only the existing synthetic preview: one app instance, five processes (main, GPU, network utility, AMP renderer, and test-backdrop renderer), with stable 508.3 MiB summed working sets and 449.1 MiB private committed bytes. The actual installed fourteen-process case was absent. Raw data: `artifacts/memory-glass/reconnection-process-check.json`.

The refreshed CUA inventory exposed Brave/Codex browsers but no native applications; `cua.listWindows` was unavailable in the current runtime. This is a native UI acceptance limitation, not loss of shell execution or saved implementation. No prior work was restarted. Live high-memory/playback-flicker acceptance remains pending reproduction in the normally installed app; no user app or music was terminated.


## Updated visual balance and animated lighting

All five user-provided screenshots were retrieved through Library and inspected as actual pixels. Their search controls, cream square play buttons, queue edge stripes and repeated placeholder covers informed this refinement.

The shell tint is now 84% opaque (previously 56%), retaining a unified surface with quieter desktop bleed-through. A single soft light field moves through small transforms over 38 seconds; it follows the existing artwork/audio hue rather than a fixed purple. Static stays still. The animation has no CSS blur, no JavaScript frame loop, and pauses when hidden. Reduced-motion preferences stop it; reduced transparency and forced colors remove it. The existing audio-reactive choice and capture cleanup remain intact.

Search fields and provider chips use translucent gradients and fine edges. Play controls share a softly lit circular material. Queue stripes are replaced with low-opacity Spotify/SoundCloud blooms, and Library rows use the same treatment. Visible provider names, pressed/current states, accessible names and focus cues preserve non-color identification.

The offline fixture now has twelve original vector covers and fictional artist/song names (Afterlight by Mira Vale, Saltwater Lines by Low Tide Society, etc.). These exist only in `apps/desktop/scripts/demo-catalog.mjs` and the synthetic preview; production artwork fallback and real libraries were not altered.

Current evidence is in `artifacts/memory-glass/balanced-ambient/measurements.json`: all 15 normal routes render at opacity 1; 60 interrupted routes settle Library without overflow; no renderer errors or CSS blur layers. Actual renderer checks confirm moving transforms, Static and reduced-motion stopping the animation, hidden-window pause and visible-window resume. Typecheck, production build and all seven existing resource/material regressions passed. Original MuSync's five uncommitted file hashes remain unchanged.

The native preview remained open at delivery as PID 4356, using `apps/desktop/scripts/desktop-review-host.cjs` with `artifacts/memory-glass/balanced-ambient/fixture-spec.json`. The superseded fixture was closed; only its owned processes were cleaned. To launch a new disposable preview, use the command above from `F:\Development\Finished\AMP-development`.

The revised native-window PNG was successfully saved to Library as `libfile_b8e8cbfef3988191ad46e48349962374`. This is a still capture of the running native window; it cannot demonstrate motion or verify wallpaper blur. The visible preview retains the temporary test backdrop, synthetic data, blocked provider requests and disabled playback. No new memory benchmark, provider acceptance claim, installer, commit, release or publication was made during this visual refinement.


## Release 0.3.7 validation

The final requested polish narrows track blooms and reduces idle/active alpha from 8.5/16% to 3.5/6.5%. The approved layout, shell opacity and animated ambient layer are unchanged. Both package manifests are versioned 0.3.7; the registered Spotify public configuration and readiness source still match the user's successfully tested local 0.3.6 baseline.

The complete source verification passed again, and the repository's dependency audit reported zero vulnerabilities. The final native fixture passed the navigation, motion, accessibility-preference and visibility checks. The latest screenshot is `docs/screenshots/library-0.3.7.png`, captured from fictional demo data.

A Windows x64 NSIS installer was built in `artifacts/amp-0.3.7-release/AMP.Setup.0.3.7.exe`. The actual castLabs EVS verifier confirms a valid production streaming VMP signature. This is stronger than counting signature files; it still does not prove provider subscription playback. Windows Authenticode publisher signing is not configured.

The unchanged packaged executable and app.asar were launched in an empty disposable profile using `apps/desktop/scripts/review-packaged-startup.mjs`. The debugger isolated app/session/log paths and suppressed global protocol/media-key registration only in the test process. Runtime identifies the app as packaged 0.3.7, resolves the bundled Spotify identifier without an environment or user override, enables the Spotify onboarding button, and initializes Widevine 4.10.3050.0. Real first-run Skip plus 15 normal and 60 interrupted routes passed; the Library is flush, opacity stays 1, and there were no renderer exceptions. The test app exited without installation or account access.

The installer payload's executable, VMP signature and app.asar match the tested unpacked package byte-for-byte; its extracted executable also passes EVS verification. Archive inspection confirms renderer/preload and public configuration are present, with no `.env` files or preview/test scripts bundled. The installer checksum is attached to [the 0.3.7 release](https://github.com/tbhtho/Advanced-Music-Player/releases/tag/v0.3.7).

Source push, version tag and release assets are authorized. No claim is made that the reported fourteen-process / 1–1.5 GB playback case has been resolved: that actual case remains unreproduced. Live Spotify/SoundCloud playback acceptance remains distinct from signing, configuration, startup and navigation verification.
