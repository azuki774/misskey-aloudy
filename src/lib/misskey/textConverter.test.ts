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

describe("preprocessText", () => {
	it.each([
		{
			description: "strips a single URL",
			input: "見てね https://example.com/foo よろしく",
			expected: "見てね よろしく",
		},
		{
			description: "strips multiple URLs",
			input: "a https://x.io b https://y.io c",
			expected: "a b c",
		},
		{
			description: "strips :emoji: shortcodes",
			input: "Hello :smile: world",
			expected: "Hello world",
		},
		{
			description: "keeps Unicode emoji",
			input: "Hi 👍 there",
			expected: "Hi 👍 there",
		},
		{
			description: "collapses multiple whitespace into one",
			input: "hello\n\n\n  world",
			expected: "hello world",
		},
		{
			description: "trims leading and trailing whitespace",
			input: "   hello   ",
			expected: "hello",
		},
		{ description: "empty string", input: "", expected: "" },
		{ description: "whitespace-only", input: "   \n\t  ", expected: "" },
	])('preprocessText: $description', ({ input, expected }) => {
		expect(preprocessText(input)).toBe(expected);
	});
});

describe("describeAttachments", () => {
	it.each([
		{ description: "empty array", files: [] as DriveFile[], expected: "" },
		{
			description: "single image -> '画像が投稿されました'",
			files: [makeFile("image/png")],
			expected: "画像が投稿されました",
		},
		{
			description: "single video -> '動画が投稿されました'",
			files: [makeFile("video/mp4")],
			expected: "動画が投稿されました",
		},
		{
			description: "single audio -> '音声が投稿されました'",
			files: [makeFile("audio/mpeg")],
			expected: "音声が投稿されました",
		},
		{
			description: "single unknown type -> 'ファイルが投稿されました'",
			files: [makeFile("application/pdf")],
			expected: "ファイルが投稿されました",
		},
		{
			description: "two files -> 'N 個のファイルが投稿されました'",
			files: [makeFile("image/png"), makeFile("image/jpeg")],
			expected: "2 個のファイルが投稿されました",
		},
		{
			description: "three mixed files",
			files: [
				makeFile("image/png"),
				makeFile("image/jpeg"),
				makeFile("video/mp4"),
			],
			expected: "3 個のファイルが投稿されました",
		},
	])('describeAttachments: $description', ({ files, expected }) => {
		expect(describeAttachments(files)).toBe(expected);
	});
});

describe("classifyNote", () => {
	it.each([
		{
			description:
				"renoteId set with text and CW -> 'renote' (CW ignored, body not read)",
			overrides: { renoteId: "r1", text: "本文", cw: "ネタバレ" },
			expected: "renote",
		},
		{
			description:
				"renoteId + files + CW -> 'renote' (CW ignored, body not read)",
			overrides: {
				renoteId: "r1",
				files: [makeFile("image/png")],
				cw: "spoiler",
			},
			expected: "renote",
		},
		{
			description: "renoteId + text (no CW) -> 'quote'",
			overrides: { renoteId: "r1", text: "引用本文" },
			expected: "quote",
		},
		{
			description: "renoteId + files (no text, no CW) -> 'quote'",
			overrides: {
				renoteId: "r1",
				text: null,
				files: [makeFile("image/png")],
			},
			expected: "quote",
		},
		{
			description: "renoteId + text + files (no CW) -> 'quote'",
			overrides: {
				renoteId: "r1",
				text: "引用本文",
				files: [makeFile("image/png")],
			},
			expected: "quote",
		},
		{
			description: "renoteId + empty text + files (no CW) -> 'quote'",
			overrides: {
				renoteId: "r1",
				text: "",
				files: [makeFile("image/png")],
			},
			expected: "quote",
		},
		{
			description: "replyId only -> 'reply'",
			overrides: { replyId: "rep1", text: "了解" },
			expected: "reply",
		},
		{
			description: "replyId + renoteId -> 'reply' (reply wins over renote)",
			overrides: { replyId: "rep1", renoteId: "r1", text: "リプ" },
			expected: "reply",
		},
		{
			description: "cw non-empty -> 'cw'",
			overrides: { cw: "ネタバレ", text: "本文" },
			expected: "cw",
		},
		{
			description: "cw non-empty, text null -> 'cw'",
			overrides: { cw: "ネタバレ", text: null },
			expected: "cw",
		},
		{
			description: "text non-empty -> 'normal'",
			overrides: { text: "こんにちは" },
			expected: "normal",
		},
		{
			description: "files only, text null -> 'normal'",
			overrides: { text: null, files: [makeFile("image/png")] },
			expected: "normal",
		},
		{
			description: "all empty -> 'empty'",
			overrides: {},
			expected: "empty",
		},
		{
			description: "text empty string -> 'empty'",
			overrides: { text: "" },
			expected: "empty",
		},
		{
			description: "cw present, text empty string -> 'cw'",
			overrides: { text: "", cw: "spoiler" },
			expected: "cw",
		},
	])('classifyNote: $description', ({ overrides, expected }) => {
		expect(classifyNote(makeNote(overrides))).toBe(expected);
	});
});

