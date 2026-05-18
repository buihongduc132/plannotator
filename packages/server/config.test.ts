/**
 * Tests for packages/server/config.ts
 *
 * Since config.ts is a pure re-export from @plannotator/shared/config,
 * these tests verify the re-exported functions work correctly.
 *
 * Run: bun test packages/server/config.test.ts
 */

import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { join } from "path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";

// Server config re-exports from shared config
import {
  loadConfig,
  saveConfig,
  detectGitUser,
  getServerConfig,
} from "./config";

// These are not re-exported by server config.ts, import from shared directly
import {
  resolveDefaultDiffType,
  resolveUseJina,
} from "@plannotator/shared/config";

const CONFIG_DIR = join(homedir(), ".plannotator");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

describe("loadConfig", () => {
  test("returns empty object when config file does not exist", () => {
    // Temporarily move config if it exists
    const backup = CONFIG_PATH + ".bak-test";
    let hadExisting = false;
    if (existsSync(CONFIG_PATH)) {
      hadExisting = true;
      const { renameSync } = require("fs");
      renameSync(CONFIG_PATH, backup);
    }

    try {
      const config = loadConfig();
      expect(config).toEqual({});
    } finally {
      if (hadExisting) {
        const { renameSync } = require("fs");
        renameSync(backup, CONFIG_PATH);
      }
    }
  });

  test("parses valid JSON config", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const original = existsSync(CONFIG_PATH) ? require("fs").readFileSync(CONFIG_PATH, "utf-8") : null;

    try {
      writeFileSync(CONFIG_PATH, JSON.stringify({ displayName: "Test User" }), "utf-8");
      const config = loadConfig();
      expect(config.displayName).toBe("Test User");
    } finally {
      if (original) {
        writeFileSync(CONFIG_PATH, original, "utf-8");
      }
    }
  });

  test("returns empty object for malformed JSON", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const original = existsSync(CONFIG_PATH) ? require("fs").readFileSync(CONFIG_PATH, "utf-8") : null;

    try {
      writeFileSync(CONFIG_PATH, "{invalid json", "utf-8");
      const config = loadConfig();
      expect(config).toEqual({});
    } finally {
      if (original) {
        writeFileSync(CONFIG_PATH, original, "utf-8");
      } else {
        rmSync(CONFIG_PATH, { force: true });
      }
    }
  });

  test("returns empty object for non-object JSON", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    const original = existsSync(CONFIG_PATH) ? require("fs").readFileSync(CONFIG_PATH, "utf-8") : null;

    try {
      writeFileSync(CONFIG_PATH, '"string-value"', "utf-8");
      const config = loadConfig();
      expect(config).toEqual({});
    } finally {
      if (original) {
        writeFileSync(CONFIG_PATH, original, "utf-8");
      } else {
        rmSync(CONFIG_PATH, { force: true });
      }
    }
  });
});

describe("saveConfig", () => {
  const original = existsSync(CONFIG_PATH) ? require("fs").readFileSync(CONFIG_PATH, "utf-8") : null;

  afterEach(() => {
    if (original) {
      writeFileSync(CONFIG_PATH, original, "utf-8");
    } else {
      rmSync(CONFIG_PATH, { force: true });
    }
  });

  test("creates new config file with partial values", () => {
    rmSync(CONFIG_PATH, { force: true });
    saveConfig({ displayName: "NewUser" });
    const config = loadConfig();
    expect(config.displayName).toBe("NewUser");
  });

  test("merges partial into existing config", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ displayName: "Existing" }), "utf-8");
    saveConfig({ jina: false });
    const config = loadConfig();
    expect(config.displayName).toBe("Existing");
    expect(config.jina).toBe(false);
  });

  test("deep-merges diffOptions", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({ diffOptions: { diffStyle: "split", showLineNumbers: true } }), "utf-8");
    saveConfig({ diffOptions: { diffStyle: "unified" } });
    const config = loadConfig();
    expect(config.diffOptions?.diffStyle).toBe("unified");
    expect(config.diffOptions?.showLineNumbers).toBe(true);
  });

  test("clears diffOptions when neither current nor partial has it", () => {
    rmSync(CONFIG_PATH, { force: true });
    saveConfig({ displayName: "NoDiffOpts" });
    const config = loadConfig();
    expect(config.diffOptions).toBeUndefined();
  });
});

