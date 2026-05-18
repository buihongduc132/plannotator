import { describe, test, expect } from "bun:test";

describe("path-utils", () => {
  describe("toRelativePath", () => {
    test("returns absolute path when no cwd", async () => {
      const { toRelativePath } = await import("./path-utils");
      expect(toRelativePath("/abs/path/file.ts")).toBe("/abs/path/file.ts");
    });

    test("strips cwd prefix", async () => {
      const { toRelativePath } = await import("./path-utils");
      expect(toRelativePath("/home/user/project/src/file.ts", "/home/user/project")).toBe("src/file.ts");
    });

    test("returns absolute path if result escapes cwd", async () => {
      const { toRelativePath } = await import("./path-utils");
      expect(toRelativePath("/other/path/file.ts", "/home/user/project")).toBe("/other/path/file.ts");
    });

    test("handles root-level files", async () => {
      const { toRelativePath } = await import("./path-utils");
      expect(toRelativePath("/home/user/project/README.md", "/home/user/project")).toBe("README.md");
    });
  });
});
