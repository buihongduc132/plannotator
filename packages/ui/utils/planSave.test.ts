/**
 * Tests for planSave.ts — Plan Save Settings Utility
 * Run: bun test packages/ui/utils/planSave.test.ts
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

const { getPlanSaveSettings, savePlanSaveSettings } = await import("./planSave");

describe("getPlanSaveSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns defaults when nothing stored", () => {
    const settings = getPlanSaveSettings();
    expect(settings).toEqual({
      enabled: true,
      customPath: null,
    });
  });

  test("returns enabled=true when stored as 'true'", () => {
    mockStorage.set("plannotator-save-enabled", "true");
    const settings = getPlanSaveSettings();
    expect(settings.enabled).toBe(true);
  });

  test("returns enabled=false when explicitly set to 'false'", () => {
    mockStorage.set("plannotator-save-enabled", "false");
    const settings = getPlanSaveSettings();
    expect(settings.enabled).toBe(false);
  });

  test("returns custom path when set", () => {
    mockStorage.set("plannotator-save-path", "/custom/path");
    const settings = getPlanSaveSettings();
    expect(settings.customPath).toBe("/custom/path");
  });

  test("returns null customPath when empty string", () => {
    mockStorage.set("plannotator-save-path", "");
    const settings = getPlanSaveSettings();
    expect(settings.customPath).toBeNull();
  });

  test("returns null customPath when nothing stored", () => {
    const settings = getPlanSaveSettings();
    expect(settings.customPath).toBeNull();
  });

  test("enabled defaults to true for any non-'false' value", () => {
    mockStorage.set("plannotator-save-enabled", "random");
    const settings = getPlanSaveSettings();
    expect(settings.enabled).toBe(true);
  });

  test("returns full custom settings", () => {
    mockStorage.set("plannotator-save-enabled", "true");
    mockStorage.set("plannotator-save-path", "/home/user/plans");
    const settings = getPlanSaveSettings();
    expect(settings).toEqual({
      enabled: true,
      customPath: "/home/user/plans",
    });
  });
});

describe("savePlanSaveSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("saves enabled state as string", () => {
    savePlanSaveSettings({ enabled: true, customPath: null });
    expect(mockStorage.get("plannotator-save-enabled")).toBe("true");
  });

  test("saves disabled state", () => {
    savePlanSaveSettings({ enabled: false, customPath: null });
    expect(mockStorage.get("plannotator-save-enabled")).toBe("false");
  });

  test("saves custom path when provided", () => {
    savePlanSaveSettings({ enabled: true, customPath: "/my/path" });
    expect(mockStorage.get("plannotator-save-path")).toBe("/my/path");
  });

  test("removes custom path when null", () => {
    mockStorage.set("plannotator-save-path", "/old/path");
    savePlanSaveSettings({ enabled: true, customPath: null });
    expect(mockStorage.has("plannotator-save-path")).toBe(false);
  });

  test("roundtrip: save then read preserves values", () => {
    savePlanSaveSettings({ enabled: false, customPath: "/test/path" });
    const settings = getPlanSaveSettings();
    expect(settings).toEqual({
      enabled: false,
      customPath: "/test/path",
    });
  });

  test("roundtrip: save with null path then read", () => {
    savePlanSaveSettings({ enabled: true, customPath: null });
    const settings = getPlanSaveSettings();
    expect(settings).toEqual({
      enabled: true,
      customPath: null,
    });
  });
});
