/**
 * Tests for themeRegistry.ts — Built-in theme definitions
 * Run: bun test packages/ui/utils/themeRegistry.test.ts
 */

import { describe, expect, test } from "bun:test";
import { BUILT_IN_THEMES, type ThemeInfo, type ThemeColors } from "./themeRegistry";

describe("BUILT_IN_THEMES", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(BUILT_IN_THEMES)).toBe(true);
    expect(BUILT_IN_THEMES.length).toBeGreaterThan(10);
  });

  test("each theme has required fields", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.builtIn).toBe(true);
      expect(["both", "dark-only", "light-only"]).toContain(theme.modeSupport);
      expect(theme.colors).toHaveProperty("dark");
      expect(theme.colors).toHaveProperty("light");
    }
  });

  test("each theme has complete color sets", () => {
    const requiredKeys: (keyof ThemeColors)[] = ["primary", "secondary", "accent", "background", "foreground"];
    for (const theme of BUILT_IN_THEMES) {
      for (const mode of ["dark", "light"] as const) {
        for (const key of requiredKeys) {
          expect(theme.colors[mode]).toHaveProperty(key);
          expect(typeof theme.colors[mode][key]).toBe("string");
          expect(theme.colors[mode][key].length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("all theme IDs are unique", () => {
    const ids = BUILT_IN_THEMES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("contains specific known themes", () => {
    const ids = BUILT_IN_THEMES.map(t => t.id);
    expect(ids).toContain("plannotator");
    expect(ids).toContain("catppuccin");
    expect(ids).toContain("dracula");
    expect(ids).toContain("tokyo-night");
    expect(ids).toContain("rose-pine");
    expect(ids).toContain("gruvbox");
  });

  test("modeSupport is valid for all themes", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(["both", "dark-only", "light-only"]).toContain(theme.modeSupport);
    }
  });

  test("has dark-only themes", () => {
    const darkOnly = BUILT_IN_THEMES.filter(t => t.modeSupport === "dark-only");
    expect(darkOnly.length).toBeGreaterThan(0);
    expect(darkOnly.some(t => t.id === "dracula")).toBe(true);
  });

  test("has light-only themes", () => {
    const lightOnly = BUILT_IN_THEMES.filter(t => t.modeSupport === "light-only");
    expect(lightOnly.length).toBeGreaterThan(0);
  });

  test("has both-mode themes", () => {
    const both = BUILT_IN_THEMES.filter(t => t.modeSupport === "both");
    expect(both.length).toBeGreaterThan(0);
    expect(both.some(t => t.id === "plannotator")).toBe(true);
  });

  test("all builtIn flags are true", () => {
    for (const theme of BUILT_IN_THEMES) {
      expect(theme.builtIn).toBe(true);
    }
  });

  test("color values use valid CSS formats", () => {
    const validPatterns = [
      /^#[0-9a-fA-F]{3,8}$/,        // hex
      /^rgb\([^)]+\)$/,              // rgb()
      /^oklch\([^)]+\)$/,            // oklch()
    ];
    for (const theme of BUILT_IN_THEMES) {
      for (const mode of ["dark", "light"] as const) {
        for (const [, value] of Object.entries(theme.colors[mode])) {
          const isValid = validPatterns.some(p => p.test(value));
          expect(isValid).toBe(true);
        }
      }
    }
  });

  test("dark-only themes have identical dark and light color objects", () => {
    const darkOnly = BUILT_IN_THEMES.filter(t => t.modeSupport === "dark-only");
    for (const theme of darkOnly) {
      expect(theme.colors.dark).toEqual(theme.colors.light);
    }
  });

  test("light-only themes exist in the registry", () => {
    const lightOnly = BUILT_IN_THEMES.filter(t => t.modeSupport === "light-only");
    expect(lightOnly.length).toBeGreaterThan(0);
    // Light-only themes may have separate dark colors (used as fallback)
  });

  test("both-mode themes have different dark and light colors", () => {
    const both = BUILT_IN_THEMES.filter(t => t.modeSupport === "both");
    for (const theme of both) {
      expect(theme.colors.dark).not.toEqual(theme.colors.light);
    }
  });

  test("default 'plannotator' theme is first", () => {
    expect(BUILT_IN_THEMES[0].id).toBe("plannotator");
  });

  test("each theme name is human-readable", () => {
    for (const theme of BUILT_IN_THEMES) {
      // Name should have at least 2 characters
      expect(theme.name.length).toBeGreaterThanOrEqual(2);
      // Name should not be the same as id (except maybe plannotator)
      if (theme.id !== "plannotator") {
        expect(theme.name).not.toBe(theme.id);
      }
    }
  });
});
