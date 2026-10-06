# Developing AMP

Use Node.js 22.18 or later, below version 26, with Corepack and pnpm 10.11.0, as declared in the repository's package.json. Run these commands from the repository root:

```bash
corepack pnpm install
corepack pnpm dev
```

Configure providers in Settings using the [provider setup notes](PROVIDER-NOTES.md).

## Verify changes

```bash
corepack pnpm verify
```

This runs the project's tests, type checks, and build. It does not establish that provider sign-in or live playback works in a packaged app; verify affected flows with the appropriate account and build before claiming them ready.

## Build a Windows installer

```bash
corepack pnpm --filter @amp/desktop dist
```

Encrypted SoundCloud audio requires a packaged, production VMP-signed build. Development mode cannot play those tracks. Follow the [DRM signing runbook](../apps/desktop/DRM-SIGNING.md) and [release workflow](../RELEASING.md) for signing and release requirements.

## Source layout

- `apps/desktop`: Electron main process and React renderer.
- `packages/core`: shared models and the cross-provider queue engine.
