# Timeline Playback (UI Integration) — Design

> Status: Implemented (with corrections during review).
> Related issue: #19 (TTS パイプライン) — UI 統合フォローアップ
> Related dependencies: #8, #9, #11, #13, #14, #15, #16, #17, #19 (all merged)

## 1. Goal

Wire the playback pipeline (`src/lib/player/pipeline.ts`, merged via PR #42) into the home page (`src/pages/index.astro`) so that a user can:

1. Click 接続 → Misskey stream comes in, notes display (already works).
2. Click 読み上げ ON → the page creates a `PlaybackPipeline`, a `PlaybackState`, and a `VoiceVoxPlayer`. New notes that arrive from the global timeline are auto-enqueued and read aloud via the **server-side proxy** `/api/speech`.
3. See a "再生中" badge on the currently-playing note in the list.
4. Click 読み上げ OFF → the pipeline pauses (queue preserved per the design choice).
5. Click 切断 → everything is torn down.

This is the **MVP**: a working TTS loop in the browser.

### Architectural note (corrected during implementation review)

The first iteration of this PR wired the pipeline's `synthesize` DI to the **default** `synthesize()` function exported from `src/lib/voicevox/client.ts`, which makes a direct browser-to-VoiceVox HTTP request. The VoiceVox engine's default `cpu-latest` Docker image does **not** enable CORS, so all synthesis requests from the browser were blocked silently.

The fix is to route synthesis through the existing server-side proxy `/api/speech` (`src/pages/api/speech.ts`, added in PR #10). The browser calls `/api/speech` (same-origin), the server calls `synthesize()` (server-to-server, no CORS), and returns the WAV bytes. This matches the same architecture that the `/test-voicevox` page has been using since PR #10, and the original MVP design intent in `docs/requirements.md` (which says "all synthesis is mediated by the app server").

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Where the pipeline is created | Lazily, on 読み上げ ON click | The user opts in to TTS. Resources (audio element, listeners) are not created until needed. |
| Pipeline lifecycle on 切断 | `pipeline.destroy()` first, then `client.destroy()` | Cleans up the player and the queue. The `destroyed` state propagates so any in-flight `await` in the loop bails out. |
| **Synthesis path** | **Browser → `/api/speech` (same-origin) → server → VoiceVox** | Avoids CORS. Reuses the existing proxy. Matches the `test-voicevox` architecture. |
| Where the synthesize wrapper lives | `src/scripts/synthesizeApi.ts` (browser-side) | Browser-only. Exposes `synthesizeViaSpeechApi(options)`. |
| The library `synthesize` default | Unchanged (still `voicevox/client.ts`) | The library stays portable. Only the UI integration passes the API wrapper as the DI. |
| Button labels | 「読み上げ ON」 / 「読み上げ OFF」 toggle | Tells the user both the current state and the action. |
| Reading status display | A separate `<p>` below the connection state, mapped from `PlaybackStateKind` to Japanese | Separates "is Misskey reachable" from "is the TTS loop running". |
| Reading status labels | `OFF` / `読み上げ準備中…` / `読み上げ中` / `エラー: <msg>` | `paused` is **not** exposed in the UI — when the user toggles OFF, the status immediately shows "OFF", not "一時停止中". This was a UX correction from the first iteration. |
| Currently-playing badge | A small inline element inside the `<li>`, hidden by default, toggled via `markNotePlaying` / `unmarkNotePlaying` driven by `pipeline.on("noteStart" / "noteEnd" / "error")` | The `error` listener is essential: a failed `play()` never emits `noteEnd`, so without the error handler the badge would stick. |
| Disabled-button matrix | 接続/切断 follow the existing rules. The reading toggle is **enabled only when connected** and **disabled when not**. | Reading without a Misskey connection makes no sense. |
| `pipeline.on("error")` handler | **Required**, surfaces errors to the user via the reading status label | The first iteration of this PR did not register this handler, so errors were silent and the user had no idea why audio wasn't playing. This is a critical UX fix. |
| `beforeunload` cleanup | Both `pipeline.destroy()` and `client.destroy()` | Symmetric with the existing cleanup. |
| E2E tests for the page | None added | The page is browser code; existing unit tests cover the underlying library. The PR's checklist calls for a manual smoke test in dev. |

## 3. File layout

```
src/
├── pages/index.astro          # modified — add reading toggle + status + badge markup
├── scripts/
│   ├── index.ts               # modified — wire up the pipeline + synthesize wrapper
│   ├── synthesizeApi.ts       # new — server-proxy wrapper for synthesis
│   └── synthesizeApi.test.ts  # new — unit tests for the wrapper
docs/
└── timeline-playback.md       # new — this file
```

No library changes. The pipeline (#19), state (#16), queue (#17), voicevox client (#8), voicevox player (#9), and the `/api/speech` route (#10) are all already complete and untouched.

## 4. Button / state matrix

| State | 接続 | 切断 | 読み上げ toggle | Reading status |
| --- | --- | --- | --- | --- |
| Not connected | enabled | disabled | disabled | "OFF" |
| Connected, reading OFF | disabled | enabled | "読み上げ ON" (enabled) | "OFF" |
| Connected, reading ON | disabled | enabled | "読み上げ OFF" (enabled) | "読み上げ中" / etc. |

The reading toggle button is **only enabled** when there is a live `MisskeyClient`. Disabling prevents creating an orphan pipeline that has nothing to enqueue from.

## 5. User flow

```
1. Page loads.
2. User clicks 接続.
   - MisskeyClient is created; statechange -> "接続済み".
   - subscribeGlobalTimeline(client, handleNote) registers a callback
     that (a) appends a <li> to the notes list and (b) calls
     pipeline.enqueue(note) IF the pipeline is active.
3. User clicks 読み上げ ON.
   - New PlaybackState, VoiceVoxPlayer, PlaybackPipeline are created
     and wired together. synthesize is set to synthesizeViaSpeechApi.
   - pipeline.on("noteStart") / "noteEnd" / "error" manage the
     "再生中" badge on the matching <li> via data-note-id.
   - state.on("statechange") updates the reading status display.
   - pipeline.start() begins processing the (currently empty) queue.
4. New note arrives.
   - handleNote adds it to the <ul> and calls pipeline.enqueue(note).
   - The pipeline dequeues, converts to text via toReadingText (#14),
     synthesizes via /api/speech (server proxy) -> VoiceVox,
     plays via VoiceVoxPlayer (#9), then dequeues the next one.
5. User clicks 読み上げ OFF.
   - pipeline.stop() pauses the in-flight audio. Queue preserved.
   - UI status immediately reverts to "OFF" (not "一時停止中").
6. User clicks 読み上げ ON again.
   - pipeline.start() resumes from the next queued note.
7. User clicks 切断.
   - pipeline.destroy() cleans up.
   - client.destroy() cleans up.
   - State goes back to "未接続", reading toggle disabled.
```

## 6. Pseudo-code (the new bits in `index.ts`)

```ts
import { PlaybackPipeline } from "../lib/player/pipeline.ts";
import { PlaybackState } from "../lib/player/state.ts";
import { VoiceVoxPlayer } from "../lib/voicevox/player.ts";
import { synthesizeViaSpeechApi } from "./synthesizeApi.ts";

let pipeline: PlaybackPipeline | null = null;
let readingState: PlaybackState | null = null;
let player: VoiceVoxPlayer | null = null;
let isReading = false;

function enableReading(): void {
  if (pipeline || !client) return;
  isReading = true;
  readingState = new PlaybackState();
  player = new VoiceVoxPlayer();
  pipeline = new PlaybackPipeline({
    player,
    state: readingState,
    synthesize: synthesizeViaSpeechApi,  // ★ server proxy, not direct browser fetch
  });
  pipeline.on("noteStart", ({ note }) => markNotePlaying(note.id));
  pipeline.on("noteEnd",   ({ note }) => unmarkNotePlaying(note.id));
  pipeline.on("error",     ({ error, note }) => {
    if (note !== undefined) unmarkNotePlaying(note.id);
    setReadingStatusText(`エラー: ${error.message}`);
  });
  pipeline.on("queueChange", ({ size }) => updateQueueSize(size));
  readingState.on("statechange", ({ to }) => {
    if (isReading) setReadingStatusText(READING_STATE_LABELS[to]);
  });
  pipeline.start();
  updateReadingButtons();
  setReadingStatusText(READING_STATE_LABELS[readingState.state]);
}

function disableReading(): void {
  const current = readingState;
  if (pipeline === null || current === null) return;
  isReading = false;
  pipeline.stop();
  if (current.currentNote !== null) {
    unmarkNotePlaying(current.currentNote.id);
  }
  updateReadingButtons();
  setReadingStatusText("OFF");  // ★ not "READING_STATE_LABELS[current.state]"
}

function destroyPipeline(): void {
  if (pipeline === null) return;
  isReading = false;
  pipeline.destroy();
  pipeline = null;
  readingState = null;
  player = null;
  updateReadingButtons();
  setReadingStatusText("OFF");
}

function handleNote(note: Note): void {
  addNote(note);
  if (isReading && pipeline !== null) {
    pipeline.enqueue(note);
  }
}
```

## 7. The synthesize wrapper (`src/scripts/synthesizeApi.ts`)

```ts
import type { SynthesizeOptions } from "../lib/voicevox/types.ts";

export async function synthesizeViaSpeechApi(
  options: SynthesizeOptions,
): Promise<ArrayBuffer> {
  const res = await fetch("/api/speech", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: options.text,
      speaker: options.speaker ?? 1,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(
      `synthesis via /api/speech failed: ${res.status}${detail ? ` (${detail})` : ""}`,
    );
  }
  return await res.arrayBuffer();
}
```

## 8. Edge cases (handled)

- Reading toggled ON while not connected → button is disabled, so this can't happen via UI.
- Reading toggled OFF while a note is being played → `pipeline.stop()` calls `player.stop()` which terminates the audio immediately. The "再生中" badge is removed.
- 切断 while reading is ON → `destroyPipeline()` runs first, then `client.destroy()`. Both cleanups are idempotent.
- 読み上げ ON then user clicks 接続 again (impossible because 接続 is disabled while connected, but defense in depth) → enableReading is gated on `!pipeline && client`, so it no-ops.
- Pipeline is destroyed mid-`synthesize` → the `/api/speech` request may complete, but the loop's `destroyed` check bails out before playing the audio.
- Pipeline `error` event (e.g. `/api/speech` returns 502) → the error listener unmarks the badge and updates the reading status to "エラー: <message>". The user sees a concrete error message instead of a silent failure.
- Page unloaded with pipeline active → `beforeunload` calls `pipeline.destroy()`.

## 9. Edge cases (explicitly NOT handled)

- Pause/Resume UI controls (out of scope; we only expose 読み上げ ON/OFF as a toggle, which uses the pipeline's pause semantics internally).
- Volume / speed / speaker controls (out of scope; `defaultSpeaker: 1` is hard-coded).
- Per-note progress / seek (the pipeline plays through to the end before dequeuing the next).
- Renote / Reply / CW visual distinction in the note display (already out of scope per the design).
- Multi-instance / per-instance selector (Issue #20 deferred).

## 10. Testing

`src/scripts/synthesizeApi.test.ts` (new) — 6 cases:
- POSTs to `/api/speech` with the text and speaker as JSON.
- Defaults the speaker to 1 when `options.speaker` is undefined.
- Returns the response body as an ArrayBuffer on 200.
- Throws an error containing the status code on non-2xx (e.g. 502 with a JSON body).
- Handles 502 with no body (does not crash on `.text()`).
- Handles 400 (e.g. text too long).

The wrapper is browser-only, so tests use `vi.stubGlobal("fetch", ...)` to mock the global `fetch`. The underlying libraries (`MisskeyClient`, `subscribeGlobalTimeline`, `PlaybackState`, `NoteQueue`, `PlaybackPipeline`, voicevox client) are already covered by existing unit tests.

The PR's manual verification checklist:

- [ ] Start VoiceVox: `docker compose up -d voicevox`. Verify: `curl http://localhost:50021/version` returns a version string.
- [ ] `pnpm run dev` and open `http://localhost:4321/`.
- [ ] Click 接続. State label becomes "接続済み". Notes start streaming.
- [ ] Click 読み上げ ON. The reading status becomes "読み上げ準備中…" then "読み上げ中" as notes arrive.
- [ ] Wait for a note to arrive. The note should have a "再生中" badge briefly while it's being read. **You should hear the audio out of the browser.**
- [ ] After reading, the badge is removed and the next note (if any) is read.
- [ ] Click 読み上げ OFF. The in-flight reading stops. The reading status immediately becomes "OFF" (not "一時停止中").
- [ ] Click 読み上げ ON again. The pipeline resumes from the next queued note.
- [ ] Click 切断. Both the connection and the reading status reset. The page is back to the initial state.
- [ ] **Troubleshooting**: if no audio plays, open DevTools → Network and confirm a `POST /api/speech` request returns 200 with `audio/wav`. If you see 502, VoiceVox is not running. If you see CORS errors (which should not happen with this architecture), something is misconfigured.

Required CI checks: `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run build`.

## 11. Out of scope

- Pause button (separate from Stop).
- Volume slider.
- Speaker selector.
- Note log persistence.
- "再生中" badge animations.
- Connection auto-reconnect (already in the client; this PR does not change that behavior).

## 12. Documentation updates

- `README.md`: a one-line mention of "MVP 完了" in the changelog-style section. Optional; deferred to a future docs PR.

## 13. Open questions

None.
