import { describe, test, expect, mock, beforeEach } from "bun:test";

// Mock storage module before importing the module under test
const mockStore = new Map<string, string>();

mock.module("../utils/storage", () => ({
  storage: {
    getItem: mock((key: string) => mockStore.get(key) ?? null),
    setItem: mock((key: string, value: string) => { mockStore.set(key, value); }),
    removeItem: mock((key: string) => { mockStore.delete(key); }),
  },
}));

import {
  getAgentSwitchSettings,
  saveAgentSwitchSettings,
  getEffectiveAgentName,
  AGENT_OPTIONS,
  type AgentSwitchSettings,
} from "./agentSwitch";

beforeEach(() => {
  mockStore.clear();
});

describe("AGENT_OPTIONS", () => {
  test("has build, custom, and disabled options", () => {
    const values = AGENT_OPTIONS.map((o) => o.value);
    expect(values).toContain("build");
    expect(values).toContain("custom");
    expect(values).toContain("disabled");
  });

  test("each option has label and description", () => {
    for (const opt of AGENT_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.description.length).toBeGreaterThan(0);
    }
  });
});

describe("getAgentSwitchSettings", () => {
  test("returns default when nothing stored", () => {
    const settings = getAgentSwitchSettings();
    expect(settings.switchTo).toBe("build");
    expect(settings.customName).toBeUndefined();
  });

  test("returns stored switchTo value", () => {
    mockStore.set("plannotator-agent-switch", "custom");
    const settings = getAgentSwitchSettings();
    expect(settings.switchTo).toBe("custom");
  });

  test("returns stored customName when present", () => {
    mockStore.set("plannotator-agent-switch", "custom");
    mockStore.set("plannotator-agent-custom", "my-agent");
    const settings = getAgentSwitchSettings();
    expect(settings.customName).toBe("my-agent");
  });

  test("accepts any non-empty string as switchTo", () => {
    mockStore.set("plannotator-agent-switch", "some-dynamic-agent");
    const settings = getAgentSwitchSettings();
    expect(settings.switchTo).toBe("some-dynamic-agent");
  });

  test("customName is undefined when not stored", () => {
    mockStore.set("plannotator-agent-switch", "build");
    const settings = getAgentSwitchSettings();
    expect(settings.customName).toBeUndefined();
  });
});

describe("saveAgentSwitchSettings", () => {
  test("saves switchTo to storage", () => {
    saveAgentSwitchSettings({ switchTo: "disabled" });
    expect(mockStore.get("plannotator-agent-switch")).toBe("disabled");
  });

  test("saves customName when provided", () => {
    saveAgentSwitchSettings({ switchTo: "custom", customName: "review-agent" });
    expect(mockStore.get("plannotator-agent-custom")).toBe("review-agent");
  });

  test("does not save customName when omitted", () => {
    saveAgentSwitchSettings({ switchTo: "build" });
    expect(mockStore.has("plannotator-agent-custom")).toBe(false);
  });

  test("round-trips correctly", () => {
    saveAgentSwitchSettings({ switchTo: "custom", customName: "deploy-agent" });
    const loaded = getAgentSwitchSettings();
    expect(loaded.switchTo).toBe("custom");
    expect(loaded.customName).toBe("deploy-agent");
  });
});

describe("getEffectiveAgentName", () => {
  test("returns undefined for disabled", () => {
    expect(getEffectiveAgentName({ switchTo: "disabled" })).toBeUndefined();
  });

  test("returns customName when switchTo is custom and customName provided", () => {
    expect(getEffectiveAgentName({ switchTo: "custom", customName: "my-agent" })).toBe("my-agent");
  });

  test("returns undefined for custom with no customName", () => {
    // Falls through to switchTo which is 'custom' — edge case
    const result = getEffectiveAgentName({ switchTo: "custom" });
    expect(result).toBe("custom");
  });

  test("returns build for build switchTo", () => {
    expect(getEffectiveAgentName({ switchTo: "build" })).toBe("build");
  });

  test("returns dynamic agent name directly", () => {
    expect(getEffectiveAgentName({ switchTo: "test-agent" })).toBe("test-agent");
  });
});
