import { MisskeyClient } from "../lib/misskey/client.ts";
import { subscribeGlobalTimeline } from "../lib/misskey/globalTimeline.ts";
import { PlaybackPipeline } from "../lib/player/pipeline.ts";
import { PlaybackState } from "../lib/player/state.ts";
import { VoiceVoxPlayer } from "../lib/voicevox/player.ts";
import type { ConnectionState } from "../lib/misskey/client.ts";
import type { PlaybackStateKind } from "../lib/player/state.ts";
import type { Note } from "../lib/misskey/types.ts";
import { synthesizeViaSpeechApi } from "./synthesizeApi.ts";

const STATE_LABELS: Record<ConnectionState, string> = {
	disconnected: "未接続",
	connecting: "接続中…",
	connected: "接続済み",
	reconnecting: "再接続中…",
	error: "エラー",
};

const READING_STATE_LABELS: Record<PlaybackStateKind, string> = {
	idle: "OFF",
	loading: "読み上げ準備中…",
	playing: "読み上げ中",
	paused: "一時停止中",
	error: "エラー",
};

const MAX_NOTES = 100;
const SCROLL_THRESHOLD_PX = 80;

function formatRelative(iso: string, now: number = Date.now()): string {
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return iso;
	const diff = Math.max(0, now - t);
	if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`;
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}時間前`;
	if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}日前`;
	return new Date(iso).toISOString().slice(0, 10);
}

function init(): void {
	const urlEl = document.getElementById("instance-url") as HTMLInputElement | null;
	const connectEl = document.getElementById("connect") as HTMLButtonElement | null;
	const disconnectEl = document.getElementById("disconnect") as HTMLButtonElement | null;
	const readingToggleEl = document.getElementById(
		"reading-toggle",
	) as HTMLButtonElement | null;
	const stateEl = document.getElementById("state") as HTMLElement | null;
	const readingStatusEl = document.getElementById(
		"reading-status",
	) as HTMLElement | null;
	const errorEl = document.getElementById("error") as HTMLElement | null;
	const notesEl = document.getElementById("notes") as HTMLElement | null;
	const countEl = document.getElementById("count") as HTMLElement | null;

	if (
		!urlEl ||
		!connectEl ||
		!disconnectEl ||
		!readingToggleEl ||
		!stateEl ||
		!readingStatusEl ||
		!errorEl ||
		!notesEl ||
		!countEl
	) {
		console.error("index: required DOM elements not found");
		return;
	}

	const url = urlEl.value;
	let client: MisskeyClient | null = null;
	let unsubscribe: (() => void) | null = null;
	let noteCount = 0;
	let isUnloading = false;

	// Playback state. Created on 読み上げ ON, destroyed on 切断 / page unload.
	let pipeline: PlaybackPipeline | null = null;
	let readingState: PlaybackState | null = null;
	let player: VoiceVoxPlayer | null = null;
	let isReading = false;

	function setStateText(text: string): void {
		stateEl!.textContent = text;
	}

	function setReadingStatusText(text: string): void {
		readingStatusEl!.textContent = text;
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
		connectEl!.disabled = busy;
		disconnectEl!.disabled = busy || client === null || !unsubscribe;
	}

	function updateReadingButtons(): void {
		const connected = client !== null;
		const checked = isReading;
		readingToggleEl!.disabled = !connected || isUnloading;
		readingToggleEl!.setAttribute("aria-checked", checked ? "true" : "false");
		document
			.getElementById("reading-toggle-icon-on")
			?.toggleAttribute("hidden", !checked);
		document
			.getElementById("reading-toggle-icon-off")
			?.toggleAttribute("hidden", checked);
	}

	function renderState(state: ConnectionState): void {
		setStateText(STATE_LABELS[state]);
	}

	function markNotePlaying(noteId: string): void {
		const li = notesEl!.querySelector(
			`li[data-note-id="${CSS.escape(noteId)}"]`,
		);
		if (li) {
			const badge = li.querySelector(".playing-badge");
			if (badge) badge.removeAttribute("hidden");
		}
	}

	function unmarkNotePlaying(noteId: string): void {
		const li = notesEl!.querySelector(
			`li[data-note-id="${CSS.escape(noteId)}"]`,
		);
		if (li) {
			const badge = li.querySelector(".playing-badge");
			if (badge) badge.setAttribute("hidden", "");
		}
	}

	function updateQueueSize(size: number): void {
		// For MVP we do not display the queue size separately. The reading
		// status label is already driven by the PlaybackState transitions.
		void size;
	}

	function addNote(note: Note): void {
		noteCount += 1;
		countEl!.textContent = String(noteCount);

		const li = document.createElement("li");
		li.className = "p-3";
		li.setAttribute("data-note-id", note.id);

		const meta = document.createElement("div");
		meta.className = "flex items-center gap-2 text-xs text-fg-muted";
		const userSpan = document.createElement("span");
		userSpan.className = "font-medium text-fg";
		userSpan.textContent = `@${note.user.username}`;
		meta.appendChild(userSpan);
		const timeSpan = document.createElement("span");
		timeSpan.textContent = ` · ${formatRelative(note.createdAt)}`;
		meta.appendChild(timeSpan);
		const badge = document.createElement("span");
		badge.className =
			"playing-badge ml-auto rounded bg-accent-bg px-2 py-0.5 text-xs font-medium text-accent-fg";
		badge.textContent = "再生中";
		badge.setAttribute("hidden", "");
		meta.appendChild(badge);
		li.appendChild(meta);

		const body = document.createElement("div");
		body.className = "mt-1 whitespace-pre-wrap break-words text-sm";
		body.textContent = note.text ?? "";
		li.appendChild(body);

		notesEl!.prepend(li);

		while (notesEl!.children.length > MAX_NOTES) {
			notesEl!.lastElementChild?.remove();
		}

		if (notesEl!.scrollTop <= SCROLL_THRESHOLD_PX) {
			notesEl!.scrollTo({ top: 0, behavior: "smooth" });
		}
	}

	function handleNote(note: Note): void {
		addNote(note);
		if (isReading && pipeline !== null) {
			pipeline.enqueue(note);
		}
	}

	function enableReading(): void {
		if (pipeline !== null || client === null) return;
		isReading = true;
		readingState = new PlaybackState();
		player = new VoiceVoxPlayer();
		pipeline = new PlaybackPipeline({
			player,
			state: readingState,
			synthesize: synthesizeViaSpeechApi,
		});
		pipeline.on("noteStart", ({ note }) => markNotePlaying(note.id));
		pipeline.on("noteEnd", ({ note }) => unmarkNotePlaying(note.id));
		pipeline.on("error", ({ error, note }) => {
			if (note !== undefined) unmarkNotePlaying(note.id);
			setReadingStatusText(`エラー: ${error.message}`);
		});
		pipeline.on("queueChange", ({ size }) => updateQueueSize(size));
		readingState.on("statechange", ({ to }) => {
			if (isReading) setReadingStatusText(READING_STATE_LABELS[to]);
		});
		pipeline.start();
		updateReadingButtons();
		setReadingStatusText(READING_STATE_LABELS[readingState.state]);
	}

	function disableReading(): void {
		const current = readingState;
		if (pipeline === null || current === null) return;
		if (current.currentNote !== null) {
			unmarkNotePlaying(current.currentNote.id);
		}
		destroyPipeline();
	}

	function destroyPipeline(): void {
		if (pipeline === null) return;
		isReading = false;
		try {
			pipeline.destroy();
		} catch {
			// ignore
		}
		pipeline = null;
		readingState = null;
		player = null;
		updateReadingButtons();
		setReadingStatusText("OFF");
	}

	function toggleReading(): void {
		if (isReading) {
			disableReading();
		} else {
			enableReading();
		}
	}

	async function onConnectClick(): Promise<void> {
		if (client !== null) return;
		setError(null);
		setBusy(true);

		const next = new MisskeyClient();
		client = next;

		next.on("statechange", ({ to }) => {
			renderState(to);
			if (to === "connected") {
				setError(null);
				setBusy(false);
			} else if (to === "disconnected") {
				setBusy(false);
			}
			updateReadingButtons();
		});
		next.on("error", ({ error }) => {
			setError(error.message);
		});

		try {
			await next.connect(url);
			unsubscribe = subscribeGlobalTimeline(next, handleNote);
			setBusy(false);
			updateReadingButtons();
		} catch (err) {
			if (isUnloading) return;
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			renderState("error");
			setBusy(false);
			updateReadingButtons();
		}
	}

	function onDisconnectClick(): void {
		destroyPipeline();
		if (unsubscribe) {
			try {
				unsubscribe();
			} catch {
				// ignore
			}
			unsubscribe = null;
		}
		if (client) {
			try {
				client.disconnect();
			} catch {
				// ignore
			}
			try {
				client.destroy();
			} catch {
				// ignore
			}
			client = null;
		}
		setError(null);
		renderState("disconnected");
		setBusy(false);
		updateReadingButtons();
	}

	connectEl.addEventListener("click", () => {
		void onConnectClick();
	});
	disconnectEl.addEventListener("click", onDisconnectClick);
	readingToggleEl.addEventListener("click", toggleReading);

	void onConnectClick();

	window.addEventListener("beforeunload", () => {
		isUnloading = true;
		updateReadingButtons();
		destroyPipeline();
		if (unsubscribe) {
			try {
				unsubscribe();
			} catch {
				// ignore
			}
			unsubscribe = null;
		}
		if (client) {
			try {
				client.destroy();
			} catch {
				// ignore
			}
			client = null;
		}
	});
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}
