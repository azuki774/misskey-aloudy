# Timeline Playback (UI Integration) — Design

> Status: Implemented (with corrections during review).
> Related issue: #19 (TTS パイプライン) — UI 統合フォローアップ
> Related dependencies: #8, #9, #11, #13, #14, #15, #16, #17, #19 (all merged)

## 1. Goal

Wire the playback pipeline (`src/lib/player/pipeline.ts`, merged via PR #42) into the home page (`src/pages/index.astro`) so that a user can:

1. Click 接続 → Misskey stream comes in, notes display (already works).
2. Click 読み上げ ON → the page creates a `PlaybackPipeline`, a `PlaybackState`, and a `VoiceVoxPlayer`. New notes that arrive from the global timeline are auto-enqueued and read aloud via the **server-side proxy** `/api/speech`.
3. See a "再生中" badge on the currently-playing note in the list.
4. Click 読み上げ OFF → the page destroys the pipeline and its player; the current audio stops and the queue is discarded.
5. Click 切断 → everything is torn down.
6. Adjust 再生速度 → active browser audio changes speed immediately, without re-synthesizing or changing pitch.

This is the **MVP**: a working TTS loop in the browser.

### Architectural note (corrected during implementation review)

The first iteration of this PR wired the pipeline's `synthesize` DI to the **default** `synthesize()` function exported from `src/lib/voicevox/client.ts`, which makes a direct browser-to-VoiceVox HTTP request. The VoiceVox engine's default `cpu-latest` Docker image does **not** enable CORS, so all synthesis requests from the browser were blocked silently.

The fix is to route synthesis through the existing server-side proxy `/api/speech` (`src/pages/api/speech.ts`, added in PR #10). The browser calls `/api/speech` (same-origin), the server calls `synthesize()` (server-to-server, no CORS), and returns the WAV bytes. This matches the same architecture that the `/test-voicevox` page has been using since PR #10, and the original MVP design intent in `docs/requirements.md` (which says "all synthesis is mediated by the app server").

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Where the pipeline is created | Lazily, on 読み上げ ON click | The user opts in to TTS. Resources (audio element, listeners) are not created until needed. |
| Pipeline lifecycle on 読み上げ OFF | `destroyPipeline()` | OFF terminates the current player and discards the queue. Turning reading on again creates a fresh pipeline and player while retaining the page-level playback-rate setting. |
| Pipeline lifecycle on 切断 | `pipeline.destroy()` first, then `client.destroy()` | Cleans up the player and the queue. The `destroyed` state propagates so any in-flight `await` in the loop bails out. |
| **Synthesis path** | **Browser → `/api/speech` (same-origin) → server → VoiceVox** | Avoids CORS. Reuses the existing proxy. Matches the `test-voicevox` architecture. |
| **Playback speed path** | **Browser-only `HTMLMediaElement.playbackRate`** | The 0.5x–2.0x setting is persisted locally, changes active audio immediately, and remains separate from VoiceVox synthesis (`speedScale: 1.1`). Valid restored values are normalized to the UI's 0.1 step; the player itself accepts any finite value in range. |
| Where the synthesize wrapper lives | `src/scripts/synthesizeApi.ts` (browser-side) | Browser-only. Exposes `synthesizeViaSpeechApi(options)`. |
| The library `synthesize` default | Unchanged (still `voicevox/client.ts`) | The library stays portable. Only the UI integration passes the API wrapper as the DI. |
| Button labels | 「読み上げ ON」 / 「読み上げ OFF」 toggle | Tells the user both the current state and the action. |
| Reading status display | A separate `<p>` below the connection state, mapped from `PlaybackStateKind` to Japanese | Separates "is Misskey reachable" from "is the TTS loop running". |
| Reading status labels | `OFF` / `読み上げ準備中…` / `読み上げ中` / `エラー: <msg>` | `paused` is **not** exposed in the UI — the page destroys the pipeline when the user toggles OFF, so the status immediately shows "OFF". Turning reading on again starts a new pipeline. |
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
│   ├── playbackRateSettings.ts # new — safe local persistence for playback speed
│   ├── synthesizeApi.ts       # new — server-proxy wrapper for synthesis
│   └── synthesizeApi.test.ts  # new — unit tests for the wrapper
├── lib/voicevox/
│   ├── playbackRate.ts        # new — shared range constants and validation
│   └── player.ts               # modified — live browser playback-rate control
docs/
└── timeline-playback.md       # new — this file
```

The pipeline (#19), state (#16), queue (#17), voicevox client (#8), and the `/api/speech` route (#10) remain unchanged. The player now owns the requested browser playback rate, while the page owns persistence and passes the setting when a player is created.

## 4. Button / state matrix

| State | 接続 | 切断 | 読み上げ toggle | Playback speed | Reading status |
| --- | --- | --- | --- | --- | --- |
| Not connected | enabled | disabled | disabled | Available | "OFF" |
| Connected, reading OFF | disabled | enabled | "読み上げ ON" (enabled) | Available | "OFF" |
| Connected, reading ON | disabled | enabled | "読み上げ OFF" (enabled) | Available | "読み上げ中" / etc. |

The reading toggle button is **only enabled** when there is a live `MisskeyClient`. Disabling prevents creating an orphan pipeline that has nothing to enqueue from.
The playback-speed range and reset button do not depend on the connection or reading state.

## 5. User flow

```
 1. Page loads.
   - The page reads the persisted playback rate, normalizing valid values to the nearest 0.1 step and falling back to 1.0x when storage is unavailable or invalid.
 2. User clicks 接続.
   - MisskeyClient is created; statechange -> "接続済み".
   - subscribeGlobalTimeline(client, handleNote) registers a callback
     that (a) appends a <li> to the notes list and (b) calls
     pipeline.enqueue(note) IF the pipeline is active.
 3. User clicks 読み上げ ON.
    - New PlaybackState, VoiceVoxPlayer (with the current playback rate), and PlaybackPipeline are created
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
    - `destroyPipeline()` destroys the pipeline and player, stopping the in-flight audio and discarding the queue.
    - UI status immediately reverts to "OFF" (not "一時停止中").
 6. User changes 再生速度.
    - The player assigns `defaultPlaybackRate` and `playbackRate` on the existing audio element. It does not call `play()`, `load()`, `pause()`, or settle the pending play promise.
    - If media assignment fails, the previous rate remains selected and a status message is shown. If local storage fails, the live rate remains applied and a persistence warning is shown.
 7. User clicks 読み上げ ON again.
    - A fresh `PlaybackState`, `VoiceVoxPlayer`, and `PlaybackPipeline` are created with the retained playback rate. Reading starts with an empty queue; only new notes are read.
 8. User clicks 切断.
   - pipeline.destroy() cleans up.
   - client.destroy() cleans up.
   - State goes back to "未接続", reading toggle disabled.
```

## 6. Pseudo-code (the new bits in `index.ts`)

```ts
import { PlaybackPipeline } from "../lib/player/pipeline.ts";
import { PlaybackState } from "../lib/player/state.ts";
import { VoiceVoxPlayer } from "../lib/voicevox/player.ts";
import { loadPlaybackRate } from "./playbackRateSettings.ts";
import { synthesizeViaSpeechApi } from "./synthesizeApi.ts";

let pipeline: PlaybackPipeline | null = null;
let readingState: PlaybackState | null = null;
let player: VoiceVoxPlayer | null = null;
let isReading = false;
let playbackRate = loadPlaybackRate();

function enableReading(): void {
  if (pipeline || !client) return;
  isReading = true;
  readingState = new PlaybackState();
  player = new VoiceVoxPlayer({ playbackRate });
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
  if (current.currentNote !== null) {
    unmarkNotePlaying(current.currentNote.id);
  }
  destroyPipeline();
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
- Reading toggled OFF while a note is being played → `destroyPipeline()` destroys the player, terminates the audio immediately, removes the "再生中" badge, and discards queued notes.
- 切断 while reading is ON → `destroyPipeline()` runs first, then `client.destroy()`. Both cleanups are idempotent.
- 読み上げ ON then user clicks 接続 again (impossible because 接続 is disabled while connected, but defense in depth) → enableReading is gated on `!pipeline && client`, so it no-ops.
- Pipeline is destroyed mid-`synthesize` → the `/api/speech` request may complete, but the loop's `destroyed` check bails out before playing the audio.
- Pipeline `error` event (e.g. `/api/speech` returns 502) → the error listener unmarks the badge and updates the reading status to "エラー: <message>". The user sees a concrete error message instead of a silent failure.
- Playback-rate change while audio is active → `VoiceVoxPlayer.setPlaybackRate()` updates the same media element without restarting it, resetting its time, or settling the pipeline's pending play promise.
- Playback-rate change while reading is OFF or disconnected → the page updates and persists the setting; the next player receives it when reading is enabled.
- Page unloaded with pipeline active → `beforeunload` calls `pipeline.destroy()`.

## 9. Edge cases (explicitly NOT handled)

- Pause/Resume UI controls (out of scope; 読み上げ ON/OFF is a destroy-and-recreate lifecycle, not a queue-preserving pause/resume control).
- Volume and speaker controls (out of scope; `defaultSpeaker: 1` is hard-coded). Browser playback speed is implemented by the home page and is independent of synthesis speed.
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

Playback-rate coverage includes the default and option values, live updates without changing time/state/promise behavior, pitch preservation, reapplication after mocked media-load resets, pause/stop and next-buffer behavior, invalid values, assignment rollback, and the destroyed-player error. Storage tests cover invalid and missing values, finite range boundaries, nearest-0.1 normalization, Node/no-storage execution, and read/write failures.

The PR's manual verification checklist:

- [ ] Start VoiceVox: `docker compose up -d voicevox`. Verify: `curl http://localhost:50021/version` returns a version string.
- [ ] `pnpm run dev` and open `http://localhost:4321/`.
- [ ] Click 接続. State label becomes "接続済み". Notes start streaming.
- [ ] Click 読み上げ ON. The reading status becomes "読み上げ準備中…" then "読み上げ中" as notes arrive.
- [ ] While reading is OFF and while disconnected, adjust 再生速度 and verify the control remains usable.
- [ ] Wait for a note to arrive. The note should have a "再生中" badge briefly while it's being read. **You should hear the audio out of the browser.**
- [ ] While a note is playing, adjust 再生速度 and verify the current audio changes speed without restarting.
- [ ] After reading, the badge is removed and the next note (if any) is read.
- [ ] Click 読み上げ OFF. The in-flight reading stops, queued notes are discarded, and the reading status immediately becomes "OFF" (not "一時停止中").
- [ ] Click 読み上げ ON again. A fresh pipeline starts; only notes arriving after it is enabled are queued.
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

- `README.md` and `docs/requirements.md`: document browser playback speed as separate from VoiceVox synthesis speed.

## 13. Open questions

None.
