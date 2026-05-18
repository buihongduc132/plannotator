import { describe, test, expect } from "bun:test";
import {
  getAgentName,
  getAgentBadge,
  AGENT_CONFIG,
  type Origin,
} from "./agents";

describe("getAgentName", () => {
  test("returns correct name for claude-code", () => {
    expect(getAgentName("claude-code")).toBe("Claude Code");
  });

  test("returns correct name for opencode", () => {
    expect(getAgentName("opencode")).toBe("OpenCode");
  });

  test("returns correct name for copilot-cli", () => {
    expect(getAgentName("copilot-cli")).toBe("GitHub Copilot");
  });

  test("returns correct name for pi", () => {
    expect(getAgentName("pi")).toBe("Pi");
  });

  test("returns correct name for codex", () => {
    expect(getAgentName("codex")).toBe("Codex");
  });

  test("returns correct name for gemini-cli", () => {
    expect(getAgentName("gemini-cli")).toBe("Gemini CLI");
  });

  test("returns default for null", () => {
    expect(getAgentName(null)).toBe("Coding Agent");
  });

  test("returns default for undefined", () => {
    expect(getAgentName(undefined)).toBe("Coding Agent");
  });

  test("returns default for unknown origin", () => {
    expect(getAgentName("unknown-agent" as Origin)).toBe("Coding Agent");
  });
});

describe("getAgentBadge", () => {
  test("returns badge classes for claude-code", () => {
    expect(getAgentBadge("claude-code")).toContain("bg-orange-");
  });

  test("returns badge classes for opencode", () => {
    expect(getAgentBadge("opencode")).toContain("bg-emerald-");
  });

  test("returns default badge for null", () => {
    expect(getAgentBadge(null)).toContain("bg-zinc-");
  });

  test("returns default badge for undefined", () => {
    expect(getAgentBadge(undefined)).toContain("bg-zinc-");
  });

  test("returns default badge for unknown origin", () => {
    expect(getAgentBadge("unknown" as Origin)).toContain("bg-zinc-");
  });

  test("all badges contain text color class", () => {
    for (const key of Object.keys(AGENT_CONFIG)) {
      const badge = getAgentBadge(key as Origin);
      expect(badge).toMatch(/text-\w+-\d+/);
    }
  });
});

describe("AGENT_CONFIG", () => {
  test("has all expected origins", () => {
    const keys = Object.keys(AGENT_CONFIG);
    expect(keys).toContain("claude-code");
    expect(keys).toContain("opencode");
    expect(keys).toContain("copilot-cli");
    expect(keys).toContain("pi");
    expect(keys).toContain("codex");
    expect(keys).toContain("gemini-cli");
  });

  test("each entry has name and badge", () => {
    for (const [key, config] of Object.entries(AGENT_CONFIG)) {
      expect(config.name).toBeTruthy();
      expect(config.badge).toBeTruthy();
      expect(typeof config.name).toBe("string");
      expect(typeof config.badge).toBe("string");
    }
  });
});
