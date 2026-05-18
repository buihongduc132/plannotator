import { describe, expect, test } from "bun:test";
import { buildPiPlanSessionOptions } from "./plan-session";

describe("buildPiPlanSessionOptions", () => {
  test("captures Pi session identity, cwd, and optional session name", () => {
    const ctx = {
      cwd: "/repo/plannotator",
      sessionManager: {
        getSessionId: () => "pi-session-42",
        getSessionName: () => "Gemini parity plan",
      },
    } as any;

    expect(buildPiPlanSessionOptions(ctx)).toEqual({
      sessionId: "pi-session-42",
      cwd: "/repo/plannotator",
      name: "Gemini parity plan",
    });
  });

  test("omits the name when Pi session has none", () => {
    const ctx = {
      cwd: "/repo/plannotator",
      sessionManager: {
        getSessionId: () => "pi-session-42",
        getSessionName: () => undefined,
      },
    } as any;

    expect(buildPiPlanSessionOptions(ctx)).toEqual({
      sessionId: "pi-session-42",
      cwd: "/repo/plannotator",
    });
  });
});
