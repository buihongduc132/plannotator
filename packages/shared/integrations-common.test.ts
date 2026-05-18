import { describe, test, expect } from "bun:test";

describe("integrations-common", () => {
  describe("generateFrontmatter", () => {
    test("generates YAML frontmatter with tags", async () => {
      const { generateFrontmatter } = await import("./integrations-common");
      const result = generateFrontmatter(["tag1", "Tag2", "TAG3"]);
      expect(result).toContain("created:");
      expect(result).toContain("source: plannotator");
      expect(result).toContain("tag1, tag2, tag3");
      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---$/);
    });
  });

  describe("extractTitle", () => {
    test("extracts title from H1 heading", async () => {
      const { extractTitle } = await import("./integrations-common");
      expect(extractTitle("# My Plan Title")).toBe("My Plan Title");
    });

    test("extracts title from Implementation Plan heading", async () => {
      const { extractTitle } = await import("./integrations-common");
      expect(extractTitle("# Implementation Plan: Add OAuth")).toBe("Add OAuth");
    });

    test("extracts title from Plan: heading", async () => {
      const { extractTitle } = await import("./integrations-common");
      expect(extractTitle("# Plan: Refactor Auth")).toBe("Refactor Auth");
    });

    test("returns Plan when no H1", async () => {
      const { extractTitle } = await import("./integrations-common");
      expect(extractTitle("## No H1 here")).toBe("Plan");
    });

    test("strips invalid filename characters", async () => {
      const { extractTitle } = await import("./integrations-common");
      const result = extractTitle("# My <Plan> with: special/chars");
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
      expect(result).not.toContain(":");
    });

    test("limits title to 50 chars", async () => {
      const { extractTitle } = await import("./integrations-common");
      const longTitle = "A".repeat(80);
      const result = extractTitle(`# ${longTitle}`);
      expect(result.length).toBeLessThanOrEqual(50);
    });
  });

  describe("generateFilename", () => {
    test("generates filename with default format", async () => {
      const { generateFilename } = await import("./integrations-common");
      const result = generateFilename("# My Plan");
      expect(result).toContain("My Plan");
      expect(result).toMatch(/\.md$/);
    });

    test("applies dash separator", async () => {
      const { generateFilename } = await import("./integrations-common");
      const result = generateFilename("# My Plan", undefined, "dash");
      expect(result).not.toContain(" ");
    });

    test("applies underscore separator", async () => {
      const { generateFilename } = await import("./integrations-common");
      const result = generateFilename("# My Plan", undefined, "underscore");
      expect(result).not.toContain(" ");
      expect(result).toContain("_");
    });

    test("uses custom format string", async () => {
      const { generateFilename } = await import("./integrations-common");
      const result = generateFilename("# Test", "{YYYY}-{MM}-{DD} {title}");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} Test\.md$/);
    });

    test("always ends with .md", async () => {
      const { generateFilename } = await import("./integrations-common");
      const result = generateFilename("# Test");
      expect(result).toMatch(/\.md$/);
    });
  });

  describe("stripH1", () => {
    test("removes H1 line", async () => {
      const { stripH1 } = await import("./integrations-common");
      expect(stripH1("# Title\nBody text")).toBe("Body text");
    });

    test("returns body when no H1", async () => {
      const { stripH1 } = await import("./integrations-common");
      expect(stripH1("Body text")).toBe("Body text");
    });
  });

  describe("buildHashtags", () => {
    test("builds hashtags from custom tags", async () => {
      const { buildHashtags } = await import("./integrations-common");
      expect(buildHashtags("tag1, tag2", [])).toBe("#tag1 #tag2");
    });

    test("builds hashtags from auto tags when no custom", async () => {
      const { buildHashtags } = await import("./integrations-common");
      expect(buildHashtags(undefined, ["auto1", "auto2"])).toBe("#auto1 #auto2");
    });

    test("filters empty tags", async () => {
      const { buildHashtags } = await import("./integrations-common");
      expect(buildHashtags("tag1, , tag2", [])).toBe("#tag1 #tag2");
    });
  });

  describe("buildBearContent", () => {
    test("prepends hashtags", async () => {
      const { buildBearContent } = await import("./integrations-common");
      const result = buildBearContent("body", "#tags", "prepend");
      expect(result).toMatch(/^#tags/);
      expect(result).toContain("body");
    });

    test("appends hashtags", async () => {
      const { buildBearContent } = await import("./integrations-common");
      const result = buildBearContent("body", "#tags", "append");
      expect(result).toMatch(/#tags$/);
      expect(result).toContain("body");
    });
  });

  describe("generateOctarineFrontmatter", () => {
    test("generates Octarine YAML frontmatter", async () => {
      const { generateOctarineFrontmatter } = await import("./integrations-common");
      const result = generateOctarineFrontmatter(["tag1", "tag2"]);
      expect(result).toContain("tags:");
      expect(result).toContain("  - tag1");
      expect(result).toContain("  - tag2");
      expect(result).toContain("Status: Draft");
      expect(result).toContain("Author: plannotator");
      expect(result).toContain("Last Edited:");
    });
  });

  describe("detectObsidianVaults", () => {
    test("returns array", async () => {
      const { detectObsidianVaults } = await import("./integrations-common");
      const vaults = detectObsidianVaults();
      expect(Array.isArray(vaults)).toBe(true);
    });
  });
});
