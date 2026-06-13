# Project Rules — misskey-aloudy

## Overview

A website that reads out Misskey's timeline. Built with Astro and Node 24, using Nix (flake.nix) for the development environment.

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
- **Runtime**: Node 24
- **Package Manager**: pnpm
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
- **Use pnpm via corepack**: pnpm is pinned in `package.json` (`"packageManager": "pnpm@10.34.3"`). The dev shell's Node 24 includes corepack, so the pinned pnpm is selected automatically. Do not install pnpm via a system package manager.
- Once direnv has activated the shell, run commands directly: `pnpm install`, `pnpm run dev`, `pnpm run lint`, `pnpm run build`.
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
| `pnpm install`       | Install dependencies      |
| `pnpm run dev`       | Start dev server          |
| `pnpm run build`     | Build for production      |
| `pnpm run preview`   | Preview production build  |
| `pnpm run lint`      | Run linter                |
| `pnpm test`          | Run unit tests once       |
| `pnpm run test:watch`| Run unit tests in watch mode |
