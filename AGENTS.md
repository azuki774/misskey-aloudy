# Project Rules — misskey-aloudy

## Overview

A website that reads out Misskey's timeline. Built with Astro and Bun, using Nix (flake.nix) for the development environment.

## Tech Stack

- **Framework**: Astro
- **Runtime**: Bun
- **Package Manager**: Bun
- **Dev Environment**: Nix flakes (flake.nix)
- **Language**: TypeScript

## Rules

### General

- All documentation and comments MUST be written in English.
- Do NOT commit secrets, API keys, tokens, or credentials. Use `.env` files locally (see `.env.example`).
- Do NOT commit `.env` files — they are gitignored.

### Development

- Use `bun` for all package management (install, add, remove, run).
- Use `flake.nix` for the development shell. Run `nix develop` to enter it.
- Run the linter before every commit. Pre-commit hooks enforce this.

### Code Style

- Use TypeScript with strict mode.
- Follow existing code conventions and naming patterns.
- Keep components small and focused.

### Git

- Pre-commit hooks run the linter automatically. Do NOT bypass them.
- Never push secrets. Double-check staged files before committing.

## Commands

| Command              | Description               |
| -------------------- | ------------------------- |
| `bun install`        | Install dependencies      |
| `bun run dev`        | Start dev server          |
| `bun run build`      | Build for production      |
| `bun run preview`    | Preview production build  |
| `bun run lint`       | Run linter                |
