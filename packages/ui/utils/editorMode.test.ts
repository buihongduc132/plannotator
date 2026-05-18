import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockStore = new Map<string, string>();

mock.module("../utils/storage", () => ({
  storage: {
    getItem: mock((key: string) => mockStore.get(key) ?? null),
    setItem: mock((key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: mock((key: string) => { mockStore.delete(key); }),
  },
}));

import { getEditorMode, saveEditorMode } from "./editorMode";

beforeEach(() => {
  mockStore.clear();
});

describe("getEditorMode", () => {
  test("returns 'selection' as default when nothing stored", () => {
    expect(getEditorMode()).toBe("selection");
  });

  test("returns stored 'comment' mode", () => {
    mockStore.set("plannotator-editor-mode", "comment");
    expect(getEditorMode()).toBe("comment");
  });

  test("returns stored 'redline' mode", () => {
    mockStore.set("plannotator-editor-mode", "redline");
    expect(getEditorMode()).toBe("redline");
  });

  test("returns stored 'quickLabel' mode", () => {
    mockStore.set("plannotator-editor-mode", "quickLabel");
    expect(getEditorMode()).toBe("quickLabel");
  });

  test("returns default for unrecognized value", () => {
    mockStore.set("plannotator-editor-mode", "invalid-mode");
    expect(getEditorMode()).toBe("selection");
  });

  test("returns default for empty string", () => {
    mockStore.set("plannotator-editor-mode", "");
    expect(getEditorMode()).toBe("selection");
  });
});

describe("saveEditorMode", () => {
  test("saves 'selection' mode", () => {
    saveEditorMode("selection");
    expect(mockStore.get("plannotator-editor-mode")).toBe("selection");
  });

  test("saves 'comment' mode", () => {
    saveEditorMode("comment");
    expect(mockStore.get("plannotator-editor-mode")).toBe("comment");
  });

  test("saves 'redline' mode", () => {
    saveEditorMode("redline");
    expect(mockStore.get("plannotator-editor-mode")).toBe("redline");
  });

  test("saves 'quickLabel' mode", () => {
    saveEditorMode("quickLabel");
    expect(mockStore.get("plannotator-editor-mode")).toBe("quickLabel");
  });

  test("round-trips correctly", () => {
    saveEditorMode("comment");
    expect(getEditorMode()).toBe("comment");
  });

  test("overwrites previous value", () => {
    saveEditorMode("selection");
    saveEditorMode("redline");
    expect(getEditorMode()).toBe("redline");
  });
});
