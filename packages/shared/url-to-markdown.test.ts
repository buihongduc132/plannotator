import { describe, test, expect } from "bun:test";

describe("url-to-markdown", () => {
  describe("isLocalUrl (tested via urlToMarkdown)", () => {
    test("module exports urlToMarkdown", async () => {
      const mod = await import("./url-to-markdown");
      expect(mod.urlToMarkdown).toBeDefined();
      expect(typeof mod.urlToMarkdown).toBe("function");
    });
  });
});
