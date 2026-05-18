/**
 * Tests for obsidian.ts — Obsidian Integration Utility
 * Run: bun test packages/ui/utils/obsidian.test.ts
 */

import { describe, expect, test, beforeEach, mock } from "bun:test";

// Mock storage
const mockStorage = new Map<string, string>();
mock.module("./storage", () => ({
  storage: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { mockStorage.set(key, value); },
    removeItem: (key: string) => { mockStorage.delete(key); },
  },
  getAutoCloseDelay: () => "off",
  setAutoCloseDelay: () => {},
  AUTO_CLOSE_OPTIONS: [],
}));

const {
  getObsidianSettings,
  saveObsidianSettings,
  getEffectiveVaultPath,
  isObsidianConfigured,
  isVaultBrowserEnabled,
  extractTags,
  generateFrontmatter,
  generateFilename,
  prepareNoteContent,
  CUSTOM_PATH_SENTINEL,
  DEFAULT_FILENAME_FORMAT,
} = await import("./obsidian");

describe("CUSTOM_PATH_SENTINEL", () => {
  test("is '__custom__'", () => {
    expect(CUSTOM_PATH_SENTINEL).toBe("__custom__");
  });
});

describe("DEFAULT_FILENAME_FORMAT", () => {
  test("contains expected placeholders", () => {
    expect(DEFAULT_FILENAME_FORMAT).toContain("{title}");
    expect(DEFAULT_FILENAME_FORMAT).toContain("{YYYY}");
  });
});

describe("getObsidianSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns defaults when nothing stored", () => {
    const settings = getObsidianSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.vaultPath).toBe("");
    expect(settings.folder).toBe("plannotator");
    expect(settings.autoSave).toBe(false);
    expect(settings.vaultBrowserEnabled).toBe(false);
    expect(settings.filenameSeparator).toBe("space");
    expect(settings.customPath).toBeUndefined();
    expect(settings.filenameFormat).toBeUndefined();
  });

  test("reads all settings from storage", () => {
    mockStorage.set("plannotator-obsidian-enabled", "true");
    mockStorage.set("plannotator-obsidian-vault", "/path/to/vault");
    mockStorage.set("plannotator-obsidian-folder", "my-folder");
    mockStorage.set("plannotator-obsidian-autosave", "true");
    mockStorage.set("plannotator-obsidian-vault-browser", "true");
    mockStorage.set("plannotator-obsidian-filename-separator", "dash");
    mockStorage.set("plannotator-obsidian-custom-path", "/custom");
    mockStorage.set("plannotator-obsidian-filename-format", "{YYYY}-{title}");
    const settings = getObsidianSettings();
    expect(settings).toEqual({
      enabled: true,
      vaultPath: "/path/to/vault",
      folder: "my-folder",
      customPath: "/custom",
      filenameFormat: "{YYYY}-{title}",
      filenameSeparator: "dash",
      autoSave: true,
      vaultBrowserEnabled: true,
    });
  });
});

describe("saveObsidianSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("persists all settings", () => {
    saveObsidianSettings({
      enabled: true,
      vaultPath: "/vault",
      folder: "notes",
      customPath: "/custom",
      filenameFormat: "{title}",
      filenameSeparator: "underscore",
      autoSave: true,
      vaultBrowserEnabled: true,
    });
    expect(mockStorage.get("plannotator-obsidian-enabled")).toBe("true");
    expect(mockStorage.get("plannotator-obsidian-vault")).toBe("/vault");
    expect(mockStorage.get("plannotator-obsidian-folder")).toBe("notes");
    expect(mockStorage.get("plannotator-obsidian-custom-path")).toBe("/custom");
    expect(mockStorage.get("plannotator-obsidian-filename-format")).toBe("{title}");
    expect(mockStorage.get("plannotator-obsidian-filename-separator")).toBe("underscore");
    expect(mockStorage.get("plannotator-obsidian-autosave")).toBe("true");
    expect(mockStorage.get("plannotator-obsidian-vault-browser")).toBe("true");
  });

  test("handles empty optional fields", () => {
    saveObsidianSettings({
      enabled: false,
      vaultPath: "",
      folder: "plannotator",
      filenameSeparator: "space",
      autoSave: false,
      vaultBrowserEnabled: false,
    });
    expect(mockStorage.get("plannotator-obsidian-custom-path")).toBe("");
    expect(mockStorage.get("plannotator-obsidian-filename-format")).toBe("");
  });
});

describe("getEffectiveVaultPath", () => {
  test("returns vaultPath when not custom sentinel", () => {
    const path = getEffectiveVaultPath({ vaultPath: "/my/vault", folder: "notes", enabled: true, filenameSeparator: "space", autoSave: false, vaultBrowserEnabled: false });
    expect(path).toBe("/my/vault");
  });

  test("returns customPath when sentinel is used", () => {
    const path = getEffectiveVaultPath({
      vaultPath: CUSTOM_PATH_SENTINEL,
      customPath: "/custom/path",
      folder: "notes",
      enabled: true,
      filenameSeparator: "space",
      autoSave: false,
      vaultBrowserEnabled: false,
    });
    expect(path).toBe("/custom/path");
  });

  test("returns empty string when sentinel with no customPath", () => {
    const path = getEffectiveVaultPath({
      vaultPath: CUSTOM_PATH_SENTINEL,
      folder: "notes",
      enabled: true,
      filenameSeparator: "space",
      autoSave: false,
      vaultBrowserEnabled: false,
    });
    expect(path).toBe("");
  });
});

