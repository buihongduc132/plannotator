import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import { extractTags, saveToObsidian, saveToBear, saveToOctarine } from "./integrations";
import type { ObsidianConfig, BearConfig, OctarineConfig } from "./integrations";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- extractTags ---

describe("extractTags", () => {
	test("always includes 'plannotator'", async () => {
		const tags = await extractTags("some plain text");
		expect(tags).toContain("plannotator");
	});

	test("extracts keywords from H1 heading", async () => {
		const md = "# Implementation Plan: Auth Service Refactor\nSome details";
		const tags = await extractTags(md);
		expect(tags).toContain("auth");
		expect(tags).toContain("service");
		expect(tags).toContain("refactor");
	});

	test("filters stop words from H1", async () => {
		const md = "# Plan: Overview of the Implementation Steps";
		const tags = await extractTags(md);
		// "plan", "overview", "implementation", "steps" are all stop words
		// Only plannotator + project tag expected
		expect(tags).not.toContain("plan");
		expect(tags).not.toContain("overview");
		expect(tags).not.toContain("implementation");
		expect(tags).not.toContain("steps");
	});

	test("extracts code language tags", async () => {
		const md = "Some text\n```typescript\nconst x = 1;\n```\n```python\nx = 1\n```";
		const tags = await extractTags(md);
		expect(tags).toContain("typescript");
		expect(tags).toContain("python");
	});

	test("excludes common non-informative languages", async () => {
		const md = "```json\n{}\n```\n```yaml\nkey: val\n```";
		const tags = await extractTags(md);
		expect(tags).not.toContain("json");
		expect(tags).not.toContain("yaml");
	});

	test("limits to 7 tags", async () => {
		const md = "# Plan: a b c d\n```ts```\n```rust```\n```go```\n```java```\n```c```\n```cpp```";
		const tags = await extractTags(md);
		expect(tags.length).toBeLessThanOrEqual(7);
	});

	test("deduplicates language tags", async () => {
		const md = "```typescript\na\n```\n```typescript\nb\n```";
		const tags = await extractTags(md);
		const tsCount = tags.filter((t) => t === "typescript").length;
		expect(tsCount).toBe(1);
	});
});

// --- saveToObsidian ---

describe("saveToObsidian", () => {
	const tmpBase = mkdtempSync(join(tmpdir(), "plannotator-test-obsidian-"));

	afterEach(() => {
		// Clean up test folder contents between tests
		try {
			const testFolder = join(tmpBase, "plannotator");
			if (existsSync(testFolder)) rmSync(testFolder, { recursive: true });
		} catch { /* ok */ }
	});

	test("returns error for non-existent vault", async () => {
		const config: ObsidianConfig = {
			vaultPath: "/nonexistent/vault",
			folder: "notes",
			plan: "# Test Plan",
		};
		const result = await saveToObsidian(config);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain("does not exist");
	});

	test("returns error when vault path is a file", async () => {
		const filePath = join(tmpBase, "file.md");
		writeFileSync(filePath, "test");
		const config: ObsidianConfig = {
			vaultPath: filePath,
			folder: "notes",
			plan: "# Test Plan",
		};
		const result = await saveToObsidian(config);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain("not a directory");
	});

	test("saves plan to vault successfully", async () => {
		const config: ObsidianConfig = {
			vaultPath: tmpBase,
			folder: "plannotator",
			plan: "# Test Plan\n\nThis is a test plan.",
		};
		const result = await saveToObsidian(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.path).toContain("Test Plan");
			expect(result.path).toContain("plannotator");
			// Verify file exists
			expect(existsSync(result.path!)).toBe(true);
		}
	});

	test("creates folder if it doesn't exist", async () => {
		const config: ObsidianConfig = {
			vaultPath: tmpBase,
			folder: "new-folder",
			plan: "# My New Plan",
		};
		const result = await saveToObsidian(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.path).toContain("new-folder");
		}
	});

	test("defaults folder to 'plannotator'", async () => {
		const config: ObsidianConfig = {
			vaultPath: tmpBase,
			folder: "",
			plan: "# Plan With Default Folder",
		};
		const result = await saveToObsidian(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.path).toContain("plannotator");
		}
	});

	test("expands ~ in vault path", async () => {
		const config: ObsidianConfig = {
			vaultPath: "~/nonexistent-test-vault",
			folder: "notes",
			plan: "# Test",
		};
		const result = await saveToObsidian(config);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain("does not exist");
	});
});

// --- saveToBear ---

describe("saveToBear", () => {
	test("opens bear URL and returns success", async () => {
		const spawnSpy = spyOn(require("node:child_process"), "spawn").mockReturnValue({
			on: () => {},
		} as any);

		const config: BearConfig = {
			plan: "# Test Plan\n\nContent here",
			customTags: "",
		};
		const result = await saveToBear(config);
		expect(result.success).toBe(true);

		spawnSpy.mockRestore();
	});

	test("uses custom tags when provided", async () => {
		const spawnSpy = spyOn(require("node:child_process"), "spawn").mockImplementation(
			(cmd: string, args: string[]) => {
				expect(args[0]).toContain("bear://");
				return { on: () => {} } as any;
			},
		);

		const config: BearConfig = {
			plan: "# Plan\n\nBody",
			customTags: "tag1 tag2",
		};
		const result = await saveToBear(config);
		expect(result.success).toBe(true);

		spawnSpy.mockRestore();
	});
});

// --- saveToOctarine ---

describe("saveToOctarine", () => {
	test("returns error when workspace is empty", async () => {
		const config: OctarineConfig = {
			workspace: "  ",
			folder: "notes",
			plan: "# Test",
		};
		const result = await saveToOctarine(config);
		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toContain("Workspace is required");
	});

	test("opens octarine URL and returns success", async () => {
		const spawnSpy = spyOn(require("node:child_process"), "spawn").mockReturnValue({
			on: () => {},
		} as any);

		const config: OctarineConfig = {
			workspace: "my-workspace",
			folder: "plans",
			plan: "# My Plan\n\nDetails here",
		};
		const result = await saveToOctarine(config);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.path).toContain("plans/");
		}

		spawnSpy.mockRestore();
	});

	test("defaults folder to 'plannotator'", async () => {
		const spawnSpy = spyOn(require("node:child_process"), "spawn").mockImplementation(
			(cmd: string, args: string[]) => {
				expect(args[0]).toContain("octarine://");
				return { on: () => {} } as any;
			},
		);

		const config: OctarineConfig = {
			workspace: "ws",
			folder: "",
			plan: "# Plan",
		};
		const result = await saveToOctarine(config);
		expect(result.success).toBe(true);

		spawnSpy.mockRestore();
	});
});
