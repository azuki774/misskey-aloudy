import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MisskeyClient } from "./client.ts";
import { MisskeyClientError } from "./errors.ts";
import type { WebSocketLike, WebSocketLikeEvent } from "./client.ts";
import type { ClientMessage } from "./types.ts";

const READY_STATE = {
	CONNECTING: 0,
	OPEN: 1,
	CLOSING: 2,
	CLOSED: 3,
} as const;

type AnyListener = (event: WebSocketLikeEvent) => void;

class MockWebSocket implements WebSocketLike {
	readyState: number = READY_STATE.CONNECTING;
	#listeners = new Map<"open" | "close" | "message" | "error", Set<AnyListener>>();
	sentFrames: string[] = [];
	closeArgs: { code?: number; reason?: string } | null = null;

	addEventListener(type: "open" | "close" | "message" | "error", listener: AnyListener): void {
		let set = this.#listeners.get(type);
		if (!set) {
			set = new Set();
			this.#listeners.set(type, set);
		}
		set.add(listener);
	}

	removeEventListener(type: "open" | "close" | "message" | "error", listener: AnyListener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		if (this.readyState !== READY_STATE.OPEN) {
			throw new Error("send while not open");
		}
		this.sentFrames.push(data);
	}

	close(code?: number, reason?: string): void {
		this.closeArgs = { code, reason };
		this.readyState = READY_STATE.CLOSED;
		this.dispatch("close", { code, reason: reason ?? "" });
	}

	dispatch(type: "open" | "close" | "message" | "error", event: WebSocketLikeEvent = {}): void {
		const set = this.#listeners.get(type);
		if (!set) return;
		for (const fn of [...set]) fn(event);
	}

	open(): void {
		this.readyState = READY_STATE.OPEN;
		this.dispatch("open", {});
	}

	deliverMessage(payload: unknown): void {
		this.dispatch("message", { data: JSON.stringify(payload) });
	}

	deliverRaw(data: string): void {
		this.dispatch("message", { data });
	}

	deliverMalformed(): void {
		this.dispatch("message", { data: "this is not json" });
	}

	closeWithCode(code: number, reason = ""): void {
		this.readyState = READY_STATE.CLOSED;
		this.dispatch("close", { code, reason });
	}

	errorWith(err: unknown): void {
		this.dispatch("error", { error: err });
	}
}

function makeFactory(): { factory: ReturnType<typeof vi.fn<(url: string) => WebSocketLike>>; sockets: MockWebSocket[] } {
	const sockets: MockWebSocket[] = [];
	const factory = vi.fn((_url: string) => {
		const sock = new MockWebSocket();
		sockets.push(sock);
		return sock as unknown as WebSocketLike;
	});
	return { factory, sockets };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("MisskeyClient.connect", () => {
	it("transitions to connecting then connected on successful open", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });

		const states: string[] = [];
		client.on("statechange", ({ to }) => states.push(to));

		const promise = client.connect("https://misskey.example");
		expect(client.state).toBe("connecting");
		expect(factory).toHaveBeenCalledWith("wss://misskey.example/streaming");

		const sock = sockets[0]!;
		sock.open();

		await promise;
		expect(client.state).toBe("connected");
		expect(states).toEqual(["connecting", "connected"]);
	});

	it("rejects with invalid_url for a malformed URL and lands in error", async () => {
		const client = new MisskeyClient({ socketFactory: makeFactory().factory });
		await expect(client.connect("not a url")).rejects.toBeInstanceOf(MisskeyClientError);
		await expect(client.connect("not a url")).rejects.toMatchObject({ kind: "invalid_url" });
		expect(client.state).toBe("error");
	});

	it("rejects with invalid_url for an empty string", async () => {
		const client = new MisskeyClient({ socketFactory: makeFactory().factory });
		await expect(client.connect("")).rejects.toMatchObject({ kind: "invalid_url" });
	});

	it("converts http:// to ws:// and https:// to wss://", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		void client.connect("http://misskey.example");
		expect(factory).toHaveBeenCalledWith("ws://misskey.example/streaming");
		sockets[0]?.open();
		await vi.runAllTimersAsync();
	});

	it("rejects if the socketFactory throws a MisskeyClientError(http_upgrade) and lands in error", async () => {
		const factory = vi.fn((_url: string): WebSocketLike => {
			throw new MisskeyClientError("404 Not Found", "http_upgrade", 404);
		});
		const client = new MisskeyClient({ socketFactory: factory });
		await expect(client.connect("https://missing.example")).rejects.toMatchObject({
			kind: "http_upgrade",
			status: 404,
		});
		expect(client.state).toBe("error");
	});

	it("rejects if connect is called twice in a row", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		void client.connect("https://misskey.example");
		sockets[0]?.open();
		await expect(client.connect("https://misskey.example")).rejects.toMatchObject({
			kind: "connection",
		});
	});

	it("rejects with destroyed after destroy()", async () => {
		const { factory } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		client.destroy();
		await expect(client.connect("https://misskey.example")).rejects.toMatchObject({
			kind: "destroyed",
		});
	});
});

