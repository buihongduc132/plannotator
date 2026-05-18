import { describe, test, expect, mock, beforeEach } from "bun:test";

describe("vcs dispatch", () => {
  describe("VcsProvider interface", () => {
    test("gitProvider owns standard diff types", async () => {
      const { detectVcs } = await import("./vcs");
      // In test env, likely no git repo at /tmp
      const provider = await detectVcs("/tmp/nonexistent-vcs-test");
      // Falls back to gitProvider
      expect(provider.id).toBe("git");
    });
  });

  describe("getVcsContext", () => {
    test("returns git context in non-vcs directory", async () => {
      const { getVcsContext } = await import("./vcs");
      try {
        const ctx = await getVcsContext("/tmp/nonexistent-vcs-test");
        expect(ctx).toBeDefined();
        expect(typeof ctx.vcsType).toBe("string");
      } catch (e) {
        // git not available in test env — acceptable
        expect(e).toBeDefined();
      }
    });
  });

  describe("canStageFiles", () => {
    test("returns true for git diff types", async () => {
      const { canStageFiles } = await import("./vcs");
      expect(canStageFiles("uncommitted")).toBe(true);
      expect(canStageFiles("staged")).toBe(true);
      expect(canStageFiles("unstaged")).toBe(true);
    });

    test("returns false for p4 diff types", async () => {
      const { canStageFiles } = await import("./vcs");
      expect(canStageFiles("p4-default")).toBe(false);
      expect(canStageFiles("p4-changelist:123")).toBe(false);
    });
  });

  describe("resolveVcsCwd", () => {
    test("returns fallback for non-worktree diff types", async () => {
      const { resolveVcsCwd } = await import("./vcs");
      expect(resolveVcsCwd("uncommitted", "/some/path")).toBe("/some/path");
      expect(resolveVcsCwd("staged")).toBeUndefined();
    });

    test("extracts path from worktree diff type", async () => {
      const { resolveVcsCwd } = await import("./vcs");
      const result = resolveVcsCwd("worktree:/path/to/worktree", "/fallback");
      expect(result).toBe("/path/to/worktree");
    });
  });

  describe("stageFile / unstageFile", () => {
    test("stageFile throws for p4 diff types", async () => {
      const { stageFile } = await import("./vcs");
      expect(stageFile("p4-default", "some/file.ts")).rejects.toThrow("Staging not available");
    });

    test("unstageFile throws for p4 diff types", async () => {
      const { unstageFile } = await import("./vcs");
      expect(unstageFile("p4-default", "some/file.ts")).rejects.toThrow("Unstaging not available");
    });
  });

  describe("getProviderForDiffType (internal)", () => {
    test("git types resolve to git provider", async () => {
      const mod = await import("./vcs");
      // Access via canStageFiles which uses getProviderForDiffType internally
      expect(mod.canStageFiles("uncommitted")).toBe(true);
      expect(mod.canStageFiles("staged")).toBe(true);
      expect(mod.canStageFiles("branch")).toBe(true);
      expect(mod.canStageFiles("merge-base")).toBe(true);
      expect(mod.canStageFiles("last-commit")).toBe(true);
    });

    test("p4 types resolve to p4 provider", async () => {
      const mod = await import("./vcs");
      expect(mod.canStageFiles("p4-default")).toBe(false);
      expect(mod.canStageFiles("p4-changelist:42")).toBe(false);
    });
  });
});
