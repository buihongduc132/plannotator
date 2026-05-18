import { describe, test, expect, mock, beforeEach } from "bun:test";

describe("exportFeedback", () => {
  describe("formatConventionalPrefix", () => {
    test("returns empty string when no label", async () => {
      const { formatConventionalPrefix } = await import("./exportFeedback");
      expect(formatConventionalPrefix()).toBe("");
      expect(formatConventionalPrefix(undefined)).toBe("");
    });

    test("formats label only", async () => {
      const { formatConventionalPrefix } = await import("./exportFeedback");
      expect(formatConventionalPrefix("issue")).toBe("**issue:** ");
    });

    test("formats label with decorations", async () => {
      const { formatConventionalPrefix } = await import("./exportFeedback");
      expect(formatConventionalPrefix("issue", ["non-blocking"])).toBe("**issue (non-blocking):** ");
    });

    test("formats label with multiple decorations", async () => {
      const { formatConventionalPrefix } = await import("./exportFeedback");
      expect(formatConventionalPrefix("nit", ["non-blocking", "if-minor"])).toBe("**nit (non-blocking, if-minor):** ");
    });
  });

  describe("describeDiff", () => {
    test("describes uncommitted mode", async () => {
      const mod = await import("./exportFeedback");
      // Access via exportReviewFeedback which uses describeDiff internally
      const feedback = mod.exportReviewFeedback(
        [{ filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment" }],
        null,
        { mode: "uncommitted" }
      );
      expect(feedback).toContain("Uncommitted changes");
    });

    test("describes staged mode", async () => {
      const mod = await import("./exportFeedback");
      const feedback = mod.exportReviewFeedback(
        [{ filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment" }],
        null,
        { mode: "staged" }
      );
      expect(feedback).toContain("Staged changes");
    });

    test("describes branch mode with base", async () => {
      const mod = await import("./exportFeedback");
      const feedback = mod.exportReviewFeedback(
        [{ filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment" }],
        null,
        { mode: "branch", base: "main" }
      );
      expect(feedback).toContain("Branch diff vs `main`");
    });

    test("describes merge-base mode", async () => {
      const mod = await import("./exportFeedback");
      const feedback = mod.exportReviewFeedback(
        [{ filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment" }],
        null,
        { mode: "merge-base", base: "develop" }
      );
      expect(feedback).toContain("PR Diff vs `develop`");
    });

    test("describes worktree path", async () => {
      const mod = await import("./exportFeedback");
      const feedback = mod.exportReviewFeedback(
        [{ filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment" }],
        null,
        { mode: "uncommitted", worktreePath: "/path/to/worktree" }
      );
      expect(feedback).toContain("worktree: /path/to/worktree");
    });
  });

  describe("exportReviewFeedback", () => {
    test("returns no feedback message for empty annotations", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([]);
      expect(result).toBe("# Code Review\n\nNo feedback provided.");
    });

    test("groups annotations by file", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "a.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment A" },
        { filePath: "b.ts", lineStart: 5, lineEnd: 5, side: "LEFT" as const, text: "comment B" },
        { filePath: "a.ts", lineStart: 10, lineEnd: 10, side: "RIGHT" as const, text: "comment C" },
      ]);
      expect(result).toContain("## a.ts");
      expect(result).toContain("## b.ts");
      expect(result).toContain("comment A");
      expect(result).toContain("comment B");
      expect(result).toContain("comment C");
    });

    test("includes PR metadata when provided", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const prMeta = {
        platform: "github" as const,
        host: "github.com",
        owner: "org",
        repo: "repo",
        number: 42,
        title: "Test PR",
        author: "user",
        baseBranch: "main",
        headBranch: "feature",
        baseSha: "abc123",
        headSha: "def456",
        url: "https://github.com/org/repo/pull/42",
      };
      const result = exportReviewFeedback(
        [{ filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "comment" }],
        prMeta,
      );
      expect(result).toContain("org/repo");
      expect(result).toContain("#42");
      expect(result).toContain("Test PR");
      expect(result).toContain("feature");
      expect(result).toContain("main");
    });

    test("includes file-scope annotations", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 0, lineEnd: 0, side: "RIGHT" as const, scope: "file" as const, text: "file comment" },
      ]);
      expect(result).toContain("File Comment");
      expect(result).toContain("file comment");
    });

    test("includes suggested code", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "fix this", suggestedCode: "const x = 1;" },
      ]);
      expect(result).toContain("Suggested code");
      expect(result).toContain("const x = 1;");
    });

    test("includes reasoning when provided", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "fix this", reasoning: "security concern" },
      ]);
      expect(result).toContain("Reasoning");
      expect(result).toContain("security concern");
    });

    test("includes token text and char range", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 5, lineEnd: 5, side: "RIGHT" as const, text: "fix", tokenText: "myVar", charStart: 10, charEnd: 15 },
      ]);
      expect(result).toContain("myVar");
      expect(result).toContain("chars 10-15");
    });

    test("formats line range for single line", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 5, lineEnd: 5, side: "RIGHT" as const, text: "comment" },
      ]);
      expect(result).toContain("Line 5");
    });

    test("formats line range for multi-line", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 5, lineEnd: 10, side: "RIGHT" as const, text: "comment" },
      ]);
      expect(result).toContain("Lines 5-10");
    });

    test("sorts file-scope before line-scope annotations", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 5, lineEnd: 5, side: "RIGHT" as const, text: "line comment" },
        { filePath: "test.ts", lineStart: 0, lineEnd: 0, side: "RIGHT" as const, scope: "file" as const, text: "file comment" },
      ]);
      const fileIdx = result.indexOf("File Comment");
      const lineIdx = result.indexOf("Line 5");
      expect(fileIdx).toBeLessThan(lineIdx);
    });

    test("includes conventional label in output", async () => {
      const { exportReviewFeedback } = await import("./exportFeedback");
      const result = exportReviewFeedback([
        { filePath: "test.ts", lineStart: 1, lineEnd: 1, side: "RIGHT" as const, text: "fix", conventionalLabel: "issue" as const },
      ]);
      expect(result).toContain("**issue:**");
    });
  });
});
