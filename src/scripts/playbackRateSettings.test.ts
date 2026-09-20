import { describe, expect, it } from "vitest";
import {
	DEFAULT_PLAYBACK_RATE,
	MAX_PLAYBACK_RATE,
	MIN_PLAYBACK_RATE,
} from "../lib/voicevox/playbackRate.ts";
import {
	loadPlaybackRate,
	PLAYBACK_RATE_STORAGE_KEY,
	savePlaybackRate,
} from "./playbackRateSettings.ts";

describe("playbackRateSettings.loadPlaybackRate", () => {
	it.each([null, "", "   ", "not a number", "NaN", "Infinity", "-Infinity", "0.49", "2.01"])(
		"returns the default for invalid stored value %s",
		(raw) => {
			const storage = {
				getItem: () => raw,
				setItem: () => {},
			};
			expect(loadPlaybackRate(storage)).toBe(DEFAULT_PLAYBACK_RATE);
		},
	);

	const validStoredValues: Array<[string, number]> = [
		["0.5", 0.5],
		["1", 1],
		["1.25", 1.3],
		["2", 2],
	];

	it.each(validStoredValues)("reads and normalizes valid finite value %s", (raw, expected) => {
		const storage = {
			getItem: () => raw,
			setItem: () => {},
		};
		expect(loadPlaybackRate(storage)).toBe(expected);
	});

	it("returns the default when storage access throws", () => {
		const storage = {
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {},
		};
		expect(loadPlaybackRate(storage)).toBe(DEFAULT_PLAYBACK_RATE);
	});

	it("does not require browser storage in Node", () => {
		expect(loadPlaybackRate()).toBe(DEFAULT_PLAYBACK_RATE);
		expect(loadPlaybackRate(null)).toBe(DEFAULT_PLAYBACK_RATE);
	});

	it("uses the shared range boundaries", () => {
		const minimum = { getItem: () => String(MIN_PLAYBACK_RATE), setItem: () => {} };
		const maximum = { getItem: () => String(MAX_PLAYBACK_RATE), setItem: () => {} };
		expect(loadPlaybackRate(minimum)).toBe(MIN_PLAYBACK_RATE);
		expect(loadPlaybackRate(maximum)).toBe(MAX_PLAYBACK_RATE);
	});
});

describe("playbackRateSettings.savePlaybackRate", () => {
	it("writes the value under the versioned key", () => {
		let writtenKey: string | undefined;
		let writtenValue: string | undefined;
		const storage = {
			getItem: () => null,
			setItem: (key: string, value: string) => {
				writtenKey = key;
				writtenValue = value;
			},
		};

		expect(savePlaybackRate(1.5, storage)).toBe(true);
		expect(writtenKey).toBe(PLAYBACK_RATE_STORAGE_KEY);
		expect(writtenValue).toBe("1.5");
	});

	it("returns false rather than throwing when storage write fails", () => {
		const storage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("quota exceeded");
			},
		};
		expect(() => savePlaybackRate(1.5, storage)).not.toThrow();
		expect(savePlaybackRate(1.5, storage)).toBe(false);
	});

	it("returns false for invalid values and unavailable storage", () => {
		expect(savePlaybackRate(0.49, null)).toBe(false);
		expect(savePlaybackRate(Number.NaN, null)).toBe(false);
		expect(savePlaybackRate(1.5, null)).toBe(false);
	});
});
