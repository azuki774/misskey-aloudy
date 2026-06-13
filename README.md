# misskey-aloudy

[![CI](https://github.com/azuki774/misskey-aloudy/actions/workflows/ci.yml/badge.svg)](https://github.com/azuki774/misskey-aloudy/actions/workflows/ci.yml)

A web application that reads Misskey timelines aloud using VoiceVox text-to-speech. Listen to your timeline while multitasking.

## Features

- **Real-time Timeline Narration**: New notes are read aloud as they arrive
- **VoiceVox Integration**: High-quality Japanese text-to-speech
- **Multiple Timelines**: Global, Home, Local, and custom lists (Phase 2)
- **Browser-based**: No installation required, works in modern browsers

## Quick Start

The dev environment is provided by the Nix flake (`flake.nix`) and activated automatically by [direnv](https://direnv.net/) via `.envrc` (`use flake`).

```bash
# Prerequisite: direnv must be installed and its shell hook enabled.
# In zsh: eval "$(direnv hook zsh)" in ~/.zshrc.

# 1. Authorize the .envrc in this repository (first time only)
direnv allow

# 2. Once direnv has activated the shell, run commands directly:
bun install
bun run dev
bun run build
```

## VoiceVox Engine

This app depends on a running [VoiceVox](https://voicevox.github.io/voicevox_engine/) engine to synthesize speech. The engine runs as a separate process on `http://localhost:50021` by default (configurable via `VOICEVOX_URL` in `.env`).

Note: `VOICEVOX_URL` is a server-only variable (no `PUBLIC_` prefix). The value is read on the server inside `src/lib/voicevox/client.ts` and never inlined into browser bundles. If you have an existing `.env` from before this rename, change `PUBLIC_VOICEVOX_URL` to `VOICEVOX_URL`.

### Running VoiceVox with docker compose

```bash
docker compose up -d voicevox
```

This starts the official `voicevox/voicevox_engine:cpu-latest` image and exposes it on port `50021`.

### Running VoiceVox directly

```bash
docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
```

### Synthesizing speech via the API

```bash
curl -X POST http://localhost:3000/api/speech \
  -H "Content-Type: application/json" \
  -d '{"text":"こんにちは","speaker":1}' \
  --output hello.wav
```

The response is a `audio/wav` body. The `speaker` field is optional and defaults to `1` (四国めたん ノーマル).

> **Note**: direnv activates `devShells.default` from `flake.nix`, which provides the `bun` binary. Do not use a system-installed Bun (CPU instruction set incompatibility, AVX2).
>
> Never run `nix develop` manually, and never use `nix develop -c bun <command>` one-liners — direnv has already exported the dev shell into your environment.

## Testing

```bash
bun test
```

Unit tests live next to source files (`*.test.ts`) and use `bun:test`.

## Manual Verification

A `Makefile` is provided for end-to-end smoke tests against the production build. These are useful when you want to verify the `POST /api/speech` endpoint behaves as expected without writing test code.

```bash
# No VoiceVox needed: builds the app, boots the production server on
# PORT=4398, and asserts 400/400/400/502 responses from /api/speech.
make smoke

# Real audio synthesis. Requires a running VoiceVox engine.
docker compose up -d voicevox
make with-voicevox            # synthesizes 'こんにちは' to /tmp/misskey-aloudy-smoke.wav
make play-audio               # plays the WAV with ffplay / aplay / afplay
```

Useful variables: `PORT=...`, `HOST=...`, `TEXT=...`, `SPEAKER=...`, `AUDIO_FILE=...`. See `make help` for the full list.

## Documentation

- [Product Requirements](docs/requirements.md) — Feature specifications and roadmap
- [Project Rules](AGENTS.md) — Development guidelines and conventions

## Tech Stack

- **Framework**: Astro
- **Runtime**: Bun
- **TTS Engine**: VoiceVox
- **Dev Environment**: Nix flakes with direnv

## Deployment

```bash
# Build Docker image
docker build -t misskey-aloudy .

# Run container
docker run -p 3000:3000 misskey-aloudy
```

## License

MIT
