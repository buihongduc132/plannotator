import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockStore = new Map<string, string>();

mock.module("../utils/storage", () => ({
  storage: {
    getItem: mock((key: string) => mockStore.get(key) ?? null),
    setItem: mock((key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: mock((key: string) => { mockStore.delete(key); }),
  },
}));

import { needsAISetup, markAISetupDone } from "./aiSetup";

beforeEach(() => {
  mockStore.clear();
});

describe("needsAISetup", () => {
  test("returns true when nothing stored", () => {
    expect(needsAISetup()).toBe(true);
  });

  test("returns true when value is not 'true'", () => {
    mockStore.set("plannotator-ai-setup-done", "false");
    expect(needsAISetup()).toBe(true);
  });

  test("returns false when marked done", () => {
    mockStore.set("plannotator-ai-setup-done", "true");
    expect(needsAISetup()).toBe(false);
  });
});

describe("markAISetupDone", () => {
  test("stores 'true' in storage", () => {
    markAISetupDone();
    expect(mockStore.get("plannotator-ai-setup-done")).toBe("true");
  });

  test("makes needsAISetup return false", () => {
    markAISetupDone();
    expect(needsAISetup()).toBe(false);
  });

  test("idempotent — calling twice is safe", () => {
    markAISetupDone();
    markAISetupDone();
    expect(needsAISetup()).toBe(false);
  });
});
