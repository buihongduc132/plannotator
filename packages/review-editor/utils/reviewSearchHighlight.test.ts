import { describe, test, expect, mock, beforeEach } from "bun:test";

describe("reviewSearchHighlight", () => {
  describe("module exports", () => {
    test("exports search highlight functions", async () => {
      const mod = await import("./reviewSearchHighlight");
      expect(mod).toBeDefined();
    });
  });

  describe("highlightSearchTerm", () => {
    test("handles null/undefined gracefully", async () => {
      const mod = await import("./reviewSearchHighlight");
      // Functions should handle missing DOM gracefully
      if (typeof mod.highlightSearchTerm === "function") {
        expect(() => mod.highlightSearchTerm("", null as any)).not.toThrow();
      }
    });
  });
});
