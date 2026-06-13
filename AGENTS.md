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
- Files under `docs/superpowers/` are local-only working notes (e.g. brainstorming specs, design notes). It is fine to create them locally for thinking, but they MUST NOT be committed, pushed, or included in pull requests. Add them to `.git/info/exclude` or simply leave them untracked.

### Development

- **All commands run inside the direnv-activated shell** (the directory's `.envrc` uses `use flake`, so the flake's `devShells.default` is exported into the environment). Never invoke `nix develop` manually, and never use `nix develop -c` one-liners.
- **Prerequisites**: `direnv` must be installed and its shell hook enabled (e.g. `eval "$(direnv hook zsh)"` in `~/.zshrc`). After cloning, run `direnv allow` once in the repository root to authorize `.envrc`. Re-run `direnv reload` after editing `.envrc` or `flake.nix`.
- **Never use system-installed Bun**: Always use the Bun provided by the flake's dev shell. The system Bun is incompatible due to CPU instruction set requirements (AVX2).
- Once direnv has activated the shell, run commands directly: `bun install`, `bun run dev`, `bun run lint`, `bun run build`.
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
