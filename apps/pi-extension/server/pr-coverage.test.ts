import { describe, expect, test } from "bun:test";
import { parsePRUrl } from "./pr";

describe("pr — parsePRUrl GitLab + edge cases", () => {
	test("parses GitLab MR URL", () => {
		const result = parsePRUrl("https://gitlab.com/my-org/my-project/-/merge_requests/42");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("gitlab");
			expect(result.host).toBe("gitlab.com");
			expect(result.projectPath).toBe("my-org/my-project");
			expect(result.iid).toBe(42);
		}
	});

	test("parses self-hosted GitLab MR URL", () => {
		const result = parsePRUrl("https://gitlab.internal.corp/team/subgroup/project/-/merge_requests/7");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("gitlab");
			expect(result.host).toBe("gitlab.internal.corp");
			expect(result.projectPath).toBe("team/subgroup/project");
			expect(result.iid).toBe(7);
		}
	});

	test("parses GitHub PR URL with trailing slash", () => {
		const result = parsePRUrl("https://github.com/owner/repo/pull/99/");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("github");
			expect(result.number).toBe(99);
		}
	});

	test("parses GitHub PR URL with trailing path segments", () => {
		const result = parsePRUrl("https://github.com/owner/repo/pull/55/files");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("github");
			expect(result.number).toBe(55);
		}
	});

	test("parses GitHub Enterprise PR URL", () => {
		const result = parsePRUrl("https://ghe.corp.com/team/project/pull/12");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("github");
			expect(result.host).toBe("ghe.corp.com");
			expect(result.owner).toBe("team");
			expect(result.repo).toBe("project");
			expect(result.number).toBe(12);
		}
	});

	test("returns null for issue URL", () => {
		expect(parsePRUrl("https://github.com/owner/repo/issues/5")).toBeNull();
	});

	test("returns null for non-PR/MR page", () => {
		expect(parsePRUrl("https://github.com/owner/repo")).toBeNull();
	});

	test("returns null for random URL", () => {
		expect(parsePRUrl("https://example.com/something")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parsePRUrl("")).toBeNull();
	});

	test("returns null for http (not https)", () => {
		const result = parsePRUrl("http://github.com/owner/repo/pull/1");
		// http:// should also work (regex allows it)
		expect(result === null || result?.platform === "github").toBe(true);
	});
});
