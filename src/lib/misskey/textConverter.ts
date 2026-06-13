import type { DriveFile, Note } from "./types.ts";

export type NoteKind = "renote" | "reply" | "cw" | "normal" | "empty";

const URL_PATTERN = /https?:\/\/\S+/g;
const CUSTOM_EMOJI_PATTERN = /:[A-Za-z0-9_]+:/g;
const WHITESPACE_PATTERN = /\s+/g;

function isNonEmptyString(value: string | null | undefined): value is string {
	return typeof value === "string" && value.length > 0;
}

function getDisplayName(note: Note): string {
	const name = note.user.name;
	if (isNonEmptyString(name)) return name;
	return note.user.username;
}

/**
 * ノートの種類を判定する。
 *
 * `replyId` がある場合 (renoteId の有無に関わらず) は `"reply"`。
 * そうでず `renoteId` がある場合が `"renote"`。
 * `cw` が非空なら `"cw"` (本文・添付は読み上げない)。
 * テキストか添付があれば `"normal"`。
 * 何もなければ `"empty"`。
 *
 * @example
 * classifyNote({ renoteId: "r1", user: { name: "alice" } }); // => "renote"
 * classifyNote({ replyId: "rep1", text: "了解" });           // => "reply"
 * classifyNote({ replyId: "p", renoteId: "r" });             // => "reply"
 * classifyNote({ text: "本文", cw: "ネタバレ" });             // => "cw"
 * classifyNote({ text: "hello" });                           // => "normal"
 * classifyNote({});                                          // => "empty"
 */
export function classifyNote(note: Note): NoteKind {
	if (isNonEmptyString(note.replyId)) return "reply";
	if (isNonEmptyString(note.renoteId)) return "renote";
	if (isNonEmptyString(note.cw)) return "cw";
	if (isNonEmptyString(note.text)) return "normal";
	if (Array.isArray(note.files) && note.files.length > 0) return "normal";
	return "empty";
}

/**
 * Renote / Reply 用の前置詞を返す。
 *
 * `kind === "renote"` のとき `"<表示名> のリノート"`。
 * `kind === "reply"` のとき:
 * - `renoteId` もある場合: `"<表示名> のリノートへの返信"`
 * - 返信のみの場合:     `"<表示名> への返信"`
 *
 * 表示名は `user.name` を優先し、null の場合は `user.username` にフォールバックする。
 *
 * @example
 * describePrefix({ renoteId: "r", user: { name: "アリス" } }, "renote");
 * // => "アリス のリノート"
 *
 * @example
 * describePrefix({ replyId: "p", user: { username: "bob" } }, "reply");
 * // => "bob への返信"
 */
export function describePrefix(note: Note, kind: "renote" | "reply"): string {
	const name = getDisplayName(note);
	if (kind === "renote") {
		return `${name} のリノート`;
	}
	if (isNonEmptyString(note.renoteId)) {
		return `${name} のリノートへの返信`;
	}
	return `${name} への返信`;
}

/**
 * 読み上げ用のテキスト前処理。URL、`:emoji:` ショートコードを除去し、空白を 1 つに圧縮する。
 *
 * Unicode 絵文字 (例: `👍`) は保持される。
 *
 * @example
 * preprocessText("見てね https://example.com/foo :smile:  よろしく");
 * // => "見てね よろしく"
 */
export function preprocessText(text: string): string {
	return text
		.replace(URL_PATTERN, "")
		.replace(CUSTOM_EMOJI_PATTERN, "")
		.replace(WHITESPACE_PATTERN, " ")
		.trim();
}

/**
 * 添付ファイルの説明文を生成する。空配列なら空文字列。
 *
 * 1 個のときはファイル種別ごとのラベル (画像 / 動画 / 音声 / ファイル)。
 * 2 個以上のときは `"N 個のファイルが投稿されました"`。
 *
 * @example
 * describeAttachments([{ type: "image/png" }]);
 * // => "画像が投稿されました"
 *
 * @example
 * describeAttachments([{ type: "image/png" }, { type: "image/jpeg" }]);
 * // => "2 個のファイルが投稿されました"
 */
export function describeAttachments(files: DriveFile[]): string {
	if (files.length === 0) return "";
	if (files.length === 1) {
		const type = files[0]?.type ?? "";
		if (type.startsWith("image/")) return "画像が投稿されました";
		if (type.startsWith("video/")) return "動画が投稿されました";
		if (type.startsWith("audio/")) return "音声が投稿されました";
		return "ファイルが投稿されました";
	}
	return `${files.length} 個のファイルが投稿されました`;
}

/**
 * ノートを読み上げ用テキストに変換する公開エントリポイント。
 *
 * 削除済みノート (`deletedAt` あり) や空のノートは空文字を返す。
 * それ以外は `classifyNote` で判定し、各 kind に対応する整形を行う。
 *
 * @example
 * toReadingText({ text: "こんにちは", user: { name: "アリス" } });
 * // => "こんにちは"
 *
 * @example
 * toReadingText({ text: "本文", cw: "ネタバレ", user: { name: "アリス" } });
 * // => "ネタバレ の注記があります"
 *
 * @example
 * toReadingText({ renoteId: "r1", user: { name: "アリス" } });
 * // => "アリス のリノート"
 *
 * @example
 * toReadingText({ text: "見て", files: [{ type: "image/png" }], user: { name: "アリス" } });
 * // => "見て。画像が投稿されました"
 */
export function toReadingText(note: Note): string {
	if (note.deletedAt) return "";

	const kind = classifyNote(note);
	if (kind === "empty") return "";

	if (kind === "renote") {
		return describePrefix(note, "renote");
	}

	if (kind === "reply") {
		const prefix = describePrefix(note, "reply");
		const body = note.text ? preprocessText(note.text) : "";
		return body ? `${prefix}。${body}` : prefix;
	}

	if (kind === "cw") {
		const cw = note.cw ?? "";
		return `${cw} の注記があります`;
	}

	// kind === "normal"
	const body = note.text ? preprocessText(note.text) : "";
	const files = describeAttachments(note.files ?? []);
	if (!body && !files) return "";
	if (!body) return files;
	if (!files) return body;
	return `${body}。${files}`;
}
