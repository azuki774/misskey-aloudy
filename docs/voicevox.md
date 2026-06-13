# VoiceVox Test Page — Design

> Status: Draft — awaiting user review.
> Related issue: #10 (VoiceVox テストページ)
> Related dependencies: #8 (VoiceVox API クライアント, merged), #9 (音声再生プレイヤー, merged)

## 1. Goal

Add a developer-facing test page at `src/pages/test-voicevox.astro` that exercises the VoiceVox integration end-to-end through the existing server endpoint. The page must let a developer type arbitrary text, click a button, and hear the synthesized audio; if VoiceVox is offline, the page must surface a clear error.

This page is a debugging/QA tool. It is not a user-facing surface of the product.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Transport for synthesis | `POST /api/speech` (server-side) | Reuses the existing validated endpoint, no CORS work, no `PUBLIC_VOICEVOX_URL` exposure, mirrors how the future timeline UI will call the engine. |
| Stop semantics | Stop = terminate; blob URL revoked; re-synthesize is required to play again | Matches the literal issue text ("再生/停止ボタン"); keeps the UI small. The `VoiceVoxPlayer` already implements this. |
| Offline detection | Surface the existing `502` body from `/api/speech` | The endpoint already returns `{"error":"VoiceVox engine is not reachable", ...}` on connection failure. No new health endpoint needed. |
| Default speaker | `1` (四国めたん ノーマル) | Matches `DEFAULT_SPEAKER` in `src/lib/voicevox/types.ts`. No speaker selector on the page (issue does not require it). |
| Page language | Astro frontmatter in English; visible labels in Japanese (consistent with the rest of the app's UI copy) | Consistent with existing pages and components. |

## 3. File layout

```
src/
├── pages/
│   └── test-voicevox.astro      # new — page template
├── scripts/
│   └── test-voicevox.ts         # new — browser logic (fetch + player wiring)
└── (no changes elsewhere)
docs/
└── requirements.md              # updated: clarify that the browser talks to /api/speech, not VoiceVox directly, for the MVP path
```

The page reuses the existing `Layout.astro`, `Header.astro`, `Footer.astro`, and Tailwind tokens. No new components are introduced.

## 4. Page layout

```
┌─ Header (existing) ─────────────────────────────────┐
├─ <main class="container mx-auto px-4 py-8">         │
│   <h1 class="text-2xl font-semibold">VoiceVox テスト</h1>
│   <p class="text-fg-muted mt-2">短い説明…</p>      │
│                                                    │
│   <label for="text" class="block mt-6">テキスト</label>
│   <textarea id="text" rows="4" maxlength="1000"     │
│             class="w-full rounded border …"></textarea>
│                                                    │
│   <div class="mt-4 flex gap-2">                    │
│     <button id="synthesize" type="button"          │
│             class="rounded bg-accent-bg px-4 py-2 …">
│       合成して再生</button>                          │
│     <button id="stop" type="button" disabled        │
│             class="rounded border px-4 py-2 …">     │
│       停止</button>                                 │
│   </div>                                           │
│                                                    │
│   <p id="status" class="mt-4 text-sm" aria-live="polite"></p>
│   <p id="error" class="mt-4 text-sm text-red-600" hidden
│      aria-live="polite"></p>                       │
├─ Footer (existing) ─────────────────────────────────┘
```

The `Stop` button starts disabled. It is enabled only after a successful play transition (i.e. once the player emits its first `statechange` to `"playing"` for the current request). It is disabled again when the player transitions to `idle` (e.g. after a new request starts) or when an error is emitted. Both buttons are `type="button"` so they do not submit the form.

## 5. End-to-end flow (button click → audio plays)

This is the section explicitly requested for documentation: what happens, in order, between the user clicking "合成して再生" and audio actually coming out of the speakers.

1. **Click handler fires.** The `synthesize` button's `click` event invokes the page's `onSynthesizeClick()` handler. The handler reads `textarea#text.value` and trims it.
2. **Early validation.** If the trimmed value is empty, the handler sets the `status` element to `"テキストを入力してください"` and returns. No network request is made.
3. **Concurrency control.**
   - If a previous request is in flight, its `AbortController.abort()` is called so the in-flight `fetch` is cancelled. The previous request's `try/catch` swallows the resulting `AbortError` (see step 9 below).
   - A new `AbortController` is created and bound to the next `fetch` call via `signal`.
   - `isBusy` is set to `true`; the `synthesize` button is disabled to prevent double submits.
4. **UI state update.** The `status` element text is set to `"合成中…"`; the `error` element receives `hidden = true` and its text is cleared.
5. **HTTP request.** `fetch("/api/speech", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, speaker: 1 }), signal })` is invoked. The browser resolves `/api/speech` against the current origin (e.g. `http://localhost:3000`).
6. **Server-side processing** (already implemented in `src/pages/api/speech.ts`).
   - The endpoint validates the JSON body: empty / oversized `text` → `400`; non-positive-integer `speaker` → `400`.
   - It calls `synthesize({ text, speaker })` from `src/lib/voicevox/client.ts`, which issues `POST /audio_query` then `POST /synthesis` against VoiceVox.
   - On success, the endpoint responds with `200 audio/wav` and the WAV bytes.
   - On connection failure, it responds with `502 application/json { error: "VoiceVox engine is not reachable", detail }`.
7. **Response handling in the browser.**
   - If `res.ok` is false: read the body as JSON, set `error.textContent = body.error` (with `body.detail` appended if present), set `status.textContent = "失敗しました"`, and abort the sequence.
   - If `res.ok` is true: `await res.arrayBuffer()` to obtain the WAV bytes, then call `player.play(arrayBuffer)`.
8. **Playback.** `player.play()` is defined in `src/lib/voicevox/player.ts`:
   1. Wraps the buffer in `new Blob([buffer], { type: "audio/wav" })`.
   2. Calls `URL.createObjectURL(blob)` to obtain a `blob:http://…` URL.
   3. Sets `audio.src = url` and calls `audio.load()`.
   4. Transitions internal state from `idle` (or `paused`) to `playing` and emits a `statechange` event.
   5. Invokes `audio.play()`. If `play()` returns a rejected promise (e.g. browser autoplay policy), the error is caught, state goes to `stopped`, and a `VoiceVoxPlayerError("media_error")` is emitted.
9. **Error/finally.** The outer `try/catch/finally` around the `fetch` ensures:
   - If the thrown error is an `AbortError` and the abort was caused by this handler chain (i.e. the user clicked 合成して再生 again while a request was already in flight, or the page is unloading), it is swallowed silently — the new request's `status` and `error` updates will replace whatever the previous request was about to write.
   - If the abort is from an external source (e.g. page navigation) and there is no replacement request in flight, `status` is set to `"キャンセルしました"`.
   - Any other thrown error sets `error.textContent` to a human-readable message and `status.textContent` to `"失敗しました"`.
   - In all cases, `isBusy` is reset to `false` and the `synthesize` button is re-enabled (unless the page is unloading).
10. **Player state events.** The page subscribes to `player.on("statechange", …)` and `player.on("error", …)`. The `statechange` handler updates the visible `status` text to one of `待機中 / 再生中 / 一時停止 / 停止` based on the player's `state`. The `error` handler writes `error.message` to the `error` element and un-hides it.
11. **Stop path.** The `stop` button's click handler calls `player.stop()`. Internally, `stop()` calls `audio.pause()`, sets `currentTime = 0`, revokes the current object URL, and transitions the player state to `stopped`. The `statechange` listener updates the `status` text accordingly. Replaying the same text requires clicking `synthesize` again; the previous buffer is not retained (per the "Stop = terminate" decision).

## 6. State summary

The browser script keeps only the following state:

- `player: VoiceVoxPlayer` — module-scoped, single instance per page load.
- `isBusy: boolean` — true while a `fetch` is in flight.
- `abortController: AbortController | null` — for cancelling the in-flight request on a new submit or page unload.
- DOM references: `textEl`, `synthesizeEl`, `stopEl`, `statusEl`, `errorEl` — captured once on `DOMContentLoaded`.

No persistent state, no global event bus, no client-side cache of synthesized audio.

## 7. Accessibility & safety

- `maxlength="1000"` on the `<textarea>` matches the server's `MAX_TEXT_LENGTH` constant.
- `aria-live="polite"` on `status` and `error` so SR users hear updates.
- Server-returned error strings are written via `textContent` (never `innerHTML`) to prevent XSS.
- Both buttons are `type="button"`.
- The page is rendered with `<html lang="ja">` via the shared `Layout`.

## 8. Cleanup on unload

- A `beforeunload` listener calls `player.destroy()` to revoke any lingering object URL. This is a defense-in-depth measure: the primary cleanup happens on every `stop()` and on every `play()` of a new buffer (which revokes the previous URL).
- Note: `beforeunload` is not guaranteed to fire under bfcache and similar optimizations. The implementation must not rely on it for correctness.

## 9. Testing

- No new unit tests for the page itself (it is a thin Astro template with a thin script; the underlying `client.ts` and `player.ts` are already covered by `client.test.ts` and `player.test.ts`).
- The page is exercised manually against the running dev server:
  - `pnpm run dev` (or `make smoke` / `make with-voicevox` for production build).
  - With VoiceVox running (`docker compose up -d voicevox`): type text → click 合成して再生 → audio plays. Click 停止 → audio stops.
  - With VoiceVox stopped: type text → click 合成して再生 → page shows `VoiceVox engine is not reachable`.
- Required CI checks: `pnpm run lint`, `pnpm run build`, `pnpm test`.

## 10. Out of scope

- Speaker selection, voice/speed controls (issue #10 does not ask for them; these are Phase 2 features per `docs/requirements.md`).
- History of past syntheses.
- Direct browser → VoiceVox call (i.e. removing the `/api/speech` server hop).
- i18n of the page copy.

## 11. Documentation updates

- `docs/requirements.md` "Data Flow" section (lines 91–96) and the "Components" table currently imply the browser talks to VoiceVox directly. This contradicts the master implementation, which routes through `/api/speech`. As part of this change, the doc is updated to reflect the actual data flow:
  - Step 3 becomes "Browser POSTs note text to the app's own `/api/speech` endpoint."
  - A new step 3b (or renumbered) says "The app server calls VoiceVox `/audio_query` and `/synthesis`."
  - The "Frontend" component row in the table gets a clarifying note that the browser only reaches VoiceVox indirectly through the app server for the MVP.

## 12. Open questions

None at the time of writing. The author awaits user review.
