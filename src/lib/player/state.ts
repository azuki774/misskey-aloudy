import type { Note } from "../misskey/types.ts";

export type PlaybackStateKind =
	| "idle"
	| "loading"
	| "playing"
	| "paused"
	| "error";

export type PlaybackStateEvent = "statechange" | "notechange";

export type PlaybackStateEventPayloads = {
	statechange: { from: PlaybackStateKind; to: PlaybackStateKind };
	notechange: { from: Note | null; to: Note | null };
};

export type PlaybackStateOptions = {
	state?: PlaybackStateKind;
	currentNote?: Note | null;
};

type Listener<E extends PlaybackStateEvent> = (
	payload: PlaybackStateEventPayloads[E],
) => void;

/**
 * Misskey ノート再生パイプラインの上位状態ホルダ。
 *
 * 「どの Note を再生しているか」 と 「そのパイプラインが今どの段階にいるか」
 * (idle / loading / playing / paused / error) を保持し、setter 駆動で
 * `statechange` / `notechange` イベントを発行する。
 *
 * オーディオバッファ単位の状態 (再生 / 一時停止 / 停止) は
 * `src/lib/voicevox/player.ts` の `VoiceVoxPlayer` 側が持つ。
 * 本クラスはその一段上の抽象化レイヤ。
 *
 * @example
 * const state = new PlaybackState();
 * state.on("statechange", ({ from, to }) => console.log(`${from} -> ${to}`));
 * state.setState("loading");
 * state.setCurrentNote(someNote);
 * state.setState("playing");
 */
export class PlaybackState {
	#state: PlaybackStateKind;
	#currentNote: Note | null;
	#destroyed = false;
	#listeners: { [E in PlaybackStateEvent]: Set<Listener<E>> } = {
		statechange: new Set(),
		notechange: new Set(),
	};

	constructor(initial?: PlaybackStateOptions) {
		this.#state = initial?.state ?? "idle";
		this.#currentNote = initial?.currentNote ?? null;
	}

	get state(): PlaybackStateKind {
		return this.#state;
	}

	get currentNote(): Note | null {
		return this.#currentNote;
	}

	/**
	 * 状態を遷移させる。同じ値なら no-op。`destroy()` 後の呼び出しも no-op。
	 *
	 * 遷移の検証はしない (パイプライン側が正しいシーケンスで呼ぶ責任を持つ)。
	 *
	 * @example
	 * state.setState("loading");
	 * state.setState("playing");
	 */
	setState(next: PlaybackStateKind): void {
		if (this.#destroyed) return;
		if (this.#state === next) return;
		const from = this.#state;
		this.#state = next;
		this.#emit("statechange", { from, to: next });
	}

	/**
	 * 現在の再生中ノートを設定する。同じ参照なら no-op。`destroy()` 後の呼び出しも no-op。
	 *
	 * 比較は `===` 参照等価。内容比較ではないので、ノートインスタンスを作り直すと
	 * イベントが発行される (パイプライン側で意図せず重複させないためのヒント)。
	 *
	 * @example
	 * state.setCurrentNote(note);
	 * state.setCurrentNote(null);  // 再生終了
	 */
	setCurrentNote(next: Note | null): void {
		if (this.#destroyed) return;
		if (this.#currentNote === next) return;
		const from = this.#currentNote;
		this.#currentNote = next;
		this.#emit("notechange", { from, to: next });
	}

	/**
	 * イベントリスナーを登録する。返り値は unsubscribe 関数 (冪等)。
	 *
	 * リスナー内で例外が throw されても、他のリスナーは影響を受けない。
	 */
	on<E extends PlaybackStateEvent>(
		event: E,
		handler: Listener<E>,
	): () => void {
		const set = this.#listeners[event] as Set<Listener<E>>;
		set.add(handler);
		const unsubscribe = (): void => {
			set.delete(handler);
		};
		return unsubscribe;
	}

	/**
	 * インスタンスを破棄する。全リスナーをクリアし、以降の setter は no-op。
	 * 冪等。`destroy()` 後の `on()` 呼び出しは可能だが、setter が no-op なので
	 * リスナーは決して発火しない。
	 */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#listeners.statechange.clear();
		this.#listeners.notechange.clear();
	}

	#emit<E extends PlaybackStateEvent>(
		event: E,
		payload: PlaybackStateEventPayloads[E],
	): void {
		const set = this.#listeners[event] as Set<Listener<E>>;
		for (const handler of [...set]) {
			try {
				(handler as Listener<E>)(payload);
			} catch {
				// listener errors must not break the state holder
			}
		}
	}
}
