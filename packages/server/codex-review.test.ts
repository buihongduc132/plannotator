/**
 * Tests for packages/server/codex-review.ts
 *
 * Tests the pure functions: buildCodexReviewUserMessage, buildCodexCommand,
 * parseCodexOutput, transformReviewFindings, generateOutputPath.
 *
 * Run: bun test packages/server/codex-review.test.ts
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import {
  CODEX_REVIEW_SYSTEM_PROMPT,
  CODEX_REVIEW_SCHEMA_PATH,
  buildCodexReviewUserMessage,
  buildCodexCommand,
  parseCodexOutput,
  transformReviewFindings,
  generateOutputPath,
  type CodexFinding,
  type CodexCommandOptions,
} from "./codex-review";

// ---------------------------------------------------------------------------
// CODEX_REVIEW_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe("CODEX_REVIEW_SYSTEM_PROMPT", () => {
  test("is a non-empty string", () => {
    expect(CODEX_REVIEW_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test("mentions review guidelines", () => {
    expect(CODEX_REVIEW_SYSTEM_PROMPT).toContain("reviewer");
  });

  test("mentions priority levels", () => {
    expect(CODEX_REVIEW_SYSTEM_PROMPT).toContain("[P0]");
    expect(CODEX_REVIEW_SYSTEM_PROMPT).toContain("[P1]");
    expect(CODEX_REVIEW_SYSTEM_PROMPT).toContain("[P2]");
    expect(CODEX_REVIEW_SYSTEM_PROMPT).toContain("[P3]");
  });
});

// ---------------------------------------------------------------------------
// buildCodexReviewUserMessage
// ---------------------------------------------------------------------------

describe("buildCodexReviewUserMessage", () => {
  const patch = "diff --git a/file.ts b/file.ts\n+new line\n-old line\n";

  test("returns PR URL in PR mode", () => {
    const msg = buildCodexReviewUserMessage(
      patch,
      "branch",
      undefined,
      { url: "https://github.com/org/repo/pull/1", baseBranch: "main", number: 1, title: "Test PR" },
    );
    expect(msg).toBe("https://github.com/org/repo/pull/1");
  });

  test("returns local worktree instructions in PR mode with local access", () => {
    const msg = buildCodexReviewUserMessage(
      patch,
      "branch",
      { hasLocalAccess: true },
      { url: "https://github.com/org/repo/pull/1", baseBranch: "main", number: 1, title: "Test PR" },
    );
    expect(msg).toContain("https://github.com/org/repo/pull/1");
    expect(msg).toContain("local worktree");
    expect(msg).toContain("origin/main");
  });

  test("uncommitted diff type", () => {
    const msg = buildCodexReviewUserMessage(patch, "uncommitted");
    expect(msg).toContain("current code changes");
  });

  test("staged diff type", () => {
    const msg = buildCodexReviewUserMessage(patch, "staged");
    expect(msg).toContain("staged");
  });

  test("unstaged diff type", () => {
    const msg = buildCodexReviewUserMessage(patch, "unstaged");
    expect(msg).toContain("unstaged");
  });

  test("last-commit diff type", () => {
    const msg = buildCodexReviewUserMessage(patch, "last-commit");
    expect(msg).toContain("last commit");
  });

  test("branch diff type with default branch", () => {
    const msg = buildCodexReviewUserMessage(
      patch,
      "branch",
      { defaultBranch: "develop" },
    );
    expect(msg).toContain("develop");
    expect(msg).toContain("git diff develop..HEAD");
  });

  test("branch diff type falls back to main", () => {
    const msg = buildCodexReviewUserMessage(patch, "branch");
    expect(msg).toContain("main");
  });

  test("merge-base diff type", () => {
    const msg = buildCodexReviewUserMessage(
      patch,
      "merge-base",
      { defaultBranch: "main" },
    );
    expect(msg).toContain("merge-base");
    expect(msg).toContain("main");
  });

  test("worktree diff type extracts effective type", () => {
    const msg = buildCodexReviewUserMessage(patch, "worktree:/some/path:unstaged");
    expect(msg).toContain("unstaged");
  });

  test("worktree with uncommitted extracts last segment", () => {
    const msg = buildCodexReviewUserMessage(patch, "worktree:/path:uncommitted");
    expect(msg).toContain("current code changes");
  });

  test("default (unknown/p4) includes patch in diff block", () => {
    const msg = buildCodexReviewUserMessage(patch, "p4-default");
    expect(msg).toContain("```diff");
    expect(msg).toContain(patch);
  });
});

// ---------------------------------------------------------------------------
// generateOutputPath
// ---------------------------------------------------------------------------

describe("generateOutputPath", () => {
  test("generates path in tmpdir", () => {
    const path = generateOutputPath();
    expect(path).toContain(tmpdir());
    expect(path).toContain("plannotator-codex-");
    expect(path).toMatch(/\.json$/);
  });

  test("generates unique paths", () => {
    const path1 = generateOutputPath();
    const path2 = generateOutputPath();
    expect(path1).not.toBe(path2);
  });
});

// ---------------------------------------------------------------------------
// buildCodexCommand
// ---------------------------------------------------------------------------

describe("buildCodexCommand", () => {
  test("builds basic command", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/home/user/project",
      outputPath: "/tmp/output.json",
      prompt: "Review this code",
    };
    const cmd = await buildCodexCommand(opts);

    expect(cmd[0]).toBe("codex");
    expect(cmd).toContain("exec");
    expect(cmd).toContain("--full-auto");
    expect(cmd).toContain("--ephemeral");
    expect(cmd).toContain("-C");
    expect(cmd).toContain("/home/user/project");
    expect(cmd).toContain("-o");
    expect(cmd).toContain("/tmp/output.json");
    expect(cmd).toContain("Review this code");
  });

  test("includes model when provided", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/tmp",
      outputPath: "/tmp/out.json",
      prompt: "test",
      model: "o3",
    };
    const cmd = await buildCodexCommand(opts);
    expect(cmd).toContain("-m");
    expect(cmd).toContain("o3");
  });

  test("omits model when not provided", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/tmp",
      outputPath: "/tmp/out.json",
      prompt: "test",
    };
    const cmd = await buildCodexCommand(opts);
    expect(cmd).not.toContain("-m");
  });

  test("includes reasoning effort when provided", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/tmp",
      outputPath: "/tmp/out.json",
      prompt: "test",
      reasoningEffort: "high",
    };
    const cmd = await buildCodexCommand(opts);
    expect(cmd).toContain("-c");
    expect(cmd).toContain("model_reasoning_effort=high");
  });

  test("includes fast mode when provided", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/tmp",
      outputPath: "/tmp/out.json",
      prompt: "test",
      fastMode: true,
    };
    const cmd = await buildCodexCommand(opts);
    expect(cmd).toContain("service_tier=fast");
  });

  test("materializes schema file", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/tmp",
      outputPath: "/tmp/out.json",
      prompt: "test",
    };
    await buildCodexCommand(opts);
    expect(existsSync(CODEX_REVIEW_SCHEMA_PATH)).toBe(true);
  });

  test("includes --output-schema in command", async () => {
    const opts: CodexCommandOptions = {
      cwd: "/tmp",
      outputPath: "/tmp/out.json",
      prompt: "test",
    };
    const cmd = await buildCodexCommand(opts);
    const schemaIdx = cmd.indexOf("--output-schema");
    expect(schemaIdx).toBeGreaterThan(-1);
    expect(cmd[schemaIdx + 1]).toBe(CODEX_REVIEW_SCHEMA_PATH);
  });
});

// ---------------------------------------------------------------------------
// parseCodexOutput
// ---------------------------------------------------------------------------

describe("parseCodexOutput", () => {
  test("returns null for non-existent file", async () => {
    const result = await parseCodexOutput("/tmp/nonexistent-" + Date.now() + ".json");
    expect(result).toBeNull();
  });

  test("returns null for empty file", async () => {
    const path = join(tmpdir(), `test-codex-empty-${Date.now()}.json`);
    writeFileSync(path, "", "utf-8");

    const result = await parseCodexOutput(path);
    expect(result).toBeNull();
    // File should be cleaned up
    expect(existsSync(path)).toBe(false);
  });

  test("returns null for invalid JSON", async () => {
    const path = join(tmpdir(), `test-codex-invalid-${Date.now()}.json`);
    writeFileSync(path, "{not valid", "utf-8");

    const result = await parseCodexOutput(path);
    expect(result).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  test("returns null for valid JSON without findings array", async () => {
    const path = join(tmpdir(), `test-codex-nofindings-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify({ foo: "bar" }), "utf-8");

    const result = await parseCodexOutput(path);
    expect(result).toBeNull();
    expect(existsSync(path)).toBe(false);
  });

  test("parses valid output", async () => {
    const validOutput = {
      findings: [
        {
          title: "[P1] Bug in logic",
          body: "The variable is used before initialization.",
          confidence_score: 0.95,
          priority: 1,
          code_location: {
            absolute_file_path: "/home/user/project/src/main.ts",
            line_range: { start: 10, end: 12 },
          },
        },
      ],
      overall_correctness: "incorrect",
      overall_explanation: "Found one important bug",
      overall_confidence_score: 0.9,
    };
    const path = join(tmpdir(), `test-codex-valid-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(validOutput), "utf-8");

    const result = await parseCodexOutput(path);
    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].title).toBe("[P1] Bug in logic");
    expect(result!.overall_correctness).toBe("incorrect");
    expect(result!.overall_confidence_score).toBe(0.9);

    // File should be cleaned up
    expect(existsSync(path)).toBe(false);
  });

  test("handles empty findings array", async () => {
    const validOutput = {
      findings: [],
      overall_correctness: "correct",
      overall_explanation: "No issues found",
      overall_confidence_score: 0.95,
    };
    const path = join(tmpdir(), `test-codex-empty-findings-${Date.now()}.json`);
    writeFileSync(path, JSON.stringify(validOutput), "utf-8");

    const result = await parseCodexOutput(path);
    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(0);
  });

  test("cleans up file even on error", async () => {
    const path = join(tmpdir(), `test-codex-cleanup-${Date.now()}.json`);
    writeFileSync(path, "bad content", "utf-8");

    await parseCodexOutput(path);
    expect(existsSync(path)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// transformReviewFindings
// ---------------------------------------------------------------------------

describe("transformReviewFindings", () => {
  const findings: CodexFinding[] = [
    {
      title: "[P1] Memory leak",
      body: "Resource not released in finally block.",
      confidence_score: 0.9,
      priority: 1,
      code_location: {
        absolute_file_path: "/home/user/project/src/handler.ts",
        line_range: { start: 42, end: 50 },
      },
    },
    {
      title: "[P2] Style issue",
      body: "Inconsistent naming.",
      confidence_score: 0.7,
      priority: 2,
      code_location: {
        absolute_file_path: "/home/user/project/src/util.ts",
        line_range: { start: 10, end: 10 },
      },
    },
  ];

  test("transforms findings to annotation format", () => {
    const annotations = transformReviewFindings(findings, "codex");
    expect(annotations).toHaveLength(2);

    expect(annotations[0].source).toBe("codex");
    expect(annotations[0].filePath).toContain("handler.ts");
    expect(annotations[0].lineStart).toBe(42);
    expect(annotations[0].lineEnd).toBe(50);
    expect(annotations[0].type).toBe("comment");
    expect(annotations[0].side).toBe("new");
    expect(annotations[0].scope).toBe("line");
    expect(annotations[0].text).toContain("[P1] Memory leak");
    expect(annotations[0].text).toContain("Resource not released");
    expect(annotations[0].author).toBe("Review Agent");
  });

  test("applies cwd relativization", () => {
    const annotations = transformReviewFindings(
      findings,
      "codex",
      "/home/user/project",
    );
    expect(annotations[0].filePath).toBe("src/handler.ts");
    expect(annotations[1].filePath).toBe("src/util.ts");
  });

  test("uses custom author", () => {
    const annotations = transformReviewFindings(
      findings,
      "codex",
      undefined,
      "Custom Agent",
    );
    expect(annotations[0].author).toBe("Custom Agent");
  });

  test("filters out findings without code_location", () => {
    const noLocation = [
      {
        title: "No location",
        body: "test",
        confidence_score: 0.5,
        priority: null,
        code_location: undefined as any,
      },
    ] as CodexFinding[];
    const annotations = transformReviewFindings(noLocation, "codex");
    expect(annotations).toHaveLength(0);
  });

  test("filters out findings without absolute_file_path", () => {
    const noPath = [
      {
        title: "No file",
        body: "test",
        confidence_score: 0.5,
        priority: null,
        code_location: {
          absolute_file_path: "",
          line_range: { start: 1, end: 2 },
        },
      },
    ] as CodexFinding[];
    const annotations = transformReviewFindings(noPath, "codex");
    expect(annotations).toHaveLength(0);
  });

  test("filters out findings without line_range", () => {
    const noRange = [
      {
        title: "No range",
        body: "test",
        confidence_score: 0.5,
        priority: null,
        code_location: {
          absolute_file_path: "file.ts",
          line_range: undefined as any,
        },
      },
    ] as CodexFinding[];
    const annotations = transformReviewFindings(noRange, "codex");
    expect(annotations).toHaveLength(0);
  });

  test("returns empty array for empty findings", () => {
    const annotations = transformReviewFindings([], "codex");
    expect(annotations).toHaveLength(0);
  });

  test("combines title and body in text field", () => {
    const annotations = transformReviewFindings(findings, "codex");
    expect(annotations[0].text).toBe(
      "[P1] Memory leak\n\nResource not released in finally block.",
    );
  });
});
