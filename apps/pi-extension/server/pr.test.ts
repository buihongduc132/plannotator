import { describe, expect, test } from "bun:test";
import { parsePRUrl } from "./pr";

describe("pr — parsePRUrl", () => {
	test("parses GitHub PR URL", () => {
		const result = parsePRUrl("https://github.com/owner/repo/pull/42");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("github");
			expect(result.owner).toBe("owner");
			expect(result.repo).toBe("repo");
			expect(result.number).toBe(42);
		}
	});

	test("parses GitHub GHE URL", () => {
		const result = parsePRUrl("https://github.mycompany.com/team/repo/pull/99");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("github");
			expect(result.host).toBe("github.mycompany.com");
			expect(result.number).toBe(99);
		}
	});

	test("parses GitLab MR URL", () => {
		const result = parsePRUrl("https://gitlab.com/mygroup/myproject/-/merge_requests/7");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("gitlab");
			expect(result.projectPath).toBe("mygroup/myproject");
			expect(result.iid).toBe(7);
		}
	});

	test("parses self-hosted GitLab MR URL", () => {
		const result = parsePRUrl("https://gitlab.example.com/group/subgroup/project/-/merge_requests/15");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("gitlab");
			expect(result.host).toBe("gitlab.example.com");
			expect(result.projectPath).toBe("group/subgroup/project");
			expect(result.iid).toBe(15);
		}
	});

	test("parses GitLab MR with nested groups", () => {
		const result = parsePRUrl("https://gitlab.com/org/team/repo/-/merge_requests/3");
		expect(result).toBeDefined();
		if (result) {
			expect(result.platform).toBe("gitlab");
			expect(result.projectPath).toBe("org/team/repo");
			expect(result.iid).toBe(3);
		}
	});

	test("returns null for non-PR URL", () => {
		expect(parsePRUrl("https://github.com/owner/repo")).toBeNull();
	});

	test("returns null for invalid URL", () => {
		expect(parsePRUrl("not-a-url")).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(parsePRUrl("")).toBeNull();
	});

	test("returns null for issues URL", () => {
		expect(parsePRUrl("https://github.com/owner/repo/issues/42")).toBeNull();
	});

	test("returns null for non-http URL", () => {
		expect(parsePRUrl("ftp://github.com/owner/repo/pull/1")).toBeNull();
	});
});
