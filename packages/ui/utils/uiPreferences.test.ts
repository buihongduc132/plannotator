/**
 * Tests for uiPreferences.ts — UI Preferences settings
 * Run: bun test packages/ui/utils/uiPreferences.test.ts
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
  getUIPreferences,
  saveUIPreferences,
  PLAN_WIDTH_OPTIONS,
} = await import("./uiPreferences");

describe("PLAN_WIDTH_OPTIONS", () => {
  test("has three width options", () => {
    expect(PLAN_WIDTH_OPTIONS).toHaveLength(3);
  });

  test("contains compact, default, wide", () => {
    const ids = PLAN_WIDTH_OPTIONS.map(o => o.id);
    expect(ids).toEqual(["compact", "default", "wide"]);
  });

  test("each option has id, label, px, and hint", () => {
    for (const opt of PLAN_WIDTH_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(typeof opt.px).toBe("number");
      expect(opt.px).toBeGreaterThan(0);
      expect(opt.hint).toBeTruthy();
    }
  });

  test("px values are in ascending order", () => {
    const pxValues = PLAN_WIDTH_OPTIONS.map(o => o.px);
    for (let i = 1; i < pxValues.length; i++) {
      expect(pxValues[i]).toBeGreaterThan(pxValues[i - 1]);
    }
  });
});

describe("getUIPreferences", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns defaults when nothing stored", () => {
    const prefs = getUIPreferences();
    expect(prefs).toEqual({
      tocEnabled: true,
      stickyActionsEnabled: true,
      planWidth: "compact",
    });
  });

  test("reads tocEnabled=false", () => {
    mockStorage.set("plannotator-toc-enabled", "false");
    const prefs = getUIPreferences();
    expect(prefs.tocEnabled).toBe(false);
  });

  test("tocEnabled defaults to true for non-'false' values", () => {
    mockStorage.set("plannotator-toc-enabled", "random");
    const prefs = getUIPreferences();
    expect(prefs.tocEnabled).toBe(true);
  });

  test("reads stickyActionsEnabled=false", () => {
    mockStorage.set("plannotator-sticky-actions-enabled", "false");
    const prefs = getUIPreferences();
    expect(prefs.stickyActionsEnabled).toBe(false);
  });

  test("reads valid plan width", () => {
    mockStorage.set("plannotator-plan-width", "wide");
    const prefs = getUIPreferences();
    expect(prefs.planWidth).toBe("wide");
  });

  test("defaults to compact for invalid plan width", () => {
    mockStorage.set("plannotator-plan-width", "invalid");
    const prefs = getUIPreferences();
    expect(prefs.planWidth).toBe("compact");
  });

  test("defaults to compact for empty plan width", () => {
    mockStorage.set("plannotator-plan-width", "");
    const prefs = getUIPreferences();
    expect(prefs.planWidth).toBe("compact");
  });

  test("reads all preferences", () => {
    mockStorage.set("plannotator-toc-enabled", "false");
    mockStorage.set("plannotator-sticky-actions-enabled", "false");
    mockStorage.set("plannotator-plan-width", "default");
    const prefs = getUIPreferences();
    expect(prefs).toEqual({
      tocEnabled: false,
      stickyActionsEnabled: false,
      planWidth: "default",
    });
  });
});

describe("saveUIPreferences", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("persists all preferences", () => {
    saveUIPreferences({
      tocEnabled: false,
      stickyActionsEnabled: false,
      planWidth: "wide",
    });
    expect(mockStorage.get("plannotator-toc-enabled")).toBe("false");
    expect(mockStorage.get("plannotator-sticky-actions-enabled")).toBe("false");
    expect(mockStorage.get("plannotator-plan-width")).toBe("wide");
  });

  test("persists true values", () => {
    saveUIPreferences({
      tocEnabled: true,
      stickyActionsEnabled: true,
      planWidth: "compact",
    });
    expect(mockStorage.get("plannotator-toc-enabled")).toBe("true");
    expect(mockStorage.get("plannotator-sticky-actions-enabled")).toBe("true");
    expect(mockStorage.get("plannotator-plan-width")).toBe("compact");
  });

  test("roundtrip preserves values", () => {
    const original = {
      tocEnabled: true,
      stickyActionsEnabled: false,
      planWidth: "default" as const,
    };
    saveUIPreferences(original);
    const loaded = getUIPreferences();
    expect(loaded).toEqual(original);
  });
});
