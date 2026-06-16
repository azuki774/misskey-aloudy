export const FALLBACK_INSTANCE_URL = "https://misskey.io";

export function resolveInstanceUrl(): string {
	const raw = process.env.MISSKEY_INSTANCE_URL;
	if (typeof raw === "string" && raw.length > 0) {
		return raw;
	}
	return FALLBACK_INSTANCE_URL;
}
