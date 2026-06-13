import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeGlobalTimeline } from "./globalTimeline.ts";
import { MisskeyClientError } from "./errors.ts";
import type { MisskeyClient } from "./client.ts";
import type { ClientMessage, Note, ServerMessage } from "./types.ts";

type AnyListener = (payload: unknown) => void;

type EventName = "statechange" | "open" | "close" | "message" | "error";

class MockMisskeyClient {
	#state: "disconnected" | "connecting" | "connected" | "reconnecting" | "error" = "disconnected";
	#listeners: { [E in EventName]: Set<AnyListener> } = {
		statechange: new Set(),
		open: new Set(),
		close: new Set(),
		message: new Set(),
		error: new Set(),
	};
	sentMessages: ClientMessage[] = [];

	get state(): "disconnected" | "connecting" | "connected" | "reconnecting" | "error" {
		return this.#state;
	}

	send(message: ClientMessage): void {
		if (this.#state !== "connected") {
			throw new MisskeyClientError("Socket is not open", "not_connected");
		}
		this.sentMessages.push(message);
	}

	on(event: EventName, listener: AnyListener): () => void {
		const set = this.#listeners[event];
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	transitionTo(next: "disconnected" | "connecting" | "connected" | "reconnecting" | "error"): void {
		const from = this.#state;
		this.#state = next;
		const set = this.#listeners.statechange;
		for (const fn of [...set]) fn({ from, to: next });
	}

	deliverMessage(message: ServerMessage): void {
		const set = this.#listeners.message;
		for (const fn of [...set]) fn(message);
	}
}

function makeNote(id: string): Note {
	return {
		id,
		createdAt: "2026-06-13T00:00:00.000Z",
		text: `note ${id}`,
		userId: "u1",
		user: {
			id: "u1",
			name: "alice",
			username: "alice",
			host: null,
			avatarUrl: "https://example/avatar.png",
			avatarBlurhash: null,
			avatarDecorations: [],
			emojis: {},
			onlineStatus: "online",
		},
		visibility: "public",
		reactionAcceptance: null,
		reactionEmojis: {},
		reactions: {},
		reactionCount: 0,
		renoteCount: 0,
		repliesCount: 0,
	};
}

