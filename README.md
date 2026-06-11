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

> **Note**: direnv activates `devShells.default` from `flake.nix`, which provides the `bun` binary. Do not use a system-installed Bun (CPU instruction set incompatibility, AVX2).
>
> Never run `nix develop` manually, and never use `nix develop -c bun <command>` one-liners — direnv has already exported the dev shell into your environment.

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
