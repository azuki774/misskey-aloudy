# Project Rules — misskey-aloudy

## Overview

A website that reads out Misskey's timeline. Built with Astro and Bun, using Nix (flake.nix) for the development environment.

## Project Structure

```
misskey-aloudy/
├── docs/                    # Documentation
│   └── requirements.md      # Product requirements and roadmap
├── src/                     # Source code
│   ├── components/          # Reusable UI components
│   ├── layouts/             # Page layouts
│   └── pages/               # Route pages
├── public/                  # Static assets
├── AGENTS.md                # This file (development rules)
├── README.md                # User-facing documentation
├── flake.nix                # Nix development environment
├── package.json             # Dependencies and scripts
└── tsconfig.json            # TypeScript configuration
```

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

- **Use Nix dev shell for all commands**: Run `nix develop` to enter the shell, or use `direnv allow` to auto-activate.
- **Never use system-installed Bun**: Always use the Bun provided by Nix dev shell.
- When in the dev shell, run commands directly: `bun install`, `bun run dev`, `bun run lint`.
- For one-off commands without entering the shell: `nix develop -c bun <command>`.
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
