import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockStore = new Map<string, string>();

mock.module("../utils/storage", () => ({
  storage: {
    getItem: mock((key: string) => mockStore.get(key) ?? null),
    setItem: mock((key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: mock((key: string) => { mockStore.delete(key); }),
  },
}));

import { getDefaultNotesApp, saveDefaultNotesApp } from "./defaultNotesApp";

beforeEach(() => {
  mockStore.clear();
});

describe("getDefaultNotesApp", () => {
  test("returns 'ask' as default when nothing stored", () => {
    expect(getDefaultNotesApp()).toBe("ask");
  });

  test("returns stored value", () => {
    mockStore.set("plannotator-default-notes-app", "obsidian");
    expect(getDefaultNotesApp()).toBe("obsidian");
  });

  test("returns each valid option", () => {
    for (const app of ["obsidian", "bear", "octarine", "download", "ask"] as const) {
      mockStore.set("plannotator-default-notes-app", app);
      expect(getDefaultNotesApp()).toBe(app);
    }
  });
});

describe("saveDefaultNotesApp", () => {
  test("saves value to storage", () => {
    saveDefaultNotesApp("bear");
    expect(mockStore.get("plannotator-default-notes-app")).toBe("bear");
  });

  test("overwrites previous value", () => {
    saveDefaultNotesApp("obsidian");
    saveDefaultNotesApp("download");
    expect(mockStore.get("plannotator-default-notes-app")).toBe("download");
  });

  test("round-trips correctly", () => {
    saveDefaultNotesApp("octarine");
    expect(getDefaultNotesApp()).toBe("octarine");
  });
});
