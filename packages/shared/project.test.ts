import { describe, test, expect } from "bun:test";
import { sanitizeTag, extractRepoName, extractDirName, hostnameOrFallback } from "./project";

describe("sanitizeTag", () => {
  test("lowercases input", () => {
    expect(sanitizeTag("Hello World")).toBe("hello-world");
  });

  test("replaces spaces with hyphens", () => {
    expect(sanitizeTag("my cool tag")).toBe("my-cool-tag");
  });

  test("replaces underscores with hyphens", () => {
    expect(sanitizeTag("my_cool_tag")).toBe("my-cool-tag");
  });

  test("removes special characters keeping only valid tag", () => {
    // After removing special chars, "tag" is only 3 chars → valid
    expect(sanitizeTag("tag!@#$%")).toBe("tag");
  });

  test("removes special characters but keeps alphanumerics", () => {
    expect(sanitizeTag("hello!world")).toBe("helloworld");
  });

  test("collapses multiple hyphens", () => {
    expect(sanitizeTag("a---b")).toBe("a-b");
  });

  test("trims leading/trailing hyphens", () => {
    expect(sanitizeTag("-hello-")).toBe("hello");
  });

  test("truncates to 30 characters", () => {
    const long = "a".repeat(50);
    const result = sanitizeTag(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(30);
  });

  test("returns null for empty string", () => {
    expect(sanitizeTag("")).toBeNull();
  });

  test("returns null for null input", () => {
    expect(sanitizeTag(null as any)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(sanitizeTag(undefined as any)).toBeNull();
  });

  test("returns null for single char (too short)", () => {
    expect(sanitizeTag("a")).toBeNull();
  });

  test("returns valid tag for two chars", () => {
    expect(sanitizeTag("ab")).toBe("ab");
  });

  test("returns null for special-only input after sanitization", () => {
    expect(sanitizeTag("!!!")).toBeNull();
  });

  test("handles mixed alphanumeric", () => {
    expect(sanitizeTag("Tag 123")).toBe("tag-123");
  });

  test("handles leading/trailing whitespace", () => {
    expect(sanitizeTag("  hello  ")).toBe("hello");
  });

  test("handles tabs and newlines as whitespace", () => {
    expect(sanitizeTag("hello\tworld")).toBe("hello-world");
  });

  test("handles numeric input", () => {
    expect(sanitizeTag("1234")).toBe("1234");
  });

  test("handles unicode characters (accented chars removed)", () => {
    // accented chars are not [a-z0-9-], so they're stripped
    expect(sanitizeTag("héllo wörld")).toBe("hllo-wrld");
  });

  test("returns null when all chars are special", () => {
    expect(sanitizeTag("!@#$")).toBeNull();
  });
});

describe("extractRepoName", () => {
  test("extracts repo from simple path", () => {
    expect(extractRepoName("/home/user/my-project")).toBe("my-project");
  });

  test("extracts repo from nested path", () => {
    expect(extractRepoName("/home/user/projects/plannotator")).toBe("plannotator");
  });

  test("handles trailing slashes", () => {
    expect(extractRepoName("/home/user/my-project/")).toBe("my-project");
  });

  test("handles multiple trailing slashes", () => {
    expect(extractRepoName("/home/user/my-project///")).toBe("my-project");
  });

  test("returns null for empty string", () => {
    expect(extractRepoName("")).toBeNull();
  });

  test("returns null for null input", () => {
    expect(extractRepoName(null as any)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(extractRepoName(undefined as any)).toBeNull();
  });

  test("handles single segment path", () => {
    expect(extractRepoName("my-project")).toBe("my-project");
  });

  test("sanitizes the extracted name", () => {
    expect(extractRepoName("/home/user/My Cool Project")).toBe("my-cool-project");
  });

  test("handles root path", () => {
    // "/" → trimmed to "" → returns null
    expect(extractRepoName("/")).toBeNull();
  });
});

describe("extractDirName", () => {
  test("extracts dir name from path", () => {
    expect(extractDirName("/home/user/my-project")).toBe("my-project");
  });

  test("handles trailing slashes", () => {
    expect(extractDirName("/home/user/my-project/")).toBe("my-project");
  });

  test("returns null for empty string", () => {
    expect(extractDirName("")).toBeNull();
  });

  test("returns null for null input", () => {
    expect(extractDirName(null as any)).toBeNull();
  });

  test("returns null for root path", () => {
    expect(extractDirName("/")).toBeNull();
  });

  test("skips generic 'home' name", () => {
    expect(extractDirName("/home")).toBeNull();
  });

  test("skips generic 'users' name", () => {
    expect(extractDirName("/Users")).toBeNull();
  });

  test("skips generic 'tmp' name", () => {
    expect(extractDirName("/tmp")).toBeNull();
  });

  test("skips generic 'var' name", () => {
    expect(extractDirName("/var")).toBeNull();
  });

  test("skips generic 'root' name", () => {
    expect(extractDirName("/root")).toBeNull();
  });

  test("skips generic 'user' name", () => {
    expect(extractDirName("/user")).toBeNull();
  });

  test("case-insensitive skip for generic names", () => {
    expect(extractDirName("/Home")).toBeNull();
    expect(extractDirName("/TMP")).toBeNull();
  });

  test("returns valid name for non-generic dirs", () => {
    expect(extractDirName("/home/user/projects")).toBe("projects");
  });
});

describe("hostnameOrFallback", () => {
  test("extracts hostname from https URL", () => {
    expect(hostnameOrFallback("https://github.com/owner/repo")).toBe("github.com");
  });

  test("extracts hostname from http URL", () => {
    expect(hostnameOrFallback("http://localhost:3000/path")).toBe("localhost");
  });

  test("returns original string for invalid URL", () => {
    expect(hostnameOrFallback("not-a-url")).toBe("not-a-url");
  });

  test("returns original string for empty string", () => {
    expect(hostnameOrFallback("")).toBe("");
  });

  test("handles subdomains", () => {
    expect(hostnameOrFallback("https://docs.github.com/guide")).toBe("docs.github.com");
  });

  test("handles port numbers", () => {
    expect(hostnameOrFallback("https://localhost:8080/api")).toBe("localhost");
  });
});
