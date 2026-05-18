import { describe, test, expect } from "bun:test";

describe("pr-provider shared", () => {
  describe("type exports", () => {
    test("module loads and exports functions", async () => {
      const mod = await import("./pr-provider");
      // Check re-exports exist
      expect(mod).toBeDefined();
    });
  });

  describe("getMRLabel", () => {
    test("returns PR for github platform", async () => {
      const { getMRLabel } = await import("./pr-provider");
      expect(getMRLabel({ platform: "github" } as any)).toBe("PR");
    });

    test("returns MR for gitlab platform", async () => {
      const { getMRLabel } = await import("./pr-provider");
      expect(getMRLabel({ platform: "gitlab" } as any)).toBe("MR");
    });
  });

  describe("getDisplayRepo", () => {
    test("returns owner/repo for github", async () => {
      const { getDisplayRepo } = await import("./pr-provider");
      const result = getDisplayRepo({
        platform: "github",
        owner: "org",
        repo: "repo",
      } as any);
      expect(result).toBe("org/repo");
    });

    test("returns projectPath for gitlab", async () => {
      const { getDisplayRepo } = await import("./pr-provider");
      const result = getDisplayRepo({
        platform: "gitlab",
        projectPath: "group/project",
      } as any);
      expect(result).toBe("group/project");
    });
  });

  describe("getMRNumberLabel", () => {
    test("returns #N for github", async () => {
      const { getMRNumberLabel } = await import("./pr-provider");
      const result = getMRNumberLabel({
        platform: "github",
        number: 42,
      } as any);
      expect(result).toBe("#42");
    });

    test("returns !N for gitlab", async () => {
      const { getMRNumberLabel } = await import("./pr-provider");
      const result = getMRNumberLabel({
        platform: "gitlab",
        iid: 5,
      } as any);
      expect(result).toBe("!5");
    });
  });
});
