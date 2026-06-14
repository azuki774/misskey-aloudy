import { describe, expect, it, vi } from "vitest";
import { NoteQueue } from "./queue.ts";
import type { Note } from "../misskey/types.ts";

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

describe("NoteQueue: constructor", () => {
	it("defaults maxSize to 10", () => {
		const q = new NoteQueue();
		expect(q.size).toBe(0);
	});

	it("throws when maxSize is not a positive integer", () => {
		expect(() => new NoteQueue({ maxSize: 0 })).toThrow();
		expect(() => new NoteQueue({ maxSize: -1 })).toThrow();
	});
});

describe("NoteQueue: enqueue/dequeue FIFO", () => {
	it("single enqueue then dequeue returns the same note", () => {
		const q = new NoteQueue();
		const n = makeNote("n1");
		expect(q.enqueue(n)).toBeNull();
		expect(q.size).toBe(1);
		expect(q.dequeue()).toBe(n);
		expect(q.size).toBe(0);
	});

	it("three items come out in FIFO order", () => {
		const q = new NoteQueue();
		const a = makeNote("a");
		const b = makeNote("b");
		const c = makeNote("c");
		q.enqueue(a);
		q.enqueue(b);
		q.enqueue(c);
		expect(q.dequeue()).toBe(a);
		expect(q.dequeue()).toBe(b);
		expect(q.dequeue()).toBe(c);
		expect(q.dequeue()).toBeUndefined();
	});

	it("peek returns the front without removing", () => {
		const q = new NoteQueue();
		const a = makeNote("a");
		const b = makeNote("b");
		q.enqueue(a);
		q.enqueue(b);
		expect(q.peek()).toBe(a);
		expect(q.size).toBe(2);
		expect(q.peek()).toBe(a);
	});
});

describe("NoteQueue: overflow", () => {
	it("enqueue at capacity drops the oldest and returns it", () => {
		const q = new NoteQueue({ maxSize: 3 });
		const a = makeNote("a");
		const b = makeNote("b");
		const c = makeNote("c");
		const d = makeNote("d");
		q.enqueue(a);
		q.enqueue(b);
		q.enqueue(c);
		expect(q.enqueue(d)).toBe(a);
		expect(q.size).toBe(3);
		expect(q.dequeue()).toBe(b);
		expect(q.dequeue()).toBe(c);
		expect(q.dequeue()).toBe(d);
	});

	it("repeated overflow keeps cycling (oldest always dropped)", () => {
		const q = new NoteQueue({ maxSize: 2 });
		const a = makeNote("a");
		const b = makeNote("b");
		const c = makeNote("c");
		const d = makeNote("d");
		const e = makeNote("e");
		expect(q.enqueue(a)).toBeNull();
		expect(q.enqueue(b)).toBeNull();
		expect(q.enqueue(c)).toBe(a);
		expect(q.enqueue(d)).toBe(b);
		expect(q.enqueue(e)).toBe(c);
		expect(q.size).toBe(2);
		expect(q.dequeue()).toBe(d);
		expect(q.dequeue()).toBe(e);
	});

	it("maxSize: 1 boundary: every enqueue drops the previous", () => {
		const q = new NoteQueue({ maxSize: 1 });
		const a = makeNote("a");
		const b = makeNote("b");
		const c = makeNote("c");
		expect(q.enqueue(a)).toBeNull();
		expect(q.enqueue(b)).toBe(a);
		expect(q.enqueue(c)).toBe(b);
		expect(q.size).toBe(1);
		expect(q.dequeue()).toBe(c);
	});
});

describe("NoteQueue: clear", () => {
	it("clears and emits change with size 0", () => {
		const q = new NoteQueue();
		const a = makeNote("a");
		q.enqueue(a);
		const events: { size: number }[] = [];
		q.on("change", (p) => events.push(p));
		q.clear();
		expect(q.size).toBe(0);
		expect(events).toEqual([{ size: 0 }]);
	});

	it("clear on an empty queue is a no-op (no event)", () => {
		const q = new NoteQueue();
		const events: unknown[] = [];
		q.on("change", (p) => events.push(p));
		q.clear();
		expect(events).toEqual([]);
	});
});

describe("NoteQueue: on", () => {
	it("change fires on enqueue and dequeue but not on overflow or peek", () => {
		const q = new NoteQueue({ maxSize: 2 });
		const events: { size: number }[] = [];
		q.on("change", (p) => events.push(p));
		q.enqueue(makeNote("a"));
		q.enqueue(makeNote("b"));
		q.peek();
		q.enqueue(makeNote("c"));  // overflow: size stays 2
		q.dequeue();
		expect(events).toEqual([{ size: 1 }, { size: 2 }, { size: 1 }]);
	});

	it("unsubscribe removes the listener", () => {
		const q = new NoteQueue();
		const handler = vi.fn();
		const off = q.on("change", handler);
		off();
		q.enqueue(makeNote("a"));
		expect(handler).not.toHaveBeenCalled();
	});

	it("a throwing listener does not break sibling listeners", () => {
		const q = new NoteQueue();
		const good = vi.fn();
		q.on("change", () => {
			throw new Error("boom");
		});
		q.on("change", good);
		q.enqueue(makeNote("a"));
		expect(good).toHaveBeenCalledTimes(1);
	});
});

describe("NoteQueue: destroy", () => {
	it("is idempotent", () => {
		const q = new NoteQueue();
		q.destroy();
		expect(() => q.destroy()).not.toThrow();
	});

	it("post-destroy mutators are no-ops", () => {
		const q = new NoteQueue();
		q.destroy();
		expect(q.enqueue(makeNote("a"))).toBeNull();
		expect(q.dequeue()).toBeUndefined();
		expect(q.peek()).toBeUndefined();
		expect(q.size).toBe(0);
	});

	it("throws for unsupported event names", () => {
		const q = new NoteQueue();
		expect(() => q.on("add" as never, () => {})).toThrow();
	});
});
