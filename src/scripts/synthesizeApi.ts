import type { SynthesizeOptions } from "../lib/voicevox/types.ts";

/**
 * サーバプロキシ (/api/speech) 経由で音声を合成する。
 *
 * ブラウザから直接 VoiceVox (`http://localhost:50021`) を叩くと CORS で
 * ブロックされるため、合成は必ずサーバ経由で行う。`/api/speech` は
 * `src/pages/api/speech.ts` が実装 (PR #10)。
 *
 * このラッパはパイプラインの `synthesize` DI として渡される。ライブラリ
 * 側 (`src/lib/voicevox/client.ts`) は触らない — ブラウザ以外のコンテキスト
 * (将来的な Node スクリプト等) でも同じ関数が直接使えるため。
 */
export async function synthesizeViaSpeechApi(
	options: SynthesizeOptions,
): Promise<ArrayBuffer> {
	const res = await fetch("/api/speech", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			text: options.text,
			speaker: options.speaker ?? 1,
		}),
	});
	if (!res.ok) {
		let detail = "";
		try {
			detail = await res.text();
		} catch {
			// ignore: body might not be readable
		}
		throw new Error(
			`synthesis via /api/speech failed: ${res.status}${detail ? ` (${detail})` : ""}`,
		);
	}
	return await res.arrayBuffer();
}
