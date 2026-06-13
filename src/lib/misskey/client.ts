import { MisskeyClientError } from "./errors.ts";
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

export type WebSocketLikeEvent = {
	data?: unknown;
	code?: number;
	reason?: string;
	error?: unknown;
};

export type WebSocketLike = {
	readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(
		type: "open" | "close" | "message" | "error",
		listener: (event: WebSocketLikeEvent) => void,
	): void;
	removeEventListener(
		type: "open" | "close" | "message" | "error",
		listener: (event: WebSocketLikeEvent) => void,
	): void;
};

export type MisskeyClientOptions = {
	socketFactory?: (url: string) => WebSocketLike;
};

const BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 60_000];
const HEARTBEAT_TIMEOUT_MS = 60_000;
const HEARTBEAT_CLOSE_CODE = 4_000;

type Listener<E extends ClientEvent> = (payload: ClientEventPayloads[E]) => void;

function defaultSocketFactory(url: string): WebSocketLike {
	const ws = new globalThis.WebSocket(url) as unknown as WebSocketLike;
	return ws;
}

export class MisskeyClient {
	#state: ConnectionState = "disconnected";
	#listeners: { [E in ClientEvent]: Set<Listener<E>> } = {
		statechange: new Set(),
		open: new Set(),
		close: new Set(),
		message: new Set(),
		error: new Set(),
	};
	#socket: WebSocketLike | null = null;
	#socketFactory: (url: string) => WebSocketLike;
	#userInitiated = true;
	#destroyed = false;
	#reconnectAttempt = 0;
	#reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	#heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	#pendingConnect: { resolve: () => void; reject: (err: MisskeyClientError) => void } | null = null;
	#lastUrl: string | null = null;

	constructor(options: MisskeyClientOptions = {}) {
		this.#socketFactory = options.socketFactory ?? defaultSocketFactory;
	}

	get state(): ConnectionState {
		return this.#state;
	}

	connect(instanceUrl: string): Promise<void> {
		if (this.#destroyed) {
			return Promise.reject(
				new MisskeyClientError("MisskeyClient has been destroyed", "destroyed"),
			);
		}
		if (
			this.#state === "connecting" ||
			this.#state === "connected" ||
			this.#state === "reconnecting"
		) {
			return Promise.reject(
				new MisskeyClientError(`MisskeyClient is already ${this.#state}`, "connection"),
			);
		}

		const url = buildStreamingUrl(instanceUrl);
		if (url === null) {
			const err = new MisskeyClientError(
				`Invalid Misskey instance URL: ${instanceUrl}`,
				"invalid_url",
			);
			this.#userInitiated = true;
			this.#setState("error");
			this.#emitError(err);
			return Promise.reject(err);
		}

		this.#userInitiated = false;
		this.#reconnectAttempt = 0;
		this.#lastUrl = url;
		return this.#openSocket(url);
	}

	disconnect(): void {
		if (this.#destroyed) return;
		this.#userInitiated = true;
		this.#cancelReconnect();
		this.#clearHeartbeat();
		this.#closeSocket(1000, "client disconnect");
		if (this.#pendingConnect) {
			this.#pendingConnect = null;
		}
		this.#setState("disconnected");
	}

	send(message: ClientMessage): void {
		if (!this.#socket) {
			throw new MisskeyClientError("Socket is not open", "not_connected");
		}
		this.#socket.send(JSON.stringify(message));
	}

	on<E extends ClientEvent>(event: E, handler: Listener<E>): () => void {
		const set = this.#listeners[event] as Set<Listener<E>>;
		set.add(handler);
		return () => {
			set.delete(handler);
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#userInitiated = true;
		this.#cancelReconnect();
		this.#clearHeartbeat();
		this.#closeSocket(1000, "client destroyed");
		this.#listeners.statechange.clear();
		this.#listeners.open.clear();
		this.#listeners.close.clear();
		this.#listeners.message.clear();
		this.#listeners.error.clear();
		this.#setState("disconnected");
	}

	#openSocket(url: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.#pendingConnect = { resolve, reject };
			this.#setState(this.#reconnectAttempt > 0 ? "reconnecting" : "connecting");

			let socket: WebSocketLike;
			try {
				socket = this.#socketFactory(url);
			} catch (err) {
				if (err instanceof MisskeyClientError && err.kind === "http_upgrade") {
					this.#terminateAsError(err);
					return;
				}
				const wrapped = new MisskeyClientError(
					`socketFactory threw: ${(err as Error).message}`,
					"connection",
				);
				this.#failConnect(wrapped);
				return;
			}
			this.#socket = socket;

			const onOpen = (): void => {
				this.#armHeartbeat();
				this.#setState("connected");
				this.#emit("open", undefined);
				const pending = this.#pendingConnect;
				this.#pendingConnect = null;
				pending?.resolve();
			};

			const onMessage = (event: { data?: unknown }): void => {
				if (typeof event.data !== "string") return;
				let parsed: ServerMessage;
				try {
					parsed = JSON.parse(event.data) as ServerMessage;
				} catch {
					return;
				}
				if (parsed.type === "ping") {
					this.#sendPong();
					this.#armHeartbeat();
					return;
				}
				if (parsed.type === "pong") {
					return;
				}
				this.#emit("message", parsed);
			};

			const onClose = (event: { code?: number; reason?: string }): void => {
				const code = typeof event.code === "number" ? event.code : 1005;
				const reason = typeof event.reason === "string" ? event.reason : "";
				this.#emit("close", { code, reason });
				this.#handleSocketClose(code);
			};

			const onError = (event: { error?: unknown }): void => {
				const raw = event.error;
				const message = raw instanceof Error ? raw.message : "WebSocket error";
				const err = new MisskeyClientError(message, "connection");
				this.#emitError(err);
			};

			socket.addEventListener("open", onOpen);
			socket.addEventListener("message", onMessage);
			socket.addEventListener("close", onClose);
			socket.addEventListener("error", onError);
		});
	}

	#sendPong(): void {
		if (!this.#socket) return;
		try {
			this.#socket.send(JSON.stringify({ type: "pong" }));
		} catch {
			// the next close event will trigger reconnect
		}
	}

	#armHeartbeat(): void {
		this.#clearHeartbeat();
		this.#heartbeatTimer = setTimeout(() => {
			this.#heartbeatTimer = null;
			const err = new MisskeyClientError(
				`No ping from server within ${HEARTBEAT_TIMEOUT_MS}ms`,
				"heartbeat_timeout",
			);
			this.#emitError(err);
			if (this.#socket) {
				try {
					this.#socket.close(HEARTBEAT_CLOSE_CODE, "heartbeat timeout");
				} catch {
					// ignore
				}
			}
		}, HEARTBEAT_TIMEOUT_MS);
	}

	#clearHeartbeat(): void {
		if (this.#heartbeatTimer !== null) {
			clearTimeout(this.#heartbeatTimer);
			this.#heartbeatTimer = null;
		}
	}

	#handleSocketClose(code: number): void {
		this.#clearHeartbeat();
		if (this.#userInitiated || this.#destroyed) {
			return;
		}
		if (this.#pendingConnect) {
			const err = new MisskeyClientError(
				`Socket closed before open (code=${code})`,
				"connection",
			);
			this.#failConnect(err);
			return;
		}
		this.#scheduleReconnect();
	}

	#failConnect(err: MisskeyClientError): void {
		this.#clearHeartbeat();
		this.#closeSocket(1006, "connect failed");
		if (this.#userInitiated || this.#destroyed) {
			const pending = this.#pendingConnect;
			this.#pendingConnect = null;
			pending?.reject(err);
			return;
		}
		this.#scheduleReconnect();
	}

	#terminateAsError(err: MisskeyClientError): void {
		this.#userInitiated = true;
		this.#cancelReconnect();
		this.#clearHeartbeat();
		this.#closeSocket(1006, "permanent error");
		this.#setState("error");
		this.#emitError(err);
		const pending = this.#pendingConnect;
		this.#pendingConnect = null;
		pending?.reject(err);
	}

	#scheduleReconnect(): void {
		if (this.#userInitiated || this.#destroyed) return;
		this.#setState("reconnecting");
		const idx = Math.min(this.#reconnectAttempt, BACKOFF_MS.length - 1);
		const delay = BACKOFF_MS[idx] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 60_000;
		this.#reconnectAttempt += 1;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			if (this.#userInitiated || this.#destroyed) return;
			if (this.#lastUrl === null) return;
			void this.#openSocket(this.#lastUrl);
		}, delay);
	}

	#cancelReconnect(): void {
		if (this.#reconnectTimer !== null) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	#closeSocket(code: number, reason: string): void {
		if (this.#socket) {
			try {
				this.#socket.close(code, reason);
			} catch {
				// ignore
			}
			this.#socket = null;
		}
	}

	#setState(next: ConnectionState): void {
		if (this.#state === next) return;
		const from = this.#state;
		this.#state = next;
		this.#emit("statechange", { from, to: next });
	}

	#emitError(error: MisskeyClientError): void {
		this.#emit("error", { error });
	}

	#emit<E extends ClientEvent>(event: E, payload: ClientEventPayloads[E]): void {
		const set = this.#listeners[event] as Set<Listener<E>>;
		for (const handler of [...set]) {
			try {
				(handler as Listener<E>)(payload);
			} catch {
				// listener errors must not break the client
			}
		}
	}
}

function buildStreamingUrl(input: string): string | null {
	if (typeof input !== "string" || input.length === 0) return null;
	const trimmed = input.trim().replace(/\/+$/, "");
	const match = /^(https?|wss?):\/\/([^/]+)$/i.exec(trimmed);
	if (!match) return null;
	const scheme = match[1]!.toLowerCase();
	const host = match[2]!;
	if (scheme === "https" || scheme === "wss") return `wss://${host}/streaming`;
	return `ws://${host}/streaming`;
}