describe("isObsidianConfigured", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns false when not enabled", () => {
    mockStorage.set("plannotator-obsidian-vault", "/vault");
    expect(isObsidianConfigured()).toBe(false);
  });

  test("returns false when enabled but no vault", () => {
    mockStorage.set("plannotator-obsidian-enabled", "true");
    expect(isObsidianConfigured()).toBe(false);
  });

  test("returns true when enabled and vault set", () => {
    mockStorage.set("plannotator-obsidian-enabled", "true");
    mockStorage.set("plannotator-obsidian-vault", "/my/vault");
    expect(isObsidianConfigured()).toBe(true);
  });
});

describe("isVaultBrowserEnabled", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns false when not enabled", () => {
    mockStorage.set("plannotator-obsidian-vault", "/vault");
    mockStorage.set("plannotator-obsidian-vault-browser", "true");
    expect(isVaultBrowserEnabled()).toBe(false);
  });

  test("returns false when enabled but no browser flag", () => {
    mockStorage.set("plannotator-obsidian-enabled", "true");
    mockStorage.set("plannotator-obsidian-vault", "/vault");
    expect(isVaultBrowserEnabled()).toBe(false);
  });

  test("returns true when all conditions met", () => {
    mockStorage.set("plannotator-obsidian-enabled", "true");
    mockStorage.set("plannotator-obsidian-vault", "/vault");
    mockStorage.set("plannotator-obsidian-vault-browser", "true");
    expect(isVaultBrowserEnabled()).toBe(true);
  });
});

describe("extractTags", () => {
  test("always includes 'plannotator'", () => {
    const tags = extractTags("hello world");
    expect(tags).toContain("plannotator");
  });

  test("extracts words from H1 title", () => {
    const tags = extractTags("# My Database Migration Plan\nSome content");
    expect(tags).toContain("database");
    expect(tags).toContain("migration");
  });

  test("excludes stop words", () => {
    const tags = extractTags("# The Plan for Implementation\nContent");
    expect(tags).not.toContain("the");
    expect(tags).not.toContain("plan");
    expect(tags).not.toContain("implementation");
  });

  test("extracts code fence languages", () => {
    const md = "# Title\n\n```typescript\nconst x = 1;\n```\n\n```rust\nlet y = 2;\n```";
    const tags = extractTags(md);
    expect(tags).toContain("typescript");
    expect(tags).toContain("rust");
  });

  test("excludes generic languages", () => {
    const md = "```json\n{}\n```\n\n```yaml\nkey: value\n```";
    const tags = extractTags(md);
    expect(tags).not.toContain("json");
    expect(tags).not.toContain("yaml");
  });

  test("deduplicates languages", () => {
    const md = "```typescript\na\n```\n\n```typescript\nb\n```";
    const tags = extractTags(md);
    const tsCount = tags.filter(t => t === "typescript").length;
    expect(tsCount).toBe(1);
  });

  test("returns max 6 tags", () => {
    const md = "# One Two Three Four Five Six Seven\n\n```rust\n```\n```go\n```\n```python\n```\n```ruby\n```";
    const tags = extractTags(md);
    expect(tags.length).toBeLessThanOrEqual(6);
  });

  test("handles empty markdown", () => {
    const tags = extractTags("");
    expect(tags).toContain("plannotator");
  });

  test("handles markdown without H1", () => {
    const tags = extractTags("## Heading 2\nSome content");
    expect(tags).toContain("plannotator");
  });

  test("strips special characters from title words", () => {
    const tags = extractTags("# API/v2 Refactor!");
    expect(tags.some(t => t.includes("api") || t.includes("refactor"))).toBe(true);
  });

  test("filters words shorter than 3 characters", () => {
    const tags = extractTags("# A B CC DDD Plan");
    // Only "ddd" should pass the >2 filter (plannotator is always included)
    expect(tags).not.toContain("a");
    expect(tags).not.toContain("b");
    expect(tags).not.toContain("cc");
  });

  test("matches Plan: prefix pattern", () => {
    const tags = extractTags("# Plan: Database Refactor\nContent");
    expect(tags).toContain("database");
    expect(tags).toContain("refactor");
  });
});

describe("generateFrontmatter", () => {
  test("generates valid YAML frontmatter", () => {
    const fm = generateFrontmatter(["plannotator", "typescript"]);
    expect(fm).toMatch(/^---\n/);
    expect(fm).toMatch(/\n---$/);
    expect(fm).toContain("created:");
    expect(fm).toContain("source: plannotator");
    expect(fm).toContain("tags: [plannotator, typescript]");
  });

  test("lowercases tags", () => {
    const fm = generateFrontmatter(["TypeScript", "RUST"]);
    expect(fm).toContain("tags: [typescript, rust]");
  });

  test("handles empty tags array", () => {
    const fm = generateFrontmatter([]);
    expect(fm).toContain("tags: []");
  });

  test("includes ISO timestamp", () => {
    const fm = generateFrontmatter(["test"]);
    const createdMatch = fm.match(/created: (.+)/);
    expect(createdMatch).toBeTruthy();
    // Should be parseable as a date
    expect(new Date(createdMatch![1]).toISOString()).toBeTruthy();
  });
});

describe("generateFilename", () => {
  test("generates filename with .md extension", () => {
    const filename = generateFilename();
    expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  });

  test("filename contains current date", () => {
    const filename = generateFilename();
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    expect(filename).toContain(dateStr);
  });
});

describe("prepareNoteContent", () => {
  test("prepends frontmatter to markdown", () => {
    const result = prepareNoteContent("# My Plan\n\nStep 1: Do things");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("# My Plan");
    expect(result).toContain("source: plannotator");
  });

  test("includes tags extracted from content", () => {
    const result = prepareNoteContent("# Database Migration\n\n```sql\nSELECT 1;\n```");
    expect(result).toContain("tags:");
  });

  test("handles empty markdown", () => {
    const result = prepareNoteContent("");
    expect(result).toContain("---");
    expect(result).toContain("source: plannotator");
  });
});
