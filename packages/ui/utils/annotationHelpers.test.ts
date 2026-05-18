import { describe, test, expect } from "bun:test";
import {
  getAnnotationCountBySection,
  buildTocHierarchy,
  type TocItem,
} from "./annotationHelpers";
import type { Block, Annotation } from "../types";

// Helper to create a heading block
function heading(id: string, content: string, level: number, order: number, startLine: number): Block {
  return { id, type: "heading", content, level, order, startLine };
}

// Helper to create a paragraph block
function para(id: string, content: string, order: number, startLine: number): Block {
  return { id, type: "paragraph", content, order, startLine };
}

// Helper to create a code block
function code(id: string, content: string, order: number, startLine: number): Block {
  return { id, type: "code", content, order, startLine };
}

// Helper to create an annotation
function annotation(id: string, blockId: string): Annotation {
  return {
    id, blockId, startOffset: 0, endOffset: 10,
    type: "COMMENT" as any, originalText: "text", createdA: Date.now(),
  };
}

// --- getAnnotationCountBySection ---

describe("getAnnotationCountBySection", () => {
  test("returns empty map for empty blocks", () => {
    const result = getAnnotationCountBySection([], []);
    expect(result.size).toBe(0);
  });

  test("returns empty map when no headings exist", () => {
    const blocks = [para("p1", "hello", 0, 1)];
    const result = getAnnotationCountBySection(blocks, []);
    expect(result.size).toBe(0);
  });

  test("returns zero counts for headings with no annotations", () => {
    const blocks = [
      heading("h1", "Title", 1, 0, 1),
      para("p1", "content", 1, 2),
      heading("h2", "Section", 2, 0, 3),
      para("p2", "more", 3, 4),
    ];
    const result = getAnnotationCountBySection(blocks, []);
    expect(result.get("h1")).toBe(0);
    expect(result.get("h2")).toBe(0);
  });

  test("counts annotations in a single section", () => {
    const blocks = [
      heading("h1", "Title", 1, 0, 1),
      para("p1", "content", 1, 2),
    ];
    const annotations = [annotation("a1", "p1"), annotation("a2", "p1")];
    const result = getAnnotationCountBySection(blocks, annotations);
    expect(result.get("h1")).toBe(2);
  });

  test("distributes annotations across sections correctly", () => {
    const blocks = [
      heading("h1", "Section A", 1, 0, 1),
      para("p1", "content a", 1, 2),
      heading("h2", "Section B", 1, 0, 3),
      para("p2", "content b", 3, 4),
      para("p3", "more b", 4, 5),
    ];
    const annotations = [
      annotation("a1", "p1"),
      annotation("a2", "p2"),
      annotation("a3", "p2"),
      annotation("a4", "p3"),
    ];
    const result = getAnnotationCountBySection(blocks, annotations);
    expect(result.get("h1")).toBe(1);
    expect(result.get("h2")).toBe(3);
  });

  test("handles nested headings — sections overlap at deeper levels", () => {
    // All three sections extend to Infinity (no sibling heading to end them)
    // so p3 (line 6) is counted in all three overlapping sections
    const blocks = [
      heading("h1", "Top", 1, 0, 1),
      para("p1", "top content", 1, 2),
      heading("h2", "Sub", 2, 0, 3),
      para("p2", "sub content", 3, 4),
      heading("h3", "Deep", 3, 0, 5),
      para("p3", "deep content", 5, 6),
    ];
    const annotations = [annotation("a1", "p3")];
    const result = getAnnotationCountBySection(blocks, annotations);
    expect(result.get("h3")).toBe(1);
    expect(result.get("h2")).toBe(1);
    expect(result.get("h1")).toBe(1);
  });

  test("ignores headings above level 3", () => {
    const blocks = [
      heading("h1", "Title", 1, 0, 1),
      heading("h4", "Ignored", 4, 0, 2),
      para("p1", "content", 2, 3),
    ];
    const annotations = [annotation("a1", "p1")];
    const result = getAnnotationCountBySection(blocks, annotations);
    expect(result.has("h4")).toBe(false);
    expect(result.get("h1")).toBe(1);
  });

  test("code block annotations counted in their section", () => {
    const blocks = [
      heading("h1", "Title", 1, 0, 1),
      code("c1", "const x = 1;", 1, 2),
    ];
    const annotations = [annotation("a1", "c1")];
    const result = getAnnotationCountBySection(blocks, annotations);
    expect(result.get("h1")).toBe(1);
  });
});

// --- buildTocHierarchy ---

describe("buildTocHierarchy", () => {
  test("returns empty array for no headings", () => {
    const blocks = [para("p1", "text", 0, 1)];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result).toEqual([]);
  });

  test("builds flat hierarchy for same-level headings", () => {
    const blocks = [
      heading("h1", "A", 1, 0, 1),
      heading("h2", "B", 1, 0, 2),
    ];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result.length).toBe(2);
    expect(result[0].children.length).toBe(0);
    expect(result[1].children.length).toBe(0);
  });

  test("nests lower-level headings under parent", () => {
    const blocks = [
      heading("h1", "Top", 1, 0, 1),
      heading("h2", "Sub", 2, 0, 2),
    ];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("h1");
    expect(result[0].children.length).toBe(1);
    expect(result[0].children[0].id).toBe("h2");
  });

  test("deeply nests multiple levels", () => {
    const blocks = [
      heading("h1", "L1", 1, 0, 1),
      heading("h2", "L2", 2, 0, 2),
      heading("h3", "L3", 3, 0, 3),
    ];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result.length).toBe(1);
    expect(result[0].children[0].children[0].id).toBe("h3");
  });

  test("includes annotation counts", () => {
    const blocks = [
      heading("h1", "A", 1, 0, 1),
      heading("h2", "B", 1, 0, 2),
    ];
    const counts = new Map([["h1", 5], ["h2", 3]]);
    const result = buildTocHierarchy(blocks, counts);
    expect(result[0].annotationCount).toBe(5);
    expect(result[1].annotationCount).toBe(3);
  });

  test("defaults annotation count to 0 when not in map", () => {
    const blocks = [heading("h1", "A", 1, 0, 1)];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result[0].annotationCount).toBe(0);
  });

  test("sorts headings by order", () => {
    const blocks = [
      heading("h2", "Second", 1, 5, 2),
      heading("h1", "First", 1, 1, 1),
    ];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result[0].id).toBe("h1");
    expect(result[1].id).toBe("h2");
  });

  test("handles sibling going back up a level", () => {
    const blocks = [
      heading("h1", "A", 1, 0, 1),
      heading("h2", "B", 2, 0, 2),
      heading("h1", "C", 1, 0, 3),
    ];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result.length).toBe(2); // A and C are top-level
    expect(result[0].children.length).toBe(1); // B nested under A
    expect(result[1].children.length).toBe(0); // C has no children
  });

  test("sets level, content, order from block", () => {
    const blocks = [heading("h1", "My Title", 2, 7, 10)];
    const result = buildTocHierarchy(blocks, new Map());
    expect(result[0].content).toBe("My Title");
    expect(result[0].level).toBe(2);
    expect(result[0].order).toBe(7);
  });
});
