import { describe, test, expect, mock } from "bun:test";

describe("git utilities", () => {
  describe("runtime", () => {
    test("runtime object has required methods", async () => {
      const { runtime } = await import("./git");
      expect(runtime).toBeDefined();
      expect(typeof runtime.runGit).toBe("function");
      expect(typeof runtime.readTextFile).toBe("function");
    });

    test("readTextFile returns null for non-existent file", async () => {
      const { runtime } = await import("./git");
      const result = await runtime.readTextFile("/tmp/nonexistent-file-xyz.txt");
      expect(result).toBeNull();
    });

    test("readTextFile returns content for existing file", async () => {
      const { runtime } = await import("./git");
      const path = "/tmp/git-test-read-" + Date.now() + ".txt";
      await Bun.write(path, "hello world");
      const result = await runtime.readTextFile(path);
      expect(result).toBe("hello world");
    });
  });

  describe("re-exports", () => {
    test("exports parseWorktreeDiffType", async () => {
      const { parseWorktreeDiffType } = await import("./git");
      expect(typeof parseWorktreeDiffType).toBe("function");
      expect(parseWorktreeDiffType("worktree:/some/path")).toBeDefined();
    });

    test("exports validateFilePath", async () => {
      const { validateFilePath } = await import("./git");
      expect(typeof validateFilePath).toBe("function");
    });

    test("exports types", async () => {
      const mod = await import("./git");
      expect(mod.getCurrentBranch).toBeDefined();
      expect(mod.getDefaultBranch).toBeDefined();
      expect(mod.getWorktrees).toBeDefined();
      expect(mod.getGitContext).toBeDefined();
      expect(mod.runGitDiff).toBeDefined();
      expect(mod.getFileContentsForDiff).toBeDefined();
      expect(mod.gitAddFile).toBeDefined();
      expect(mod.gitResetFile).toBeDefined();
    });
  });

  describe("parseWorktreeDiffType", () => {
    test("parses worktree diff type correctly", async () => {
      const { parseWorktreeDiffType } = await import("./git");
      const result = parseWorktreeDiffType("worktree:/path/to/worktree");
      expect(result).toBeDefined();
      expect(result!.path).toBe("/path/to/worktree");
    });

    test("returns undefined for non-worktree types", async () => {
      const { parseWorktreeDiffType } = await import("./git");
      expect(parseWorktreeDiffType("uncommitted")).toBeFalsy();
      expect(parseWorktreeDiffType("staged")).toBeFalsy();
    });
  });
});
