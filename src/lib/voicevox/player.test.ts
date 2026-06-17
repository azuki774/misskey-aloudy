import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceVoxPlayer } from "./player.ts";
import { VoiceVoxPlayerError } from "./errors.ts";
import type { PlayerState } from "./types.ts";

type Listener = (event: Event) => void;

class MockAudioElement {
	src = "";
	currentTime = 0;
	duration = NaN;
	paused = true;
	play = vi.fn(async (): Promise<void> => {
		this.paused = false;
	});
	pause = vi.fn((): void => {
		this.paused = true;
	});
	load = vi.fn((): void => {});
	#listeners = new Map<string, Set<Listener>>();

	addEventListener = vi.fn((type: string, listener: Listener): void => {
		let set = this.#listeners.get(type);
		if (!set) {
			set = new Set();
			this.#listeners.set(type, set);
		}
		set.add(listener);
	});

	removeEventListener = vi.fn((type: string, listener: Listener): void => {
		this.#listeners.get(type)?.delete(listener);
	});

	dispatch(type: "ended" | "error"): void {
		const set = this.#listeners.get(type);
		if (!set) return;
		for (const fn of [...set]) fn(new Event(type));
	}
}

function makeBuffer(...bytes: number[]): ArrayBuffer {
	const arr = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) arr[i] = bytes[i] ?? 0;
	return arr.buffer;
}

function createPlayer(): { player: VoiceVoxPlayer; audio: MockAudioElement } {
	const audio = new MockAudioElement();
	const player = new VoiceVoxPlayer({ audioFactory: () => audio as unknown as HTMLAudioElement });
	return { player, audio };
}

let originalAudio: typeof globalThis.Audio | undefined;
let originalBlob: typeof globalThis.Blob | undefined;
let originalURL: typeof globalThis.URL | undefined;
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
	originalAudio = globalThis.Audio;
	originalBlob = globalThis.Blob;
	originalURL = globalThis.URL;
	const desc = Object.getOwnPropertyDescriptor(globalThis, "window");
	originalWindow = desc;
	(globalThis as { window: unknown }).window = globalThis;
	(globalThis as { Audio: unknown }).Audio = class {};
	(globalThis as { Blob: unknown }).Blob = class {
		constructor(public parts: unknown[], public opts?: { type?: string }) {}
	};
	(globalThis as { URL: unknown }).URL = {
		createObjectURL: vi.fn(() => `blob:fake/${Math.random().toString(36).slice(2)}`),
		revokeObjectURL: vi.fn(() => {}),
	} as unknown as typeof URL;
});

afterEach(() => {
	(globalThis as { Audio: unknown }).Audio = originalAudio;
	(globalThis as { Blob: unknown }).Blob = originalBlob;
	(globalThis as { URL: unknown }).URL = originalURL;
	if (originalWindow) {
		Object.defineProperty(globalThis, "window", originalWindow);
	} else {
		delete (globalThis as { window?: unknown }).window;
	}
});

/**
 * Start playback, dispatch `ended`, and wait for the play() Promise to
 * resolve. Use this in tests that don't need to assert intermediate state
 * between play() and the audio ending.
 */
async function playAndWait(
	player: VoiceVoxPlayer,
	audio: MockAudioElement,
	buffer: ArrayBuffer,
): Promise<void> {
	const playPromise = player.play(buffer);
	audio.dispatch("ended");
	await playPromise;
}

describe("VoiceVoxPlayer — initial state", () => {
	it("starts in the idle state", () => {
		const { player } = createPlayer();
		expect(player.state).toBe("idle");
	});

	it("exposes currentTime and duration from the underlying audio element", () => {
		const { player, audio } = createPlayer();
		audio.currentTime = 1.5;
		Object.defineProperty(audio, "duration", { value: 12.5, configurable: true });
		expect(player.currentTime).toBe(1.5);
		expect(player.duration).toBe(12.5);
	});

	it("returns 0 for duration when audio duration is not finite", () => {
		const { player } = createPlayer();
		expect(player.duration).toBe(0);
	});
});

