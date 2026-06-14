# PlaybackPipeline — Design

> Status: Implemented.
> Related issue: #19 (音声合成パイプライン)
> Related dependencies: #11 (Note types, merged), #14 (toReadingText, merged), #16 (PlaybackState, merged), #17 (NoteQueue, this PR), #8 (synthesize, merged), #9 (VoiceVoxPlayer, merged)

## 1. Goal

Provide a `PlaybackPipeline` class at `src/lib/player/pipeline.ts` that wires the following together into a working Misskey-TTS loop:

```
   Note   --> NoteQueue
   NoteQueue  --dequeue-->  toReadingText(note)
                           --> synthesize(text, speaker)
                           --> VoiceVoxPlayer.play(buffer)
                           --> await audio-end
                           --dequeue-->  (next note)
```

The pipeline owns a `NoteQueue` (#17) and a `PlaybackState` (#16). It uses the `synthesize` function from `src/lib/voicevox/client.ts` and the `VoiceVoxPlayer` from `src/lib/voicevox/player.ts`. **The pipeline does not need the `MisskeyClient`** — the UI layer is responsible for calling `pipeline.enqueue(note)` for each note that arrives from `subscribeGlobalTimeline`. Keeping the pipeline free of the MisskeyClient lets it be tested with mocks of just `synthesize` and `VoiceVoxPlayer`.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Lifecycle | `start()` (begin processing) / `stop()` (pause, queue preserved) / `destroy()` (tear down) | Matches the "pause semantics with queue preserved" decision from the PR1 brainstorm. |
| Auto-start on enqueue | Yes — first `enqueue` on a pipeline in the idle state begins the processing loop | Lets the UI just call `enqueue` after `subscribeGlobalTimeline` returns a note; no need to also call `start()`. |
| State on `stop()` | Set to `paused` | The user picked 5 states including `paused`. `paused` distinguishes "user pressed Stop" from "no notes in queue" (`idle`). |
| State on enqueue→start | idle → loading → playing → idle (loop) | Same pattern as the design sketch. |
| Error policy | Skip the failed note, emit `error`, continue with the next | Per the user's choice. A single bad note (e.g. text too long) does not poison the queue. |
| Max queue size | 10 (forwarded to `NoteQueue`) | Per the user's choice. |
| Default speaker | `1` (forwarded to `synthesize`) | Matches `DEFAULT_SPEAKER` in `src/lib/voicevox/types.ts`. |
| Events emitted | `noteStart`, `noteEnd`, `error`, `queueChange` | Issue #18's `onNoteStart` / `onNoteEnd` / `onError` / `onQueueChange` are emitted directly by the pipeline. The pipeline does **not** also pass through `statechange` events — UI consumers listen to the `PlaybackState` instance directly. |
| Destroyed state | `enqueue`/`start`/`stop` are no-ops, listeners cleared, underlying `NoteQueue.destroy()` and `VoiceVoxPlayer.destroy()` are called | Symmetric with the other player classes. |
| `MisskeyClient` dependency | None | The pipeline receives notes via `enqueue`. The UI bridges `subscribeGlobalTimeline(client, ...)` to `pipeline.enqueue(note)`. |
| Re-entrancy on `enqueue` from inside the loop | Not possible (the loop runs in a microtask chain, not synchronously inside `enqueue`). | The enqueue side-effect of starting the loop is guarded by a `started` flag. |
| Mid-loop `destroy()` | The in-flight `synthesize` / `play` may complete, but the result is discarded. The loop checks a destroyed flag after each await and bails. | No AbortController plumbing for MVP. |

## 3. File layout

```
src/lib/player/
├── pipeline.ts       # new — PlaybackPipeline
├── pipeline.test.ts  # new — vitest
docs/
└── playback-pipeline.md  # new — this file
```

No new dependencies.

## 4. Public API

```ts
// src/lib/player/pipeline.ts
import type { Note } from "../misskey/types.ts";
import type { PlaybackState } from "./state.ts";
import type { VoiceVoxPlayer } from "../voicevox/player.ts";
import type { NoteQueue } from "./queue.ts";
import type { synthesize } from "../voicevox/client.ts";
import type { toReadingText } from "../misskey/textConverter.ts";

export type PlaybackPipelineOptions = {
  player: VoiceVoxPlayer;
  state?: PlaybackState;
  synthesize?: typeof synthesize;
  toReadingText?: typeof toReadingText;
  queueMaxSize?: number;
  defaultSpeaker?: number;
};

export type PlaybackPipelineEvent =
  | "noteStart"
  | "noteEnd"
  | "error"
  | "queueChange";

export type PlaybackPipelineEventPayloads = {
  noteStart: { note: Note };
  noteEnd: { note: Note };
  error: { error: Error; note: Note };
  queueChange: { size: number };
};

export class PlaybackPipeline {
  readonly state: PlaybackState;
  readonly queue: NoteQueue;

  constructor(options: PlaybackPipelineOptions);

  enqueue(note: Note): void;
  start(): void;
  stop(): void;

  on<E extends PlaybackPipelineEvent>(
    event: E,
    handler: (payload: PlaybackPipelineEventPayloads[E]) => void,
  ): () => void;

  destroy(): void;
}
```

## 5. Behavior

### 5.1 Construction

- `state` defaults to `new PlaybackState()`.
- `synthesize` defaults to the `synthesize` function from `src/lib/voicevox/client.ts`.
- `toReadingText` defaults to the `toReadingText` function from `src/lib/misskey/textConverter.ts`.
- `queueMaxSize` defaults to 10.
- `defaultSpeaker` defaults to 1.
- Internal `NoteQueue` is constructed with `{ maxSize: queueMaxSize }` and the same `change` events are forwarded to the pipeline's own `queueChange` event.
- The pipeline subscribes to its own `NoteQueue.on("change", ...)` to re-emit `queueChange`. The pipeline also subscribes to `player` events:
  - `statechange` is not consumed (the underlying player manages its own state internally; the pipeline only tracks the higher-level state).
  - `error` is re-emitted as the pipeline's `error` event with the most recently dequeued note (if any).
  - The pipeline does **not** rely on `ended` because `player.play(buffer)` already returns a Promise that resolves when audio finishes (see `src/lib/voicevox/player.ts:60`).

### 5.2 `enqueue(note)`

1. If destroyed, no-op.
2. If stopped, just add to the queue (the user can call `start()` to resume).
3. Otherwise (auto-start):
   - `queue.enqueue(note)`.
   - If a note was dropped from the queue, do not emit `error` (this is a normal overflow, not a failure); the dropped note is silently discarded.
   - If `isRunning` is false, kick off the processing loop (await `void this.#runLoop()`; we don't await it inside `enqueue`).

### 5.3 `start()`

1. If destroyed, no-op.
2. If `isRunning` is already true, no-op.
3. If `stopped` is true, clear the `stopped` flag.
4. Kick off the processing loop if not already running.

### 5.4 `stop()`

1. If destroyed, no-op.
2. Set `stopped = true`. The next loop iteration bails out.
3. Call `player.stop()` to terminate the in-flight audio (this is the only way to free the audio element; the await on `player.play()` will reject and the loop catches it).
4. Set `state.setState("paused")`.
5. Note: `currentNote` is **not** cleared here; the UI can read it until a new note starts.

### 5.5 `on(event, handler)`

Standard pattern: returns an idempotent unsubscribe function. A throwing listener is caught and ignored.

### 5.6 `destroy()`

1. If already destroyed, no-op (idempotent).
2. Set `destroyed = true`. The loop bails on its next checkpoint.
3. Call `player.destroy()` (idempotent).
4. Call `queue.destroy()`.
5. Clear all pipeline listeners.

After `destroy()`, the underlying `state` is **not** destroyed — the caller owns it. (The caller may choose to call `state.destroy()` if they want a full teardown.)

## 6. The processing loop (pseudocode)

```
private async runLoop(): Promise<void> {
  if (isRunning) return;
  isRunning = true;
  try {
    while (!destroyed && !stopped) {
      if (queue.size === 0) {
        state.setCurrentNote(null);
        state.setState("idle");
        return;
      }
      const note = queue.dequeue();
      if (note === undefined) return;
      state.setCurrentNote(note);
      try {
        state.setState("loading");
        const text = toReadingText(note);
        const buffer = await synthesize({ text, speaker: defaultSpeaker });
        if (destroyed) return;
        if (stopped) return;
        state.setState("playing");
        emit("noteStart", { note });
        await player.play(buffer);  // resolves when audio ends
        if (destroyed) return;
        if (stopped) return;
        emit("noteEnd", { note });
      } catch (err) {
        if (destroyed) return;
        if (stopped) return;
        emit("error", { error: err, note });
        // continue to next note
      }
      // loop
    }
  } finally {
    isRunning = false;
  }
}
```

## 7. Edge cases (handled)

- `enqueue` on a destroyed pipeline → no-op.
- `enqueue` on a stopped pipeline → adds to queue but does not start.
- Multiple `enqueue` calls in quick succession → all go into the queue; the loop drains them in order.
- `start()` while already running → no-op.
- `stop()` while not running → sets `stopped` (the loop bails on next iteration if it ever starts again, but currently we don't auto-resume).
- `stop()` while playing → terminates the in-flight audio; loop bails; state becomes `paused`.
- `stop()` followed by `start()` → resumes the loop; if the queue is non-empty, the next note is dequeued and played.
- `destroy()` while synthesizing → the in-flight `synthesize` may complete (no AbortController); the loop checks `destroyed` after the await and bails without playing. The buffer is discarded.
- `destroy()` while playing → the in-flight `play` may complete; the loop bails on its next checkpoint.
- Synthesize throws (e.g. text too long, VoiceVox down) → caught, `error` emitted, loop continues with the next note.
- `player.play` throws (e.g. autoplay blocked) → caught, `error` emitted, loop continues.

## 8. Edge cases (explicitly NOT handled)

- AbortController on `synthesize` / `play` for clean cancellation — the in-flight work is allowed to complete; the loop's `destroyed` / `stopped` checks discard the result.
- Cross-tab synchronization — only one pipeline per page.
- Configurable error policy (skip vs. stop on error) — fixed to "skip and emit".

## 9. Testing

Tests live in `src/lib/player/pipeline.test.ts`. ~15 cases, structured as `it.each` tables where natural.

A `MockPlayer` and a `MockSynthesize` are used to drive the pipeline deterministically. The mocks expose manual control over when `play()` resolves and what `synthesize` returns.

- `describe("enqueue")` — 4 cases: single note goes through full lifecycle (enqueue → synthesize → play → ended), two notes in sequence, overflow drops oldest silently, enqueue on a destroyed pipeline is a no-op.
- `describe("stop")` — 3 cases: stop during play sets state to paused, queue is preserved across stop, start after stop resumes from the next queued note.
- `describe("error")` — 2 cases: synthesize failure emits `error` and continues to the next note, player failure emits `error` and continues.
- `describe("destroy")` — 2 cases: idempotent, post-destroy enqueue/start/stop are no-ops.
- `describe("state")` — 2 cases: state transitions through loading → playing on success, currentNote is updated on each note.
- `describe("queueChange")` — 1 case: events fire on enqueue and dequeue.

Total: ~15 cases.

## 10. Out of scope

- Pause/Resume UI (#21 deferred to a later PR).
- Per-note volume / speed controls.
- MFM decoding.
- Speaker selection UI.

## 11. Documentation updates

None for this PR. The next PR (#18 follow-up) will add UI integration; that PR will update the README.

## 12. Open questions

None.
