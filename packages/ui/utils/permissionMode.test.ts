/**
 * Tests for permissionMode.ts — Permission Mode Settings
 * Run: bun test packages/ui/utils/permissionMode.test.ts
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
  getPermissionModeSettings,
  savePermissionModeSettings,
  needsPermissionModeSetup,
  PERMISSION_MODE_OPTIONS,
} = await import("./permissionMode");

describe("PERMISSION_MODE_OPTIONS", () => {
  test("has three options", () => {
    expect(PERMISSION_MODE_OPTIONS).toHaveLength(3);
  });

  test("contains acceptEdits, bypassPermissions, default", () => {
    const values = PERMISSION_MODE_OPTIONS.map(o => o.value);
    expect(values).toContain("acceptEdits");
    expect(values).toContain("bypassPermissions");
    expect(values).toContain("default");
  });

  test("each option has value, label, and description", () => {
    for (const opt of PERMISSION_MODE_OPTIONS) {
      expect(opt.value).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.description).toBeTruthy();
    }
  });
});

describe("getPermissionModeSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns defaults when nothing stored", () => {
    const settings = getPermissionModeSettings();
    expect(settings.mode).toBe("acceptEdits");
    expect(settings.configured).toBe(false);
  });

  test("returns stored mode", () => {
    mockStorage.set("plannotator-permission-mode", "bypassPermissions");
    const settings = getPermissionModeSettings();
    expect(settings.mode).toBe("bypassPermissions");
  });

  test("returns stored configured state", () => {
    mockStorage.set("plannotator-permission-mode-configured", "true");
    const settings = getPermissionModeSettings();
    expect(settings.configured).toBe(true);
  });

  test("defaults to acceptEdits for unknown mode", () => {
    mockStorage.set("plannotator-permission-mode", "unknown-mode");
    const settings = getPermissionModeSettings();
    expect(settings.mode).toBe("unknown-mode"); // passes through whatever is stored
  });

  test("returns acceptEdits when mode is not stored but configured is true", () => {
    mockStorage.set("plannotator-permission-mode-configured", "true");
    const settings = getPermissionModeSettings();
    expect(settings.mode).toBe("acceptEdits");
    expect(settings.configured).toBe(true);
  });
});

describe("savePermissionModeSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("saves mode and marks as configured", () => {
    savePermissionModeSettings("bypassPermissions");
    expect(mockStorage.get("plannotator-permission-mode")).toBe("bypassPermissions");
    expect(mockStorage.get("plannotator-permission-mode-configured")).toBe("true");
  });

  test("saves default mode", () => {
    savePermissionModeSettings("default");
    expect(mockStorage.get("plannotator-permission-mode")).toBe("default");
    expect(mockStorage.get("plannotator-permission-mode-configured")).toBe("true");
  });

  test("saves acceptEdits mode", () => {
    savePermissionModeSettings("acceptEdits");
    expect(mockStorage.get("plannotator-permission-mode")).toBe("acceptEdits");
  });
});

describe("needsPermissionModeSetup", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns true when not configured", () => {
    expect(needsPermissionModeSetup()).toBe(true);
  });

  test("returns false after saving", () => {
    savePermissionModeSettings("acceptEdits");
    expect(needsPermissionModeSetup()).toBe(false);
  });

  test("returns false when configured flag is set", () => {
    mockStorage.set("plannotator-permission-mode-configured", "true");
    expect(needsPermissionModeSetup()).toBe(false);
  });

  test("returns true when configured flag is not 'true'", () => {
    mockStorage.set("plannotator-permission-mode-configured", "false");
    expect(needsPermissionModeSetup()).toBe(true);
  });
});
