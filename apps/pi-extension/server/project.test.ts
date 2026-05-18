import { afterEach, describe, expect, test } from "bun:test";
import { detectProjectName, getRepoInfo } from "./project";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origCwd = process.cwd();

afterEach(() => {
	process.chdir(origCwd);
});

describe("project — detectProjectName", () => {
	test("returns a non-empty string in git repo", () => {
		const name = detectProjectName();
		expect(name).toBeTruthy();
		expect(typeof name).toBe("string");
		expect(name.length).toBeGreaterThan(0);
	});

	test("returns sanitized tag", () => {
		const name = detectProjectName();
		expect(name).not.toMatch(/[^a-zA-Z0-9._-]/);
	});

	test("falls back to cwd basename when not in git repo", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "no-git-dir-"));
		try {
			process.chdir(tmpDir);
			const name = detectProjectName();
			expect(name).toBeTruthy();
			// Should use directory name (sanitized)
			expect(name.length).toBeGreaterThan(0);
		} finally {
			process.chdir(origCwd);
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("project — getRepoInfo", () => {
	test("returns repo info in git repo", () => {
		const info = getRepoInfo();
		if (info) {
			expect(info.display).toBeTruthy();
			expect(typeof info.display).toBe("string");
		}
	});

	test("returns cwd-based info when not in git repo", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "no-git-info-"));
		try {
			process.chdir(tmpDir);
			const info = getRepoInfo();
			// Should still return something based on cwd
			if (info) {
				expect(info.display).toBeTruthy();
			}
		} finally {
			process.chdir(origCwd);
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
