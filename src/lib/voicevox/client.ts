import { VoiceVoxError } from "./errors.ts";
import {
	DEFAULT_BASE_URL,
	DEFAULT_SPEAKER,
	type AudioQuery,
	type AudioQueryOptions,
	type SynthesisOptions,
	type SynthesizeOptions,
} from "./types.ts";

export { DEFAULT_BASE_URL, DEFAULT_SPEAKER };

export function resolveBaseUrl(override?: string): string {
	if (override && override.length > 0) return override.replace(/\/+$/, "");
	const fromEnv = process.env.VOICEVOX_URL;
	if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
	return DEFAULT_BASE_URL;
}

function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === "AbortError";
}

async function safeJson(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return {};
	}
}

export async function audioQuery(options: AudioQueryOptions): Promise<AudioQuery> {
	const baseUrl = resolveBaseUrl(options.baseUrl);
	const url = `${baseUrl}/audio_query?speaker=${options.speaker}&text=${encodeURIComponent(options.text)}`;
	let res: Response;
	try {
		res = await fetch(url, { method: "POST", signal: options.signal });
	} catch (err) {
		if (isAbortError(err)) throw err;
		throw new VoiceVoxError(
			`Failed to connect to VoiceVox at ${baseUrl}: ${(err as Error).message}`,
			"connection",
		);
	}
	if (!res.ok) {
		throw new VoiceVoxError(
			`/audio_query failed with status ${res.status}: ${res.statusText}`,
			"audio_query",
			res.status,
		);
	}
	const body = (await safeJson(res)) as AudioQuery;
	return body;
}

export async function synthesis(options: SynthesisOptions): Promise<ArrayBuffer> {
	const baseUrl = resolveBaseUrl(options.baseUrl);
	const url = `${baseUrl}/synthesis?speaker=${options.speaker}`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(options.query),
			signal: options.signal,
		});
	} catch (err) {
		if (isAbortError(err)) throw err;
		throw new VoiceVoxError(
			`Failed to connect to VoiceVox at ${baseUrl}: ${(err as Error).message}`,
			"connection",
		);
	}
	if (!res.ok) {
		throw new VoiceVoxError(
			`/synthesis failed with status ${res.status}: ${res.statusText}`,
			"synthesis",
			res.status,
		);
	}
	return await res.arrayBuffer();
}

export async function synthesize(options: SynthesizeOptions): Promise<ArrayBuffer> {
	const speaker = options.speaker ?? DEFAULT_SPEAKER;
	const query = await audioQuery({ text: options.text, speaker, baseUrl: options.baseUrl, signal: options.signal });
	const finalQuery =
		options.speedScale !== undefined
			? { ...query, speedScale: options.speedScale }
			: query;
	return await synthesis({ query: finalQuery, speaker, baseUrl: options.baseUrl, signal: options.signal });
}
