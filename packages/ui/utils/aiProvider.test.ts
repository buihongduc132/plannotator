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
  getAIProviderSettings,
  saveAIProviderSettings,
  getPreferredModel,
  savePreferredModel,
} from "./aiProvider";

beforeEach(() => {
  mockStore.clear();
});

describe("getAIProviderSettings", () => {
  test("returns defaults when nothing stored", () => {
    const settings = getAIProviderSettings();
    expect(settings.providerId).toBeNull();
    expect(settings.preferredModels).toEqual({});
  });

  test("returns stored providerId", () => {
    mockStore.set("plannotator-ai-provider", "provider-1");
    const settings = getAIProviderSettings();
    expect(settings.providerId).toBe("provider-1");
  });

  test("parses stored preferred models JSON", () => {
    mockStore.set("plannotator-ai-models", '{"p1":"claude-3","p2":"gpt-4"}');
    const settings = getAIProviderSettings();
    expect(settings.preferredModels).toEqual({ p1: "claude-3", p2: "gpt-4" });
  });

  test("handles corrupt JSON gracefully", () => {
    mockStore.set("plannotator-ai-models", "not-json{{{");
    const settings = getAIProviderSettings();
    expect(settings.preferredModels).toEqual({});
  });

  test("handles empty string providerId as null", () => {
    mockStore.set("plannotator-ai-provider", "");
    const settings = getAIProviderSettings();
    expect(settings.providerId).toBeNull();
  });
});

describe("saveAIProviderSettings", () => {
  test("saves providerId when present", () => {
    saveAIProviderSettings({ providerId: "p1", preferredModels: {} });
    expect(mockStore.get("plannotator-ai-provider")).toBe("p1");
  });

  test("removes providerId when null", () => {
    mockStore.set("plannotator-ai-provider", "old");
    saveAIProviderSettings({ providerId: null, preferredModels: {} });
    expect(mockStore.has("plannotator-ai-provider")).toBe(false);
  });

  test("serializes preferredModels as JSON", () => {
    saveAIProviderSettings({ providerId: null, preferredModels: { x: "model-a" } });
    expect(mockStore.get("plannotator-ai-models")).toBe('{"x":"model-a"}');
  });

  test("round-trips correctly", () => {
    saveAIProviderSettings({ providerId: "p2", preferredModels: { p2: "sonnet" } });
    const loaded = getAIProviderSettings();
    expect(loaded.providerId).toBe("p2");
    expect(loaded.preferredModels.p2).toBe("sonnet");
  });
});

describe("getPreferredModel", () => {
  test("returns null when no models stored", () => {
    expect(getPreferredModel("p1")).toBeNull();
  });

  test("returns model for a stored provider", () => {
    mockStore.set("plannotator-ai-models", '{"p1":"claude-3-opus"}');
    expect(getPreferredModel("p1")).toBe("claude-3-opus");
  });

  test("returns null for unregistered provider", () => {
    mockStore.set("plannotator-ai-models", '{"p1":"claude-3"}');
    expect(getPreferredModel("p2")).toBeNull();
  });
});

describe("savePreferredModel", () => {
  test("saves model without losing other preferences", () => {
    mockStore.set("plannotator-ai-models", '{"p1":"claude-3"}');
    savePreferredModel("p2", "gpt-4");
    const settings = getAIProviderSettings();
    expect(settings.preferredModels.p1).toBe("claude-3");
    expect(settings.preferredModels.p2).toBe("gpt-4");
  });

  test("overwrites existing model for same provider", () => {
    mockStore.set("plannotator-ai-models", '{"p1":"claude-3"}');
    savePreferredModel("p1", "claude-3-opus");
    expect(getPreferredModel("p1")).toBe("claude-3-opus");
  });
});