describe("describePrefix", () => {
	type Case = {
		description: string;
		kind: "renote" | "reply" | "quote";
		overrides: Partial<Note>;
		expected: string;
	};

	const cases: Case[] = [
		{
			description: "renote with name",
			kind: "renote",
			overrides: { renoteId: "r1", user: makeUser({ name: "アリス" }) },
			expected: "アリス のリノート",
		},
		{
			description: "renote with name=null falls back to username",
			kind: "renote",
			overrides: {
				renoteId: "r1",
				user: makeUser({ name: null, username: "alice" }),
			},
			expected: "alice のリノート",
		},
		{
			description: "quote with name",
			kind: "quote",
			overrides: {
				renoteId: "r1",
				text: "引用本文",
				user: makeUser({ name: "アリス" }),
			},
			expected: "アリス の引用リノート",
		},
		{
			description: "quote with name=null falls back to username",
			kind: "quote",
			overrides: {
				renoteId: "r1",
				text: "引用本文",
				user: makeUser({ name: null, username: "alice" }),
			},
			expected: "alice の引用リノート",
		},
		{
			description: "plain reply -> '<name> への返信'",
			kind: "reply",
			overrides: { replyId: "p", user: makeUser({ name: "ボブ" }) },
			expected: "ボブ への返信",
		},
		{
			description: "reply on a renote -> '<name> のリノートへの返信'",
			kind: "reply",
			overrides: {
				replyId: "p",
				renoteId: "r",
				user: makeUser({ name: "キャロル" }),
			},
			expected: "キャロル のリノートへの返信",
		},
		{
			description: "reply on a renote with name='' -> username",
			kind: "reply",
			overrides: {
				replyId: "p",
				renoteId: "r",
				user: makeUser({ name: "", username: "carol" }),
			},
			expected: "carol のリノートへの返信",
		},
	];

	it.each(cases)(
		"describePrefix: $description",
		({ kind, overrides, expected }) => {
			expect(describePrefix(makeNote(overrides), kind)).toBe(expected);
		},
	);
});

describe("toReadingText (integration)", () => {
	it.each([
		{
			description: "normal text",
			overrides: { text: "こんにちは" },
			expected: "こんにちは",
		},
		{
			description:
				"strips URL and :emoji: from text (Acceptance: 通常のテキストノート)",
			overrides: { text: "見てね https://x.io :smile: よろしく 👍" },
			expected: "見てね よろしく 👍",
		},
		{
			description: "text + single image joined with 。",
			overrides: { text: "見て", files: [makeFile("image/png")] },
			expected: "見て。画像が投稿されました",
		},
		{
			description: "image-only (Acceptance: 画像のみのノート)",
			overrides: { text: null, files: [makeFile("image/jpeg")] },
			expected: "画像が投稿されました",
		},
		{
			description: "text + multiple files",
			overrides: {
				text: "見て",
				files: [makeFile("image/png"), makeFile("image/jpeg")],
			},
			expected: "見て。2 個のファイルが投稿されました",
		},
		{
			description: "CW with body (Acceptance: CW 付き)",
			overrides: { text: "本文", cw: "ネタバレ" },
			expected: "ネタバレ の注記があります",
		},
		{
			description: "CW body is omitted",
			overrides: { text: "シークレット本文", cw: "spoiler" },
			expected: "spoiler の注記があります",
		},
		{
			description: "CW attachments are omitted",
			overrides: {
				text: "本文",
				cw: "ネタバレ",
				files: [makeFile("image/png")],
			},
			expected: "ネタバレ の注記があります",
		},
		{
			description: "renote -> '<name> のリノート'",
			overrides: { renoteId: "r1" },
			expected: "アリス のリノート",
		},
		{
			description: "reply -> '<name> への返信' + text",
			overrides: { replyId: "p", text: "了解" },
			expected: "アリス への返信。了解",
		},
		{
			description: "reply on renote -> '<name> のリノートへの返信' + text",
			overrides: { replyId: "p", renoteId: "r", text: "これはリプ" },
			expected: "アリス のリノートへの返信。これはリプ",
		},
		{
			description: "deleted note -> empty",
			overrides: {
				text: "本文",
				deletedAt: "2026-06-13T00:00:00.000Z",
			},
			expected: "",
		},
		{
			description: "empty note -> empty",
			overrides: {},
			expected: "",
		},
		{
			description: "null text (no files, no cw) -> empty",
			overrides: { text: null },
			expected: "",
		},
		{
			description: "undefined files treated as empty",
			overrides: { text: "hi", files: undefined },
			expected: "hi",
		},
		{
			description: "renote with name=null falls back to username",
			overrides: {
				renoteId: "r",
				user: makeUser({ name: null, username: "alice" }),
			},
			expected: "alice のリノート",
		},
		{
			description: "CW with null text (no body to omit)",
			overrides: { text: null, cw: "spoiler" },
			expected: "spoiler の注記があります",
		},
		{
			description: "quote renote (renoteId + text) -> '<name> の引用リノート。<body>'",
			overrides: { renoteId: "r1", text: "引用本文" },
			expected: "アリス の引用リノート。引用本文",
		},
		{
			description: "quote renote with name=null falls back to username",
			overrides: {
				renoteId: "r1",
				text: "引用本文",
				user: makeUser({ name: null, username: "alice" }),
			},
			expected: "alice の引用リノート。引用本文",
		},
		{
			description: "quote renote + files -> '<name> の引用リノート。<file desc>'",
			overrides: {
				renoteId: "r1",
				text: "見て",
				files: [makeFile("image/png")],
			},
			expected: "アリス の引用リノート。見て。画像が投稿されました",
		},
		{
			description: "quote renote (files only, text null) -> '<name> の引用リノート。<file desc>'",
			overrides: {
				renoteId: "r1",
				text: null,
				files: [makeFile("image/png")],
			},
			expected: "アリス の引用リノート。画像が投稿されました",
		},
		{
			description: "renoteId + CW + text -> 'renote' (CW ignored, body not read)",
			overrides: { renoteId: "r1", text: "本文", cw: "ネタバレ" },
			expected: "アリス のリノート",
		},
	])('toReadingText: $description', ({ overrides, expected }) => {
		expect(toReadingText(makeNote(overrides))).toBe(expected);
	});
});
