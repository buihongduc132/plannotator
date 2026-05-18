import { describe, test, expect } from "bun:test";

describe("markdown parser", () => {
  describe("parseMarkdownToBlocks", () => {
    test("parses headings", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("# Title\n## Subtitle\n### Section");
      expect(blocks.length).toBeGreaterThanOrEqual(3);
      expect(blocks[0].type).toBe("heading");
      expect(blocks[0].level).toBe(1);
      expect(blocks[0].content).toContain("Title");
    });

    test("parses paragraphs", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("Hello world\n\nAnother paragraph");
      expect(blocks.length).toBeGreaterThanOrEqual(2);
      expect(blocks.some(b => b.type === "paragraph")).toBe(true);
    });

    test("parses code blocks", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("```typescript\nconst x = 1;\n```");
      expect(blocks.some(b => b.type === "code")).toBe(true);
      const codeBlock = blocks.find(b => b.type === "code");
      expect(codeBlock?.language).toBe("typescript");
      expect(codeBlock?.content).toContain("const x = 1;");
    });

    test("parses list items", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("- item 1\n- item 2\n- item 3");
      expect(blocks.some(b => b.type === "list-item")).toBe(true);
    });

    test("parses numbered list items", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("1. first\n2. second\n3. third");
      expect(blocks.some(b => b.type === "list-item")).toBe(true);
    });

    test("parses blockquotes", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("> This is a quote");
      expect(blocks.some(b => b.type === "blockquote")).toBe(true);
    });

    test("parses GitHub alert notes", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("> [!NOTE]\n> This is a note");
      const alert = blocks.find(b => b.alertKind === "note");
      expect(alert).toBeDefined();
    });

    test("parses GitHub alert warnings", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("> [!WARNING]\n> Be careful");
      const alert = blocks.find(b => b.alertKind === "warning");
      expect(alert).toBeDefined();
    });

    test("parses horizontal rules", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("above\n---\nbelow");
      expect(blocks.some(b => b.type === "hr")).toBe(true);
    });

    test("parses tables", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("| A | B |\n|---|---|\n| 1 | 2 |");
      expect(blocks.some(b => b.type === "table")).toBe(true);
    });

    test("parses HTML blocks", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("<details>\n<summary>Click</summary>\nContent\n</details>");
      expect(blocks.some(b => b.type === "html")).toBe(true);
    });

    test("handles empty input", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("");
      expect(blocks).toEqual([]);
    });

    test("assigns sequential order", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("# H1\n\nPara\n\n## H2");
      for (let i = 0; i < blocks.length; i++) {
        expect(blocks[i].order).toBe(i + 1);
      }
    });

    test("generates unique block IDs", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks("# One\n# Two\n# Three");
      const ids = blocks.map(b => b.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    test("parses directive containers", async () => {
      const { parseMarkdownToBlocks } = await import("./parser");
      const blocks = parseMarkdownToBlocks(":::tip\nSome tip content\n:::");
      // Directive containers may be parsed as specific types
      expect(blocks.length).toBeGreaterThan(0);
    });
  });
});
