# Product Requirements Document — misskey-aloudy

## Table of Contents

- [Overview](#overview)
- [Goals](#goals)
- [Target Users](#target-users)
- [Functional Requirements](#functional-requirements)
  - [MVP (Phase 1)](#mvp-phase-1)
  - [Phase 2](#phase-2)
  - [Out of Scope](#out-of-scope)
- [Non-Functional Requirements](#non-functional-requirements)
- [Technical Architecture](#technical-architecture)
- [Deployment](#deployment)
- [Roadmap](#roadmap)

## Overview

A web application that reads Misskey timelines aloud using VoiceVox text-to-speech. Users can listen to their timeline while multitasking.

## Goals

- Enable hands-free Misskey consumption
- Provide real-time timeline narration without reading past posts
- Support Japanese speakers primarily

## Target Users

Users who want to listen to Misskey timelines while doing other tasks (cooking, exercising, commuting, etc.).

## Functional Requirements

### MVP (Phase 1)

| Feature | Description |
|---------|-------------|
| Global Timeline | Read notes from the global timeline |
| Real-time Updates | Stream new notes via WebSocket or polling |
| VoiceVox TTS | Convert note text to speech using VoiceVox API |
| Playback Controls | Play, pause, skip current note |
| No Authentication | Read public timeline without login |

### Phase 2

| Feature | Description |
|---------|-------------|
| User Authentication | Login with Misskey API token |
| Home Timeline | Read user's home timeline |
| Local Timeline | Read instance-local timeline |
| List Timeline | Read specific user lists |
| Channel Support | Read channel posts |
| Note Filtering | Skip replies, renotes, or specific users |
| Voice Selection | Choose VoiceVox speaker |
| Reading Speed | Adjust playback speed |

### Out of Scope

- Reading past notes (only new notes are read)
- Multi-language support (Japanese only for now)
- Note composition (read-only)

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Latency | < 2 seconds from note arrival to speech start |
| Deployment | Docker container (self-hosted) |
| Security | API tokens stored in browser only (no server-side storage) |
| Browser Support | Modern browsers with WebSocket and Web Audio API |

## Technical Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                    │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │  Astro  │──│WebSocket │──│  Misskey  │  │
│  │   UI    │  │  Client  │  │  Server   │  │
│  └────┬────┘  └──────────┘  └───────────┘  │
│       │                                     │
│       │ HTTP                                │
│       ▼                                     │
│  ┌──────────────────┐                       │
│  │  App Server      │                       │
│  │  (Astro/Node 24) │                       │
│  │   /api/speech    │─── HTTP ──▶ VoiceVox  │
│  └──────────────────┘                       │
└─────────────────────────────────────────────┘
```

### Data Flow

1. Browser connects to Misskey instance via WebSocket
2. New notes arrive in real-time
3. Browser POSTs note text to the app's own `/api/speech` endpoint
4. The app server calls VoiceVox `/audio_query` and `/synthesis` and returns the resulting `audio/wav` bytes to the browser
5. Browser plays the audio via the `VoiceVoxPlayer`

> The browser does not call VoiceVox directly in the MVP. All synthesis is mediated by the app server so that input validation, secrets management (`VOICEVOX_URL` stays server-side), and future auth live in one place.

### Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | Astro + TypeScript | Web UI, WebSocket client, calls `/api/speech` for synthesis |
| App Server | Astro (Node 24, server output) | Hosts the API routes (`/api/speech`) and proxies to VoiceVox |
| TTS Engine | VoiceVox | Text-to-speech synthesis; reached only via the app server in the MVP |
| Runtime | Node 24 | JavaScript runtime |
| Package Manager | pnpm | Dependency management |
| Container | Docker | Application packaging |

## Deployment

### Docker

```dockerfile
# Build stage
FROM node:24-slim AS builder
WORKDIR /app
COPY . .
RUN corepack enable pnpm && pnpm install --frozen-lockfile && pnpm run build

# Production stage
FROM node:24-slim
WORKDIR /app
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server/entry.mjs"]
```

### VoiceVox

VoiceVox runs as a separate container. The browser accesses it directly.

```yaml
# docker-compose.yml example
services:
  app:
    build: .
    ports:
      - "3000:3000"
  
  voicevox:
    image: voicevox/voicevox_engine:cpu-latest
    ports:
      - "50021:50021"
```

## Roadmap

| Phase | Milestone | Status |
|-------|-----------|--------|
| 0 | Project setup, dev environment | ✅ Done |
| 1 | MVP: Global timeline + VoiceVox | 📋 Planned |
| 2 | User authentication + multiple timelines | 🔲 Backlog |
| 3 | Advanced features (filtering, voice selection) | 🔲 Backlog |
