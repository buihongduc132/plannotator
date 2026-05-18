import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockStore = new Map<string, string>();

mock.module("../utils/storage", () => ({
  storage: {
    getItem: mock((key: string) => mockStore.get(key) ?? null),
    setItem: mock((key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: mock((key: string) => { mockStore.delete(key); }),
  },
}));

import {
  getFileBrowserSettings,
  saveFileBrowserSettings,
  isFileBrowserEnabled,
} from "./fileBrowser";

beforeEach(() => {
  mockStore.clear();
});

describe("getFileBrowserSettings", () => {
  test("returns defaults when nothing stored", () => {
    const settings = getFileBrowserSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.directories).toEqual([]);
  });

  test("returns stored enabled state", () => {
    mockStore.set("plannotator-filebrowser-enabled", "true");
    const settings = getFileBrowserSettings();
    expect(settings.enabled).toBe(true);
  });

  test("parses stored directories JSON", () => {
    mockStore.set("plannotator-filebrowser-dirs", '["/home/user/docs","/tmp/notes"]');
    const settings = getFileBrowserSettings();
    expect(settings.directories).toEqual(["/home/user/docs", "/tmp/notes"]);
  });

  test("handles corrupt directories JSON gracefully", () => {
    mockStore.set("plannotator-filebrowser-dirs", "not-json{{{");
    const settings = getFileBrowserSettings();
    expect(settings.directories).toEqual([]);
  });

  test("returns disabled when enabled is not 'true'", () => {
    mockStore.set("plannotator-filebrowser-enabled", "false");
    expect(getFileBrowserSettings().enabled).toBe(false);
  });

  test("returns empty dirs when dirs key is empty string", () => {
    mockStore.set("plannotator-filebrowser-dirs", "");
    expect(getFileBrowserSettings().directories).toEqual([]);
  });
});

describe("saveFileBrowserSettings", () => {
  test("saves enabled state as string", () => {
    saveFileBrowserSettings({ enabled: true, directories: [] });
    expect(mockStore.get("plannotator-filebrowser-enabled")).toBe("true");
  });

  test("saves directories as JSON", () => {
    saveFileBrowserSettings({ enabled: false, directories: ["/a", "/b"] });
    expect(mockStore.get("plannotator-filebrowser-dirs")).toBe('["/a","/b"]');
  });

  test("round-trips correctly", () => {
    saveFileBrowserSettings({ enabled: true, directories: ["/home/user"] });
    const loaded = getFileBrowserSettings();
    expect(loaded.enabled).toBe(true);
    expect(loaded.directories).toEqual(["/home/user"]);
  });
});

describe("isFileBrowserEnabled", () => {
  test("returns false by default", () => {
    expect(isFileBrowserEnabled()).toBe(false);
  });

  test("returns false when enabled but no directories", () => {
    mockStore.set("plannotator-filebrowser-enabled", "true");
    expect(isFileBrowserEnabled()).toBe(false);
  });

  test("returns false when directories exist but not enabled", () => {
    mockStore.set("plannotator-filebrowser-dirs", '["/docs"]');
    expect(isFileBrowserEnabled()).toBe(false);
  });

  test("returns true when both enabled and has directories", () => {
    mockStore.set("plannotator-filebrowser-enabled", "true");
    mockStore.set("plannotator-filebrowser-dirs", '["/docs"]');
    expect(isFileBrowserEnabled()).toBe(true);
  });

  test("returns false when enabled but directories is empty array", () => {
    mockStore.set("plannotator-filebrowser-enabled", "true");
    mockStore.set("plannotator-filebrowser-dirs", "[]");
    expect(isFileBrowserEnabled()).toBe(false);
  });
});
