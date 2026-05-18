import { describe, test, expect } from "bun:test";
import { buildFileTree, FILE_BROWSER_EXCLUDED, type VaultNode } from "./reference-common";

describe("buildFileTree", () => {
  test("builds tree from flat file list", () => {
    const result = buildFileTree(["README.md", "guide.md"]);
    expect(result).toHaveLength(2);
    expect(result.every(n => n.type === "file")).toBe(true);
  });

  test("builds nested tree from paths with dirs", () => {
    const result = buildFileTree(["docs/guide.md", "docs/api.md"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("folder");
    expect(result[0].name).toBe("docs");
    expect(result[0].children).toHaveLength(2);
  });

  test("sorts folders before files", () => {
    const result = buildFileTree(["README.md", "docs/guide.md"]);
    expect(result[0].type).toBe("folder");
    expect(result[0].name).toBe("docs");
    expect(result[1].type).toBe("file");
    expect(result[1].name).toBe("README.md");
  });

  test("sorts alphabetically within type", () => {
    const result = buildFileTree(["c.md", "a.md", "b.md"]);
    expect(result.map(n => n.name)).toEqual(["a.md", "b.md", "c.md"]);
  });

  test("sorts folders alphabetically", () => {
    const result = buildFileTree(["z/file.md", "a/file.md"]);
    expect(result[0].name).toBe("a");
    expect(result[1].name).toBe("z");
  });

  test("handles deeply nested paths", () => {
    const result = buildFileTree(["a/b/c/d.md"]);
    expect(result[0].name).toBe("a");
    expect(result[0].children![0].name).toBe("b");
    expect(result[0].children![0].children![0].name).toBe("c");
    expect(result[0].children![0].children![0].children![0].name).toBe("d.md");
    expect(result[0].children![0].children![0].children![0].type).toBe("file");
  });

  test("sets correct relative paths", () => {
    const result = buildFileTree(["docs/guide.md"]);
    expect(result[0].path).toBe("docs");
    expect(result[0].children![0].path).toBe("docs/guide.md");
  });

  test("handles empty array", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  test("handles mix of files and folders at same level", () => {
    const result = buildFileTree([
      "README.md",
      "docs/intro.md",
      "CHANGELOG.md",
      "docs/api.md",
    ]);
    // Folders first: docs, then files: CHANGELOG.md, README.md
    expect(result[0].name).toBe("docs");
    expect(result[0].type).toBe("folder");
    expect(result[1].name).toBe("CHANGELOG.md");
    expect(result[1].type).toBe("file");
    expect(result[2].name).toBe("README.md");
  });

  test("handles files with same name in different dirs", () => {
    const result = buildFileTree(["a/README.md", "b/README.md"]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("a");
    expect(result[1].name).toBe("b");
    expect(result[0].children![0].name).toBe("README.md");
    expect(result[1].children![0].name).toBe("README.md");
  });

  test("sorts children recursively", () => {
    const result = buildFileTree([
      "docs/z-guide.md",
      "docs/a-intro.md",
      "docs/sub/b.md",
      "docs/sub/a.md",
    ]);
    const docs = result[0]; // "docs" folder
    expect(docs.children![0].name).toBe("sub"); // folder first
    expect(docs.children![1].name).toBe("a-intro.md"); // then files sorted
    expect(docs.children![2].name).toBe("z-guide.md");

    const sub = docs.children![0];
    expect(sub.children![0].name).toBe("a.md");
    expect(sub.children![1].name).toBe("b.md");
  });
});

describe("FILE_BROWSER_EXCLUDED", () => {
  test("includes common excluded directories", () => {
    expect(FILE_BROWSER_EXCLUDED).toContain("node_modules/");
    expect(FILE_BROWSER_EXCLUDED).toContain(".git/");
    expect(FILE_BROWSER_EXCLUDED).toContain("dist/");
    expect(FILE_BROWSER_EXCLUDED).toContain("__pycache__/");
  });

  test("all entries end with /", () => {
    for (const entry of FILE_BROWSER_EXCLUDED) {
      expect(entry).toMatch(/\/$/);
    }
  });

  test("is non-empty", () => {
    expect(FILE_BROWSER_EXCLUDED.length).toBeGreaterThan(0);
  });
});
