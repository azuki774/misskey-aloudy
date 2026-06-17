import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaybackPipeline } from "./pipeline.ts";
import { PlaybackState } from "./state.ts";
import type { Note } from "../misskey/types.ts";
import type { VoiceVoxPlayer } from "../voicevox/player.ts";
import type { SynthesizeOptions } from "../voicevox/types.ts";

class MockPlayer {
	playResolvers: Array<() => void> = [];
	playCalls: ArrayBuffer[] = [];
	stopped = false;
	destroyed = false;

	async play(buffer: ArrayBuffer): Promise<void> {
		if (this.destroyed) {
			throw new Error("Player has been destroyed");
		}
		this.playCalls.push(buffer);
		return new Promise<void>((resolve) => {
			this.playResolvers.push(resolve);
		});
	}

	stop(): void {
		this.stopped = true;
		// resolve all pending play promises (simulating the audio being interrupted)
		const resolvers = this.playResolvers.splice(0);
		for (const r of resolvers) r();
	}

	destroy(): void {
		this.destroyed = true;
		this.stop();
	}

	finishCurrent(): void {
		const r = this.playResolvers.shift();
		if (r) r();
	}
}

function asVoiceVoxPlayer(mock: MockPlayer): VoiceVoxPlayer {
	return mock as unknown as VoiceVoxPlayer;
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

async function tick(): Promise<void> {
	await new Promise<void>((r) => setTimeout(r, 0));
}

let mockPlayer: MockPlayer;
let pipeline: PlaybackPipeline;
let synthesize: ReturnType<typeof vi.fn<(opts: SynthesizeOptions) => Promise<ArrayBuffer>>>;

beforeEach(() => {
	mockPlayer = new MockPlayer();
	synthesize = vi.fn<(opts: SynthesizeOptions) => Promise<ArrayBuffer>>(
		async () => new TextEncoder().encode("RIFF....WAVE").buffer,
	);
	pipeline = new PlaybackPipeline({
		player: asVoiceVoxPlayer(mockPlayer),
		synthesize,
	});
});

afterEach(() => {
	pipeline.destroy();
});

describe("PlaybackPipeline: enqueue", () => {
	it("a single note goes through enqueue -> synthesize -> play -> ended", async () => {
		const events: string[] = [];
		pipeline.on("noteStart", ({ note }) => events.push(`start:${note.id}`));
		pipeline.on("noteEnd", ({ note }) => events.push(`end:${note.id}`));
		pipeline.on("queueChange", ({ size }) => events.push(`q:${size}`));

		pipeline.enqueue(makeNote("n1"));
		await tick();
		// play has been called
		expect(mockPlayer.playCalls).toHaveLength(1);
		expect(synthesize).toHaveBeenCalledTimes(1);

		mockPlayer.finishCurrent();
		await tick();
		expect(pipeline.state.state).toBe("idle");
		expect(pipeline.state.currentNote).toBeNull();
		expect(events).toEqual(["q:1", "q:0", `start:n1`, `end:n1`]);
	});

	it("passes the default speedScale to synthesize", async () => {
		pipeline.enqueue(makeNote("n1"));
		await tick();
		expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({ speedScale: 1.1 }));
	});

	it("two notes in sequence: second plays after the first ends", async () => {
		pipeline.enqueue(makeNote("n1"));
		pipeline.enqueue(makeNote("n2"));
		await tick();

		expect(mockPlayer.playCalls).toHaveLength(1);
		mockPlayer.finishCurrent();
		await tick();

		expect(mockPlayer.playCalls).toHaveLength(2);
		expect(synthesize).toHaveBeenCalledTimes(2);
		expect(pipeline.state.state).toBe("playing");
		expect(pipeline.state.currentNote?.id).toBe("n2");

		mockPlayer.finishCurrent();
		await tick();
		expect(pipeline.state.state).toBe("idle");
	});

	it("enqueue on a destroyed pipeline is a no-op", async () => {
		pipeline.destroy();
		pipeline.enqueue(makeNote("n1"));
		await tick();
		expect(synthesize).not.toHaveBeenCalled();
		expect(mockPlayer.playCalls).toHaveLength(0);
	});

	it("overflow enqueues silently (the dropped note is not surfaced as an error event)", async () => {
		const errors: unknown[] = [];
		pipeline.on("error", (e) => errors.push(e));
		for (let i = 0; i < 15; i++) pipeline.enqueue(makeNote(`n${i}`));
		await tick();
		expect(errors).toEqual([]);
	});
});

describe("PlaybackPipeline: stop", () => {
	it("stop() during play sets state to paused", async () => {
		pipeline.enqueue(makeNote("n1"));
		await tick();
		expect(pipeline.state.state).toBe("playing");

		pipeline.stop();
		expect(pipeline.state.state).toBe("paused");
	});

	it("queue is preserved across stop()", async () => {
		pipeline.enqueue(makeNote("n1"));
		pipeline.enqueue(makeNote("n2"));
		pipeline.enqueue(makeNote("n3"));
		await tick();
		mockPlayer.finishCurrent();
		await tick();
		// now playing n2
		expect(pipeline.state.currentNote?.id).toBe("n2");

		pipeline.stop();
		expect(pipeline.queue.size).toBe(1); // n3 still queued
		expect(pipeline.state.state).toBe("paused");
	});

	it("start() after stop() resumes from the next queued note", async () => {
		pipeline.enqueue(makeNote("n1"));
		pipeline.enqueue(makeNote("n2"));
		await tick();
		mockPlayer.finishCurrent();
		await tick();
		expect(pipeline.state.currentNote?.id).toBe("n2");

		pipeline.stop();
		pipeline.start();
		await tick();
		expect(mockPlayer.playCalls.length).toBeGreaterThanOrEqual(2);
		expect(pipeline.state.currentNote?.id).toBe("n2");
	});

	it("start() on an empty queue is a no-op", async () => {
		pipeline.start();
		await tick();
		expect(mockPlayer.playCalls).toHaveLength(0);
		expect(pipeline.state.state).toBe("idle");
	});
});

