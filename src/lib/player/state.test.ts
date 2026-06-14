import { describe, expect, it, vi } from "vitest";
import { PlaybackState } from "./state.ts";
import type { Note } from "../misskey/types.ts";
import type { PlaybackStateKind } from "./state.ts";

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

describe("PlaybackState: constructor", () => {
	it("defaults to state='idle' and currentNote=null", () => {
		const state = new PlaybackState();
		expect(state.state).toBe("idle");
		expect(state.currentNote).toBeNull();
	});
});

describe("PlaybackState: setState", () => {
	type Case = { description: string; from: PlaybackStateKind; to: PlaybackStateKind };
	const cases: Case[] = [
		{ description: "idle -> loading", from: "idle", to: "loading" },
		{ description: "loading -> playing", from: "loading", to: "playing" },
		{ description: "playing -> paused", from: "playing", to: "paused" },
		{ description: "playing -> error", from: "playing", to: "error" },
		{ description: "error -> idle", from: "error", to: "idle" },
	];

	it.each(cases)(
		"emits statechange on $description",
		({ from, to }: Case) => {
		const state = new PlaybackState({ state: from });
		const events: { from: PlaybackStateKind; to: PlaybackStateKind }[] = [];
		state.on("statechange", (p) => events.push(p));
		state.setState(to);
		expect(events).toEqual([{ from, to }]);
		expect(state.state).toBe(to);
	});

	it("does not emit when the new state equals the current state", () => {
		const state = new PlaybackState({ state: "playing" });
		const events: unknown[] = [];
		state.on("statechange", (p) => events.push(p));
		state.setState("playing");
		expect(events).toEqual([]);
		expect(state.state).toBe("playing");
	});
});

describe("PlaybackState: setCurrentNote", () => {
	type Case = { description: string; from: string | null; to: string | null };
	const cases: Case[] = [
		{ description: "null -> note", from: null, to: "n1" },
		{ description: "note -> null", from: "n1", to: null },
		{ description: "note A -> note B", from: "n1", to: "n2" },
	];

	it.each(cases)(
		"emits notechange on $description",
		({ from, to }: Case) => {
		const state = new PlaybackState();
		const events: { from: Note | null; to: Note | null }[] = [];
		state.on("notechange", (p) => events.push(p));
		const fromNote = from ? makeNote(from) : null;
		const toNote = to ? makeNote(to) : null;
		if (fromNote !== null) state.setCurrentNote(fromNote);
		events.length = 0;
		state.setCurrentNote(toNote);
		expect(events).toEqual([{ from: fromNote, to: toNote }]);
		expect(state.currentNote).toBe(toNote);
	});

	it("does not emit when setting the same note reference (===)", () => {
		const note = makeNote("n1");
		const state = new PlaybackState({ currentNote: note });
		const events: unknown[] = [];
		state.on("notechange", (p) => events.push(p));
		state.setCurrentNote(note);
		expect(events).toEqual([]);
		expect(state.currentNote).toBe(note);
	});

	it("emits when a different object with the same id is set (reference inequality)", () => {
		const original = makeNote("n1");
		const clone = makeNote("n1");
		const state = new PlaybackState({ currentNote: original });
		const events: unknown[] = [];
		state.on("notechange", (p) => events.push(p));
		state.setCurrentNote(clone);
		expect(events).toHaveLength(1);
		expect(state.currentNote).toBe(clone);
	});
});

describe("PlaybackState: on", () => {
	it("returns an unsubscribe function that removes the listener", () => {
		const state = new PlaybackState();
		const handler = vi.fn();
		const off = state.on("statechange", handler);
		off();
		state.setState("loading");
		expect(handler).not.toHaveBeenCalled();
	});

	it("a throwing listener does not break sibling listeners", () => {
		const state = new PlaybackState();
		const good = vi.fn();
		state.on("statechange", () => {
			throw new Error("boom");
		});
		state.on("statechange", good);
		state.setState("loading");
		expect(good).toHaveBeenCalledTimes(1);
	});
});

describe("PlaybackState: destroy", () => {
	it("is idempotent", () => {
		const state = new PlaybackState();
		state.destroy();
		expect(() => state.destroy()).not.toThrow();
	});

	it("makes subsequent setState a no-op", () => {
		const state = new PlaybackState();
		const events: unknown[] = [];
		state.on("statechange", (p) => events.push(p));
		state.destroy();
		state.setState("loading");
		expect(events).toEqual([]);
		expect(state.state).toBe("idle");
	});

	it("makes subsequent setCurrentNote a no-op", () => {
		const state = new PlaybackState();
		const events: unknown[] = [];
		state.on("notechange", (p) => events.push(p));
		state.destroy();
		state.setCurrentNote(makeNote("n1"));
		expect(events).toEqual([]);
		expect(state.currentNote).toBeNull();
	});
});
