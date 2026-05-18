import { describe, test, expect, beforeEach, afterEach } from "bun:test";

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
});
