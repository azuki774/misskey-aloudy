# NoteQueue — Design

> Status: Implemented.
> Related issue: #17 (再生キュー実装)
> Related dependencies: #11 (ノート型定義, merged), #16 (PlaybackState, merged)

## 1. Goal

Provide a small, single-purpose FIFO queue class `NoteQueue` at `src/lib/player/queue.ts`. It holds Misskey `Note` objects up to a configurable maximum size; when the queue is full and a new note is enqueued, the **oldest** note is dropped to make room. The queue emits a `change` event whenever its size changes.

This class is the foundation of the playback pipeline (#19). It is not directly used by the UI; the pipeline owns the queue and forwards events to its own listeners.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Storage | A plain `Note[]` array, head = front, tail = back | FIFO with O(1) `dequeue` (shift) and O(1) `enqueue` (push). For a max size of 10, `shift` cost is negligible. |
| Max size | `10` (constructor option `maxSize`, default) | The user explicitly chose 10. Small enough to test boundary cases, large enough to absorb bursts. |
| Overflow policy | Drop the oldest note, append the new one; `enqueue()` returns the dropped note (or `null` if no drop happened) | Per Issue #17: "キューが溢れた場合は古いノートを破棄する". Returning the dropped note lets the caller log / display it. |
| `peek` | Returns the front note without removing it | Useful for "what's about to play next" UI. Cheap. |
| `clear` | Removes all items | For `stop()` semantics that preserve the queue we don't use this internally, but exposing it is harmless. |
| `on("change")` | Fired whenever `size` changes, with `{ size: number }` | Emits on enqueue, dequeue, clear, and the implicit drop on overflow (the size doesn't change in the drop case, so it does NOT fire on a same-size replacement). Listeners that want to react to drops can use the `enqueue()` return value. |
| `destroy()` | Clears the items, removes all listeners, makes `enqueue`/`dequeue`/`peek`/`clear` no-ops | Same pattern as the other player classes. |
| Reference equality on `Note` | Not enforced | Notes that are content-equal but different references (e.g. a fresh copy from the server) are still treated as distinct items. The pipeline is expected to keep a stable reference per note. |

## 3. Public API

```ts
// src/lib/player/queue.ts
import type { Note } from "../misskey/types.ts";

export type NoteQueueOptions = {
  maxSize?: number;  // default 10
};

export class NoteQueue {
  readonly size: number;

  constructor(options?: NoteQueueOptions);

  // Returns the dropped note when the queue was at capacity, else null.
  enqueue(note: Note): Note | null;

  dequeue(): Note | undefined;
  peek(): Note | undefined;
  clear(): void;

  on(
    event: "change",
    handler: (payload: { size: number }) => void,
  ): () => void;

  destroy(): void;
}
```

## 4. Behavior

### 4.1 `enqueue(note)`

1. If destroyed, return `null`.
2. If `size < maxSize`:
   - `this.#items.push(note)`.
   - Emit `"change"` with `{ size: this.#items.length }`.
   - Return `null`.
3. Otherwise (at capacity):
   - `const dropped = this.#items.shift(); this.#items.push(note);`.
   - The size is unchanged, so **no** `"change"` event is fired.
   - Return `dropped`.

### 4.2 `dequeue()`

1. If destroyed or empty, return `undefined`.
2. `const front = this.#items.shift();`.
3. Emit `"change"` with `{ size: this.#items.length }`.
4. Return `front`.

### 4.3 `peek()`

- `return this.#items[0]`. No mutation, no event.

### 4.4 `clear()`

1. If destroyed, no-op.
2. `this.#items = []`.
3. Emit `"change"` with `{ size: 0 }`.

### 4.5 `on("change", handler)`

- Adds the handler to a `Set<Listener>`.
- Returns an idempotent unsubscribe function.
- A throwing handler is caught and ignored (other listeners still run).

### 4.6 `destroy()`

1. If already destroyed, no-op (idempotent).
2. `this.#items = []`.
3. Clear the listener set.
4. Mark the instance as destroyed.

After `destroy()`, all mutators are no-ops. Listeners can still be added via `on()` but will never fire (since `enqueue`/`dequeue`/`clear` are no-ops). This matches the contract used in `MisskeyClient` and `PlaybackState`.

## 5. Edge cases (handled)

- `enqueue` on a destroyed queue → no-op, returns `null`.
- `enqueue` at capacity → drops the oldest, returns it; no `change` event.
- `dequeue` on an empty queue → returns `undefined`, no event.
- `peek` on an empty queue → returns `undefined`, no event.
- `clear` on an empty queue → still fires `change` with `{ size: 0 }` (callers may rely on this for "queue was emptied" semantics; the cost is one redundant event).
- `clear` on a destroyed queue → no-op.
- Listener exception → caught and ignored.

## 6. Edge cases (explicitly NOT handled)

- Concurrency safety: not designed for cross-thread use. The pipeline owns the queue in a single JS context; we don't synchronize.
- Persistence: the queue is in-memory only. A page refresh loses it.

## 7. Testing

Tests live in `src/lib/player/queue.test.ts`. ~10 cases, structured as `it.each` tables where natural.

- `describe("enqueue/dequeue FIFO")` — 3 cases: single enqueue+dequeue, 3 items in order, peek does not consume.
- `describe("overflow")` — 2 cases: enqueue at capacity drops oldest, repeated overflow keeps cycling.
- `describe("clear")` — 1 case: clear emits change and resets size.
- `describe("on")` — 2 cases: change fires on enqueue/dequeue, throwing listener does not break siblings.
- `describe("destroy")` — 2 cases: idempotent, post-destroy mutators are no-ops.

Total: ~10 cases.

## 8. Out of scope

- Cross-instance sharing.
- Priority lanes (a "high priority" lane that bypasses the FIFO).
- Persistence.
- Concurrency primitives (locks, atomics).

## 9. Documentation updates

None. Internal library.

## 10. Open questions

None.