describe("VoiceVoxPlayer.play", () => {
	it("sets a blob: URL, calls load() and play(), and transitions to playing", async () => {
		const { player, audio } = createPlayer();
		const playPromise = player.play(makeBuffer(1, 2, 3, 4));
		expect(audio.src.startsWith("blob:fake/")).toBe(true);
		expect(audio.load).toHaveBeenCalled();
		expect(audio.play).toHaveBeenCalled();
		expect(player.state).toBe("playing");
		audio.dispatch("ended");
		await playPromise;
	});

	it("revokes the previous object URL when a new buffer is loaded", async () => {
		const { player, audio } = createPlayer();
		const p1 = player.play(makeBuffer(1));
		audio.dispatch("ended");
		await p1;
		const p2 = player.play(makeBuffer(2));
		audio.dispatch("ended");
		await p2;
		const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL;
		expect(revoke.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("emits statechange from idle to playing", async () => {
		const { player, audio } = createPlayer();
		const events: { from: PlayerState; to: PlayerState }[] = [];
		player.on("statechange", (payload) => events.push(payload));
		const playPromise = player.play(makeBuffer(1));
		expect(events).toEqual([{ from: "idle", to: "playing" }]);
		audio.dispatch("ended");
		await playPromise;
	});

	it("rejects with VoiceVoxPlayerError(empty_buffer) on empty buffer and does not change state", async () => {
		const { player } = createPlayer();
		const errors: VoiceVoxPlayerError[] = [];
		player.on("error", (payload) => errors.push(payload.error));
		await expect(player.play(new ArrayBuffer(0))).rejects.toBeInstanceOf(VoiceVoxPlayerError);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.kind).toBe("empty_buffer");
		expect(player.state).toBe("idle");
	});

	it("catches a rejected audio.play() and converts it to a media_error", async () => {
		const { player, audio } = createPlayer();
		audio.play = vi.fn(async () => {
			throw new Error("autoplay blocked");
		});
		const errors: VoiceVoxPlayerError[] = [];
		player.on("error", (payload) => errors.push(payload.error));
		await expect(player.play(makeBuffer(1))).rejects.toMatchObject({ kind: "media_error" });
		expect(errors[0]?.kind).toBe("media_error");
		expect(player.state).toBe("stopped");
	});
});

describe("VoiceVoxPlayer.pause", () => {
	it("pauses when in playing state and transitions to paused", async () => {
		const { player, audio } = createPlayer();
		const playPromise = player.play(makeBuffer(1));
		player.pause();
		expect(audio.pause).toHaveBeenCalled();
		expect(player.state).toBe("paused");
		audio.dispatch("ended");
		await playPromise;
	});

	it("is a no-op when not playing", () => {
		const { player, audio } = createPlayer();
		player.pause();
		expect(audio.pause).not.toHaveBeenCalled();
		expect(player.state).toBe("idle");
	});
});

describe("VoiceVoxPlayer.play (resume)", () => {
	it("resumes from paused state without reloading the buffer", async () => {
		const { player, audio } = createPlayer();
		const p1 = player.play(makeBuffer(1));
		audio.play.mockClear();
		audio.load.mockClear();
		player.pause();
		const p2 = player.play(makeBuffer(1));
		expect(audio.load).not.toHaveBeenCalled();
		expect(audio.play).toHaveBeenCalled();
		expect(player.state).toBe("playing");
		audio.dispatch("ended");
		await p1;
		await p2;
	});

	it("returned Promise also waits for the audio to end", async () => {
		const { player, audio } = createPlayer();
		const p1 = player.play(makeBuffer(1));
		let p2Resolved = false;
		const p2 = player.play(makeBuffer(1));
		void p2.then(() => {
			p2Resolved = true;
		});
		// Note: this test pre-empts p1 (supersede). After supersede, p2 should
		// wait for its own audio to end, not resolve immediately.
		player.pause();
		// Resume p2
		const p2Resume = player.play(makeBuffer(1));
		await new Promise<void>((r) => setTimeout(r, 0));
		expect(p2Resolved).toBe(false);
		audio.dispatch("ended");
		await p1;
		await p2;
		await p2Resume;
	});
});

describe("VoiceVoxPlayer.stop", () => {
	it("pauses, resets currentTime, revokes the URL and transitions to stopped", async () => {
		const { player, audio } = createPlayer();
		const playPromise = player.play(makeBuffer(1));
		audio.currentTime = 5;
		player.stop();
		expect(audio.pause).toHaveBeenCalled();
		expect(audio.currentTime).toBe(0);
		const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL;
		expect(revoke).toHaveBeenCalled();
		expect(player.state).toBe("stopped");
		await playPromise;
	});

	it("is a no-op when state is idle", () => {
		const { player, audio } = createPlayer();
		player.stop();
		expect(audio.pause).not.toHaveBeenCalled();
		expect(player.state).toBe("idle");
	});

	it("resolves the pending play() Promise", async () => {
		const { player } = createPlayer();
		const playPromise = player.play(makeBuffer(1));
		let resolved = false;
		void playPromise.then(() => {
			resolved = true;
		});
		player.stop();
		await new Promise<void>((r) => setTimeout(r, 0));
		expect(resolved).toBe(true);
	});
});

describe("VoiceVoxPlayer events", () => {
	it("emits ended and transitions to stopped on the audio 'ended' event", async () => {
		const { player, audio } = createPlayer();
		let ended = 0;
		const states: PlayerState[] = [];
		player.on("ended", () => {
			ended++;
		});
		player.on("statechange", (p) => states.push(p.to));
		await playAndWait(player, audio, makeBuffer(1));
		expect(ended).toBe(1);
		expect(player.state).toBe("stopped");
		expect(states).toEqual(["playing", "stopped"]);
	});

	it("emits a media_error on the audio 'error' event", async () => {
		const { player, audio } = createPlayer();
		const errors: VoiceVoxPlayerError[] = [];
		player.on("error", (p) => errors.push(p.error));
		const playPromise = player.play(makeBuffer(1));
		audio.dispatch("error");
		await expect(playPromise).rejects.toMatchObject({ kind: "media_error" });
		expect(errors).toHaveLength(1);
		expect(errors[0]?.kind).toBe("media_error");
		expect(player.state).toBe("stopped");
	});

	it("on() returns an unsubscribe function that removes the listener", async () => {
		const { player, audio } = createPlayer();
		const handler = vi.fn(() => {});
		const off = player.on("ended", handler);
		await playAndWait(player, audio, makeBuffer(1));
		expect(handler).toHaveBeenCalledTimes(1);
		off();
		const p2 = player.play(makeBuffer(1));
		audio.dispatch("ended");
		await p2;
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("a throwing listener does not break other listeners", async () => {
		const { player, audio } = createPlayer();
		const good = vi.fn(() => {});
		player.on("ended", () => {
			throw new Error("boom");
		});
		player.on("ended", good);
		await playAndWait(player, audio, makeBuffer(1));
		expect(good).toHaveBeenCalled();
	});
});

describe("VoiceVoxPlayer.play — Promise semantics", () => {
	it("does not resolve until the audio element fires 'ended'", async () => {
		const { player, audio } = createPlayer();
		let resolved = false;
		const playPromise = player.play(makeBuffer(1)).then(() => {
			resolved = true;
		});
		await new Promise<void>((r) => setTimeout(r, 0));
		expect(resolved).toBe(false);
		audio.dispatch("ended");
		await playPromise;
		expect(resolved).toBe(true);
	});

	it("rejects on the audio 'error' event", async () => {
		const { player, audio } = createPlayer();
		const playPromise = player.play(makeBuffer(1));
		audio.dispatch("error");
		await expect(playPromise).rejects.toBeInstanceOf(VoiceVoxPlayerError);
	});

	it("a second play() called while the first is in progress resolves the first Promise", async () => {
		const { player, audio } = createPlayer();
		const p1 = player.play(makeBuffer(1));
		let p1Resolved = false;
		void p1.then(() => {
			p1Resolved = true;
		});
		const p2 = player.play(makeBuffer(2));
		await new Promise<void>((r) => setTimeout(r, 0));
		expect(p1Resolved).toBe(true);
		audio.dispatch("ended");
		await p2;
	});

	it("a new play() while in playing state changes the audio src to the new buffer", async () => {
		const { player, audio } = createPlayer();
		const p1 = player.play(makeBuffer(1));
		const firstSrc = audio.src;
		const p2 = player.play(makeBuffer(2));
		expect(audio.src).not.toBe(firstSrc);
		audio.dispatch("ended");
		await p2;
		await p1;
	});
});

describe("VoiceVoxPlayer.destroy", () => {
	it("stops playback, revokes URL and makes the player unusable", async () => {
		const { player, audio } = createPlayer();
		const playPromise = player.play(makeBuffer(1));
		const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof vi.fn> }).revokeObjectURL;
		const callsBefore = revoke.mock.calls.length;
		player.destroy();
		expect(audio.removeEventListener).toHaveBeenCalledWith("ended", expect.anything());
		expect(audio.removeEventListener).toHaveBeenCalledWith("error", expect.anything());
		expect(revoke.mock.calls.length).toBeGreaterThan(callsBefore);
		await expect(playPromise).rejects.toBeInstanceOf(VoiceVoxPlayerError);
		await expect(player.play(makeBuffer(1))).rejects.toBeInstanceOf(VoiceVoxPlayerError);
	});

	it("rejects the pending play() Promise", async () => {
		const { player } = createPlayer();
		const playPromise = player.play(makeBuffer(1));
		player.destroy();
		await expect(playPromise).rejects.toMatchObject({ kind: "media_error" });
	});

	it("is idempotent", () => {
		const { player } = createPlayer();
		player.destroy();
		expect(() => player.destroy()).not.toThrow();
	});
});
