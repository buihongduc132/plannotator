/**
 * Regression test: no hardcoded localhost URLs in production source files
 *
 * Prevents accidental introduction of `http://localhost` in non-test,
 * non-comment source code. All server URL construction must go through
 * `getServerUrl()` from `packages/server/remote.ts`.
 *
 * Whitelisted categories:
 *   - `packages/server/remote.ts` — the canonical function that constructs
 *     localhost URLs as a default fallback (this IS the right place for it)
 *   - URL-parsing base: files that use `new URL(str, 'http://localhost')` purely
 *     as a parsing base (no actual network call)
 *   - CORS origins: development localhost origins in allowlists
 *   - Console startup messages: informational only
 *   - Input placeholders: UI hint text
 *   - Test files: excluded entirely
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");

/**
 * Recursively collect .ts files, excluding test/generated/node_modules.
 */
function collectTsFiles(dir: string, files: string[] = []): string[] {
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "generated"]);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectTsFiles(fullPath, files);
    } else if (
      stat.isFile() &&
      extname(entry) === ".ts" &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".spec.ts")
    ) {
      // Skip test files by path (root-level test-*.ts, tests/ dir, manual tests)
      const rel = fullPath.slice(PROJECT_ROOT.length + 1);
      if (
        rel.startsWith("tests/") ||
        rel.startsWith("test-") ||
        rel === "test-multi-session.ts"
      ) {
        continue;
      }
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Whitelist: files that legitimately contain `http://localhost`.
 * Keyed by relative path from project root.
 */
const WHITELIST = new Set([
  // The canonical fallback function — it's supposed to construct localhost URLs
  "packages/server/remote.ts",

  // URL-parsing base only (new URL(str, 'http://localhost') — no network call)
  "apps/review/vite.config.ts",
  "apps/vscode-extension/src/cookie-proxy.ts",
  "apps/vscode-extension/src/ipc-server.ts",
  "apps/hook/dev-mock-api.ts",
  "apps/pi-extension/server/helpers.ts",

  // CORS allowlist origin for development
  "apps/paste-service/core/cors.ts",

  // Startup console message
  "apps/paste-service/targets/bun.ts",

  // Input placeholder text in VS Code prompt
  "apps/vscode-extension/src/extension.ts",

  // Session URL construction in multi-session mode (uses known port, runs locally)
  "packages/server/index.ts",

  // Goal setup (uses known port locally)
  "packages/server/goal-setup.ts",
]);

interface Violation {
  file: string;
  line: number;
  context: string;
}

describe("localhost URL regression", () => {
  test("no hardcoded http://localhost in production source files", () => {
    const tsFiles = collectTsFiles(PROJECT_ROOT);
    const violations: Violation[] = [];

    for (const filePath of tsFiles) {
      const relativePath = filePath.slice(PROJECT_ROOT.length + 1);

      // Skip whitelisted files entirely
      if (WHITELIST.has(relativePath)) continue;

      const source = readFileSync(filePath, "utf-8");
      const lines = source.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes("http://localhost")) continue;

        const trimmed = line.trimStart();

        // Skip comment lines
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
          continue;
        }

        violations.push({
          file: relativePath,
          line: i + 1,
          context: trimmed,
        });
      }
    }

    if (violations.length > 0) {
      const details = violations
        .map((v) => `  ${v.file}:${v.line}: ${v.context}`)
        .join("\n");
      expect(
        violations.length,
        `Found hardcoded http://localhost URLs:\n${details}\n\nUse getServerUrl() from packages/server/remote.ts instead, or add to WHITELIST if legitimate.`
      ).toBe(0);
    }

    expect(violations.length).toBe(0);
  });

  test("whitelisted files still exist", () => {
    for (const whitelisted of WHITELIST) {
      const fullPath = join(PROJECT_ROOT, whitelisted);
      let exists = false;
      try {
        exists = statSync(fullPath).isFile();
      } catch {
        exists = false;
      }
      expect(exists, `Whitelisted file not found: ${whitelisted}`).toBe(true);
    }
  });
});
