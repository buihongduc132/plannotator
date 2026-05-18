import { describe, test, expect } from "bun:test";

describe("p4 utilities", () => {
  describe("detectP4Workspace", () => {
    test("returns null when p4 is not installed", async () => {
      const { detectP4Workspace } = await import("./p4");
      const result = await detectP4Workspace("/tmp/nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getP4Context", () => {
    test("returns empty context when not in p4 workspace", async () => {
      const { getP4Context } = await import("./p4");
      const ctx = await getP4Context("/tmp/nonexistent");
      expect(ctx.vcsType).toBe("p4");
      expect(ctx.currentBranch).toBe("");
      expect(ctx.diffOptions).toEqual([]);
      expect(ctx.availableBranches).toEqual({ local: [], remote: [] });
      expect(ctx.worktrees).toEqual([]);
    });
  });

  describe("runP4Diff", () => {
    test("returns error when not in p4 workspace", async () => {
      const { runP4Diff } = await import("./p4");
      const result = await runP4Diff("p4-default", "/tmp/nonexistent");
      expect(result.error).toBeDefined();
      expect(result.patch).toBe("");
    });

    test("returns empty result for unknown diff type", async () => {
      const { runP4Diff } = await import("./p4");
      const result = await runP4Diff("unknown-type" as any, "/tmp/nonexistent");
      expect(result.patch).toBe("");
    });
  });

  describe("getP4FileContentsForDiff", () => {
    test("returns null contents when not in p4 workspace", async () => {
      const { getP4FileContentsForDiff } = await import("./p4");
      const result = await getP4FileContentsForDiff("p4-default", "some/file.ts", "/tmp/nonexistent");
      expect(result.oldContent).toBeNull();
      expect(result.newContent).toBeNull();
    });
  });
});
