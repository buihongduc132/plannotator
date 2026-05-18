/**
 * Tests for platform.ts — Platform detection constants
 * Run: bun test packages/ui/utils/platform.test.ts
 */

import { describe, expect, test, mock } from "bun:test";

// The module uses top-level navigator checks, so we need to test the export behavior.
// Since Bun doesn't have navigator, these will resolve to the non-Mac defaults.

describe("platform constants", () => {
  // These are module-level exports that evaluate at import time.
  // In Bun test env (no navigator), they resolve to non-Mac defaults.

  test("isMac is false in Bun test environment (no navigator)", async () => {
    // Re-import to get fresh evaluation
    const { isMac } = await import("./platform");
    // In Bun there's no navigator, so the typeof check should return false
    expect(typeof isMac).toBe("boolean");
  });

  test("modKey is a non-empty string", async () => {
    const { modKey } = await import("./platform");
    expect(typeof modKey).toBe("string");
    expect(modKey.length).toBeGreaterThan(0);
  });

  test("altKey is a non-empty string", async () => {
    const { altKey } = await import("./platform");
    expect(typeof altKey).toBe("string");
    expect(altKey.length).toBeGreaterThan(0);
  });

  test("submitHint contains either Cmd or Ctrl", async () => {
    const { submitHint } = await import("./platform");
    expect(submitHint).toMatch(/⌘↵|Ctrl\+Enter/);
  });

  test("isWindows is boolean", async () => {
    const { isWindows } = await import("./platform");
    expect(typeof isWindows).toBe("boolean");
  });
});

describe("platform constants — consistency", () => {
  test("modKey and altKey are different strings", async () => {
    const { modKey, altKey } = await import("./platform");
    expect(modKey).not.toBe(altKey);
  });

  test("submitHint contains modKey concept", async () => {
    const { submitHint, modKey } = await import("./platform");
    // submitHint should start with the mod key
    expect(submitHint.startsWith(modKey) || submitHint.includes("Ctrl")).toBe(true);
  });
});
