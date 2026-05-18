/**
 * Tests for favicon SVG constant.
 * Run: bun test packages/shared/favicon.test.ts
 */

import { describe, expect, test } from "bun:test";
import { FAVICON_SVG } from "./favicon";

describe("FAVICON_SVG", () => {
  test("is a non-empty string", () => {
    expect(FAVICON_SVG).toBeTruthy();
    expect(typeof FAVICON_SVG).toBe("string");
    expect(FAVICON_SVG.length).toBeGreaterThan(0);
  });

  test("is valid SVG markup", () => {
    expect(FAVICON_SVG).toMatch(/^<svg/);
    expect(FAVICON_SVG).toMatch(/<\/svg>$/);
  });

  test("contains SVG namespace", () => {
    expect(FAVICON_SVG).toContain("xmlns=");
  });

  test("contains viewBox", () => {
    expect(FAVICON_SVG).toContain("viewBox");
  });

  test("contains the P letter", () => {
    expect(FAVICON_SVG).toContain(">P<");
  });

  test("contains background rect", () => {
    expect(FAVICON_SVG).toContain("<rect");
  });

  test("has rounded corners (rx)", () => {
    expect(FAVICON_SVG).toMatch(/rx=/);
  });

  test("contains fill attributes", () => {
    expect(FAVICON_SVG).toMatch(/fill=/);
  });

  test("has dark background color", () => {
    expect(FAVICON_SVG).toContain("#070b14");
  });
});
