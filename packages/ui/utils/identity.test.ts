/**
 * Tests for identity.ts — Tater Identity System
 * Run: bun test packages/ui/utils/identity.test.ts
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";

// Mock configStore before importing identity module
const mockConfigStore = {
  _values: {} as Record<string, string>,
  get(key: string): string {
    return mockConfigStore._values[key] ?? "default-tater";
  },
  set(key: string, value: string): void {
    mockConfigStore._values[key] = value;
  },
  reset(): void {
    mockConfigStore._values = {};
  },
};

// Mock the config module
mock.module("../config", () => ({
  configStore: mockConfigStore,
}));

// Mock generateIdentity to return deterministic values
let mockIdentityCounter = 0;
mock.module("./generateIdentity", () => ({
  generateIdentity: () => `mock-tater-${++mockIdentityCounter}`,
}));

const { getIdentity, setCustomIdentity, regenerateIdentity, isCurrentUser } = await import("./identity");

describe("getIdentity", () => {
  beforeEach(() => {
    mockConfigStore.reset();
  });

  test("returns displayName from configStore", () => {
    mockConfigStore._values["displayName"] = "swift-falcon-tater";
    expect(getIdentity()).toBe("swift-falcon-tater");
  });

  test("returns default when no identity set", () => {
    expect(getIdentity()).toBe("default-tater");
  });
});

describe("setCustomIdentity", () => {
  beforeEach(() => {
    mockConfigStore.reset();
  });

  test("sets a custom display name", () => {
    const result = setCustomIdentity("  my-custom-name  ");
    expect(result).toBe("my-custom-name");
    expect(mockConfigStore._values["displayName"]).toBe("my-custom-name");
  });

  test("rejects empty string", () => {
    mockConfigStore._values["displayName"] = "original-tater";
    const result = setCustomIdentity("");
    expect(result).toBe("original-tater");
    expect(mockConfigStore._values["displayName"]).toBe("original-tater");
  });

  test("rejects whitespace-only string", () => {
    mockConfigStore._values["displayName"] = "original-tater";
    const result = setCustomIdentity("   \t  ");
    expect(result).toBe("original-tater");
  });

  test("accepts single character name", () => {
    const result = setCustomIdentity("x");
    expect(result).toBe("x");
  });

  test("accepts name with special characters", () => {
    const result = setCustomIdentity("tater_🥔");
    expect(result).toBe("tater_🥔");
  });
});

describe("regenerateIdentity", () => {
  beforeEach(() => {
    mockConfigStore.reset();
    mockIdentityCounter = 0;
  });

  test("generates and stores a new identity", () => {
    const result = regenerateIdentity();
    expect(result).toBe("mock-tater-1");
    expect(mockConfigStore._values["displayName"]).toBe("mock-tater-1");
  });

  test("each call generates a different identity", () => {
    const first = regenerateIdentity();
    const second = regenerateIdentity();
    expect(first).not.toBe(second);
  });
});

describe("isCurrentUser", () => {
  beforeEach(() => {
    mockConfigStore.reset();
  });

  test("returns true when author matches current identity", () => {
    mockConfigStore._values["displayName"] = "swift-falcon-tater";
    expect(isCurrentUser("swift-falcon-tater")).toBe(true);
  });

  test("returns false when author does not match", () => {
    mockConfigStore._values["displayName"] = "swift-falcon-tater";
    expect(isCurrentUser("other-tater")).toBe(false);
  });

  test("returns false for undefined author", () => {
    expect(isCurrentUser(undefined)).toBe(false);
  });

  test("returns false for empty string author", () => {
    mockConfigStore._values["displayName"] = "swift-falcon-tater";
    expect(isCurrentUser("")).toBe(false);
  });

  test("returns false when no identity is configured", () => {
    expect(isCurrentUser("any-name")).toBe(false);
  });
});