describe("MisskeyClient.disconnect", () => {
	it("closes the socket, lands in disconnected, and prevents reconnect", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		const sock = sockets[0]!;
		sock.open();
		await p;

		client.disconnect();
		expect(sock.closeArgs?.code).toBe(1000);
		expect(client.state).toBe("disconnected");

		vi.advanceTimersByTime(120_000);
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("is idempotent", async () => {
		const client = new MisskeyClient({ socketFactory: makeFactory().factory });
		client.disconnect();
		client.disconnect();
		expect(client.state).toBe("disconnected");
	});
});

describe("MisskeyClient.send", () => {
	it("serializes and forwards a ClientMessage to the socket", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		const sock = sockets[0]!;
		sock.open();
		await p;

		const msg: ClientMessage = {
			type: "connect",
			body: { channel: "globalTimeline", id: "1" },
		};
		client.send(msg);
		expect(sock.sentFrames).toEqual([JSON.stringify(msg)]);
	});

	it("throws not_connected when the socket is not open", () => {
		const client = new MisskeyClient({ socketFactory: makeFactory().factory });
		expect(() => client.send({ type: "ping" } as unknown as ClientMessage)).toThrow(
			MisskeyClientError,
		);
	});
});

describe("MisskeyClient heartbeat", () => {
	it("replies to a server ping with a pong and resets the watchdog", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		const sock = sockets[0]!;
		sock.open();
		await p;

		sock.deliverMessage({ type: "ping" });
		expect(sock.sentFrames).toContain(JSON.stringify({ type: "pong" }));

		// 30s pass with a follow-up ping — watchdog should not fire
		vi.advanceTimersByTime(30_000);
		sock.deliverMessage({ type: "ping" });
		vi.advanceTimersByTime(59_000);
		expect(client.state).toBe("connected");

		// 60s without ping should fire the watchdog
		vi.advanceTimersByTime(2_000);
		expect(sock.closeArgs?.code).toBe(4_000);
		expect(client.state).not.toBe("connected");
	});

	it("ignores messages that are not strings and silently drops malformed JSON", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const messages: unknown[] = [];
		client.on("message", (m) => messages.push(m));

		const p = client.connect("https://misskey.example");
		const sock = sockets[0]!;
		sock.open();
		await p;

		sock.deliverMalformed();
		sock.deliverRaw("");
		sock.deliverMessage({ type: "note", body: { id: "n1" } });
		expect(messages).toHaveLength(1);
	});
});

