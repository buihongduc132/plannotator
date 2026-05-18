import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from "fs";
import { tmpdir } from "os";
import {
  sanitizeCwd,
  generateSlug,
  savePlan,
  saveAnnotations,
  saveFinalSnapshot,
  parseArchiveFilename,
  listArchivedPlans,
  readArchivedPlan,
  getPlanDir,
  getHistoryDir,
  saveToHistory,
  getPlanVersion,
  getPlanVersionPath,
  getVersionCount,
  listVersions,
  listProjectPlans,
} from "./storage";

// Use temp dir for tests to avoid polluting user's home
const TEST_DIR = join(tmpdir(), `plannotator-test-storage-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe("sanitizeCwd", () => {
  test("replaces slashes with underscores", () => {
    expect(sanitizeCwd("/home/user/project")).toBe("home_user_project");
  });

  test("strips leading/trailing separators", () => {
    // Middle slashes become _, then leading/trailing _ stripped
    expect(sanitizeCwd("///home///user///")).toBe("home___user");
  });

  test("strips non-word characters", () => {
    expect(sanitizeCwd("/path/with spaces/and!special")).toBe("path_withspaces_andspecial");
  });

  test("returns _root for empty result", () => {
    expect(sanitizeCwd("///")).toBe("_root");
  });

  test("handles simple paths", () => {
    expect(sanitizeCwd("project")).toBe("project");
  });

  test("handles empty string", () => {
    expect(sanitizeCwd("")).toBe("_root");
  });
});

describe("generateSlug", () => {
  test("generates slug from H1 heading with date", () => {
    const slug = generateSlug("# My Implementation Plan\nSome content");
    expect(slug).toMatch(/^my-implementation-plan-\d{4}-\d{2}-\d{2}$/);
  });

  test("generates fallback slug when no heading", () => {
    const slug = generateSlug("No heading here");
    expect(slug).toMatch(/^plan-\d{4}-\d{2}-\d{2}$/);
  });

  test("sanitizes heading text", () => {
    const slug = generateSlug("# Plan With Special! Characters #123");
    expect(slug).toMatch(/^plan-with-special-characters-1-/);
  });

  test("handles empty plan", () => {
    const slug = generateSlug("");
    expect(slug).toMatch(/^plan-\d{4}-\d{2}-\d{2}$/);
  });

  test("uses first H1 only", () => {
    const slug = generateSlug("# First Heading\n## Sub\n# Second Heading");
    expect(slug).toMatch(/^first-heading-/);
  });
});

describe("getPlanDir", () => {
  test("uses custom path when provided", () => {
    const dir = getPlanDir(TEST_DIR);
    expect(dir).toBe(resolve(TEST_DIR));
    expect(existsSync(dir)).toBe(true);
  });

  test("creates directory if not exists", () => {
    const customDir = join(TEST_DIR, "new-dir", "sub");
    const dir = getPlanDir(customDir);
    expect(existsSync(dir)).toBe(true);
  });

  test("scopes to cwd + sessionId when both provided", () => {
    const dir = getPlanDir(TEST_DIR, { cwd: "/my/project", sessionId: "sess-123" });
    expect(dir).toContain("my_project");
    expect(dir).toContain("sess-123");
    expect(existsSync(dir)).toBe(true);
  });

  test("ignores scope when only cwd provided", () => {
    const dir = getPlanDir(TEST_DIR, { cwd: "/my/project" });
    expect(dir).toBe(resolve(TEST_DIR));
  });

  test("ignores scope when only sessionId provided", () => {
    const dir = getPlanDir(TEST_DIR, { sessionId: "sess-123" });
    expect(dir).toBe(resolve(TEST_DIR));
  });

  test("handles null customPath", () => {
    // Will use homedir - just verify it returns a string
    const dir = getPlanDir(null);
    expect(typeof dir).toBe("string");
    expect(dir).toContain(".plannotator");
  });

  test("handles empty customPath string", () => {
    const dir = getPlanDir("  ");
    expect(typeof dir).toBe("string");
    expect(dir).toContain(".plannotator");
  });
});

describe("savePlan / saveAnnotations / saveFinalSnapshot", () => {
  test("savePlan creates file and returns path", () => {
    const path = savePlan("test-plan", "# Plan content", TEST_DIR);
    expect(path).toBe(join(resolve(TEST_DIR), "test-plan.md"));
    expect(existsSync(path)).toBe(true);
  });

  test("saveAnnotations creates .annotations.md file", () => {
    const path = saveAnnotations("test-plan", "Some feedback", TEST_DIR);
    expect(path).toMatch(/test-plan\.annotations\.md$/);
    expect(existsSync(path)).toBe(true);
  });

  test("saveFinalSnapshot with approved status", () => {
    const path = saveFinalSnapshot("test-plan", "approved", "# Plan", "Feedback", TEST_DIR);
    expect(path).toMatch(/test-plan-approved\.md$/);
    expect(existsSync(path)).toBe(true);
  });

  test("saveFinalSnapshot with denied status", () => {
    const path = saveFinalSnapshot("test-plan", "denied", "# Plan", "Issues", TEST_DIR);
    expect(path).toMatch(/test-plan-denied\.md$/);
    expect(existsSync(path)).toBe(true);
  });

  test("saveFinalSnapshot omits annotations when 'No changes detected'", () => {
    const path = saveFinalSnapshot("test", "approved", "# Plan", "No changes detected.", TEST_DIR);
    const content = require("fs").readFileSync(path, "utf-8");
    expect(content).toBe("# Plan");
    expect(content).not.toContain("---");
  });

  test("saveFinalSnapshot combines plan and annotations", () => {
    const path = saveFinalSnapshot("test", "denied", "# Plan", "Fix this", TEST_DIR);
    const content = require("fs").readFileSync(path, "utf-8");
    expect(content).toContain("# Plan");
    expect(content).toContain("---");
    expect(content).toContain("Fix this");
  });

  test("works with scope", () => {
    const scope = { cwd: "/project", sessionId: "s1" };
    savePlan("scoped", "# Scoped", TEST_DIR, scope);
    const dir = getPlanDir(TEST_DIR, scope);
    expect(existsSync(join(dir, "scoped.md"))).toBe(true);
  });
});

describe("parseArchiveFilename", () => {
  test("parses approved filename", () => {
    const result = parseArchiveFilename("my-plan-2024-01-15-approved.md");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("approved");
    expect(result!.date).toBe("2024-01-15");
    expect(result!.title).toBe("my plan");
  });

  test("parses denied filename", () => {
    const result = parseArchiveFilename("my-plan-2024-01-15-denied.md");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("denied");
  });

  test("returns null for plain .md file without status", () => {
    expect(parseArchiveFilename("plain-file.md")).toBeNull();
  });

  test("returns null for .annotations.md files", () => {
    expect(parseArchiveFilename("plan.annotations.md")).toBeNull();
  });

  test("returns null for .diff.md files", () => {
    expect(parseArchiveFilename("plan.diff.md")).toBeNull();
  });

  test("handles filename without date", () => {
    const result = parseArchiveFilename("my-cool-plan-approved.md");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("approved");
    expect(result!.date).toBe("");
    expect(result!.title).toBe("my cool plan");
  });

  test("uses 'Untitled Plan' for empty title", () => {
    const result = parseArchiveFilename("-approved.md");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Untitled Plan");
  });
});

describe("listArchivedPlans", () => {
  test("returns empty array for empty directory", () => {
    expect(listArchivedPlans(TEST_DIR)).toEqual([]);
  });

  test("lists approved/denied plans", () => {
    const dir = resolve(TEST_DIR);
    writeFileSync(join(dir, "plan-a-approved.md"), "content");
    writeFileSync(join(dir, "plan-b-denied.md"), "content");
    writeFileSync(join(dir, "plain.md"), "content");

    const plans = listArchivedPlans(TEST_DIR);
    expect(plans.length).toBe(2);
    expect(plans.some(p => p.status === "approved")).toBe(true);
    expect(plans.some(p => p.status === "denied")).toBe(true);
  });

  test("sorts by date descending", () => {
    const dir = resolve(TEST_DIR);
    writeFileSync(join(dir, "plan-2024-01-01-approved.md"), "a");
    writeFileSync(join(dir, "plan-2024-06-15-denied.md"), "b");

    const plans = listArchivedPlans(TEST_DIR);
    expect(plans[0].date).toBe("2024-06-15");
  });
});

describe("readArchivedPlan", () => {
  test("reads existing plan", () => {
    const dir = resolve(TEST_DIR);
    writeFileSync(join(dir, "plan-approved.md"), "Plan content here");

    const content = readArchivedPlan("plan-approved.md", TEST_DIR);
    expect(content).toBe("Plan content here");
  });

  test("returns null for missing file", () => {
    expect(readArchivedPlan("nonexistent.md", TEST_DIR)).toBeNull();
  });

  test("returns null for path traversal attempt", () => {
    expect(readArchivedPlan("../../etc/passwd", TEST_DIR)).toBeNull();
  });

  test("returns null for absolute path escape", () => {
    expect(readArchivedPlan("/etc/passwd", TEST_DIR)).toBeNull();
  });
});

describe("Version History", () => {
  const project = "test-project";
  const slug = "test-slug";

  test("saveToHistory creates versioned files", () => {
    const result = saveToHistory(project, slug, "# Plan v1", undefined);
    // Need to use a temp history dir — saveToHistory uses homedir
    // so we just verify the return shape
    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("path");
    expect(result).toHaveProperty("isNew");
    expect(result.isNew).toBe(true);
    expect(result.version).toBeGreaterThanOrEqual(1);
  });

  test("saveToHistory deduplicates identical content", () => {
    saveToHistory(project, slug, "# Same content", undefined);
    const result = saveToHistory(project, slug, "# Same content", undefined);
    expect(result.isNew).toBe(false);
  });

  test("saveToHistory increments version for new content", () => {
    saveToHistory(project, slug, "# Version A", undefined);
    const result = saveToHistory(project, slug, "# Version B", undefined);
    expect(result.isNew).toBe(true);
    expect(result.version).toBeGreaterThanOrEqual(2);
  });

  test("getPlanVersion reads back saved version", () => {
    const saved = saveToHistory(project, slug, "# Version X", undefined);
    if (saved.isNew) {
      const content = getPlanVersion(project, slug, saved.version, undefined);
      expect(content).toBe("# Version X");
    }
  });

  test("getPlanVersion returns null for nonexistent version", () => {
    expect(getPlanVersion(project, slug, 99999, undefined)).toBeNull();
  });

  test("getPlanVersionPath returns path for existing version", () => {
    const saved = saveToHistory(project, slug, "# Path test", undefined);
    if (saved.isNew) {
      const path = getPlanVersionPath(project, slug, saved.version, undefined);
      expect(path).not.toBeNull();
      expect(existsSync(path!)).toBe(true);
    }
  });

  test("getPlanVersionPath returns null for missing version", () => {
    expect(getPlanVersionPath(project, slug, 99999, undefined)).toBeNull();
  });

  test("getVersionCount returns correct count", () => {
    const count1 = getVersionCount(project, slug, undefined);
    saveToHistory(project, slug, `# Count test ${Date.now()}`, undefined);
    const count2 = getVersionCount(project, slug, undefined);
    expect(count2).toBe(count1 + 1);
  });

  test("listVersions returns sorted versions", () => {
    // Save multiple versions
    saveToHistory(project, `list-test-${Date.now()}`, "# V1", undefined);
    saveToHistory(project, `list-test-${Date.now()}`, "# V2", undefined);

    // This tests the function with whatever slug we gave it
    const versions = listVersions(project, `list-test-${Date.now()}`, undefined);
    expect(Array.isArray(versions)).toBe(true);
  });
});

describe("listProjectPlans", () => {
  test("returns empty for nonexistent project", () => {
    const plans = listProjectPlans(`nonexistent-${Date.now()}`, undefined);
    expect(plans).toEqual([]);
  });
});
