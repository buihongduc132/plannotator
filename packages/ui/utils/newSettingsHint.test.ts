/**
 * Tests for newSettingsHint.ts
 * Run: bun test packages/ui/utils/newSettingsHint.test.ts
 */

import { describe, expect, test, beforeEach } from "bun:test";

// Mock storage module
const mockStorage = new Map<string, string>();
const mockStorageObj = {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { mockStorage.set(key, value); },
  removeItem: (key: string) => { mockStorage.delete(key); },
};

// We can't easily mock the storage import, so we'll test the logic directly
// by importing and examining behavior through the exported functions.

// Since storage is a real cookie-based module that won't work in Bun test env,
// we need to mock it. Let's use mock.module.
import { mock } from "bun:test";

mock.module("./storage", () => ({
  storage: mockStorageObj,
  getAutoCloseDelay: () => "off",
  setAutoCloseDelay: () => {},
  AUTO_CLOSE_OPTIONS: [],
}));

const { hasNewSettings, markNewSettingsSeen } = await import("./newSettingsHint");

describe("newSettingsHint", () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  describe("hasNewSettings", () => {
    test("returns true when no version stored (first visit)", () => {
      expect(hasNewSettings()).toBe(true);
    });

    test("returns true when stored version differs from current", () => {
      mockStorage.set("plannotator-new-settings-seen", "0.11.0");
      expect(hasNewSettings()).toBe(true);
    });

    test("returns false when stored version matches current", () => {
      markNewSettingsSeen();
      expect(hasNewSettings()).toBe(false);
    });
  });

  describe("markNewSettingsSeen", () => {
    test("stores the current hint version", () => {
      markNewSettingsSeen();
      expect(mockStorage.get("plannotator-new-settings-seen")).toBe("0.12.0");
    });

    test("calling twice is idempotent", () => {
      markNewSettingsSeen();
      markNewSettingsSeen();
      expect(mockStorage.get("plannotator-new-settings-seen")).toBe("0.12.0");
    });
  });

  describe("full lifecycle", () => {
    test("new user sees hint, dismisses, no longer sees it", () => {
      // Initially sees new settings
      expect(hasNewSettings()).toBe(true);

      // Marks as seen
      markNewSettingsSeen();

      // No longer sees it
      expect(hasNewSettings()).toBe(false);
    });
  });
});
