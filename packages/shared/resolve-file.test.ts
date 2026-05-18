import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join, resolve } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  expandHomePath,
  stripWrappingQuotes,
  normalizeUserPathInput,
  isAbsoluteUserPath,
  resolveUserPath,
  isWithinProjectRoot,
  resolveMarkdownFile,
  hasMarkdownFiles,
} from "./resolve-file";

const TEST_DIR = join(tmpdir(), `plannotator-test-resolve-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
});

describe("expandHomePath", () => {
  test("expands ~ to home dir", () => {
    expect(expandHomePath("~", "/home/user")).toBe("/home/user");
  });

  test("expands ~/path to home + path", () => {
    expect(expandHomePath("~/documents/file.md", "/home/user")).toBe("/home/user/documents/file.md");
  });

  test("expands ~\\path on Windows style", () => {
    expect(expandHomePath("~\\documents", "/home/user")).toBe("/home/user/documents");
  });

  test("does not expand ~ in middle of path", () => {
    expect(expandHomePath("/path/~other/file", "/home/user")).toBe("/path/~other/file");
  });

  test("does not expand paths without ~", () => {
    expect(expandHomePath("/absolute/path", "/home/user")).toBe("/absolute/path");
  });

  test("handles relative paths", () => {
    expect(expandHomePath("relative/path", "/home/user")).toBe("relative/path");
  });
});

describe("stripWrappingQuotes", () => {
  test("strips double quotes", () => {
    expect(stripWrappingQuotes('"hello.md"')).toBe("hello.md");
  });

  test("strips single quotes", () => {
    expect(stripWrappingQuotes("'hello.md'")).toBe("hello.md");
  });

  test("does not strip mismatched quotes", () => {
    expect(stripWrappingQuotes('"hello.md')).toBe('"hello.md');
    expect(stripWrappingQuotes("hello.md'")).toBe("hello.md'");
  });

  test("does not strip quotes in middle", () => {
    expect(stripWrappingQuotes('he"llo.md')).toBe('he"llo.md');
  });

  test("returns short strings unchanged", () => {
    expect(stripWrappingQuotes("a")).toBe("a");
    expect(stripWrappingQuotes('""')).toBe("");
  });

  test("handles empty string", () => {
    expect(stripWrappingQuotes("")).toBe("");
  });
});

describe("normalizeUserPathInput", () => {
  test("trims whitespace", () => {
    expect(normalizeUserPathInput("  /path/to/file  ", "linux")).toBe("/path/to/file");
  });

  test("strips wrapping quotes", () => {
    expect(normalizeUserPathInput('"/path/to/file"', "linux")).toBe("/path/to/file");
  });

  test("expands home directory", () => {
    const result = normalizeUserPathInput("~/file.md", "linux");
    expect(result).not.toContain("~");
  });

  test("handles Windows paths on win32", () => {
    const result = normalizeUserPathInput("/c/Users/test/file.md", "win32");
    expect(result).toMatch(/^C:/);
  });

  test("handles Linux paths on linux", () => {
    expect(normalizeUserPathInput("/home/user/file.md", "linux")).toBe("/home/user/file.md");
  });

  test("handles /cygdrive/ paths on win32", () => {
    const result = normalizeUserPathInput("/cygdrive/d/projects/file.md", "win32");
    expect(result).toMatch(/^D:/);
  });
});

describe("isAbsoluteUserPath", () => {
  test("recognizes absolute Linux path", () => {
    expect(isAbsoluteUserPath("/home/user/file.md", "linux")).toBe(true);
  });

  test("recognizes relative path", () => {
    expect(isAbsoluteUserPath("relative/path.md", "linux")).toBe(false);
  });

  test("recognizes ~ as relative (after expansion it becomes absolute)", () => {
    // ~/file expands to absolute, but before expansion ~ is relative
    // isAbsoluteUserPath normalizes first then checks
    const result = isAbsoluteUserPath("~/file.md", "linux");
    expect(result).toBe(true); // ~ expands to absolute
  });

  test("recognizes Windows drive letter path as absolute", () => {
    expect(isAbsoluteUserPath("C:\\Users\\file.md", "linux")).toBe(true);
  });
});

describe("resolveUserPath", () => {
  test("resolves absolute path", () => {
    const result = resolveUserPath("/home/user/file.md", "/base", "linux");
    expect(result).toBe("/home/user/file.md");
  });

  test("resolves relative path against base", () => {
    const result = resolveUserPath("docs/file.md", "/project", "linux");
    expect(result).toBe("/project/docs/file.md");
  });

  test("resolves ~ path to home", () => {
    const result = resolveUserPath("~/file.md", "/project", "linux");
    expect(result).toContain(process.env.HOME || "");
    expect(result).not.toContain("~");
  });

  test("returns empty for empty input", () => {
    const result = resolveUserPath("", "/base", "linux");
    expect(result).toBe("");
  });

  test("handles quoted paths", () => {
    const result = resolveUserPath('"/absolute/path.md"', "/base", "linux");
    expect(result).toBe("/absolute/path.md");
  });
});

describe("isWithinProjectRoot", () => {
  test("same path is within", () => {
    expect(isWithinProjectRoot("/project", "/project")).toBe(true);
  });

  test("subdirectory is within", () => {
    expect(isWithinProjectRoot("/project/src/file.md", "/project")).toBe(true);
  });

  test("sibling directory is not within", () => {
    expect(isWithinProjectRoot("/other/file.md", "/project")).toBe(false);
  });

  test("traversal attack is not within", () => {
    expect(isWithinProjectRoot("/project/../etc/passwd", "/project")).toBe(false);
  });

  test("handles trailing slashes", () => {
    expect(isWithinProjectRoot("/project/file.md", "/project/")).toBe(true);
  });
});

describe("resolveMarkdownFile", () => {
  test("returns not_found for non-markdown files", () => {
    const result = resolveMarkdownFile("script.ts", TEST_DIR);
    expect(result.kind).toBe("not_found");
  });

  test("returns found for existing absolute markdown file", () => {
    const filePath = join(TEST_DIR, "README.md");
    writeFileSync(filePath, "# Test");
    const result = resolveMarkdownFile(filePath, TEST_DIR);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.path).toBe(resolve(filePath));
    }
  });

  test("returns not_found for missing absolute path", () => {
    const result = resolveMarkdownFile("/nonexistent/path.md", TEST_DIR);
    expect(result.kind).toBe("not_found");
  });

  test("returns found for relative markdown in project root", () => {
    writeFileSync(join(TEST_DIR, "guide.md"), "# Guide");
    const result = resolveMarkdownFile("guide.md", TEST_DIR);
    expect(result.kind).toBe("found");
  });

  test("returns found for .mdx files", () => {
    writeFileSync(join(TEST_DIR, "page.mdx"), "# Page");
    const result = resolveMarkdownFile("page.mdx", TEST_DIR);
    expect(result.kind).toBe("found");
  });

  test("returns not_found for missing relative file", () => {
    const result = resolveMarkdownFile("missing.md", TEST_DIR);
    expect(result.kind).toBe("not_found");
  });

  test("returns ambiguous for multiple case-insensitive matches", () => {
    mkdirSync(join(TEST_DIR, "sub1"), { recursive: true });
    mkdirSync(join(TEST_DIR, "sub2"), { recursive: true });
    writeFileSync(join(TEST_DIR, "sub1", "Guide.md"), "# Guide 1");
    writeFileSync(join(TEST_DIR, "sub2", "Guide.md"), "# Guide 2");
    const result = resolveMarkdownFile("guide.md", TEST_DIR);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.matches.length).toBe(2);
    }
  });

  test("strips @ prefix and retries", () => {
    writeFileSync(join(TEST_DIR, "notes.md"), "# Notes");
    const result = resolveMarkdownFile("@notes.md", TEST_DIR);
    expect(result.kind).toBe("found");
  });

  test("returns not_found when @ path doesn't resolve", () => {
    const result = resolveMarkdownFile("@nonexistent.md", TEST_DIR);
    expect(result.kind).toBe("not_found");
  });

  test("handles empty string", () => {
    const result = resolveMarkdownFile("", TEST_DIR);
    expect(result.kind).toBe("not_found");
  });
});

describe("hasMarkdownFiles", () => {
  test("returns true for directory with .md file", () => {
    writeFileSync(join(TEST_DIR, "README.md"), "# Readme");
    expect(hasMarkdownFiles(TEST_DIR)).toBe(true);
  });

  test("returns true for directory with .mdx file", () => {
    writeFileSync(join(TEST_DIR, "page.mdx"), "# Page");
    expect(hasMarkdownFiles(TEST_DIR)).toBe(true);
  });

  test("returns false for directory without markdown", () => {
    writeFileSync(join(TEST_DIR, "script.ts"), "console.log('hi')");
    expect(hasMarkdownFiles(TEST_DIR)).toBe(false);
  });

  test("returns false for nonexistent directory", () => {
    expect(hasMarkdownFiles("/nonexistent/path")).toBe(false);
  });

  test("skips ignored directories", () => {
    mkdirSync(join(TEST_DIR, "node_modules"), { recursive: true });
    writeFileSync(join(TEST_DIR, "node_modules", "package.md"), "# Package");
    expect(hasMarkdownFiles(TEST_DIR)).toBe(false);
  });

  test("finds markdown in nested directories", () => {
    mkdirSync(join(TEST_DIR, "docs", "guides"), { recursive: true });
    writeFileSync(join(TEST_DIR, "docs", "guides", "intro.md"), "# Intro");
    expect(hasMarkdownFiles(TEST_DIR)).toBe(true);
  });

  test("respects custom extensions", () => {
    writeFileSync(join(TEST_DIR, "data.yaml"), "key: value");
    expect(hasMarkdownFiles(TEST_DIR, [], /\.ya?ml$/)).toBe(true);
  });
});