describe("MisskeyClient reconnection", () => {
	it("reconnects with exponential backoff after an unexpected close", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		const first = sockets[0]!;
		first.open();
		await p;

		first.closeWithCode(1006, "abnormal");
		expect(client.state).toBe("reconnecting");

		vi.advanceTimersByTime(1_000);
		await vi.runOnlyPendingTimersAsync();
		expect(factory).toHaveBeenCalledTimes(2);

		const second = sockets[1]!;
		second.open();
		await Promise.resolve();
		expect(client.state).toBe("connected");
	});

	it("progresses the backoff table: 1s, 2s, 4s, 8s, 16s, 60s, 60s", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;

		const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 60_000, 60_000];

		for (let i = 0; i < expectedDelays.length; i++) {
			const idx = i;
			const sock = sockets[idx]!;
			sock.closeWithCode(1006, "boom");

			// Don't tick the timer yet — factory count should not change
			vi.advanceTimersByTime(expectedDelays[idx]! - 1);
			expect(factory).toHaveBeenCalledTimes(idx + 1);

			// Tick one more ms to fire the timer
			vi.advanceTimersByTime(1);
			await Promise.resolve();
			expect(factory).toHaveBeenCalledTimes(idx + 2);

			// Open the new socket so the client transitions to "connected",
			// making it ready for the next close.
			sockets[idx + 1]!.open();
			await Promise.resolve();
			expect(client.state).toBe("connected");
		}
	});

	it("does not reconnect after a clean close following disconnect()", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;
		client.disconnect();
		vi.advanceTimersByTime(120_000);
		expect(factory).toHaveBeenCalledTimes(1);
	});

	it("emits a connection error when the underlying socket errors out", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const errors: MisskeyClientError[] = [];
		client.on("error", ({ error }) => errors.push(error));

		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;
		sockets[0]!.errorWith(new Error("ECONNRESET"));
		sockets[0]!.closeWithCode(1006);
		expect(errors.some((e) => e.message.includes("ECONNRESET"))).toBe(true);
	});
});

describe("MisskeyClient.on", () => {
	it("returns an unsubscribe function", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const handler = vi.fn();
		const off = client.on("message", handler);

		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;
		sockets[0]!.deliverMessage({ type: "note", body: { id: "n1" } });
		expect(handler).toHaveBeenCalledTimes(1);

		off();
		sockets[0]!.deliverMessage({ type: "note", body: { id: "n2" } });
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("a throwing listener does not break other listeners", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const good = vi.fn();
		client.on("message", () => {
			throw new Error("boom");
		});
		client.on("message", good);

		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;
		sockets[0]!.deliverMessage({ type: "note", body: { id: "n1" } });
		expect(good).toHaveBeenCalled();
	});
});

describe("MisskeyClient.destroy", () => {
	it("cancels timers, clears listeners, and rejects subsequent connect()", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;

		const handler = vi.fn();
		client.on("statechange", handler);
		client.destroy();
		expect(sockets[0]!.closeArgs?.code).toBe(1000);

		vi.advanceTimersByTime(120_000);
		expect(factory).toHaveBeenCalledTimes(1);

		await expect(client.connect("https://misskey.example")).rejects.toMatchObject({
			kind: "destroyed",
		});
	});

	it("is idempotent", () => {
		const client = new MisskeyClient({ socketFactory: makeFactory().factory });
		client.destroy();
		expect(() => client.destroy()).not.toThrow();
	});
});

describe("MisskeyClient state event", () => {
	it("emits statechange with from/to on every transition", async () => {
		const { factory, sockets } = makeFactory();
		const client = new MisskeyClient({ socketFactory: factory });
		const events: { from: string; to: string }[] = [];
		client.on("statechange", ({ from, to }) => events.push({ from, to }));

		const p = client.connect("https://misskey.example");
		sockets[0]!.open();
		await p;
		client.disconnect();
		expect(events).toEqual([
			{ from: "disconnected", to: "connecting" },
			{ from: "connecting", to: "connected" },
			{ from: "connected", to: "disconnected" },
		]);
	});
});
