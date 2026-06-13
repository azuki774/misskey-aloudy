import type { APIRoute } from "astro";
import { synthesize } from "../../lib/voicevox/client.ts";
import { VoiceVoxError } from "../../lib/voicevox/errors.ts";

export const prerender = false;

type SpeechRequestBody = {
	text?: unknown;
	speaker?: unknown;
};

const MAX_TEXT_LENGTH = 1000;

function isFinitePositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export const POST: APIRoute = async ({ request }) => {
	let body: SpeechRequestBody;
	try {
		body = (await request.json()) as SpeechRequestBody;
	} catch {
		return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}

	const text = typeof body.text === "string" ? body.text : "";
	if (text.length === 0) {
		return new Response(JSON.stringify({ error: "text is required" }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}
	if (text.length > MAX_TEXT_LENGTH) {
		return new Response(JSON.stringify({ error: `text exceeds ${MAX_TEXT_LENGTH} characters` }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
	}

	let speaker: number | undefined;
	if (body.speaker !== undefined) {
		if (!isFinitePositiveInt(body.speaker)) {
			return new Response(JSON.stringify({ error: "speaker must be a positive integer" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			});
		}
		speaker = body.speaker;
	}

	try {
		const audio = await synthesize({ text, speaker });
		return new Response(audio, {
			status: 200,
			headers: {
				"content-type": "audio/wav",
				"content-length": String(audio.byteLength),
			},
		});
	} catch (err) {
		if (err instanceof VoiceVoxError) {
			if (err.kind === "connection") {
				return new Response(
					JSON.stringify({ error: "VoiceVox engine is not reachable", detail: err.message }),
					{ status: 502, headers: { "content-type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({ error: `VoiceVox ${err.kind} failed`, detail: err.message, status: err.status }),
				{ status: 502, headers: { "content-type": "application/json" } },
			);
		}
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		});
	}
};
