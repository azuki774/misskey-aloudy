# Global Timeline Subscription — Design

> Status: Implemented.
> Related issue: #12 (グローバル TL 購読)
> Related dependencies: #13 (Misskey WebSocket クライアント, merged), #11 (ノート型定義, merged)

## 1. Goal

Provide a thin layer on top of `MisskeyClient` that:

- Subscribes to Misskey's `globalTimeline` streaming channel.
- Surfaces each new note to a user-supplied callback.
- Auto-resubscribes after a reconnect, so the consumer does not have to re-call subscribe when the underlying socket comes back.
- Returns an idempotent unsubscribe function that detaches all listeners and tells the server to drop the channel.
- Permits only one active subscription per `MisskeyClient` instance (a second call without an unsubscribe in between throws).

Issue #12 in the repository describes the desired shape as a function called `subscribeGlobalTimeline(callback)`. To stay compatible with the existing class-based pattern (#9 `VoiceVoxPlayer`, #13 `MisskeyClient`) while honoring the issue text, this design exposes a single function that takes the `MisskeyClient` as its first argument.

This layer does **not** interpret the note (e.g. filter renotes, transform CW, etc.). That is the job of issue #14 (ノート→テキスト変換) and beyond.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Public API shape | A function `subscribeGlobalTimeline(client, callback) → unsubscribe` | Matches the issue's text exactly; minimal surface; easy to use from a UI handler. |
| Multiple subscriptions per client | Forbidden; second call throws | The user explicitly chose "1 回だけ" to keep the API simple and avoid accidentally double-subscribing (which would lead to duplicate notes). |
| Auto-resubscribe on reconnect | Yes — on every `statechange → "connected"`, re-send the `connect` message | The user explicitly chose this. The consumer does not have to track connection state. |
| Connection-state guard | None at subscribe time: we allow subscribe in any state and defer the `connect` send until the next `connected` transition. | If the user subscribes before calling `client.connect(...)`, the subscription silently activates on the first connect. Symmetric with the auto-resubscribe path. |
| Memory leak prevention | Use the unsubscribe function returned by `client.on(event, handler)` to detach every listener we register | Mirrors the convention already used in `MisskeyClient`. The unsubscribe function we return composes those plus the server-side `disconnect` send. |
| Channel id generation | A monotonic per-process counter, starting at 1, encoded as a string | Misskey requires a unique id per channel. With the "1 subscription per client" rule the counter is only used to satisfy the protocol, not for routing. `crypto.randomUUID()` was considered but adds noise; a counter is enough. |
| `params` for the connect message | Empty (`undefined`) | The issue does not ask for `withRenotes` / `withFiles` overrides. Out of scope. |
| Note shape | Passed through as-is from the server (`as Note`); no validation at this layer | A future layer (#14 / #15) will validate or transform. The cost of adding a validator here is duplicated logic. |
| Errors | Reuses `MisskeyClientError` from `src/lib/misskey/errors.ts` with kind `"connection"` for the "already subscribed" case | One error type for the whole misskey module keeps the surface small. |
| Spec file location | `docs/misskey-timeline.md` | Same convention as `docs/voicevox.md` (issue #10) and `docs/misskey-client.md` (issue #13). |

## 3. File layout

```
src/lib/misskey/
├── globalTimeline.ts          # new — subscribeGlobalTimeline
├── globalTimeline.test.ts     # new — vitest unit tests
├── client.ts                  # existing (used as the transport)
├── client.test.ts             # existing
├── errors.ts                  # existing (reused for "already subscribed")
└── types.ts                   # existing
docs/
└── misskey-timeline.md        # new — this file
```

No new components, pages, or scripts. No dependency additions.

## 4. Public API

```ts
// src/lib/misskey/globalTimeline.ts
import type { MisskeyClient } from "./client.ts";
import type { Note } from "./types.ts";

export type GlobalTimelineCallback = (note: Note) => void;

export function subscribeGlobalTimeline(
  client: MisskeyClient,
  callback: GlobalTimelineCallback,
): () => void;
```

`callback` is invoked once per `note` event received on the `globalTimeline` channel. It is never invoked with anything that isn't a `Note`-shaped payload (other channel message types — e.g. `stats`, `typing`, etc. — are silently ignored).

The returned function unsubscribes. It is idempotent: calling it twice has no additional effect (listeners are already detached and the WeakMap entry is already cleared). It never throws.

## 5. Behavior

### 5.1 Subscribe

1. Look up the client in a module-private `WeakMap<MisskeyClient, SubscriptionState>`. If a subscription already exists, throw `MisskeyClientError("Already subscribed to global timeline", "connection")`.
2. Allocate a channel id (a monotonic counter; e.g. the first subscription is `"1"`).
3. Register a `message` listener on the client that filters for `{type:"channel", body:{id:<ourId>, type:"note"}}` and calls `callback(msg.body.body as Note)`. Other `ServerMessage` shapes are ignored.
4. Register a `statechange` listener that re-sends the `connect` message every time the state transitions to `"connected"`. This handles both:
   - the "subscribed while disconnected → user later calls `client.connect()`" case, and
   - the "socket dropped and reconnected automatically" case (#13's exponential backoff).
5. If the client is already in `"connected"` at subscribe time, also send the `connect` message immediately so the consumer does not have to wait for a state transition.
6. Store `{channelId, offMessage, offState}` in the WeakMap.
7. Return the unsubscribe function (see 5.2).

### 5.2 Unsubscribe

The function returned by `subscribeGlobalTimeline`:

1. If no entry exists in the WeakMap for the client (i.e. already unsubscribed), return without side effects.
2. Detach the `message` listener via `offMessage()`.
3. Detach the `statechange` listener via `offState()`.
4. If the client is currently `"connected"`, send `{type:"disconnect", body:{id:<ourId>}}` to the server. If `send` throws (race with a state change), swallow the error.
5. Delete the WeakMap entry.

The `disconnect` send is best-effort: the channel is implicitly dropped when the socket closes anyway.

### 5.3 What the callback sees

The callback is called only with payloads whose shape is `{type:"channel", body:{id:<ourId>, type:"note", body:<Note>}}`. The `<Note>` object is passed as-is from the server, without any field validation or transformation. Unknown fields (Misskey's API can add fields in newer versions) are preserved.

## 6. Edge cases

| Situation | Behavior |
| --- | --- |
| Subscribe before `client.connect()` | Accepted. The `connect` message is sent on the next `statechange → "connected"`. |
| Subscribe twice on the same client without an unsubscribe in between | Throws `MisskeyClientError(kind:"connection")`. |
| Subscribe on a client that is `"error"` or has been `destroy()`-ed | Accepted. The `connect` message is never sent (the client never reaches `"connected"` again). The user should `disconnect()` / `destroy()` the client and create a new one. |
| Unsubscribe called twice | Idempotent. Second call is a no-op. |
| Server-side `disconnect` confirmation | The Misskey streaming API does not echo a `disconnect` confirmation for channels; the client simply stops receiving. We do not need to wait for a response. |
| Listener exception inside the callback | The exception is caught by the existing `client.on()` machinery and ignored. (The callback is a user listener; the client does not see it.) The subscription itself stays alive. |
| Multiple `MisskeyClient` instances | Each has its own WeakMap entry. You can subscribe to all of them independently. |

## 7. Testing

All tests live in `src/lib/misskey/globalTimeline.test.ts` and use a hand-rolled `MockMisskeyClient` that implements the same minimal surface as `MisskeyClient`:

- `state` getter (test-controlled)
- `on(event, handler) → unsubscribe`
- `send(message)`
- `setState(to)` helper for simulating transitions

Coverage:

- Subscribe sends a `connect` message when the client is already `"connected"`.
- Subscribe defers the `connect` message when the client is `"disconnected"`, and sends it on the next `statechange → "connected"`.
- Subscribe throws when called twice on the same client without an unsubscribe in between.
- Subscribing to two different clients does not throw.
- A `channel` `ServerMessage` whose `id` matches the subscription's id and whose `type` is `"note"` invokes the callback with the note.
- A `channel` `ServerMessage` whose `id` does not match is ignored.
- A `channel` `ServerMessage` whose `type` is not `"note"` (e.g. `"stats"`) is ignored.
- A non-`channel` `ServerMessage` is ignored.
- Unsubscribe detaches the `message` listener; further `channel` events do not invoke the callback.
- Unsubscribe sends a `disconnect` message with the correct id.
- Unsubscribe does not send `disconnect` if the client is not `"connected"` at unsubscribe time.
- Unsubscribe is idempotent.
- After a `disconnect → connecting → connected` cycle, the subscription re-sends `connect` automatically.
- After a `disconnect → connected` cycle triggered by the underlying `#13` reconnect (i.e. a previously-failed connection that comes back), the subscription also re-sends `connect`.
- Destroying the client does not cause further `send` calls (the listener has been removed via the statechange path; we don't add an additional destroy listener).

## 8. Out of scope

- Filtering renotes / replies / CWs. That's #14.
- Connecting / disconnecting the `MisskeyClient` itself. The caller is responsible for `client.connect(url)` and `client.disconnect()`.
- Multiple timeline types (home, local, list). The function name and channel are specifically for `globalTimeline`. Other channels will get their own helpers.
- Server-side `params` (e.g. `withRenotes`, `withFiles`). The issue does not ask for them.
- Authentication. Phase 2.

## 9. Documentation updates

- `README.md`: not required; this layer has no user-facing surface yet (a test page will arrive in #15).
- `docs/requirements.md`: the Data Flow section already says "Browser connects to Misskey instance via WebSocket" and "New notes arrive in real-time". This implementation realizes step 2 of the data flow. No edit needed.

## 10. Open questions

None.
