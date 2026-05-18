import { describe, test, expect, mock, beforeEach } from "bun:test";

describe("bear utility", () => {
  describe("getBearSettings", () => {
    test("returns default settings when storage returns null", async () => {
      // The real storage returns null for unset keys
      // getBearSettings should return sensible defaults
      const { getBearSettings } = await import("./bear");
      const settings = getBearSettings();
      expect(settings).toBeDefined();
      expect(typeof settings.enabled).toBe("boolean");
      expect(typeof settings.customTags).toBe("string");
      expect(typeof settings.tagPosition).toBe("string");
      expect(typeof settings.autoSave).toBe("boolean");
    });
  });

  describe("normalizeTags", () => {
    test("strips # prefix and lowercases", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("#Tag1, ##Tag2")).toBe("tag1, tag2");
    });

    test("replaces spaces with hyphens", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("my tag, another tag")).toBe("my-tag, another-tag");
    });

    test("removes invalid characters", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("tag@1, tag!2")).toBe("tag1, tag2");
    });

    test("handles empty string", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("")).toBe("");
    });

    test("handles single tag", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("#my-tag")).toBe("my-tag");
    });

    test("handles tags with slashes", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("folder/subfolder/tag")).toBe("folder/subfolder/tag");
    });

    test("trims whitespace around tags", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("  tag1  ,  tag2  ")).toBe("tag1, tag2");
    });

    test("filters empty tags", async () => {
      const { normalizeTags } = await import("./bear");
      expect(normalizeTags("tag1,, ,tag2")).toBe("tag1, tag2");
    });
  });
});
