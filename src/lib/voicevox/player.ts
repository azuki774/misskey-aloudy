import { VoiceVoxPlayerError } from "./errors.ts";
import type {
	PlayerEvent,
	PlayerEventHandler,
	PlayerState,
	VoiceVoxPlayerOptions,
} from "./types.ts";

const BLOB_TYPE = "audio/wav";

function assertBrowser(): void {
	if (typeof globalThis.window === "undefined") {
		throw new VoiceVoxPlayerError(
			"VoiceVoxPlayer is only available in a browser environment",
			"unsupported_environment",
		);
	}
	if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
		throw new VoiceVoxPlayerError(
			"VoiceVoxPlayer requires Blob and URL.createObjectURL support",
			"unsupported_environment",
		);
	}
}

const defaultAudioFactory = (): HTMLAudioElement => new Audio();

export class VoiceVoxPlayer {
	#state: PlayerState = "idle";
	#currentObjectUrl: string | null = null;
	#destroyed = false;
	#listeners: { [E in PlayerEvent]: Set<PlayerEventHandler<E>> } = {
		statechange: new Set(),
		ended: new Set(),
		error: new Set(),
	};
	readonly #audio: HTMLAudioElement;

	constructor(options: VoiceVoxPlayerOptions = {}) {
		assertBrowser();
		const factory = options.audioFactory ?? defaultAudioFactory;
		this.#audio = factory();
		this.#audio.addEventListener("ended", this.#handleEnded);
		this.#audio.addEventListener("error", this.#handleError);
	}

	get state(): PlayerState {
		return this.#state;
	}

	get currentTime(): number {
		return this.#audio.currentTime;
	}

	get duration(): number {
		const d = this.#audio.duration;
		return Number.isFinite(d) ? d : 0;
	}

	play(audioBuffer: ArrayBuffer): Promise<void> {
		if (this.#destroyed) {
			return Promise.reject(
				new VoiceVoxPlayerError("Player has been destroyed", "media_error"),
			);
		}
		if (audioBuffer.byteLength === 0) {
			const err = new VoiceVoxPlayerError("Audio buffer is empty", "empty_buffer");
			this.#emitError(err);
			return Promise.reject(err);
		}

		if (this.#state === "paused" && this.#currentObjectUrl !== null) {
			this.#setState("playing");
			const result = this.#audio.play();
			if (result && typeof (result as Promise<void>).then === "function") {
				return (result as Promise<void>).catch((err: unknown) => {
					const wrapped = new VoiceVoxPlayerError(
						err instanceof Error ? err.message : "Failed to resume playback",
						"media_error",
					);
					this.#setState("stopped");
					this.#emitError(wrapped);
					throw wrapped;
				});
			}
			return Promise.resolve();
		}

		this.#revokeCurrentUrl();
		const blob = new Blob([audioBuffer], { type: BLOB_TYPE });
		const url = URL.createObjectURL(blob);
		this.#currentObjectUrl = url;
		this.#audio.src = url;
		this.#audio.load();

		this.#setState("playing");

		const result = this.#audio.play();
		if (result && typeof (result as Promise<void>).then === "function") {
			return (result as Promise<void>).catch((err: unknown) => {
				const wrapped = new VoiceVoxPlayerError(
					err instanceof Error ? err.message : "Failed to start playback",
					"media_error",
				);
				this.#setState("stopped");
				this.#emitError(wrapped);
				throw wrapped;
			});
		}
		return Promise.resolve();
	}

	pause(): void {
		if (this.#state !== "playing") return;
		this.#audio.pause();
		this.#setState("paused");
	}

	stop(): void {
		if (this.#state === "idle") return;
		this.#audio.pause();
		this.#audio.currentTime = 0;
		this.#revokeCurrentUrl();
		this.#setState("stopped");
	}

	on<E extends PlayerEvent>(event: E, handler: PlayerEventHandler<E>): () => void {
		const set = this.#listeners[event] as Set<PlayerEventHandler<E>>;
		set.add(handler);
		return () => {
			set.delete(handler);
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#audio.removeEventListener("ended", this.#handleEnded);
		this.#audio.removeEventListener("error", this.#handleError);
		try {
			this.#audio.pause();
		} catch {
			// ignore
		}
		this.#audio.currentTime = 0;
		this.#revokeCurrentUrl();
		this.#listeners.statechange.clear();
		this.#listeners.ended.clear();
		this.#listeners.error.clear();
		this.#setState("stopped");
	}

	#setState(next: PlayerState): void {
		if (this.#state === next) return;
		const from = this.#state;
		this.#state = next;
		this.#emit("statechange", { from, to: next });
	}

	#emitError(error: VoiceVoxPlayerError): void {
		this.#emit("error", { error });
	}

	#emit<E extends PlayerEvent>(event: E, payload: Parameters<PlayerEventHandler<E>>[0]): void {
		const set = this.#listeners[event] as Set<PlayerEventHandler<E>>;
		for (const handler of [...set]) {
			try {
				(handler as PlayerEventHandler<E>)(payload as Parameters<PlayerEventHandler<E>>[0]);
			} catch {
				// listener errors must not break the player
			}
		}
	}

	#revokeCurrentUrl(): void {
		if (this.#currentObjectUrl !== null) {
			URL.revokeObjectURL(this.#currentObjectUrl);
			this.#currentObjectUrl = null;
		}
	}

	readonly #handleEnded = (): void => {
		this.#setState("stopped");
		this.#emit("ended", undefined);
	};

	readonly #handleError = (): void => {
		this.#setState("stopped");
		const err = new VoiceVoxPlayerError("Underlying audio element reported an error", "media_error");
		this.#emitError(err);
	};
}
