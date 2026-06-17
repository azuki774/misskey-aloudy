import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeViaSpeechApi } from "./synthesizeApi.ts";

const SAMPLE_WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);

function mockFetchResponse(status: number, body: BodyInit | null = null): Response {
	return new Response(body, { status });
}

beforeEach(() => {
	vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("synthesizeViaSpeechApi", () => {
	it("POSTs to /api/speech with the text and speaker as JSON", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(mockFetchResponse(200, SAMPLE_WAV));

		await synthesizeViaSpeechApi({ text: "こんにちは", speaker: 1 });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("/api/speech");
		expect(init).toBeDefined();
		expect((init as RequestInit).method).toBe("POST");
		const headers = (init as RequestInit).headers as Record<string, string>;
		expect(headers["content-type"]).toBe("application/json");
		const body = JSON.parse((init as RequestInit).body as string);
		expect(body).toEqual({ text: "こんにちは", speaker: 1 });
	});

	it("defaults the speaker to 1 when options.speaker is undefined", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(mockFetchResponse(200, SAMPLE_WAV));

		await synthesizeViaSpeechApi({ text: "hello" });

		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
		expect(body.speaker).toBe(1);
	});

	it("returns the response body as an ArrayBuffer on 200", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(mockFetchResponse(200, SAMPLE_WAV));

		const result = await synthesizeViaSpeechApi({ text: "x", speaker: 2 });

		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(new Uint8Array(result)).toEqual(SAMPLE_WAV);
	});

	it("throws an Error containing the status code on non-2xx", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(
			mockFetchResponse(502, JSON.stringify({ error: "VoiceVox engine is not reachable" })),
		);

		await expect(
			synthesizeViaSpeechApi({ text: "x", speaker: 1 }),
		).rejects.toThrowError(/502.*VoiceVox/);
	});

	it("handles 502 with no body (does not crash on .text())", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(
			new Response(null, { status: 502 }),
		);

		await expect(
			synthesizeViaSpeechApi({ text: "x", speaker: 1 }),
		).rejects.toThrowError(/502/);
	});

	it("handles 400 (e.g. text too long)", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(
			mockFetchResponse(400, JSON.stringify({ error: "text is required" })),
		);

		await expect(
			synthesizeViaSpeechApi({ text: "", speaker: 1 }),
		).rejects.toThrowError(/400.*text is required/);
	});

	it("forwards speedScale to /api/speech when provided", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(mockFetchResponse(200, SAMPLE_WAV));

		await synthesizeViaSpeechApi({ text: "x", speaker: 1, speedScale: 1.2 });

		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
		expect(body.speedScale).toBe(1.2);
	});

	it("omits speedScale from the body when not provided", async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce(mockFetchResponse(200, SAMPLE_WAV));

		await synthesizeViaSpeechApi({ text: "x", speaker: 1 });

		const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
		expect(body.speedScale).toBeUndefined();
	});
});
