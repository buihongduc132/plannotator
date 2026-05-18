import { describe, test, expect } from "bun:test";

describe("repo info detection", () => {
  describe("getRepoInfo", () => {
    test("returns repo info in a git repo", async () => {
      const { getRepoInfo } = await import("./repo");
      const info = await getRepoInfo();
      // In the plannotator repo, should get a result
      expect(info).not.toBeNull();
      expect(info!.display).toBeTruthy();
    });

    test("returns null or info with display property", async () => {
      const { getRepoInfo } = await import("./repo");
      const info = await getRepoInfo();
      if (info) {
        expect(info.display).toBeDefined();
        expect(typeof info.display).toBe("string");
      }
    });
  });
});
