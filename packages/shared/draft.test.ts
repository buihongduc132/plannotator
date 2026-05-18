import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { getDraftDir, contentHash, saveDraft, loadDraft, deleteDraft } from "./draft";

const TEST_DIR = join(tmpdir(), `plannotator-test-draft-${Date.now()}`);
const originalHome = process.env.HOME;

// Override homedir for test isolation
beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.HOME = TEST_DIR;
});

afterEach(() => {
  process.env.HOME = originalHome;
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe("getDraftDir", () => {
  test("creates drafts directory", () => {
    const dir = getDraftDir();
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain(".plannotator");
    expect(dir).toContain("drafts");
  });

  test("scopes to cwd + sessionId when both provided", () => {
    const dir = getDraftDir({ cwd: "/my/project", sessionId: "sess-abc" });
    expect(dir).toContain("my_project");
    expect(dir).toContain("sess-abc");
    expect(existsSync(dir)).toBe(true);
  });

  test("ignores scope when only cwd provided", () => {
    const dir = getDraftDir({ cwd: "/my/project" });
    expect(dir).not.toContain("my_project");
    expect(dir).toEndWith("drafts");
  });

  test("ignores scope when only sessionId provided", () => {
    const dir = getDraftDir({ sessionId: "sess-abc" });
    expect(dir).not.toContain("sess-abc");
    expect(dir).toEndWith("drafts");
  });
});

describe("contentHash", () => {
  test("produces consistent hash for same input", () => {
    const hash1 = contentHash("hello world");
    const hash2 = contentHash("hello world");
    expect(hash1).toBe(hash2);
  });

  test("produces different hashes for different inputs", () => {
    const hash1 = contentHash("hello world");
    const hash2 = contentHash("hello universe");
    expect(hash1).not.toBe(hash2);
  });

  test("returns 16-char hex string", () => {
    const hash = contentHash("test");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  test("handles empty string", () => {
    const hash = contentHash("");
    expect(hash).toHaveLength(16);
  });

  test("handles unicode content", () => {
    const hash = contentHash("héllo wörld 🌍");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  test("handles large content", () => {
    const hash = contentHash("x".repeat(10000));
    expect(hash).toHaveLength(16);
  });
});

describe("saveDraft / loadDraft / deleteDraft", () => {
  test("save and load round-trip", () => {
    const key = contentHash("test-plan");
    const data = { annotations: [{ type: "COMMENT", text: "fix this" }] };

    saveDraft(key, data);
    const loaded = loadDraft(key);

    expect(loaded).toEqual(data);
  });

  test("loadDraft returns null for missing key", () => {
    const result = loadDraft("nonexistent-key");
    expect(result).toBeNull();
  });

  test("deleteDraft removes the file", () => {
    const key = contentHash("delete-test");
    saveDraft(key, { test: true });
    expect(loadDraft(key)).not.toBeNull();

    deleteDraft(key);
    expect(loadDraft(key)).toBeNull();
  });

  test("deleteDraft is no-op for missing key", () => {
    // Should not throw
    deleteDraft("nonexistent-key");
  });

  test("saveDraft overwrites existing draft", () => {
    const key = contentHash("overwrite-test");
    saveDraft(key, { version: 1 });
    saveDraft(key, { version: 2 });

    const loaded = loadDraft(key);
    expect((loaded as any).version).toBe(2);
  });

  test("supports scoped drafts", () => {
    const scope = { cwd: "/project", sessionId: "s1" };
    const key = contentHash("scoped-test");
    const data = { scoped: true };

    saveDraft(key, data, scope);
    const loaded = loadDraft(key, scope);
    expect(loaded).toEqual(data);
  });

  test("scoped draft is isolated from unscoped", () => {
    const scope = { cwd: "/project", sessionId: "s1" };
    const key = contentHash("isolation-test");

    saveDraft(key, { scoped: true }, scope);
    // Without scope, should not find it
    const unscoped = loadDraft(key);
    expect(unscoped).toBeNull();
  });

  test("persists complex nested objects", () => {
    const key = contentHash("complex-test");
    const data = {
      nested: { deep: { value: 42, arr: [1, 2, 3] } },
      null_val: null,
      bool: true,
    };

    saveDraft(key, data);
    expect(loadDraft(key)).toEqual(data);
  });
});
