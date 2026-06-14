import type { Note } from "../misskey/types.ts";

export type NoteQueueOptions = {
	maxSize?: number;
};

const DEFAULT_MAX_SIZE = 10;

type Listener = (payload: { size: number }) => void;

/**
 * Misskey ノートの FIFO キュー。`maxSize` を超えると最古のノートを破棄する。
 *
 * 再生パイプライン (#19) が内部で所有する。UI から直接は使わない。
 *
 * @example
 * const q = new NoteQueue({ maxSize: 3 });
 * q.enqueue(n1); q.enqueue(n2); q.enqueue(n3);
 * q.enqueue(n4);  // n1 が破棄され、n4 が末尾に追加される
 */
export class NoteQueue {
	#maxSize: number;
	#items: Note[] = [];
	#destroyed = false;
	#listeners: Set<Listener> = new Set();

	constructor(options?: NoteQueueOptions) {
		this.#maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
		if (this.#maxSize <= 0) {
			throw new Error(`NoteQueue: maxSize must be a positive integer (got ${this.#maxSize})`);
		}
	}

	get size(): number {
		return this.#items.length;
	}

	/**
	 * ノートを末尾に追加する。容量超過時は最古のノートを破棄し、それを返す。
	 * 破棄が発生しなかった場合は `null` を返す。
	 *
	 * 容量内の enqueue ではサイズが変わるため `change` イベントが発火する。
	 * 容量超過の enqueue ではサイズが同じ (drop & push) なので `change` イベントは発火しない。
	 */
	enqueue(note: Note): Note | null {
		if (this.#destroyed) return null;

		if (this.#items.length < this.#maxSize) {
			this.#items.push(note);
			this.#emit({ size: this.#items.length });
			return null;
		}

		const dropped = this.#items.shift() as Note;
		this.#items.push(note);
		return dropped;
	}

	/** 先頭のノートを削除して返す。空なら `undefined`。`change` 発火。 */
	dequeue(): Note | undefined {
		if (this.#destroyed) return undefined;
		if (this.#items.length === 0) return undefined;
		const front = this.#items.shift() as Note;
		this.#emit({ size: this.#items.length });
		return front;
	}

	/** 先頭のノートを参照だけで返す。削除しない。`change` 発火しない。 */
	peek(): Note | undefined {
		if (this.#destroyed) return undefined;
		return this.#items[0];
	}

	/** 全件削除する。`change` 発火 (size: 0)。 */
	clear(): void {
		if (this.#destroyed) return;
		if (this.#items.length === 0) return;
		this.#items = [];
		this.#emit({ size: 0 });
	}

	/**
	 * `change` イベントリスナーを登録する。返り値は冪等な unsubscribe 関数。
	 * リスナー内で例外が throw されても他リスナーは影響を受けない。
	 */
	on(event: "change", handler: Listener): () => void {
		if (event !== "change") {
			throw new Error(`NoteQueue: unsupported event "${String(event)}"`);
		}
		this.#listeners.add(handler);
		const unsubscribe = (): void => {
			this.#listeners.delete(handler);
		};
		return unsubscribe;
	}

	/** インスタンスを破棄する。全アイテムをクリアしリスナーを解放。以降の setter は no-op。冪等。 */
	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#items = [];
		this.#listeners.clear();
	}

	#emit(payload: { size: number }): void {
		for (const handler of [...this.#listeners]) {
			try {
				handler(payload);
			} catch {
				// listener errors must not break the queue
			}
		}
	}
}
