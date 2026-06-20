import { describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_TEXT_LENGTH,
	TRUNCATION_SUFFIX,
	truncateForSpeech,
} from "./truncation.ts";

describe("truncateForSpeech: constants", () => {
	it("DEFAULT_MAX_TEXT_LENGTH is 100", () => {
		expect(DEFAULT_MAX_TEXT_LENGTH).toBe(100);
	});

	it("TRUNCATION_SUFFIX is 「以下略」", () => {
		expect(TRUNCATION_SUFFIX).toBe("以下略");
	});
});

describe("truncateForSpeech: under the limit", () => {
	it("returns the input as-is when shorter than the default limit", () => {
		const text = "こんにちは、世界。";
		expect(truncateForSpeech(text)).toBe(text);
	});

	it("returns the input as-is when exactly at the default limit", () => {
		const text = "a".repeat(DEFAULT_MAX_TEXT_LENGTH);
		expect(truncateForSpeech(text)).toBe(text);
		expect(truncateForSpeech(text).length).toBe(DEFAULT_MAX_TEXT_LENGTH);
	});

	it("returns an empty string unchanged", () => {
		expect(truncateForSpeech("")).toBe("");
	});

	it("returns the input as-is for a one-character string", () => {
		expect(truncateForSpeech("a")).toBe("a");
	});
});

describe("truncateForSpeech: over the limit", () => {
	it("cuts at 100 chars and appends the suffix when input is 101 chars", () => {
		const text = "a".repeat(DEFAULT_MAX_TEXT_LENGTH + 1);
		const result = truncateForSpeech(text);
		expect(result).toBe("a".repeat(DEFAULT_MAX_TEXT_LENGTH) + TRUNCATION_SUFFIX);
		expect(result.length).toBe(DEFAULT_MAX_TEXT_LENGTH + TRUNCATION_SUFFIX.length);
	});

	it("cuts at 100 chars and appends the suffix when input is 500 chars", () => {
		const text = "a".repeat(500);
		const result = truncateForSpeech(text);
		expect(result).toBe("a".repeat(DEFAULT_MAX_TEXT_LENGTH) + TRUNCATION_SUFFIX);
	});

	it("cuts Japanese text at 100 chars and appends the suffix", () => {
		const text = "あ".repeat(150);
		const result = truncateForSpeech(text);
		expect(result).toBe("あ".repeat(DEFAULT_MAX_TEXT_LENGTH) + TRUNCATION_SUFFIX);
	});

	it("preserves the original prefix characters exactly (no rounding/mutation)", () => {
		const text = "X".repeat(250);
		const result = truncateForSpeech(text);
		expect(result.startsWith("X".repeat(DEFAULT_MAX_TEXT_LENGTH))).toBe(true);
		expect(result.endsWith(TRUNCATION_SUFFIX)).toBe(true);
	});
});

describe("truncateForSpeech: custom maxLength", () => {
	it("honors a custom maxLength of 50", () => {
		const text = "a".repeat(200);
		const result = truncateForSpeech(text, 50);
		expect(result).toBe("a".repeat(50) + TRUNCATION_SUFFIX);
	});

	it("returns the input as-is when shorter than the custom maxLength", () => {
		const text = "a".repeat(30);
		expect(truncateForSpeech(text, 50)).toBe(text);
	});

	it("uses DEFAULT_MAX_TEXT_LENGTH when maxLength is omitted", () => {
		const text = "a".repeat(DEFAULT_MAX_TEXT_LENGTH + 1);
		const result = truncateForSpeech(text);
		expect(result.length).toBe(DEFAULT_MAX_TEXT_LENGTH + TRUNCATION_SUFFIX.length);
	});
});

describe("truncateForSpeech: suffix behavior", () => {
	it("does NOT append the suffix when the input fits within maxLength", () => {
		const text = "a".repeat(DEFAULT_MAX_TEXT_LENGTH);
		expect(truncateForSpeech(text)).not.toContain(TRUNCATION_SUFFIX);
	});

	it("appends the suffix exactly once when truncating", () => {
		const text = "a".repeat(500);
		const result = truncateForSpeech(text);
		const matches = result.match(new RegExp(TRUNCATION_SUFFIX, "g"));
		expect(matches).toHaveLength(1);
	});
});
