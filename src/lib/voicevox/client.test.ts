import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	DEFAULT_BASE_URL,
	DEFAULT_SPEAKER,
	audioQuery,
	synthesis,
	synthesize,
} from "./client.ts";
import { VoiceVoxError } from "./errors.ts";

const originalFetch = globalThis.fetch;

type FetchCall = {
	url: string;
	init: RequestInit | undefined;
};

function mockFetch(responder: (call: FetchCall) => Response | Promise<Response>): FetchCall[] {
	const calls: FetchCall[] = [];
	globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		calls.push({ url, init });
		return responder({ url, init });
	}) as unknown as typeof fetch;
	return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function bufferResponse(body: ArrayBuffer, status = 200): Response {
	return new Response(body, {
		status,
		headers: { "content-type": "audio/wav" },
	});
}

beforeEach(() => {
	delete process.env.VOICEVOX_URL;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	delete process.env.VOICEVOX_URL;
});

describe("audioQuery", () => {
	it("POSTs to /audio_query with the given text and speaker", async () => {
		const query = {
			accent_phrases: [],
			speedScale: 1,
			pitchScale: 0,
			intonationScale: 1,
			volumeScale: 1,
			prePhonemeLength: 0.1,
			postPhonemeLength: 0.1,
			outputSamplingRate: 24000,
			outputStereo: false,
			kana: "コンニチワ",
		};
		const calls = mockFetch(() => jsonResponse(query));

		const result = await audioQuery({ text: "こんにちは", speaker: 3, baseUrl: "http://vv.test:50021" });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://vv.test:50021/audio_query?speaker=3&text=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(result).toEqual(query);
	});

	it("uses the default baseUrl when none is provided", async () => {
		const calls = mockFetch(() =>
			jsonResponse({
				accent_phrases: [],
				speedScale: 1,
				pitchScale: 0,
				intonationScale: 1,
				volumeScale: 1,
				prePhonemeLength: 0.1,
				postPhonemeLength: 0.1,
				outputSamplingRate: 24000,
				outputStereo: false,
				kana: "",
			}),
		);

		await audioQuery({ text: "test", speaker: 1 });

		expect(calls[0]?.url.startsWith(DEFAULT_BASE_URL)).toBe(true);
	});

	it("throws VoiceVoxError(audio_query) on non-2xx response", async () => {
		mockFetch(() => new Response("boom", { status: 500, statusText: "Server Error" }));

		const promise = audioQuery({ text: "test", speaker: 1, baseUrl: "http://vv.test:50021" });
		await expect(promise).rejects.toBeInstanceOf(VoiceVoxError);
		await expect(promise).rejects.toMatchObject({ kind: "audio_query", status: 500 });
	});

	it("throws VoiceVoxError(connection) when fetch itself fails", async () => {
		globalThis.fetch = mock(async () => {
			throw new TypeError("ECONNREFUSED");
		}) as unknown as typeof fetch;

		await expect(audioQuery({ text: "test", speaker: 1, baseUrl: "http://vv.test:50021" })).rejects.toMatchObject({
			kind: "connection",
		});
	});

	it("rethrows AbortError unchanged so callers can distinguish cancellation from connection failure", async () => {
		const abortError = new Error("aborted");
		abortError.name = "AbortError";
		globalThis.fetch = mock(async () => {
			throw abortError;
		}) as unknown as typeof fetch;

		const controller = new AbortController();
		const promise = audioQuery({ text: "test", speaker: 1, baseUrl: "http://vv.test:50021", signal: controller.signal });
		await expect(promise).rejects.toBe(abortError);
	});
});

describe("synthesis", () => {
	const sampleQuery = {
		accent_phrases: [],
		speedScale: 1,
		pitchScale: 0,
		intonationScale: 1,
		volumeScale: 1,
		prePhonemeLength: 0.1,
		postPhonemeLength: 0.1,
		outputSamplingRate: 24000,
		outputStereo: false,
		kana: "",
	};

	it("POSTs the query JSON to /synthesis with the speaker and returns ArrayBuffer", async () => {
		const audio = new TextEncoder().encode("RIFF....WAVE").buffer;
		const calls = mockFetch(() => bufferResponse(audio));

		const result = await synthesis({ query: sampleQuery, speaker: 4, baseUrl: "http://vv.test:50021" });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://vv.test:50021/synthesis?speaker=4");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(calls[0]?.init?.headers).toMatchObject({ "content-type": "application/json" });
		expect(calls[0]?.init?.body).toBe(JSON.stringify(sampleQuery));
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(result)).toEqual(new Uint8Array(audio));
	});

	it("throws VoiceVoxError(synthesis) on 4xx response", async () => {
		mockFetch(() => new Response("bad", { status: 422 }));

		await expect(
			synthesis({ query: sampleQuery, speaker: 1, baseUrl: "http://vv.test:50021" }),
		).rejects.toMatchObject({ kind: "synthesis", status: 422 });
	});
});

describe("synthesize", () => {
	const sampleQuery = {
		accent_phrases: [],
		speedScale: 1,
		pitchScale: 0,
		intonationScale: 1,
		volumeScale: 1,
		prePhonemeLength: 0.1,
		postPhonemeLength: 0.1,
		outputSamplingRate: 24000,
		outputStereo: false,
		kana: "",
	};

	it("calls audioQuery then synthesis and returns the audio buffer", async () => {
		const audio = new Uint8Array([1, 2, 3, 4]).buffer;
		const calls: FetchCall[] = [];
		let phase = 0;
		globalThis.fetch = mock(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			calls.push({ url, init: undefined });
			phase++;
			if (phase === 1) return jsonResponse(sampleQuery);
			return bufferResponse(audio);
		}) as unknown as typeof fetch;

		const result = await synthesize({ text: "test", speaker: 2, baseUrl: "http://vv.test:50021" });

		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toContain("/audio_query");
		expect(calls[1]?.url).toContain("/synthesis");
		expect(result).toBeInstanceOf(ArrayBuffer);
	});

	it("defaults speaker to 1 when not provided", async () => {
		const calls = mockFetch(() => {
			return jsonResponse(sampleQuery);
		});

		await synthesize({ text: "test", baseUrl: "http://vv.test:50021" });

		const url = calls[0]?.url ?? "";
		expect(url).toContain(`speaker=${DEFAULT_SPEAKER}`);
	});

	it("uses VOICEVOX_URL from process.env (Bun maps this to import.meta.env) when baseUrl is not provided", async () => {
		process.env.VOICEVOX_URL = "http://env-host:50021";
		const calls = mockFetch(() => jsonResponse(sampleQuery));

		await synthesize({ text: "test", speaker: 1 });

		expect(calls[0]?.url.startsWith("http://env-host:50021/")).toBe(true);
	});
});