function asClient(mock: MockMisskeyClient): MisskeyClient {
	return mock as unknown as MisskeyClient;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("subscribeGlobalTimeline", () => {
	it("sends a connect message immediately when the client is already connected", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		mock.sentMessages.length = 0;

		subscribeGlobalTimeline(asClient(mock), () => {});

		expect(mock.sentMessages).toEqual([
			{ type: "connect", body: { channel: "globalTimeline", id: "1" } },
		]);
	});

	it("defers the connect message when the client is disconnected and sends it on connect", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("disconnected");
		mock.sentMessages.length = 0;

		subscribeGlobalTimeline(asClient(mock), () => {});

		// No send yet, because we are not connected
		expect(mock.sentMessages).toEqual([]);

		// Now the user calls client.connect() and the socket comes up
		mock.transitionTo("connecting");
		expect(mock.sentMessages).toEqual([]);

		mock.transitionTo("connected");
		expect(mock.sentMessages).toEqual([
			{ type: "connect", body: { channel: "globalTimeline", id: "2" } },
		]);
	});

	it("throws when called twice on the same client without an unsubscribe", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		mock.sentMessages.length = 0;

		subscribeGlobalTimeline(asClient(mock), () => {});

		expect(() => subscribeGlobalTimeline(asClient(mock), () => {})).toThrow(MisskeyClientError);
		expect(() => subscribeGlobalTimeline(asClient(mock), () => {})).toThrow(
			/Already subscribed/,
		);
	});

	it("allows subscribing to two different clients independently", () => {
		const a = new MockMisskeyClient();
		const b = new MockMisskeyClient();
		a.transitionTo("connected");
		b.transitionTo("connected");
		a.sentMessages.length = 0;
		b.sentMessages.length = 0;

		subscribeGlobalTimeline(asClient(a), () => {});
		subscribeGlobalTimeline(asClient(b), () => {});

		expect(a.sentMessages).toHaveLength(1);
		expect(b.sentMessages).toHaveLength(1);
	});

	it("invokes the callback on a matching note event", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		const received: Note[] = [];
		subscribeGlobalTimeline(asClient(mock), (note) => received.push(note));

		const channelId = (mock.sentMessages[0]?.body as { id?: string }).id ?? "";
		expect(channelId).not.toBe("");

		mock.deliverMessage({
			type: "channel",
			body: { id: channelId, type: "note", body: makeNote("n1") },
		});

		expect(received).toEqual([expect.objectContaining({ id: "n1" })]);
	});

	it("ignores channel events for a different id", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		const received: Note[] = [];
		subscribeGlobalTimeline(asClient(mock), (note) => received.push(note));

		mock.deliverMessage({
			type: "channel",
			body: { id: "other-channel", type: "note", body: makeNote("n1") },
		});

		expect(received).toEqual([]);
	});

	it("ignores channel events whose type is not 'note'", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		const received: Note[] = [];
		subscribeGlobalTimeline(asClient(mock), (note) => received.push(note));

		const channelId = (mock.sentMessages[0]?.body as { id?: string }).id ?? "";
		mock.deliverMessage({
			type: "channel",
			body: { id: channelId, type: "stats", body: {} },
		});

		expect(received).toEqual([]);
	});

	it("ignores non-channel server messages", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		const received: Note[] = [];
		subscribeGlobalTimeline(asClient(mock), (note) => received.push(note));

		mock.deliverMessage({ type: "pong" } as unknown as ServerMessage);

		expect(received).toEqual([]);
	});
});

describe("subscribeGlobalTimeline unsubscribe", () => {
	it("detaches the message listener; further events do not invoke the callback", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		const received: Note[] = [];
		const off = subscribeGlobalTimeline(asClient(mock), (note) => received.push(note));

		const channelId = (mock.sentMessages[0]?.body as { id?: string }).id ?? "";
		off();

		mock.deliverMessage({
			type: "channel",
			body: { id: channelId, type: "note", body: makeNote("n1") },
		});

		expect(received).toEqual([]);
	});

	it("sends a disconnect message with the correct id when the client is connected", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		mock.sentMessages.length = 0;
		const off = subscribeGlobalTimeline(asClient(mock), () => {});

		const channelId = (mock.sentMessages[0]?.body as { id?: string }).id ?? "";
		off();

		expect(mock.sentMessages).toContainEqual({ type: "disconnect", body: { id: channelId } });
	});

	it("does not attempt to send disconnect if the client is not connected", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("disconnected");
		const off = subscribeGlobalTimeline(asClient(mock), () => {});

		off();

		expect(mock.sentMessages).toEqual([]);
	});

	it("is idempotent", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		const off = subscribeGlobalTimeline(asClient(mock), () => {});

		off();
		off();
		off();

		// Only one disconnect was sent
		const disconnects = mock.sentMessages.filter((m) => m.type === "disconnect");
		expect(disconnects).toHaveLength(1);
	});
});

describe("subscribeGlobalTimeline auto-resubscribe", () => {
	it("re-sends the connect message when the client reconnects after a drop", () => {
		const mock = new MockMisskeyClient();
		mock.transitionTo("connected");
		mock.sentMessages.length = 0;
		subscribeGlobalTimeline(asClient(mock), () => {});

		mock.transitionTo("reconnecting");
		mock.transitionTo("connecting");
		mock.transitionTo("connected");

		const connectMessages = mock.sentMessages.filter(
			(m) => m.type === "connect" && m.body.channel === "globalTimeline",
		);
		expect(connectMessages).toHaveLength(2);
		expect(connectMessages[0]?.body.id).toBe(connectMessages[1]?.body.id);
	});
});
