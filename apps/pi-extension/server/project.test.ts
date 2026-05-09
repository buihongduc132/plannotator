import { describe, expect, test } from "bun:test";
import { detectProjectName, getRepoInfo } from "./project";

describe("project — detectProjectName", () => {
	test("returns a non-empty string", () => {
		const name = detectProjectName();
		expect(name).toBeTruthy();
		expect(typeof name).toBe("string");
		expect(name.length).toBeGreaterThan(0);
	});

	test("returns sanitized tag", () => {
		const name = detectProjectName();
		// Should not contain special chars that would break file paths
		expect(name).not.toMatch(/[^a-zA-Z0-9._-]/);
	});
});

describe("project — getRepoInfo", () => {
	test("returns repo info or null", () => {
		const info = getRepoInfo();
		if (info) {
			expect(info.display).toBeTruthy();
			expect(typeof info.display).toBe("string");
		}
	});
});
