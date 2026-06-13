import { describe, expect, it } from "vitest";
import {
	classifyNote,
	describeAttachments,
	describePrefix,
	preprocessText,
	toReadingText,
} from "./textConverter.ts";
import type { DriveFile, Note, UserLite } from "./types.ts";

function makeUser(overrides: Partial<UserLite> = {}): UserLite {
	return {
		id: "u1",
		name: "アリス",
		username: "alice",
		host: null,
		avatarUrl: "https://example/avatar.png",
		avatarBlurhash: null,
		avatarDecorations: [],
		emojis: {},
		onlineStatus: "online",
		...overrides,
	};
}

function makeNote(overrides: Partial<Note> = {}): Note {
	return {
		id: "n1",
		createdAt: "2026-06-13T00:00:00.000Z",
		text: null,
		userId: "u1",
		user: makeUser(),
		visibility: "public",
		reactionAcceptance: null,
		reactionEmojis: {},
		reactions: {},
		reactionCount: 0,
		renoteCount: 0,
		repliesCount: 0,
		...overrides,
	};
}

function makeFile(type: string, overrides: Partial<DriveFile> = {}): DriveFile {
	const base: DriveFile = {
		id: "f1",
		createdAt: "2026-06-13T00:00:00.000Z",
		name: "f",
		type,
		md5: "x",
		size: 0,
		isSensitive: false,
		blurhash: null,
		properties: {},
		url: "https://example/f",
		thumbnailUrl: null,
		comment: null,
		folderId: null,
		userId: null,
	};
	return { ...base, ...overrides };
}

describe("classifyNote", () => {
	it('returns "renote" when renoteId is set, regardless of CW or text', () => {
		const note = makeNote({ renoteId: "r1", text: "本文", cw: "ネタバレ" });
		expect(classifyNote(note)).toBe("renote");
	});

	it('returns "reply" when replyId is set and renoteId is not', () => {
		const note = makeNote({ replyId: "rep1", text: "了解" });
		expect(classifyNote(note)).toBe("reply");
	});

	it('returns "reply" when both replyId and renoteId are set (reply on a renote)', () => {
		const note = makeNote({ replyId: "rep1", renoteId: "r1", text: "リプ" });
		expect(classifyNote(note)).toBe("reply");
	});

	it('returns "cw" when cw is non-empty and there is no reply/renote', () => {
		const note = makeNote({ cw: "ネタバレ", text: "本文" });
		expect(classifyNote(note)).toBe("cw");
	});

	it('returns "cw" when cw is non-empty and there are no files', () => {
		const note = makeNote({ cw: "ネタバレ", text: null });
		expect(classifyNote(note)).toBe("cw");
	});

	it('returns "normal" when text is non-empty', () => {
		const note = makeNote({ text: "こんにちは" });
		expect(classifyNote(note)).toBe("normal");
	});

	it('returns "normal" when files are attached, even with empty text', () => {
		const note = makeNote({ text: null, files: [makeFile("image/png")] });
		expect(classifyNote(note)).toBe("normal");
	});

	it('returns "empty" when text, files, replyId, renoteId, and cw are all absent/empty', () => {
		const note = makeNote();
		expect(classifyNote(note)).toBe("empty");
	});

	it('returns "empty" for an empty-string text with no files', () => {
		const note = makeNote({ text: "" });
		expect(classifyNote(note)).toBe("empty");
	});

	it('returns "cw" not "normal" when cw is present but text is empty', () => {
		const note = makeNote({ text: "", cw: "spoiler" });
		expect(classifyNote(note)).toBe("cw");
	});
});

describe("describePrefix", () => {
	it('formats a renote as "<name> のリノート"', () => {
		const note = makeNote({ renoteId: "r1", user: makeUser({ name: "アリス" }) });
		expect(describePrefix(note, "renote")).toBe("アリス のリノート");
	});

	it('falls back to username when name is null', () => {
		const note = makeNote({ renoteId: "r1", user: makeUser({ name: null, username: "alice" }) });
		expect(describePrefix(note, "renote")).toBe("alice のリノート");
	});

	it('formats a plain reply as "<name> への返信"', () => {
		const note = makeNote({ replyId: "p", user: makeUser({ name: "ボブ" }) });
		expect(describePrefix(note, "reply")).toBe("ボブ への返信");
	});

	it('formats a reply on a renote as "<name> のリノートへの返信"', () => {
		const note = makeNote({
			replyId: "p",
			renoteId: "r",
			user: makeUser({ name: "キャロル" }),
		});
		expect(describePrefix(note, "reply")).toBe("キャロル のリノートへの返信");
	});

	it('uses username when name is empty string and reply is on a renote', () => {
		const note = makeNote({
			replyId: "p",
			renoteId: "r",
			user: makeUser({ name: "", username: "carol" }),
		});
		expect(describePrefix(note, "reply")).toBe("carol のリノートへの返信");
	});
});

describe("preprocessText", () => {
	it("removes http URLs", () => {
		expect(preprocessText("見てね https://example.com/foo よろしく")).toBe("見てね よろしく");
	});

	it("removes multiple URLs", () => {
		expect(preprocessText("a https://x.io b https://y.io c")).toBe("a b c");
	});

	it("removes :emoji: shortcodes", () => {
		expect(preprocessText("Hello :smile: world")).toBe("Hello world");
	});

	it("keeps Unicode emoji", () => {
		expect(preprocessText("Hi 👍 there")).toBe("Hi 👍 there");
	});

	it("collapses multiple whitespace into one", () => {
		expect(preprocessText("hello\n\n\n  world")).toBe("hello world");
	});

	it("trims leading and trailing whitespace", () => {
		expect(preprocessText("   hello   ")).toBe("hello");
	});

	it("returns empty string for empty input", () => {
		expect(preprocessText("")).toBe("");
	});

	it("returns empty string for whitespace-only input", () => {
		expect(preprocessText("   \n\t  ")).toBe("");
	});
});