describe("PlaybackPipeline: error", () => {
	it("synthesize failure emits 'error' and continues to the next note", async () => {
		const note1 = makeNote("n1");
		const note2 = makeNote("n2");
		synthesize
			.mockRejectedValueOnce(new Error("synth failed"))
			.mockResolvedValueOnce(new TextEncoder().encode("RIFF").buffer);

		const errors: { error: Error; note: Note }[] = [];
		pipeline.on("error", (e) => errors.push(e));

		pipeline.enqueue(note1);
		pipeline.enqueue(note2);
		await tick();
		// n1 failed; n2 should be picked up
		expect(errors).toHaveLength(1);
		expect(errors[0]?.note.id).toBe("n1");
		expect(mockPlayer.playCalls).toHaveLength(1);
		expect(pipeline.state.currentNote?.id).toBe("n2");

		mockPlayer.finishCurrent();
		await tick();
		expect(pipeline.state.state).toBe("idle");
	});

	it("player.play failure emits 'error' and continues to the next note", async () => {
		const note1 = makeNote("n1");
		const note2 = makeNote("n2");
		// synthesize works, but we sabotage play by destroying the player mid-flight
		// (simpler: wrap the mockPlayer.play to reject on the first call)
		const origPlay = mockPlayer.play.bind(mockPlayer);
		let call = 0;
		mockPlayer.play = async (buf) => {
			call += 1;
			if (call === 1) throw new Error("autoplay blocked");
			return origPlay(buf);
		};

		const errors: { error: Error; note: Note }[] = [];
		pipeline.on("error", (e) => errors.push(e));

		pipeline.enqueue(note1);
		pipeline.enqueue(note2);
		await tick();
		// n1's play() threw; n2 should be picked up
		expect(errors.length).toBeGreaterThanOrEqual(1);
		expect(errors[0]?.note.id).toBe("n1");
		expect(pipeline.state.currentNote?.id).toBe("n2");
	});
});

describe("PlaybackPipeline: destroy", () => {
	it("honors a custom defaultSpeed option", async () => {
		const localPlayer = new MockPlayer();
		const localSynth = vi.fn(async () => new TextEncoder().encode("RIFF").buffer);
		const localPipeline = new PlaybackPipeline({
			player: asVoiceVoxPlayer(localPlayer),
			synthesize: localSynth,
			defaultSpeed: 1.5,
		});
		expect(localPipeline.defaultSpeed).toBe(1.5);
		localPipeline.enqueue(makeNote("n1"));
		await tick();
		expect(localSynth).toHaveBeenCalledWith(expect.objectContaining({ speedScale: 1.5 }));
		localPipeline.destroy();
	});

	it("is idempotent", () => {
		pipeline.destroy();
		expect(() => pipeline.destroy()).not.toThrow();
	});

	it("post-destroy enqueue/start/stop are no-ops", async () => {
		pipeline.destroy();
		pipeline.enqueue(makeNote("n1"));
		pipeline.start();
		pipeline.stop();
		await tick();
		expect(synthesize).not.toHaveBeenCalled();
		expect(mockPlayer.playCalls).toHaveLength(0);
	});

	it("does not destroy the supplied PlaybackState", () => {
		const state = new PlaybackState();
		const localPlayer = new MockPlayer();
		const localPipeline = new PlaybackPipeline({
			player: asVoiceVoxPlayer(localPlayer),
			state,
		});
		localPipeline.destroy();
		// state should still be usable
		state.setState("paused");
		expect(state.state).toBe("paused");
	});
});

describe("PlaybackPipeline: state", () => {
	it("transitions through loading -> playing on a successful note", async () => {
		const states: string[] = [];
		const s = new PlaybackState();
		const localPlayer = new MockPlayer();
		const localPipeline = new PlaybackPipeline({
			player: asVoiceVoxPlayer(localPlayer),
			state: s,
			synthesize,
		});
		s.on("statechange", ({ to }) => states.push(to));

		localPipeline.enqueue(makeNote("n1"));
		await tick();
		localPlayer.finishCurrent();
		await tick();
		localPipeline.destroy();
		expect(states).toEqual(["loading", "playing", "idle"]);
	});

	it("updates currentNote on each note", async () => {
		pipeline.enqueue(makeNote("n1"));
		pipeline.enqueue(makeNote("n2"));
		await tick();
		expect(pipeline.state.currentNote?.id).toBe("n1");
		mockPlayer.finishCurrent();
		await tick();
		expect(pipeline.state.currentNote?.id).toBe("n2");
		mockPlayer.finishCurrent();
		await tick();
		expect(pipeline.state.currentNote).toBeNull();
	});
});

describe("PlaybackPipeline: queueChange", () => {
	it("emits on enqueue and dequeue", async () => {
		const sizes: number[] = [];
		pipeline.on("queueChange", ({ size }) => sizes.push(size));
		pipeline.enqueue(makeNote("n1"));
		pipeline.enqueue(makeNote("n2"));
		await tick();
		mockPlayer.finishCurrent();
		await tick();
		mockPlayer.finishCurrent();
		await tick();
		// 2 enqueues (size 1, then 1 again because the loop already dequeued)
		// and 2 dequeues (size 0 twice) = 4 events
		expect(sizes).toEqual([1, 0, 1, 0]);
	});
});
