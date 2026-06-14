import { NoteQueue } from "./queue.ts";
import { PlaybackState } from "./state.ts";
import { synthesize as defaultSynthesize } from "../voicevox/client.ts";
import { toReadingText as defaultToReadingText } from "../misskey/textConverter.ts";
import type { Note } from "../misskey/types.ts";
import type { VoiceVoxPlayer } from "../voicevox/player.ts";
import type { SynthesizeOptions } from "../voicevox/types.ts";

const DEFAULT_QUEUE_MAX_SIZE = 10;
const DEFAULT_SPEAKER = 1;

export type PlaybackPipelineOptions = {
	player: VoiceVoxPlayer;
	state?: PlaybackState;
	synthesize?: (options: SynthesizeOptions) => Promise<ArrayBuffer>;
	toReadingText?: (note: Note) => string;
	queueMaxSize?: number;
	defaultSpeaker?: number;
};

export type PlaybackPipelineEvent = "noteStart" | "noteEnd" | "error" | "queueChange";

export type PlaybackPipelineEventPayloads = {
	noteStart: { note: Note };
	noteEnd: { note: Note };
	error: { error: Error; note: Note };
	queueChange: { size: number };
};

type Listener<E extends PlaybackPipelineEvent> = (
	payload: PlaybackPipelineEventPayloads[E],
) => void;

/**
 * Misskey ノート → 読み上げパイプライン。
 *
 * 内部で `NoteQueue` (#17) を保持し、`MisskeyClient` ではなく UI レイヤから
 * `enqueue(note)` でノートを受け取る。各ノートを `toReadingText` (#14) →
 * `synthesize` (#8) → `VoiceVoxPlayer.play` (#9) の順で処理する。
 *
 * エラーはスキップして次へ進む。`stop()` は pause セマンティクス (queue 保持)。
 *
 * `state` プロパティで `PlaybackState` (#16) を駆動する。`statechange` イベントは
 * ここではなく `state.on("statechange", ...)` 側で購読する。
 *
 * @example
 * const state = new PlaybackState();
 * const player = new VoiceVoxPlayer();
 * const pipeline = new PlaybackPipeline({ player, state });
 * pipeline.enqueue(someNote);  // 自動開始
 * pipeline.stop();             // pause
 * pipeline.start();            // 再開
 * pipeline.destroy();          // 完全 tear down
 */
export class PlaybackPipeline {
	readonly state: PlaybackState;
	readonly queue: NoteQueue;
	readonly defaultSpeaker: number;

	#player: VoiceVoxPlayer;
	#synthesize: (options: SynthesizeOptions) => Promise<ArrayBuffer>;
	#toReadingText: (note: Note) => string;

	#listeners: { [E in PlaybackPipelineEvent]: Set<Listener<E>> } = {
		noteStart: new Set(),
		noteEnd: new Set(),
		error: new Set(),
		queueChange: new Set(),
	};

	#isRunning = false;
	#stopped = false;
	#destroyed = false;
	#runLoopPromise: Promise<void> | null = null;

	constructor(options: PlaybackPipelineOptions) {
		this.state = options.state ?? new PlaybackState();
		this.queue = new NoteQueue({ maxSize: options.queueMaxSize ?? DEFAULT_QUEUE_MAX_SIZE });
		this.defaultSpeaker = options.defaultSpeaker ?? DEFAULT_SPEAKER;
		this.#player = options.player;
		this.#synthesize = options.synthesize ?? defaultSynthesize;
		this.#toReadingText = options.toReadingText ?? defaultToReadingText;

		this.queue.on("change", (p) => {
			this.#emit("queueChange", { size: p.size });
		});
	}

	/**
	 * ノートをキューに追加する。停止中 (`stop()` 後) でも追加可能。
	 * 処理中でないとき (idle) は自動的に処理ループを開始する。
	 */
	enqueue(note: Note): void {
		if (this.#destroyed) return;
		this.queue.enqueue(note);
		if (!this.#stopped && !this.#isRunning) {
			void this.#runLoop();
		}
	}

	/**
	 * 処理ループを開始する。既に running なら no-op。`stop()` 後の再開に使う。
	 */
	start(): void {
		if (this.#destroyed) return;
		if (this.#isRunning) return;
		if (this.#stopped) this.#stopped = false;
		if (this.queue.size > 0) {
			void this.#runLoop();
		}
	}

	/**
	 * 処理ループを停止する (pause セマンティクス)。queue は保持され、
	 * `start()` で続きから再生できる。再生中の音声は `player.stop()` で即時停止。
	 */
	stop(): void {
		if (this.#destroyed) return;
		if (this.#stopped) return;
		this.#stopped = true;
		try {
			this.#player.stop();
		} catch {
			// ignore: player may have nothing to stop
		}
		this.state.setState("paused");
	}

	/**
	 * パイプラインのイベントリスナーを登録する。返り値は冪等な unsubscribe 関数。
	 * `statechange` はここではなく `state.on(...)` 側で購読する。
	 */
	on<E extends PlaybackPipelineEvent>(event: E, handler: Listener<E>): () => void {
		const set = this.#listeners[event] as Set<Listener<E>>;
		set.add(handler);
		const unsubscribe = (): void => {
			set.delete(handler);
		};
		return unsubscribe;
	}

	/**
	 * パイプラインを完全 tear down する。`player.destroy()` と `queue.destroy()` を呼び、
	 * 全ての内部リスナーを解放する。冪等。`state` は呼び出し元が所有するため、ここでは破棄しない。
	 */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#stopped = true;
		try {
			this.#player.destroy();
		} catch {
			// ignore
		}
		this.queue.destroy();
		this.#listeners.noteStart.clear();
		this.#listeners.noteEnd.clear();
		this.#listeners.error.clear();
		this.#listeners.queueChange.clear();
	}

	async #runLoop(): Promise<void> {
		if (this.#isRunning) return;
		this.#isRunning = true;
		this.#runLoopPromise = this.#runLoopImpl();
		try {
			await this.#runLoopPromise;
		} finally {
			this.#isRunning = false;
			this.#runLoopPromise = null;
		}
	}

	async #runLoopImpl(): Promise<void> {
		while (!this.#destroyed && !this.#stopped) {
			if (this.queue.size === 0) {
				this.state.setCurrentNote(null);
				this.state.setState("idle");
				return;
			}

			const note = this.queue.dequeue();
			if (note === undefined) {
				this.state.setCurrentNote(null);
				this.state.setState("idle");
				return;
			}

			this.state.setCurrentNote(note);
			try {
				this.state.setState("loading");
				const text = this.#toReadingText(note);
				const buffer = await this.#synthesize({
					text,
					speaker: this.defaultSpeaker,
				});
				if (this.#destroyed || this.#stopped) return;

				this.state.setState("playing");
				this.#emit("noteStart", { note });
				await this.#player.play(buffer);
				if (this.#destroyed || this.#stopped) return;

				this.#emit("noteEnd", { note });
			} catch (err) {
				if (this.#destroyed || this.#stopped) return;
				const error = err instanceof Error ? err : new Error(String(err));
				this.#emit("error", { error, note });
				// continue to next note
			}
		}
	}

	#emit<E extends PlaybackPipelineEvent>(
		event: E,
		payload: PlaybackPipelineEventPayloads[E],
	): void {
		const set = this.#listeners[event] as Set<Listener<E>>;
		for (const handler of [...set]) {
			try {
				(handler as Listener<E>)(payload);
			} catch {
				// listener errors must not break the pipeline
			}
		}
	}
}
