# Misskey WebSocket Client — Design

> Status: Implemented.
> Related issue: #13 (WebSocket クライアント基盤)
> Related dependencies: #5 (Astro 初期化, merged), #11 (ノート型定義, merged)

## 1. Goal

Provide a reusable Misskey WebSocket client at `src/lib/misskey/client.ts` that:

- Connects to a Misskey instance's `/streaming` WebSocket endpoint.
- Exposes its connection state through a `state` getter and a `statechange` event.
- Automatically reconnects on transient failures (network errors, 5xx, unexpected close) using exponential backoff.
- Stops reconnecting on permanent failures (HTTP 4xx during the upgrade, explicit `disconnect()`).
- Handles Misskey's server-driven `ping` / client-driven `pong` heartbeat, with a 60-second timeout watchdog.
- Surfaces raw `ServerMessage` events so higher layers (#12 global timeline subscription, #14 text conversion) can layer on their own behavior.

This is the foundation layer for the Misskey pipeline; channel subscriptions and message-type-specific parsing are explicitly out of scope.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Code structure | Class-based, mirrors `VoiceVoxPlayer` (`src/lib/voicevox/player.ts`) | Reuses the established `#state` / `#listeners` / `on(event, handler)` pattern; future #18 (event system) can layer cleanly on top. |
| `misskey-js` dependency | Not used | The WebSocket JSON protocol is simple enough to implement directly; avoids extra bundle weight and lock-in to misskey-js's API surface. |
| State model | 5 states: `disconnected`, `connecting`, `connected`, `reconnecting`, `error` | `reconnecting` is distinct from `connecting` so the UI can communicate "we're trying to recover" vs. "first connection attempt". |
| WebSocket DI | `socketFactory?: (url) => WebSocketLike` option, defaulting to `new globalThis.WebSocket(url)` | Lets tests inject a fully-controllable `MockWebSocket` without spinning up a real `ws` server. |
| Backoff | `[1s, 2s, 4s, 8s, 16s, 60s]`, capped at 60s. No jitter. | Per the user's explicit choice. Predictable behavior; the cap avoids pathological sleeps. |
| Error classification | HTTP 4xx during the WS upgrade is permanent (`error` state, no further reconnect). 5xx, ECONNREFUSED, ENOTFOUND, unexpected `close` are temporary (backoff loop). | A 404 / 401 / 403 will not recover by waiting; retrying would just spam logs. |
| Heartbeat | Server-driven: on `{type:"ping"}` reply with `{type:"pong"}`. Watchdog: if no `ping` arrives within 60s, force-close and reconnect. | Matches Misskey's default `/streaming` behavior. The watchdog catches half-open connections where the server silently died. |
| Test framework | `vitest`, same as the rest of the repo. `vi.useFakeTimers()` for backoff tests. | The codebase is on vitest after the bun-to-node migration. `vi.useFakeTimers()` makes 60-second timeouts trivial to test. |
| Test-only deps | None added in this PR. `MockWebSocket` injected via `socketFactory` covers all unit tests. | YAGNI: if a future integration test needs `ws`, it can be added when written. |
| Spec file location | `docs/misskey-client.md` | Same convention as `docs/voicevox.md` (issue #10). |

## 3. File layout

```
src/lib/misskey/
├── client.ts          # new — MisskeyClient class
├── client.test.ts     # new — vitest unit tests
├── errors.ts          # new — MisskeyClientError
├── types.ts           # existing — ConnectBody, ClientMessage, ServerMessage, ...
docs/
└── misskey-client.md  # new — this file
package.json           # modified — +ws, +@types/ws in devDependencies
```

No new components, pages, or scripts.

## 4. Public API

```ts
// src/lib/misskey/client.ts
import type { ClientMessage, ServerMessage } from "./types.ts";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export type ClientEvent =
  | "statechange"
  | "open"
  | "close"
  | "message"
  | "error";

export type ClientEventPayloads = {
  statechange: { from: ConnectionState; to: ConnectionState };
  open: undefined;
  close: { code: number; reason: string };
  message: ServerMessage;
  error: { error: MisskeyClientError };
};

export type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "close" | "message" | "error",
    listener: (event: { data?: unknown; code?: number; reason?: string; error?: unknown }) => void,
  ): void;
  removeEventListener(
    type: "open" | "close" | "message" | "error",
    listener: (event: { data?: unknown; code?: number; reason?: string; error?: unknown }) => void,
  ): void;
};

export type MisskeyClientOptions = {
  socketFactory?: (url: string) => WebSocketLike;
};

export class MisskeyClient {
  constructor(options?: MisskeyClientOptions);
  readonly state: ConnectionState;
  connect(instanceUrl: string): Promise<void>;
  disconnect(): void;
  send(message: ClientMessage): void;
  on<E extends ClientEvent>(
    event: E,
    handler: (payload: ClientEventPayloads[E]) => void,
  ): () => void;
  destroy(): void;
}
```

`MisskeyClientError` lives in `src/lib/misskey/errors.ts`:

```ts
export type MisskeyClientErrorKind =
  | "invalid_url"
  | "connection"
  | "http_upgrade"
  | "heartbeat_timeout"
  | "destroyed"
  | "not_connected";

export class MisskeyClientError extends Error {
  readonly kind: MisskeyClientErrorKind;
  readonly status?: number;
  constructor(message: string, kind: MisskeyClientErrorKind, status?: number);
}
```

## 5. State machine

```
              ┌────────────────────┐
              │   disconnected     │◀──── disconnect() (from any state)
              └────────┬───────────┘
                       │ connect()
                       ▼
              ┌────────────────────┐
              │    connecting      │──── HTTP 4xx ──▶┌────────┐
              └────────┬───────────┘                │ error  │
                       │ WS open                    └───┬────┘
                       ▼                                ▲
              ┌────────────────────┐                    │
              │     connected      │                    │
              └────────┬───────────┘                    │
                       │ unexpected close / 5xx / …     │
                       ▼                                │
              ┌────────────────────┐    attempt cap or   │
              │   reconnecting     │───4xx (reconnect)─▶│
              └────────┬───────────┘                    │
                       │ backoff timer fires            │
                       └─▶ connecting                   │
                                                       │
        connect() rejects (only) ─────────────────────┘
```

- `disconnect()` is the only transition that lands in `disconnected` from any state, and it sets an internal `userInitiated` flag so the reconnection loop exits.
- `destroy()` short-circuits all timers and listeners; subsequent `connect()` rejects with `MisskeyClientError("destroyed")`.
- `state` is exposed as a getter; transitions go through `#setState` which emits `statechange` with `{from, to}`.

## 6. Reconnection algorithm

```
backoff  = [1_000, 2_000, 4_000, 8_000, 16_000, 60_000]  // ms
attempt  = 0
loop:
  if userInitiated or destroyed: return
  if attempt < backoff.length:
    delay = backoff[attempt]
  else:
    delay = backoff[backoff.length - 1]   // cap
  attempt += 1
  sleep(delay)         // cancellable via destroy()/disconnect()
  if userInitiated or destroyed: return
  openSocket()         // transitions to "connecting" then "connected" or "reconnecting"
```

`connect()` resolves when the first `open` event arrives (state becomes `connected`).
`connect()` rejects when the upgrade returns HTTP 4xx (state becomes `error`) or when the constructor is `destroy()`-ed before open.

Once `connected`, any subsequent `close` event whose `code !== 1000` kicks off the backoff loop above, transitioning through `reconnecting` → `connecting` → `connected`.

## 7. Heartbeat

- On every `{type:"ping"}` from the server, immediately send `{type:"pong"}` over the same socket.
- On `open` and on every received `ping`, set a 60-second timer. If the timer fires before the next `ping`, force-close the socket with code `4000` and a synthetic reason. This triggers the normal `close` handling, which kicks the backoff loop.

## 8. URL handling

`connect(instanceUrl)`:

1. Validate the input is a non-empty string.
2. Build `wss://<host>/streaming` from `https://...` or `wss://...` inputs. `http://` is upgraded to `ws://`; everything else is rejected with `MisskeyClientError("invalid_url")`.
3. Pass the resulting URL to `socketFactory` (default `new globalThis.WebSocket(url)`).

## 9. Error classification

| Situation | Classification | Behavior |
| --- | --- | --- |
| Upgrade HTTP 4xx (e.g. 401, 403, 404, 410) | permanent | `state = "error"`; emit `error` with `MisskeyClientError(http_upgrade)`; do **not** reconnect. |
| Upgrade HTTP 5xx | temporary | increment `attempt`, sleep, retry. |
| `Error` event with `ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` | temporary | same as above. |
| `close` event with `code === 1000` (normal) **after** we were connected | depends on `userInitiated` | If `disconnect()`-initiated: stay `disconnected`. Otherwise: treat as unexpected, reconnect. |
| `close` event with non-1000 code | temporary | reconnect. |
| 60-second heartbeat timeout | temporary | close with code 4000, reconnect. |

`connect()` rejects:

- with `MisskeyClientError("invalid_url")` if the URL is malformed.
- with `MisskeyClientError("http_upgrade", …)` if the upgrade returns 4xx.
- with `MisskeyClientError("connection", …)` if the URL cannot be reached (e.g. socketFactory threw, or the server returned 5xx that the user opted to treat as rejectable — actually, by default 5xx is a temporary retry, so the promise only rejects on permanent errors or destroy).

## 10. Event API

Same shape as `VoiceVoxPlayer.on`:

```ts
const off = client.on("statechange", ({ from, to }) => { ... });
off();  // unsubscribe
```

- `statechange`: `{ from: ConnectionState; to: ConnectionState }`. Emitted on every state transition, including no-op transitions that share a name (e.g. an explicit `disconnected → disconnected` is suppressed; `connecting → connecting` is suppressed).
- `open`: `undefined`. Emitted on every successful socket open, including after a reconnect.
- `close`: `{ code: number; reason: string }`. Emitted on every socket close.
- `message`: `ServerMessage`. The raw parsed JSON object. **The client does not interpret message types** beyond `ping` (heartbeat) and `pong` (no-op).
- `error`: `{ error: MisskeyClientError }`. Emitted on every permanent or unexpected error.

Listener exceptions are caught and ignored so a misbehaving listener cannot break the client.

## 11. Cleanup on destroy

- Cancel any pending backoff timer.
- Clear the heartbeat watchdog.
- Force-close the underlying socket (if open) with code `1000`.
- Clear all event listeners (statechange/open/close/message/error).
- Set `state = "disconnected"`.
- Set an internal `destroyed` flag; subsequent `connect()` calls reject with `MisskeyClientError("destroyed")`.

## 12. Testing

All tests live in `src/lib/misskey/client.test.ts` and use `vi.useFakeTimers()` to keep the suite fast. The `MockWebSocket` is a small class that:

- Tracks `readyState`.
- Captures `addEventListener` calls so the test can `dispatch("open")` etc.
- Records all `send` calls (so we can assert on `{type:"pong"}`).
- Records `close` calls.

Coverage targets:

- `connect()` resolves on `open` and transitions `connecting → connected`.
- `connect()` rejects with `MisskeyClientError(invalid_url)` on a malformed URL.
- `connect()` rejects with `MisskeyClientError(http_upgrade)` on 4xx and lands in `error`.
- `disconnect()` is idempotent and lands in `disconnected` from any state without firing the backoff loop.
- Unexpected `close` from `connected` schedules a reconnect via backoff.
- Backoff progression: `[1s, 2s, 4s, 8s, 16s, 60s]` then capped at 60s.
- HTTP 4xx during a reconnect attempt terminates the loop with `error`.
- `ping` from server is answered with `{type:"pong"}`.
- 60s heartbeat watchdog closes the socket and triggers a reconnect.
- Listener exceptions do not break other listeners.
- `destroy()` cancels timers, clears listeners, and rejects subsequent `connect()`.

## 13. Out of scope

- Channel subscriptions (`connect` / `disconnect` / `ch` for `globalTimeline`). That's issue #12.
- Note-type-specific parsing and TL event handling. That's #14 / #15.
- Authentication via `?i=` token. Phase 2.
- Reconnection cap (e.g. "give up after N attempts"). The current design retries forever; this is intentional for a passive background reader.

## 14. Documentation updates

- `docs/requirements.md` "Components" table: the "Frontend" row currently says "WebSocket client". This implementation realizes that. No edit required, but a future #15 test page will exercise the client.
- `README.md` does not need an update for this issue; the client has no user-facing surface yet.

## 15. Open questions

None.
