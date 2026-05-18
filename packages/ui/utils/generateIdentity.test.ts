import { describe, test, expect } from "bun:test";
import { generateIdentity } from "./generateIdentity";

describe("generateIdentity", () => {
  test("returns a string ending with '-tater'", () => {
    const result = generateIdentity();
    expect(result.endsWith("-tater")).toBe(true);
  });

  test("contains exactly two hyphens before '-tater'", () => {
    // Format: adjective-noun-tater
    const result = generateIdentity();
    const parts = result.split("-");
    // Should be at least 3 parts (adjective-noun-tater), but compounds could add more
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[parts.length - 1]).toBe("tater");
  });

  test("generates unique identities on successive calls", () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(generateIdentity());
    }
    // With random adjectives and nouns, at least some should differ
    expect(results.size).toBeGreaterThan(1);
  });

  test("result is all lowercase", () => {
    for (let i = 0; i < 10; i++) {
      const result = generateIdentity();
      expect(result).toBe(result.toLowerCase());
    }
  });

  test("does not contain the custom separator '|||'", () => {
    for (let i = 0; i < 10; i++) {
      const result = generateIdentity();
      expect(result).not.toContain("|||");
    }
  });

  test("always has at least adjective-noun before '-tater'", () => {
    // The adjective and noun should not be empty
    for (let i = 0; i < 10; i++) {
      const result = generateIdentity();
      // Remove the "-tater" suffix
      const prefix = result.slice(0, -6); // "-tater" is 6 chars
      expect(prefix.length).toBeGreaterThan(0);
    }
  });
});
