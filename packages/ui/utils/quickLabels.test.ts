/**
 * Tests for quickLabels.ts — Quick Label presets
 * Run: bun test packages/ui/utils/quickLabels.test.ts
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
  getQuickLabels,
  saveQuickLabels,
  resetQuickLabels,
  findLabelByText,
  LABEL_COLOR_MAP,
  DEFAULT_QUICK_LABELS,
} = await import("./quickLabels");

describe("DEFAULT_QUICK_LABELS", () => {
  test("has expected default labels", () => {
    expect(DEFAULT_QUICK_LABELS.length).toBeGreaterThanOrEqual(10);
  });

  test("each label has required fields", () => {
    for (const label of DEFAULT_QUICK_LABELS) {
      expect(label.id).toBeTruthy();
      expect(label.emoji).toBeTruthy();
      expect(label.text).toBeTruthy();
      expect(label.color).toBeTruthy();
    }
  });

  test("contains specific known labels", () => {
    const ids = DEFAULT_QUICK_LABELS.map(l => l.id);
    expect(ids).toContain("needs-tests");
    expect(ids).toContain("nice-approach");
    expect(ids).toContain("out-of-scope");
    expect(ids).toContain("clarify-this");
  });

  test("ids are kebab-case", () => {
    for (const label of DEFAULT_QUICK_LABELS) {
      expect(label.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("LABEL_COLOR_MAP", () => {
  test("has entries for common colors", () => {
    expect(LABEL_COLOR_MAP).toHaveProperty("blue");
    expect(LABEL_COLOR_MAP).toHaveProperty("red");
    expect(LABEL_COLOR_MAP).toHaveProperty("green");
    expect(LABEL_COLOR_MAP).toHaveProperty("yellow");
    expect(LABEL_COLOR_MAP).toHaveProperty("purple");
  });

  test("each color has bg, text, and darkText", () => {
    for (const [, colors] of Object.entries(LABEL_COLOR_MAP)) {
      expect(colors).toHaveProperty("bg");
      expect(colors).toHaveProperty("text");
      expect(colors).toHaveProperty("darkText");
    }
  });

  test("all default label colors exist in color map", () => {
    for (const label of DEFAULT_QUICK_LABELS) {
      expect(LABEL_COLOR_MAP).toHaveProperty(label.color);
    }
  });
});

describe("getQuickLabels", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns default labels when nothing stored", () => {
    const labels = getQuickLabels();
    expect(labels).toEqual(DEFAULT_QUICK_LABELS);
  });

  test("returns custom labels from storage", () => {
    const custom = [{ id: "custom", emoji: "🎯", text: "Custom", color: "blue" }];
    mockStorage.set("plannotator-quick-labels", JSON.stringify(custom));
    const labels = getQuickLabels();
    expect(labels).toEqual(custom);
  });

  test("returns defaults for invalid JSON", () => {
    mockStorage.set("plannotator-quick-labels", "not-json");
    const labels = getQuickLabels();
    expect(labels).toEqual(DEFAULT_QUICK_LABELS);
  });

  test("returns defaults for empty array", () => {
    mockStorage.set("plannotator-quick-labels", "[]");
    const labels = getQuickLabels();
    expect(labels).toEqual(DEFAULT_QUICK_LABELS);
  });
});

describe("saveQuickLabels", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("stores labels as JSON", () => {
    const custom = [{ id: "test", emoji: "✅", text: "Test", color: "green" }];
    saveQuickLabels(custom);
    const stored = mockStorage.get("plannotator-quick-labels");
    expect(stored).toBe(JSON.stringify(custom));
  });

  test("overwrites previous custom labels", () => {
    saveQuickLabels([{ id: "old", emoji: "❌", text: "Old", color: "red" }]);
    saveQuickLabels([{ id: "new", emoji: "✅", text: "New", color: "green" }]);
    const labels = getQuickLabels();
    expect(labels).toEqual([{ id: "new", emoji: "✅", text: "New", color: "green" }]);
  });
});

describe("resetQuickLabels", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("removes stored labels", () => {
    saveQuickLabels([{ id: "test", emoji: "🎯", text: "Test", color: "blue" }]);
    resetQuickLabels();
    const labels = getQuickLabels();
    expect(labels).toEqual(DEFAULT_QUICK_LABELS);
  });

  test("is idempotent", () => {
    resetQuickLabels();
    resetQuickLabels();
    const labels = getQuickLabels();
    expect(labels).toEqual(DEFAULT_QUICK_LABELS);
  });
});

describe("findLabelByText", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("finds a matching default label", () => {
    const label = findLabelByText("🧪 Needs tests");
    expect(label).toBeDefined();
    expect(label!.id).toBe("needs-tests");
  });

  test("returns undefined for non-matching text", () => {
    const label = findLabelByText("nonexistent label");
    expect(label).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const label = findLabelByText("");
    expect(label).toBeUndefined();
  });

  test("matches format: emoji + space + text", () => {
    const label = findLabelByText("👍 Nice approach");
    expect(label).toBeDefined();
    expect(label!.id).toBe("nice-approach");
  });

  test("does not match without emoji", () => {
    const label = findLabelByText("Needs tests");
    expect(label).toBeUndefined();
  });

  test("finds custom labels from storage", () => {
    const custom = [{ id: "my-label", emoji: "🚀", text: "Ship it", color: "green" }];
    saveQuickLabels(custom);
    const label = findLabelByText("🚀 Ship it");
    expect(label).toBeDefined();
    expect(label!.id).toBe("my-label");
  });
});
