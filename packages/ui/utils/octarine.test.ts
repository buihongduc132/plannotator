/**
 * Tests for octarine.ts — Octarine Notes Integration
 * Run: bun test packages/ui/utils/octarine.test.ts
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

const { getOctarineSettings, saveOctarineSettings, isOctarineConfigured } = await import("./octarine");

describe("getOctarineSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns defaults when nothing stored", () => {
    const settings = getOctarineSettings();
    expect(settings).toEqual({
      enabled: false,
      workspace: "",
      folder: "plannotator",
      autoSave: false,
    });
  });

  test("reads enabled=true from storage", () => {
    mockStorage.set("plannotator-octarine-enabled", "true");
    const settings = getOctarineSettings();
    expect(settings.enabled).toBe(true);
  });

  test("reads workspace from storage", () => {
    mockStorage.set("plannotator-octarine-workspace", "my-workspace");
    const settings = getOctarineSettings();
    expect(settings.workspace).toBe("my-workspace");
  });

  test("reads custom folder from storage", () => {
    mockStorage.set("plannotator-octarine-folder", "custom-folder");
    const settings = getOctarineSettings();
    expect(settings.folder).toBe("custom-folder");
  });

  test("reads autoSave from storage", () => {
    mockStorage.set("plannotator-octarine-autosave", "true");
    const settings = getOctarineSettings();
    expect(settings.autoSave).toBe(true);
  });

  test("reads full settings from storage", () => {
    mockStorage.set("plannotator-octarine-enabled", "true");
    mockStorage.set("plannotator-octarine-workspace", "ws");
    mockStorage.set("plannotator-octarine-folder", "notes");
    mockStorage.set("plannotator-octarine-autosave", "true");
    const settings = getOctarineSettings();
    expect(settings).toEqual({
      enabled: true,
      workspace: "ws",
      folder: "notes",
      autoSave: true,
    });
  });

  test("null workspace defaults to empty string", () => {
    mockStorage.set("plannotator-octarine-workspace", "something");
    mockStorage.delete("plannotator-octarine-workspace");
    const settings = getOctarineSettings();
    expect(settings.workspace).toBe("");
  });
});

describe("saveOctarineSettings", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("persists all settings", () => {
    saveOctarineSettings({
      enabled: true,
      workspace: "my-ws",
      folder: "plans",
      autoSave: true,
    });
    expect(mockStorage.get("plannotator-octarine-enabled")).toBe("true");
    expect(mockStorage.get("plannotator-octarine-workspace")).toBe("my-ws");
    expect(mockStorage.get("plannotator-octarine-folder")).toBe("plans");
    expect(mockStorage.get("plannotator-octarine-autosave")).toBe("true");
  });

  test("persists disabled state", () => {
    saveOctarineSettings({
      enabled: false,
      workspace: "",
      folder: "plannotator",
      autoSave: false,
    });
    expect(mockStorage.get("plannotator-octarine-enabled")).toBe("false");
    expect(mockStorage.get("plannotator-octarine-autosave")).toBe("false");
  });
});

describe("isOctarineConfigured", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test("returns false when not enabled", () => {
    mockStorage.set("plannotator-octarine-enabled", "false");
    mockStorage.set("plannotator-octarine-workspace", "my-ws");
    expect(isOctarineConfigured()).toBe(false);
  });

  test("returns false when enabled but no workspace", () => {
    mockStorage.set("plannotator-octarine-enabled", "true");
    mockStorage.set("plannotator-octarine-workspace", "");
    expect(isOctarineConfigured()).toBe(false);
  });

  test("returns false when enabled but workspace is whitespace only", () => {
    mockStorage.set("plannotator-octarine-enabled", "true");
    mockStorage.set("plannotator-octarine-workspace", "   ");
    expect(isOctarineConfigured()).toBe(false);
  });

  test("returns true when enabled and workspace is set", () => {
    mockStorage.set("plannotator-octarine-enabled", "true");
    mockStorage.set("plannotator-octarine-workspace", "my-workspace");
    expect(isOctarineConfigured()).toBe(true);
  });

  test("returns false when nothing configured", () => {
    expect(isOctarineConfigured()).toBe(false);
  });
});
