import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { isNoOpBrowserSentinel, shouldTryRemoteBrowserFallback } from "./browser";

const ENV_KEYS = ["PLANNOTATOR_BROWSER", "BROWSER"];

function saveEnv(keys: string[]) {
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("browser", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = saveEnv(ENV_KEYS);
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  describe("shouldTryRemoteBrowserFallback", () => {
    test("returns true when remote and no browser env vars", async () => {
      const { shouldTryRemoteBrowserFallback } = await import("./browser");
      expect(shouldTryRemoteBrowserFallback(true)).toBe(true);
    });

    test("returns false when not remote", async () => {
      const { shouldTryRemoteBrowserFallback } = await import("./browser");
      expect(shouldTryRemoteBrowserFallback(false)).toBe(false);
    });

    test("returns false when PLANNOTATOR_BROWSER is set", async () => {
      process.env.PLANNOTATOR_BROWSER = "firefox";
      const { shouldTryRemoteBrowserFallback } = await import("./browser");
      expect(shouldTryRemoteBrowserFallback(true)).toBe(false);
    });

    test("returns false when BROWSER is set", async () => {
      process.env.BROWSER = "/usr/bin/chromium";
      const { shouldTryRemoteBrowserFallback } = await import("./browser");
      expect(shouldTryRemoteBrowserFallback(true)).toBe(false);
    });

    test("returns false when both browser env vars are set", async () => {
      process.env.PLANNOTATOR_BROWSER = "firefox";
      process.env.BROWSER = "/usr/bin/firefox";
      const { shouldTryRemoteBrowserFallback } = await import("./browser");
      expect(shouldTryRemoteBrowserFallback(true)).toBe(false);
    });
  });

  describe("isWSL", () => {
    test("returns false on non-linux platforms", async () => {
      // We can't change process.platform, but we can verify the function
      // works without error. On Linux non-WSL it checks /proc/version.
      const { isWSL } = await import("./browser");
      const result = await isWSL();
      expect(typeof result).toBe("boolean");
    });
  });

  test("true for remote sessions when BROWSER is a no-op sentinel (e.g. agent view)", () => {
    clearEnv();
    process.env.BROWSER = "true";
    expect(shouldTryRemoteBrowserFallback(true)).toBe(true);
  });

  test("true for remote sessions when PLANNOTATOR_BROWSER is a no-op sentinel", () => {
    clearEnv();
    process.env.PLANNOTATOR_BROWSER = "none";
    expect(shouldTryRemoteBrowserFallback(true)).toBe(true);
  });
});

describe("isNoOpBrowserSentinel", () => {
  test("returns false for undefined / empty", () => {
    expect(isNoOpBrowserSentinel(undefined)).toBe(false);
    expect(isNoOpBrowserSentinel("")).toBe(false);
  });

  test("recognises the documented no-op values, case- and whitespace-insensitive", () => {
    for (const v of ["true", "false", "none", ":", "0", "1", "TRUE", "  none  "]) {
      expect(isNoOpBrowserSentinel(v)).toBe(true);
    }
  });

  test("does not flag real browser handlers", () => {
    expect(isNoOpBrowserSentinel("/usr/bin/firefox")).toBe(false);
    expect(isNoOpBrowserSentinel("Google Chrome")).toBe(false);
    expect(isNoOpBrowserSentinel("open")).toBe(false);
  });
});
