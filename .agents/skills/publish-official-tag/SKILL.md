---
name: publish-official-tag
description: Use when publishing a new semver tag and GitHub Release for the misskey-aloudy project, after development work is ready to ship from master. Trigger phrases include "publish tag X.Y.Z", "正式タグ X.Y.Z を発行", or "release X.Y.Z して".
---

# publish-official-tag

## Overview

Guides an opencode agent through the human-in-the-loop flow of publishing a new semver tag (`X.Y.Z`, no `v` prefix) and a GitHub Release for misskey-aloudy. The flow is **Plan → Confirm → Execute → Verify**, with hard pre-checks, an explicit user approval gate, and per-step error handling.

The agent must never modify any project file (CI workflow, Dockerfile, source code) during this skill. The only commands issued are `git tag`, `git push`, and `gh release create`.

## When to Use

Use this skill when the user asks to:

- "publish tag 1.2.3" / "release 1.2.3 して"
- "正式タグ 1.2.3 を発行して"
- "create a new release for X.Y.Z"
- "cut a release for X.Y.Z"

Do NOT use this skill for:

- Hotfixes that should be cherry-picked (use a different workflow)
- Release branches that are not `master`
- Draft releases (this skill always publishes as a full release)
- Versions with a `v` prefix (this project uses `X.Y.Z` only)
- Lightweight or GPG-signed tags (this project uses annotated tags only)
- CHANGELOG.md updates (out of scope; use a separate skill if needed)

## Required Input

The user must provide a version string of the form `X.Y.Z` (no `v` prefix). If the user does not provide one, stop and ask for it explicitly. Do NOT auto-derive the version from commit history.

## Required Tools

Verify these are present and authenticated before Phase 1:

- `git` (any recent version)
- `gh` (GitHub CLI), authenticated via `gh auth login` for the `azuki774/misskey-aloudy` repository

If `gh auth status` fails, stop and ask the user to authenticate. Do not proceed.

## Phase 1: Prepare (read-only)

All commands in this phase are read-only. **Any failure stops the skill immediately**. Do not proceed to Phase 2. Report the failed check to the user with the exact command and its output.

### 1.1 Pre-checks (fail-fast, in order)

Run each check in this order. If any fails, stop and report.

1. `git fetch origin`
2. `git rev-parse --abbrev-ref HEAD` must return `master`
3. `git status --porcelain` must produce empty output (working tree clean)
4. `git rev-parse master` and `git rev-parse origin/master` must be equal
5. `git tag -l "X.Y.Z"` (local) and `git ls-remote origin "refs/tags/X.Y.Z"` (remote) must both be empty
6. `gh auth status` must show an authenticated user

### 1.2 Information gathering

- Previous tag: `git describe --tags --abbrev=0 master`
  - If it fails (e.g., `fatal: No names found ...`), treat as "no previous tag"
- Release notes draft, one commit per line as `- <subject> (<short-sha>)`:
  - If a previous tag exists: `git log <prev>..master --pretty=format:"- %s (%h)"`
  - If no previous tag: `git log master --pretty=format:"- %s (%h)"`

## Phase 2: Confirm (human gate)

Display the following to the user in a single block and require **explicit** approval. Do not proceed to Phase 3 until approval is given.

Display items:

- Current branch (`master`) and HEAD short SHA
- Previous tag (or "no previous tag")
- Number of commits since previous tag
- Release notes draft (commit list, as-is from Phase 1.2)
- Proposed new tag: `X.Y.Z`
- The 3 commands that will be executed in Phase 3, with their exact invocations

Approval rules (strict; case-insensitive, whitespace-trimmed):

- **Accept**: `yes`, `y`, `ok`, `go`, `approve`, `進めて`, `OK`, `はい`, `承認`
- **Explicit reject**: `no`, `n`, `cancel`, `abort`, `やめて`, `いいえ`
- **Anything else** (e.g., `yes?`, `maybe`, `ok かも`, `sure?`): treat as **ambiguous** and refuse to proceed. Ask the user for a clearer answer.

Both reject and ambiguous responses leave all state unchanged and exit the skill cleanly. Do not push, do not tag, do not create a release.

## Phase 3: Execute

Run the three commands in order, substituting the actual version and release notes gathered in Phase 1. **If any step fails, stop immediately** and follow the error handling table in Phase 5.

1. Create the annotated tag:
   ```bash
   git tag -a X.Y.Z -m "Release X.Y.Z"
   ```
2. Push the tag to origin:
   ```bash
   git push origin X.Y.Z
   ```
3. Create the GitHub Release. The `--notes` body must be the commit list generated in Phase 1.2 (one line per commit, `- <subject> (<short-sha>)`):
   ```bash
   gh release create X.Y.Z --title "X.Y.Z" --notes "<commit list from Phase 1.2>" --target master
   ```

## Phase 4: Verify

After all three Phase 3 commands succeed, run both verifications:

- `git ls-remote origin "refs/tags/X.Y.Z"` must return a non-empty result (the tag SHA on the remote)
- `gh release view X.Y.Z` must exit with code 0 and show the release

If both pass, the skill is complete. Report success to the user with a link to the GitHub Release.

If either fails, follow the Phase 5 error handling.

## Phase 5: Error Handling

| Failure point | State when it fails | Recovery |
|---|---|---|
| Phase 1.1 pre-check | Nothing modified | Show the exact failing command and its output, then stop. Do not proceed. |
| Phase 3 step 1 (tag create) | No tag exists | Show the error from `git tag` and stop. |
| Phase 3 step 2 (push) | Local tag exists, not on remote | Keep the local tag. Ask the user to re-run `git push origin X.Y.Z` manually once the underlying issue (auth, network, branch protection) is resolved. |
| Phase 3 step 3 (release) | Tag pushed, no release | Ask the user to re-run the `gh release create X.Y.Z --title "X.Y.Z" --notes "<notes>" --target master` command manually. |
| Phase 4 verify | Unknown | Report which verification did not match, and ask the user to run `git ls-remote` and `gh release view` manually to confirm the actual state. |

**Do not auto-rollback.** Deleting a remote tag is destructive and may affect external notifications, downstream tooling, and branch protection. Leave any partially-pushed tag in place and let the user decide what to do.

## Completion Criteria

The skill is successful only if ALL of the following are true:

- The annotated tag `X.Y.Z` exists locally (`git tag -l "X.Y.Z"` is non-empty)
- The tag is pushed to `origin` (`git ls-remote origin "refs/tags/X.Y.Z"` is non-empty)
- `gh release view X.Y.Z` exits 0 and prints the release metadata
- The release notes contain the commit list generated in Phase 1.2
- The user has been informed of success with a link to the GitHub Release page

## Out of Scope

The following are intentionally NOT part of this skill:

- CHANGELOG.md creation or update
- Adding semver tags to Docker images (the `docker.yml` workflow is unchanged)
- Conventional Commits parsing for automatic version suggestion
- Running on branches other than `master`
- Tags with a `v` prefix
- Lightweight tags or GPG-signed tags
- Automatic version bumping

If any of these become needed, write a separate skill or spec rather than expanding this one.
