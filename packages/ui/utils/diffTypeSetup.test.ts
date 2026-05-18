import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockStore = new Map<string, string>();

mock.module("../utils/storage", () => ({
  storage: {
    getItem: mock((key: string) => mockStore.get(key) ?? null),
    setItem: mock((key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: mock((key: string) => { mockStore.delete(key); }),
  },
}));

import { needsDiffTypeSetup, markDiffTypeSetupDone } from "./diffTypeSetup";

beforeEach(() => {
  mockStore.clear();
});

describe("needsDiffTypeSetup", () => {
  test("returns true when nothing stored", () => {
    expect(needsDiffTypeSetup()).toBe(true);
  });

  test("returns true when value is not 'true'", () => {
    mockStore.set("plannotator-diff-type-setup-done", "false");
    expect(needsDiffTypeSetup()).toBe(true);
  });

  test("returns false when marked done", () => {
    mockStore.set("plannotator-diff-type-setup-done", "true");
    expect(needsDiffTypeSetup()).toBe(false);
  });
});

describe("markDiffTypeSetupDone", () => {
  test("stores 'true' in storage", () => {
    markDiffTypeSetupDone();
    expect(mockStore.get("plannotator-diff-type-setup-done")).toBe("true");
  });

  test("makes needsDiffTypeSetup return false", () => {
    markDiffTypeSetupDone();
    expect(needsDiffTypeSetup()).toBe(false);
  });

  test("idempotent — calling twice is safe", () => {
    markDiffTypeSetupDone();
    markDiffTypeSetupDone();
    expect(needsDiffTypeSetup()).toBe(false);
  });
});
