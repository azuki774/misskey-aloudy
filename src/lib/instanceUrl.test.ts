import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_INSTANCE_URL, resolveInstanceUrl } from "./instanceUrl.ts";

describe("resolveInstanceUrl", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns the value of MISSKEY_INSTANCE_URL when it is set", () => {
		vi.stubEnv("MISSKEY_INSTANCE_URL", "https://azkey-dev.azuki.blue");
		expect(resolveInstanceUrl()).toBe("https://azkey-dev.azuki.blue");
	});

	it(`falls back to ${FALLBACK_INSTANCE_URL} when MISSKEY_INSTANCE_URL is unset`, () => {
		vi.stubEnv("MISSKEY_INSTANCE_URL", "");
		delete process.env.MISSKEY_INSTANCE_URL;
		expect(resolveInstanceUrl()).toBe(FALLBACK_INSTANCE_URL);
	});

	it("falls back when MISSKEY_INSTANCE_URL is an empty string", () => {
		vi.stubEnv("MISSKEY_INSTANCE_URL", "");
		expect(resolveInstanceUrl()).toBe(FALLBACK_INSTANCE_URL);
	});
});
