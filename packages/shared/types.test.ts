/**
 * Tests for shared types — EditorAnnotation interface and re-exports.
 * Run: bun test packages/shared/types.test.ts
 *
 * types.ts is primarily type definitions and re-exports.
 * This validates the type contracts and ensures interfaces can be instantiated.
 */

import { describe, expect, test } from "bun:test";
import type { EditorAnnotation, DiffOption, WorktreeInfo } from "./types";

describe("EditorAnnotation", () => {
  test("can construct a minimal annotation", () => {
    const ann: EditorAnnotation = {
      id: "ann-1",
      filePath: "src/auth.ts",
      selectedText: "const token = getCookie(req)",
      lineStart: 10,
      lineEnd: 10,
      createdAt: Date.now(),
    };
    expect(ann.id).toBe("ann-1");
    expect(ann.filePath).toBe("src/auth.ts");
    expect(ann.selectedText).toBeTruthy();
    expect(ann.lineStart).toBe(10);
    expect(ann.lineEnd).toBe(10);
    expect(ann.comment).toBeUndefined();
  });

  test("can construct annotation with comment", () => {
    const ann: EditorAnnotation = {
      id: "ann-2",
      filePath: "src/utils.ts",
      selectedText: "JSON.parse(input)",
      lineStart: 42,
      lineEnd: 42,
      comment: "Should wrap in try/catch",
      createdAt: Date.now(),
    };
    expect(ann.comment).toBe("Should wrap in try/catch");
  });

  test("can construct multiline annotation", () => {
    const ann: EditorAnnotation = {
      id: "ann-3",
      filePath: "src/app.ts",
      selectedText: "line1\nline2\nline3",
      lineStart: 5,
      lineEnd: 7,
      createdAt: Date.now(),
    };
    expect(ann.lineEnd - ann.lineStart).toBe(2);
  });

  test("createdAt is numeric timestamp", () => {
    const ann: EditorAnnotation = {
      id: "ann-4",
      filePath: "f.ts",
      selectedText: "x",
      lineStart: 1,
      lineEnd: 1,
      createdAt: 1700000000000,
    };
    expect(typeof ann.createdAt).toBe("number");
    expect(ann.createdAt).toBeGreaterThan(0);
  });

  test("file path is workspace-relative (not absolute)", () => {
    const ann: EditorAnnotation = {
      id: "ann-5",
      filePath: "src/components/App.tsx",
      selectedText: "export default",
      lineStart: 1,
      lineEnd: 1,
      createdAt: Date.now(),
    };
    // Workspace-relative paths contain / but don't start with /
    expect(ann.filePath).not.toMatch(/^\//);
  });
});

describe("re-exported types", () => {
  test("DiffOption has id and label", () => {
    const opt: DiffOption = { id: "unstaged", label: "Unstaged changes" };
    expect(opt.id).toBe("unstaged");
    expect(opt.label).toBe("Unstaged changes");
  });

  test("WorktreeInfo has required fields", () => {
    const info: WorktreeInfo = {
      path: "/repo/.git/worktrees/feature",
      branch: "feature-branch",
      head: "abc1234",
    };
    expect(info.path).toBeTruthy();
    expect(info.branch).toBe("feature-branch");
    expect(info.head).toBe("abc1234");
  });

  test("WorktreeInfo branch can be null", () => {
    const info: WorktreeInfo = {
      path: "/repo/.git/worktrees/detached",
      branch: null,
      head: "def5678",
    };
    expect(info.branch).toBeNull();
  });
});
