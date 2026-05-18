/**
 * Tests for planAgentInstructions.ts — Agent instructions builder
 * Run: bun test packages/ui/utils/planAgentInstructions.test.ts
 */

import { describe, expect, test } from "bun:test";
import { buildPlanAgentInstructions } from "./planAgentInstructions";

describe("buildPlanAgentInstructions", () => {
  test("returns a non-empty string", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  test("includes the origin in the base URL section", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("http://localhost:3000");
  });

  test("includes origin in curl examples", () => {
    const origin = "http://192.168.1.100:54321";
    const result = buildPlanAgentInstructions(origin);
    // Should appear multiple times (base URL + curl examples)
    const matches = result.match(new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    expect(matches!.length).toBeGreaterThan(2);
  });

  test("includes key API sections", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("/api/external-annotations");
    expect(result).toContain("/api/plan");
    expect(result).toContain("COMMENT");
    expect(result).toContain("GLOBAL_COMMENT");
    expect(result).toContain("originalText");
    expect(result).toContain("source");
  });

  test("includes posting instructions", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("curl");
    expect(result).toContain("POST");
  });

  test("includes delete instructions", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("DELETE");
  });

  test("includes batching instructions", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("annotations");
    expect(result).toContain("Batching");
  });

  test("includes cleanup pattern", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("re-run");
    expect(result).toContain("Cleaning up");
  });

  test("works with remote URL", () => {
    const result = buildPlanAgentInstructions("http://100.114.135.99:19432");
    expect(result).toContain("http://100.114.135.99:19432");
  });

  test("works with https", () => {
    const result = buildPlanAgentInstructions("https://example.com");
    expect(result).toContain("https://example.com");
  });

  test("works with empty string origin", () => {
    const result = buildPlanAgentInstructions("");
    expect(result).toBeTruthy();
    // Should still contain all the documentation, just with empty base URL
    expect(result).toContain("/api/external-annotations");
  });

  test("contains field documentation table", () => {
    const result = buildPlanAgentInstructions("http://localhost:3000");
    expect(result).toContain("Required");
    expect(result).toContain("source");
    expect(result).toContain("text");
    expect(result).toContain("type");
  });
});
