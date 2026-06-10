# misskey-aloudy

A web application that reads Misskey timelines aloud using VoiceVox text-to-speech. Listen to your timeline while multitasking.

## Features

- **Real-time Timeline Narration**: New notes are read aloud as they arrive
- **VoiceVox Integration**: High-quality Japanese text-to-speech
- **Multiple Timelines**: Global, Home, Local, and custom lists (Phase 2)
- **Browser-based**: No installation required, works in modern browsers

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build
```

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