describe("getServerConfig", () => {
  const original = existsSync(CONFIG_PATH) ? require("fs").readFileSync(CONFIG_PATH, "utf-8") : null;

  afterEach(() => {
    if (original) {
      writeFileSync(CONFIG_PATH, original, "utf-8");
    } else {
      rmSync(CONFIG_PATH, { force: true });
    }
  });

  test("includes gitUser when provided", () => {
    rmSync(CONFIG_PATH, { force: true });
    const serverConfig = getServerConfig("testuser");
    expect(serverConfig.gitUser).toBe("testuser");
  });

  test("omits gitUser when null", () => {
    rmSync(CONFIG_PATH, { force: true });
    const serverConfig = getServerConfig(null);
    expect(serverConfig.gitUser).toBeUndefined();
  });

  test("includes config values from disk", () => {
    writeFileSync(CONFIG_PATH, JSON.stringify({
      displayName: "DiskUser",
      diffOptions: { diffStyle: "split" },
      conventionalComments: true,
      conventionalLabels: [{ label: "issue", display: "Issue", blocking: true }],
    }), "utf-8");

    const serverConfig = getServerConfig(null);
    expect(serverConfig.displayName).toBe("DiskUser");
    expect(serverConfig.diffOptions?.diffStyle).toBe("split");
    expect(serverConfig.conventionalComments).toBe(true);
    expect(serverConfig.conventionalLabels).toHaveLength(1);
  });
});

describe("resolveDefaultDiffType", () => {
  test("returns 'unstaged' for undefined config", () => {
    expect(resolveDefaultDiffType()).toBe("unstaged");
  });

  test("returns 'unstaged' for empty config", () => {
    expect(resolveDefaultDiffType({})).toBe("unstaged");
  });

  test("returns 'uncommitted' when configured", () => {
    expect(resolveDefaultDiffType({ diffOptions: { defaultDiffType: "uncommitted" } })).toBe("uncommitted");
  });

  test("returns 'staged' when configured", () => {
    expect(resolveDefaultDiffType({ diffOptions: { defaultDiffType: "staged" } })).toBe("staged");
  });

  test("returns 'unstaged' for invalid value", () => {
    expect(resolveDefaultDiffType({ diffOptions: { defaultDiffType: "invalid" as any } })).toBe("unstaged");
  });
});

describe("resolveUseJina", () => {
  const origEnv = process.env.PLANNOTATOR_JINA;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.PLANNOTATOR_JINA = origEnv;
    } else {
      delete process.env.PLANNOTATOR_JINA;
    }
  });

  test("CLI flag --no-jina overrides everything", () => {
    process.env.PLANNOTATOR_JINA = "true";
    expect(resolveUseJina(true, { jina: true })).toBe(false);
  });

  test("env var overrides config", () => {
    process.env.PLANNOTATOR_JINA = "false";
    expect(resolveUseJina(false, { jina: true })).toBe(false);
  });

  test("env var '1' is truthy", () => {
    process.env.PLANNOTATOR_JINA = "1";
    expect(resolveUseJina(false, { jina: false })).toBe(true);
  });

  test("config value used when no env or CLI", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(false, { jina: false })).toBe(false);
  });

  test("defaults to true when nothing is set", () => {
    delete process.env.PLANNOTATOR_JINA;
    expect(resolveUseJina(false, {})).toBe(true);
  });
});

describe("detectGitUser", () => {
  test("returns a string or null", () => {
    // In a real git repo this should return the configured user name
    const result = detectGitUser();
    expect(result === null || typeof result === "string").toBe(true);
  });
});
