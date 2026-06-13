import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { VoiceVoxPlayer } from "./player.ts";
import { VoiceVoxPlayerError } from "./errors.ts";
import type { PlayerState } from "./types.ts";

type Listener = (event: Event) => void;

class MockAudioElement {
	src = "";
	currentTime = 0;
	duration = NaN;
	paused = true;
	play = mock(async (): Promise<void> => {
		this.paused = false;
	});
	pause = mock((): void => {
		this.paused = true;
	});
	load = mock((): void => {});
	#listeners = new Map<string, Set<Listener>>();

	addEventListener = mock((type: string, listener: Listener): void => {
		let set = this.#listeners.get(type);
		if (!set) {
			set = new Set();
			this.#listeners.set(type, set);
		}
		set.add(listener);
	});

	removeEventListener = mock((type: string, listener: Listener): void => {
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
		createObjectURL: mock(() => `blob:fake/${Math.random().toString(36).slice(2)}`),
		revokeObjectURL: mock(() => {}),
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
		await player.play(makeBuffer(1, 2, 3, 4));
		expect(audio.src.startsWith("blob:fake/")).toBe(true);
		expect(audio.load).toHaveBeenCalled();
		expect(audio.play).toHaveBeenCalled();
		expect(player.state).toBe("playing");
	});

	it("revokes the previous object URL when a new buffer is loaded", async () => {
		const { player } = createPlayer();
		await player.play(makeBuffer(1));
		await player.play(makeBuffer(2));
		const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof mock> }).revokeObjectURL;
		expect(revoke.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it("emits statechange from idle to playing", async () => {
		const { player } = createPlayer();
		const events: { from: PlayerState; to: PlayerState }[] = [];
		player.on("statechange", (payload) => events.push(payload));
		await player.play(makeBuffer(1));
		expect(events).toEqual([{ from: "idle", to: "playing" }]);
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
		audio.play = mock(async () => {
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
		await player.play(makeBuffer(1));
		player.pause();
		expect(audio.pause).toHaveBeenCalled();
		expect(player.state).toBe("paused");
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
		await player.play(makeBuffer(1));
		audio.play.mockClear();
		audio.load.mockClear();
		player.pause();
		await player.play(makeBuffer(1));
		expect(audio.load).not.toHaveBeenCalled();
		expect(audio.play).toHaveBeenCalled();
		expect(player.state).toBe("playing");
	});
});

describe("VoiceVoxPlayer.stop", () => {
	it("pauses, resets currentTime, revokes the URL and transitions to stopped", async () => {
		const { player, audio } = createPlayer();
		await player.play(makeBuffer(1));
		audio.currentTime = 5;
		player.stop();
		expect(audio.pause).toHaveBeenCalled();
		expect(audio.currentTime).toBe(0);
		const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof mock> }).revokeObjectURL;
		expect(revoke).toHaveBeenCalled();
		expect(player.state).toBe("stopped");
	});

	it("is a no-op when state is idle", () => {
		const { player, audio } = createPlayer();
		player.stop();
		expect(audio.pause).not.toHaveBeenCalled();
		expect(player.state).toBe("idle");
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
		await player.play(makeBuffer(1));
		audio.dispatch("ended");
		expect(ended).toBe(1);
		expect(player.state).toBe("stopped");
		expect(states).toEqual(["playing", "stopped"]);
	});

	it("emits a media_error on the audio 'error' event", async () => {
		const { player, audio } = createPlayer();
		const errors: VoiceVoxPlayerError[] = [];
		player.on("error", (p) => errors.push(p.error));
		await player.play(makeBuffer(1));
		audio.dispatch("error");
		expect(errors).toHaveLength(1);
		expect(errors[0]?.kind).toBe("media_error");
		expect(player.state).toBe("stopped");
	});

	it("on() returns an unsubscribe function that removes the listener", async () => {
		const { player, audio } = createPlayer();
		const handler = mock(() => {});
		const off = player.on("ended", handler);
		await player.play(makeBuffer(1));
		audio.dispatch("ended");
		expect(handler).toHaveBeenCalledTimes(1);
		off();
		audio.dispatch("ended");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("a throwing listener does not break other listeners", async () => {
		const { player, audio } = createPlayer();
		const good = mock(() => {});
		player.on("ended", () => {
			throw new Error("boom");
		});
		player.on("ended", good);
		await player.play(makeBuffer(1));
		audio.dispatch("ended");
		expect(good).toHaveBeenCalled();
	});
});

describe("VoiceVoxPlayer.destroy", () => {
	it("stops playback, revokes URL and makes the player unusable", async () => {
		const { player, audio } = createPlayer();
		await player.play(makeBuffer(1));
		const revoke = (globalThis.URL as unknown as { revokeObjectURL: ReturnType<typeof mock> }).revokeObjectURL;
		const callsBefore = revoke.mock.calls.length;
		player.destroy();
		expect(audio.removeEventListener).toHaveBeenCalledWith("ended", expect.anything());
		expect(audio.removeEventListener).toHaveBeenCalledWith("error", expect.anything());
		expect(revoke.mock.calls.length).toBeGreaterThan(callsBefore);
		await expect(player.play(makeBuffer(1))).rejects.toBeInstanceOf(VoiceVoxPlayerError);
	});

	it("is idempotent", () => {
		const { player } = createPlayer();
		player.destroy();
		expect(() => player.destroy()).not.toThrow();
	});
});