describe("describeAttachments", () => {
	it("returns empty string for empty array", () => {
		expect(describeAttachments([])).toBe("");
	});

	it('returns "画像が投稿されました" for a single image', () => {
		expect(describeAttachments([makeFile("image/png")])).toBe("画像が投稿されました");
	});

	it('returns "動画が投稿されました" for a single video', () => {
		expect(describeAttachments([makeFile("video/mp4")])).toBe("動画が投稿されました");
	});

	it('returns "音声が投稿されました" for a single audio', () => {
		expect(describeAttachments([makeFile("audio/mpeg")])).toBe("音声が投稿されました");
	});

	it('returns "ファイルが投稿されました" for a single file with unknown type', () => {
		expect(describeAttachments([makeFile("application/pdf")])).toBe("ファイルが投稿されました");
	});

	it('returns "N 個のファイルが投稿されました" for two or more files', () => {
		expect(
			describeAttachments([makeFile("image/png"), makeFile("image/jpeg")]),
		).toBe("2 個のファイルが投稿されました");
		expect(
			describeAttachments([
				makeFile("image/png"),
				makeFile("image/jpeg"),
				makeFile("video/mp4"),
			]),
		).toBe("3 個のファイルが投稿されました");
	});
});

describe("toReadingText (integration)", () => {
	it("renders a normal text note as-is", () => {
		const note = makeNote({ text: "こんにちは" });
		expect(toReadingText(note)).toBe("こんにちは");
	});

	it("renders text with URL and emoji stripped (Acceptance: 通常のテキストノート)", () => {
		const note = makeNote({
			text: "見てね https://x.io :smile: よろしく 👍",
		});
		expect(toReadingText(note)).toBe("見てね よろしく 👍");
	});

	it("renders text + image attachment joined with a full stop", () => {
		const note = makeNote({
			text: "見て",
			files: [makeFile("image/png")],
		});
		expect(toReadingText(note)).toBe("見て。画像が投稿されました");
	});

	it('renders an image-only note as "画像が投稿されました" (Acceptance: 画像のみのノート)', () => {
		const note = makeNote({ text: null, files: [makeFile("image/jpeg")] });
		expect(toReadingText(note)).toBe("画像が投稿されました");
	});

	it("renders text + multiple files joined with the N-files message", () => {
		const note = makeNote({
			text: "見て",
			files: [makeFile("image/png"), makeFile("image/jpeg")],
		});
		expect(toReadingText(note)).toBe("見て。2 個のファイルが投稿されました");
	});

	it('renders a CW-only note as "<cw> の注記があります" (Acceptance: CW 付き)', () => {
		const note = makeNote({ text: "本文", cw: "ネタバレ" });
		expect(toReadingText(note)).toBe("ネタバレ の注記があります");
	});

	it("omits the body when CW is present", () => {
		const note = makeNote({ text: "シークレット本文", cw: "spoiler" });
		expect(toReadingText(note)).toBe("spoiler の注記があります");
	});

	it("omits attachments when CW is present", () => {
		const note = makeNote({
			text: "本文",
			cw: "ネタバレ",
			files: [makeFile("image/png")],
		});
		expect(toReadingText(note)).toBe("ネタバレ の注記があります");
	});

	it('renders a renote as "<name> のリノート"', () => {
		const note = makeNote({ renoteId: "r1" });
		expect(toReadingText(note)).toBe("アリス のリノート");
	});

	it('renders a reply as "<name> への返信" + text', () => {
		const note = makeNote({ replyId: "p", text: "了解" });
		expect(toReadingText(note)).toBe("アリス への返信。了解");
	});

	it('renders a reply on a renote as "<name> のリノートへの返信" + text', () => {
		const note = makeNote({ replyId: "p", renoteId: "r", text: "これはリプ" });
		expect(toReadingText(note)).toBe("アリス のリノートへの返信。これはリプ");
	});

	it("returns empty string for a deleted note", () => {
		const note = makeNote({ text: "本文", deletedAt: "2026-06-13T00:00:00.000Z" });
		expect(toReadingText(note)).toBe("");
	});

	it("returns empty string for a note with no text, no files, no CW, no reply/renote", () => {
		const note = makeNote();
		expect(toReadingText(note)).toBe("");
	});

	it("treats null text as missing", () => {
		const note = makeNote({ text: null });
		expect(toReadingText(note)).toBe("");
	});

	it("treats undefined files as empty", () => {
		const note = makeNote({ text: "hi", files: undefined });
		expect(toReadingText(note)).toBe("hi");
	});

	it("falls back to username when name is null for renote prefix", () => {
		const note = makeNote({
			renoteId: "r",
			user: makeUser({ name: null, username: "alice" }),
		});
		expect(toReadingText(note)).toBe("alice のリノート");
	});

	it("renders CW without body when text is null but CW is set", () => {
		const note = makeNote({ text: null, cw: "spoiler" });
		expect(toReadingText(note)).toBe("spoiler の注記があります");
	});
});
