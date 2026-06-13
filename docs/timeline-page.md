# Home Page (Misskey TL display) — Design

> Status: Implemented.
> Related issue: #15 (Misskey テストページ)
> Related dependencies: #13 (MisskeyClient, merged), #12 (globalTimeline, merged), #14 (textConverter, merged)

## 1. Goal

Replace the placeholder home page (`/`) at `src/pages/index.astro` with a real page that subscribes to a Misskey instance's global timeline and displays new notes in real time. The page is a developer-facing / debugging tool for the Misskey streaming pipeline (#12 + #13); it is the first user-visible end-to-end integration of the Misskey libraries.

Originally this was scoped as a "test page" at `/test-misskey` (issue #15). The plan was revised mid-implementation: the test page is **deleted** and the functionality moves to `/` directly, so the home route becomes the place to exercise the pipeline.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Route | `/` (the home page, `src/pages/index.astro`) | The user changed the plan: the test page moves to the home page. `/test-misskey` no longer exists. |
| URL source | `MISSKEY_INSTANCE_URL` env var, passed as a `readonly` input from the Astro page | Same as the original #15 design: the URL is a **server-side fixed value** for this iteration, and user choice is a future feature (likely #20). Reading the input value at runtime gives a single source of truth. |
| Env var fallback | If `MISSKEY_INSTANCE_URL` is not set, fall back to `"https://misskey.io"` | So a freshly-cloned repo can still open the page and try it. A console warning is logged in dev so the dev sees that the env var was missing. |
| Page title | `<Layout title="misskey-aloudy">` | The home page uses the site name. |
| Browser script | `src/scripts/index.ts` (renamed from `test-misskey.ts`) | Mirrors the page name. |
| Note display format | `@username · 3秒前` + raw text body | Minimal: no Renote/Reply/CW labels in v1. Adding those is a follow-up. |
| Note list size | Max 100; oldest dropped when over | Reasonable memory bound. |
| Auto-scroll | Scroll to top on each new note, but only if the user is already within 80px of the top | Reading older notes is not disrupted. |
| Relative time | Computed in the script at receive time | Cheap, no library needed. |
| Multi-instance | Not supported. The page binds to a single env-var URL. | Out of scope. Future #20 will provide a real picker. |
| Renote / Reply / CW | Not displayed as a separate label | YAGNI. The username + text already convey the main content. We can add a small "Reply" / "Renote" / "CW" prefix later if needed. |
| toReadingText (#14) | Not used in this page | The page is for **displaying** notes, not for TTS. The TTS pipeline (#19) will consume `toReadingText` later. |
| URL / `:emoji:` stripping | Not applied | Same reason. The user sees the original text. |
| Cleanup | `beforeunload` calls `client.destroy()` | Same pattern as #10. |
| Unit tests | None | The existing unit tests for `MisskeyClient` (#13) and `subscribeGlobalTimeline` (#12) cover the underlying logic. Adding a jsdom + Vitest setup for a single page is out of scope. The page is verified manually in the PR's checklist. |
| .env.example update | Add a comment above `MISSKEY_INSTANCE_URL` explaining that the home page uses it | The variable already exists but is currently unused. |

## 3. File layout

```
src/
├── pages/index.astro           # new — replaces the previous placeholder; this is now the home page
└── scripts/index.ts            # new — browser logic (renamed from src/scripts/test-misskey.ts)
.env.example                      # updated — comment on MISSKEY_INSTANCE_URL
docs/
└── timeline-page.md            # new — this file
README.md                         # updated — "Test page" references the home page now
```

No new dependencies. The page reuses the shared `Layout`, `Header`, `Footer`, and Tailwind tokens.

## 4. Public API surface

### `src/pages/index.astro`

Renders the page. Reads `import.meta.env.MISSKEY_INSTANCE_URL` in its frontmatter and passes the value to the readonly input.

### `src/scripts/index.ts`

Internal (no exports). Wires up DOM event listeners on `DOMContentLoaded` and orchestrates a single `MisskeyClient` + a single `subscribeGlobalTimeline` subscription.

## 5. State

The browser script keeps only the following state:

- `client: MisskeyClient | null` — module-scoped, single instance per page load
- `unsubscribe: (() => void) | null` — the unsubscribe function returned by `subscribeGlobalTimeline`
- `noteCount: number` — UI counter, updated as notes arrive
- DOM references: `urlEl`, `connectEl`, `disconnectEl`, `stateEl`, `errorEl`, `notesEl`, `countEl` — captured once on `DOMContentLoaded`

No persistent storage. No global event bus.

## 6. Behavior

### 6.1 Page load

1. The Astro frontmatter reads `import.meta.env.MISSKEY_INSTANCE_URL`. If missing, falls back to `"https://misskey.io"` and logs a `console.warn` in dev.
2. The page renders a readonly `<input>` with that URL as the value.
3. `<script>` imports `../scripts/index.ts` (Vite will bundle and include it as a client module).
4. The browser script's `init()` runs on `DOMContentLoaded`. It captures DOM references and wires up the listeners.

### 6.2 Connect button

1. Disable both buttons; show 状態: "接続中…".
2. If a previous `client` exists, call `client.destroy()` to make sure no leak.
3. Create a new `MisskeyClient()`.
4. Subscribe to `statechange` to update the 状態 label and the error message.
5. Call `client.connect(url)`. On success:
   - 状態 becomes "接続済み". Enable 切断; disable 接続.
   - Call `subscribeGlobalTimeline(client, addNote)` and store the returned unsubscribe function.
6. On rejection, render the error message; 状態 becomes "エラー"; re-enable 接続.

### 6.3 Disconnect button

1. Disable both buttons briefly.
2. Call `unsubscribe()` (if set) to drop the channel server-side.
3. Call `client.disconnect()` to close the socket.
4. Call `client.destroy()` to clear listeners and revoke any object URLs.
5. Reset `client` and `unsubscribe` to `null`. 状態: "未接続". Enable 接続; disable 切断.

### 6.4 statechange handler

- `disconnected` → "未接続"
- `connecting` → "接続中…"
- `connected` → "接続済み"
- `reconnecting` → "再接続中…"
- `error` → "エラー"

The error event handler renders the error message into the `<p id="error">` element (and unhides it).

### 6.5 Note arrival

For each note delivered by the subscription:

1. Increment `noteCount`.
2. Create a `<li>` containing:
   - A `<div class="text-xs text-fg-muted">` with `@${user.username} · ${formatRelative(note.createdAt)}`
   - A `<div>` with `note.text` as `textContent` (preserves XSS safety; newlines become `<br>` via `white-space: pre-wrap` CSS)
3. `notesEl.prepend(li)`.
4. If `notesEl.children.length > 100`, remove the last child.
5. Update the `countEl` text.
6. `notesEl.scrollTo({top: 0, behavior: "smooth"})` — only if the user is "near the top" (within 80px). Otherwise the user is reading older notes; don't yank them.

### 6.6 Relative time format

```ts
function formatRelative(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}日前`;
  return new Date(iso).toISOString().slice(0, 10);  // YYYY-MM-DD
}
```

### 6.7 Cleanup

On `beforeunload`:

- If `unsubscribe` is set, call it.
- If `client` is set, call `client.destroy()`.

## 7. Accessibility & safety

- The readonly input has `aria-readonly="true"` and an `aria-label` so SR users hear "Misskey instance URL, read-only".
- The 状態 label uses `aria-live="polite"` so screen readers announce state transitions.
- The error region uses `role="alert"` and `aria-live="assertive"` for high-priority announcements.
- Note text is set via `textContent`, never `innerHTML`. The `text-xs` container has `white-space: pre-wrap` so newlines render correctly.
- Buttons are `type="button"`.

## 8. Testing

No automated tests for this page (would require jsdom + DOM fixtures; out of scope).

Manual verification steps (recorded in the PR body):

1. `docker compose up -d voicevox` is **not** required for this page (VoiceVox is not used here).
2. Set `MISSKEY_INSTANCE_URL=https://misskey.io` in `.env` (or rely on the fallback).
3. `pnpm run dev`.
4. Open `http://localhost:4321/` in a browser.
5. Click 接続. The state should go 接続中… → 接続済み.
6. New notes should appear in the list within seconds.
7. Click 切断. The state should go 切断 → 未接続.
8. With a reachable network but unreachable Misskey (e.g. set `MISSKEY_INSTANCE_URL` to a typo), click 接続. State should land on エラー and the error region should show the connection failure.

Required CI checks: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`.

## 9. Out of scope

- Renote / Reply / CW labels in the note display.
- MFM (Misskey Flavored Markdown) decoding.
- `?i=` authentication token.
- Multiple-instance picker.
- E2E tests via Playwright.
- "Pause the stream" / "filter notes" / "save notes" controls.
- toReadingText integration (that's #19).
- Audio playback of incoming notes (that's #19's domain).

## 10. Documentation updates

- `README.md`: the existing "Test page" subsection (added in #35 for VoiceVox) has been generalized; the Misskey test page is now the home page itself.

## 11. Open questions

None.
