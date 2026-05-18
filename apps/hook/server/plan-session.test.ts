import { describe, expect, test } from "bun:test";
import { buildHookPlanSessionOptions } from "./plan-session";

describe("buildHookPlanSessionOptions", () => {
  test("preserves Gemini session identity and derives a name from the plan filename", () => {
    expect(
      buildHookPlanSessionOptions({
        detectedOrigin: "claude-code",
        isGemini: true,
        eventSessionId: "gemini-session-123",
        cwd: "/workspace/plannotator",
        planFilename: "feature-plan.md",
      }),
    ).toEqual({
      origin: "gemini-cli",
      sessionId: "gemini-session-123",
      cwd: "/workspace/plannotator",
      name: "feature-plan",
    });
  });

  test("preserves non-Gemini origin and omits optional fields when absent", () => {
    expect(
      buildHookPlanSessionOptions({
        detectedOrigin: "claude-code",
        isGemini: false,
      }),
    ).toEqual({
      origin: "claude-code",
    });
  });
});
