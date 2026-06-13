import { VoiceVoxPlayer } from "../lib/voicevox/player.ts";
import type { PlayerState } from "../lib/voicevox/types.ts";

const STATE_LABELS: Record<PlayerState, string> = {
	idle: "待機中",
	playing: "再生中",
	paused: "一時停止",
	stopped: "停止",
};

function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === "AbortError";
}

function init(): void {
	const textEl = document.getElementById("text") as HTMLTextAreaElement | null;
	const synthesizeEl = document.getElementById("synthesize") as HTMLButtonElement | null;
	const stopEl = document.getElementById("stop") as HTMLButtonElement | null;
	const statusEl = document.getElementById("status") as HTMLElement | null;
	const errorEl = document.getElementById("error") as HTMLElement | null;

	if (!textEl || !synthesizeEl || !stopEl || !statusEl || !errorEl) {
		console.error("test-voicevox: required DOM elements not found");
		return;
	}

	const player = new VoiceVoxPlayer();
	let isBusy = false;
	let abortController: AbortController | null = null;
	let activeRequestId = 0;
	let isUnloading = false;

	function setStatus(text: string): void {
		statusEl!.textContent = text;
	}

	function setError(message: string | null): void {
		if (message === null) {
			errorEl!.textContent = "";
			errorEl!.setAttribute("hidden", "");
		} else {
			errorEl!.textContent = message;
			errorEl!.removeAttribute("hidden");
		}
	}

	function setBusy(busy: boolean): void {
		isBusy = busy;
		synthesizeEl!.disabled = busy;
	}

	player.on("statechange", ({ to }) => {
		setStatus(STATE_LABELS[to]);
		if (to === "playing") {
			stopEl!.disabled = false;
		} else if (to === "idle" || to === "stopped") {
			stopEl!.disabled = true;
		}
	});

	player.on("error", ({ error }) => {
		setError(error.message);
		setStatus("失敗しました");
		stopEl!.disabled = true;
	});

	async function onSynthesizeClick(): Promise<void> {
		if (isBusy) return;

		const text = textEl!.value.trim();
		if (text.length === 0) {
			setStatus("テキストを入力してください");
			return;
		}

		if (abortController) {
			abortController.abort();
		}

		const controller = new AbortController();
		abortController = controller;
		const requestId = ++activeRequestId;

		setBusy(true);
		setStatus("合成中…");
		setError(null);
		stopEl!.disabled = true;

		try {
			const res = await fetch("/api/speech", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text, speaker: 1 }),
				signal: controller.signal,
			});

			if (requestId !== activeRequestId) return;

			if (!res.ok) {
				let message = `HTTP ${res.status}`;
				try {
					const body = (await res.json()) as { error?: string; detail?: string };
					message = body.detail ? `${body.error}: ${body.detail}` : body.error ?? message;
				} catch {
					// body was not JSON; fall back to status text
				}
				setError(message);
				setStatus("失敗しました");
				return;
			}

			const buffer = await res.arrayBuffer();
			if (requestId !== activeRequestId) return;

			await player.play(buffer);
		} catch (err) {
			if (isAbortError(err)) {
				if (requestId === activeRequestId && isUnloading) {
					setStatus("キャンセルしました");
				}
				return;
			}
			if (requestId !== activeRequestId) return;
			setError(err instanceof Error ? err.message : String(err));
			setStatus("失敗しました");
		} finally {
			if (requestId === activeRequestId) {
				setBusy(false);
				abortController = null;
			}
		}
	}

	function onStopClick(): void {
		player.stop();
	}

	synthesizeEl.addEventListener("click", () => {
		void onSynthesizeClick();
	});
	stopEl.addEventListener("click", onStopClick);

	window.addEventListener("beforeunload", () => {
		isUnloading = true;
		if (abortController) abortController.abort();
		player.destroy();
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
