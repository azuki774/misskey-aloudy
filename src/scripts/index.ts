import { MisskeyClient } from "../lib/misskey/client.ts";
import { subscribeGlobalTimeline } from "../lib/misskey/globalTimeline.ts";
import type { ConnectionState } from "../lib/misskey/client.ts";
import type { Note } from "../lib/misskey/types.ts";

const STATE_LABELS: Record<ConnectionState, string> = {
	disconnected: "未接続",
	connecting: "接続中…",
	connected: "接続済み",
	reconnecting: "再接続中…",
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
	const stateEl = document.getElementById("state") as HTMLElement | null;
	const errorEl = document.getElementById("error") as HTMLElement | null;
	const notesEl = document.getElementById("notes") as HTMLElement | null;
	const countEl = document.getElementById("count") as HTMLElement | null;

	if (
		!urlEl ||
		!connectEl ||
		!disconnectEl ||
		!stateEl ||
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

	function setStateText(text: string): void {
		stateEl!.textContent = text;
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

	function renderState(state: ConnectionState): void {
		setStateText(STATE_LABELS[state]);
	}

	function addNote(note: Note): void {
		noteCount += 1;
		countEl!.textContent = String(noteCount);

		const li = document.createElement("li");
		li.className = "p-3";

		const meta = document.createElement("div");
		meta.className = "text-xs text-fg-muted";
		const userSpan = document.createElement("span");
		userSpan.className = "font-medium text-fg";
		userSpan.textContent = `@${note.user.username}`;
		const timeSpan = document.createElement("span");
		timeSpan.textContent = ` · ${formatRelative(note.createdAt)}`;
		meta.appendChild(userSpan);
		meta.appendChild(timeSpan);
		li.appendChild(meta);

		const body = document.createElement("div");
		body.className = "mt-1 whitespace-pre-wrap break-words text-sm";
		body.textContent = note.text ?? "";
		li.appendChild(body);

		notesEl!.prepend(li);

		while (notesEl!.children.length > MAX_NOTES) {
			notesEl!.lastElementChild?.remove();
		}

		// Auto-scroll only when the user is already near the top, so reading
		// older notes is not disrupted.
		if (notesEl!.scrollTop <= SCROLL_THRESHOLD_PX) {
			notesEl!.scrollTo({ top: 0, behavior: "smooth" });
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
		});
		next.on("error", ({ error }) => {
			setError(error.message);
		});

		try {
			await next.connect(url);
			unsubscribe = subscribeGlobalTimeline(next, addNote);
			setBusy(false);
		} catch (err) {
			if (isUnloading) return;
			const message = err instanceof Error ? err.message : String(err);
			setError(message);
			renderState("error");
			setBusy(false);
		}
	}

	function onDisconnectClick(): void {
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
	}

	connectEl.addEventListener("click", () => {
		void onConnectClick();
	});
	disconnectEl.addEventListener("click", onDisconnectClick);

	window.addEventListener("beforeunload", () => {
		isUnloading = true;
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
