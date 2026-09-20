import {
	DEFAULT_PLAYBACK_RATE,
	isValidPlaybackRate,
	PLAYBACK_RATE_STEP,
} from "../lib/voicevox/playbackRate.ts";

export const PLAYBACK_RATE_STORAGE_KEY = "misskey-aloudy:playback-rate:v1";

export type PlaybackRateStorage = Pick<Storage, "getItem" | "setItem">;

function normalizeStoredPlaybackRate(rate: number): number {
	return Number((Math.round(rate / PLAYBACK_RATE_STEP) * PLAYBACK_RATE_STEP).toFixed(1));
}

function resolveStorage(storage?: PlaybackRateStorage | null): PlaybackRateStorage | null {
	if (storage !== undefined) return storage;
	try {
		return globalThis.localStorage;
	} catch {
		return null;
	}
}

export function loadPlaybackRate(storage?: PlaybackRateStorage | null): number {
	const resolved = resolveStorage(storage);
	if (resolved === null) return DEFAULT_PLAYBACK_RATE;

	try {
		const raw = resolved.getItem(PLAYBACK_RATE_STORAGE_KEY);
		if (raw === null || raw.trim().length === 0) return DEFAULT_PLAYBACK_RATE;
		const parsed = Number(raw);
		return isValidPlaybackRate(parsed)
			? normalizeStoredPlaybackRate(parsed)
			: DEFAULT_PLAYBACK_RATE;
	} catch {
		return DEFAULT_PLAYBACK_RATE;
	}
}

export function savePlaybackRate(
	rate: unknown,
	storage?: PlaybackRateStorage | null,
): boolean {
	if (!isValidPlaybackRate(rate)) return false;
	const resolved = resolveStorage(storage);
	if (resolved === null) return false;

	try {
		resolved.setItem(PLAYBACK_RATE_STORAGE_KEY, String(rate));
		return true;
	} catch {
		return false;
	}
}
