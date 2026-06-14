# PlaybackState — Design

> Status: Implemented.
> Related issue: #16 (状態管理)
> Related dependencies: #11 (ノート型定義, merged)

## 1. Goal

Provide a small state-holder class `PlaybackState` at `src/lib/player/state.ts` that tracks:

- The current high-level playback state of the Misskey-note pipeline (`idle` / `loading` / `playing` / `paused` / `error`).
- The currently-playing `Note` (or `null` when nothing is playing).

It exposes simple setters and an event API so the TTS pipeline (#19) can drive the state and the UI (#22 現在のノート表示, #21 再生コントロール UI) can react.

This is **not** the audio-buffer state machine that `VoiceVoxPlayer` already implements. `VoiceVoxPlayer` tracks the audio element (`idle` / `playing` / `paused` / `stopped`). `PlaybackState` sits one level above it and tracks the Misskey-note-level state. The pipeline that #19 will build glues the two together.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| API shape | Class with private fields, mirroring `VoiceVoxPlayer` and `MisskeyClient` | Consistency with the established pattern. |
| State kinds | 5: `idle`, `loading`, `playing`, `paused`, `error` | Issue #16 lists 4; we add `loading` (synthesis in progress) so the UI can render a "loading" indicator and the pipeline can be observed mid-step. |
| State transition validation | None — `setState` is a plain setter | The pipeline (#19) is the actor that knows the correct sequence; the state holder just records. YAGNI on a guard. |
| Current note | A single field `currentNote: Note \| null` | The pipeline plays one note at a time. When nothing is playing, the field is `null`. |
| Event API | `on(event, handler)` returning an unsubscribe function, with a `destroy()` that clears all listeners | Same shape as `MisskeyClient` and `VoiceVoxPlayer`. |
| Events emitted | `statechange` and `notechange` (two separate events) | Consumers that only care about state changes can subscribe to one; consumers that only care about note changes can subscribe to the other. Mixing them in a single event would force consumers to inspect a tag. |
| No-op detection | If `setState(x)` is called with the current state, or `setCurrentNote(x)` with the same reference (`===`), do not emit | Avoids spurious events; the pipeline can call freely without worrying about dedup. |
| Listener exception safety | A throwing listener is caught and ignored | Same as the other event-emitter classes. |
| Defaults | `state = 'idle'`, `currentNote = null` | Sensible initial state. |
| Constructor override | Optional `initial` object lets a caller seed non-default values | Useful for tests and for the future "resume from saved state" feature. |

## 3. File layout

```
src/lib/player/
├── state.ts          # new — PlaybackState class
├── state.test.ts     # new — vitest unit tests
docs/
└── playback-state.md # new — this file
```

No new dependencies. The class lives in a new directory; existing code is untouched.

## 4. Public API

```ts
// src/lib/player/state.ts
import type { Note } from "../misskey/types.ts";

export type PlaybackStateKind =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "error";

export type PlaybackStateEvent = "statechange" | "notechange";

export type PlaybackStateEventPayloads = {
  statechange: { from: PlaybackStateKind; to: PlaybackStateKind };
  notechange: { from: Note | null; to: Note | null };
};

export type PlaybackStateOptions = {
  state?: PlaybackStateKind;
  currentNote?: Note | null;
};

export class PlaybackState {
  readonly state: PlaybackStateKind;
  readonly currentNote: Note | null;

  constructor(initial?: PlaybackStateOptions);

  setState(next: PlaybackStateKind): void;
  setCurrentNote(next: Note | null): void;

  on<E extends PlaybackStateEvent>(
    event: E,
    handler: (payload: PlaybackStateEventPayloads[E]) => void,
  ): () => void;

  destroy(): void;
}
```

## 5. Behavior

### 5.1 Constructor

If `initial` is provided, both `state` and `currentNote` can be set. If omitted, defaults are `state = "idle"`, `currentNote = null`.

`initial.state` is **not** compared against the default and does not emit an event — it's the seed, not a transition.

### 5.2 `setState(next)`

1. If the instance is destroyed (post-`destroy()`), the call is a no-op.
2. If `next === this.state`, do nothing (no event).
3. Otherwise, capture `from = this.state`, assign `this.state = next`, then emit `statechange` with `{ from, to: next }`.

### 5.3 `setCurrentNote(next)`

1. If the instance is destroyed, no-op.
2. If `next === this.currentNote` (reference equality), do nothing.
3. Otherwise, capture `from = this.currentNote`, assign `this.currentNote = next`, then emit `notechange` with `{ from, to: next }`.

### 5.4 `on(event, handler)`

- Adds the handler to the listener set for that event.
- Returns a function that, when called, removes the handler. Idempotent: calling the unsubscribe twice is a no-op.
- A throwing handler is caught and ignored. The next handler in the set still runs.

### 5.5 `destroy()`

- Marks the instance as destroyed.
- Clears all listener sets.
- Subsequent `setState` and `setCurrentNote` calls are no-ops.
- Idempotent: calling `destroy()` twice is safe.

After `destroy()`, calling `on()` is allowed (the listener is added to a fresh set) — but those listeners will never fire because setters are no-ops. The contract is "destroy = no more events".

## 6. State transitions (illustrative)

The state machine is not enforced; the pipeline drives it. A typical happy path:

```
idle
  → loading         (synthesize started)
loading
  → playing         (audio starts)
playing
  → loading         (next note picked up, no gap)
playing
  → paused          (user paused)
paused
  → playing         (user resumed)
playing
  → idle            (queue empty)
loading | playing
  → error           (synthesis or playback error)
error
  → idle            (error acknowledged; next note or stop)
```

## 7. Edge cases (handled)

- `setState(x)` when `state === x` → no-op, no event.
- `setCurrentNote(null)` when already `null` → no-op, no event.
- `setCurrentNote(sameNoteReference)` → no-op, no event.
- `setState` after `destroy` → no-op.
- Listener exception → caught and ignored.
- `on()` after `destroy` → listener added but will never fire (since setters are no-ops).

## 8. Edge cases (explicitly NOT handled)

- Concurrent transitions: `setState('playing'); setState('paused')` will fire two events in order. Listeners see both. The class does not coalesce.
- Persistence: state is in-memory only. A page refresh resets to `idle` / `null`.
- Concurrency-safe across tabs: not synchronized. A tab can be in `playing` while another is in `paused`. Out of scope.

## 9. Testing

Tests live in `src/lib/player/state.test.ts`. Target: ~12 cases, structured as `it.each` tables where possible (same convention as #14's textConverter tests).

- `describe("setState")` — 5 cases: idle → loading, loading → playing, playing → paused, no-op when same state, error transition.
- `describe("setCurrentNote")` — 3 cases: null → note, note → null, note → different note (reference inequality).
- `describe("on")` — 2 cases: unsubscribe removes the listener, throwing listener does not affect siblings.
- `describe("constructor")` — 1 case: default values (`idle` / `null`).
- `describe("destroy")` — 1 case: idempotent and post-destroy setters are no-ops.

Total: ~12 cases.

## 10. Out of scope

- Pause/resume control flow (handled by the pipeline #19).
- Queue integration (#17).
- Event bus / multi-listener coalescing (#18).
- Progress / currentTime tracking.
- State machine validation.
- Persistence.

## 11. Documentation updates

None. The new class is internal; no user-facing surface changes.

## 12. Open questions

None.
