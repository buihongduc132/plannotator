import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

describe("share-url", () => {
  describe("formatSize", () => {
    test("formats bytes", async () => {
      const { formatSize } = await import("./share-url");
      expect(formatSize(500)).toBe("500 B");
    });

    test("formats KB with decimal", async () => {
      const { formatSize } = await import("./share-url");
      expect(formatSize(1536)).toBe("1.5 KB");
    });

    test("formats large KB without decimal", async () => {
      const { formatSize } = await import("./share-url");
      expect(formatSize(102400)).toBe("100 KB");
    });

    test("formats 0 bytes", async () => {
      const { formatSize } = await import("./share-url");
      expect(formatSize(0)).toBe("0 B");
    });
  });

  describe("generateRemoteShareUrl", () => {
    test("generates share URL with default base", async () => {
      const { generateRemoteShareUrl } = await import("./share-url");
      const url = await generateRemoteShareUrl("test plan");
      expect(url).toContain("share.plannotator.ai");
      expect(url).toContain("#");
    });

    test("uses custom share base URL", async () => {
      const { generateRemoteShareUrl } = await import("./share-url");
      const url = await generateRemoteShareUrl("test plan", "https://custom.example.com");
      expect(url).toContain("custom.example.com");
    });
  });
});
