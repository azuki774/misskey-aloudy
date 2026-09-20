export const DEFAULT_PLAYBACK_RATE = 1;
export const MIN_PLAYBACK_RATE = 0.5;
export const MAX_PLAYBACK_RATE = 2;
export const PLAYBACK_RATE_STEP = 0.1;

export function isValidPlaybackRate(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= MIN_PLAYBACK_RATE &&
		value <= MAX_PLAYBACK_RATE
	);
}

export function validatePlaybackRate(value: unknown): number {
	if (!isValidPlaybackRate(value)) {
		throw new RangeError(
			`Playback rate must be a finite number between ${MIN_PLAYBACK_RATE} and ${MAX_PLAYBACK_RATE}`,
		);
	}
	return value;
}
