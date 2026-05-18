import { describe, test, expect } from "bun:test";
import { parseChecklist, extractDoneSteps, markCompletedSteps } from "./checklist";

describe("parseChecklist", () => {
  test("parses unchecked items", () => {
    const result = parseChecklist("- [ ] Step one\n- [ ] Step two");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ step: 1, text: "Step one", completed: false });
    expect(result[1]).toEqual({ step: 2, text: "Step two", completed: false });
  });

  test("parses checked items with lowercase x", () => {
    const result = parseChecklist("- [x] Done");
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
  });

  test("parses checked items with uppercase X", () => {
    const result = parseChecklist("- [X] Done");
    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
  });

  test("handles * bullet style", () => {
    const result = parseChecklist("* [ ] Task");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Task");
  });

  test("ignores non-checkbox lines", () => {
    const result = parseChecklist("# Title\n- [ ] Task\nNormal text");
    expect(result).toHaveLength(1);
  });

  test("numbers steps sequentially", () => {
    const result = parseChecklist("- [ ] A\n- [x] B\n- [ ] C");
    expect(result.map(r => r.step)).toEqual([1, 2, 3]);
  });

  test("trims text whitespace", () => {
    const result = parseChecklist("- [ ]   Task with spaces  ");
    expect(result[0].text).toBe("Task with spaces");
  });

  test("skips empty text items", () => {
    const result = parseChecklist("- [ ]  ");
    expect(result).toHaveLength(0);
  });

  test("handles empty string", () => {
    expect(parseChecklist("")).toEqual([]);
  });

  test("handles string with no checkboxes", () => {
    expect(parseChecklist("Just a paragraph\nAnd another")).toEqual([]);
  });

  test("finds checkboxes in multi-line content", () => {
    const content = `
# Plan

Some intro text.

- [ ] First step
- [ ] Second step

More text.

- [x] Third step (done)
`;
    const result = parseChecklist(content);
    expect(result).toHaveLength(3);
    expect(result[2].completed).toBe(true);
  });
});

describe("extractDoneSteps", () => {
  test("extracts single done step", () => {
    expect(extractDoneSteps("[DONE:1]")).toEqual([1]);
  });

  test("extracts multiple done steps", () => {
    expect(extractDoneSteps("[DONE:1] [DONE:3] [DONE:5]")).toEqual([1, 3, 5]);
  });

  test("is case insensitive", () => {
    expect(extractDoneSteps("[done:1]")).toEqual([1]);
    expect(extractDoneSteps("[Done:1]")).toEqual([1]);
  });

  test("returns empty for no matches", () => {
    expect(extractDoneSteps("no done steps here")).toEqual([]);
  });

  test("handles empty string", () => {
    expect(extractDoneSteps("")).toEqual([]);
  });

  test("ignores non-numeric values", () => {
    expect(extractDoneSteps("[DONE:abc]")).toEqual([]);
  });

  test("extracts from longer message", () => {
    const msg = "Completed step 1 [DONE:1] and step 4 [DONE:4]";
    expect(extractDoneSteps(msg)).toEqual([1, 4]);
  });
});

describe("markCompletedSteps", () => {
  test("marks matching steps as completed", () => {
    const items = parseChecklist("- [ ] A\n- [ ] B\n- [ ] C");
    const count = markCompletedSteps("[DONE:1] [DONE:3]", items);
    expect(count).toBe(2);
    expect(items[0].completed).toBe(true);
    expect(items[1].completed).toBe(false);
    expect(items[2].completed).toBe(true);
  });

  test("ignores step numbers that don't exist", () => {
    const items = parseChecklist("- [ ] A");
    const count = markCompletedSteps("[DONE:5]", items);
    // extractDoneSteps returns [5], so count is 1 (done steps found)
    // but no item has step=5, so nothing gets completed
    expect(count).toBe(1); // 1 done step marker found
    expect(items[0].completed).toBe(false);
  });

  test("returns 0 for no done steps in message", () => {
    const items = parseChecklist("- [ ] A");
    const count = markCompletedSteps("no done markers", items);
    expect(count).toBe(0);
  });

  test("handles empty message", () => {
    const items = parseChecklist("- [ ] A");
    const count = markCompletedSteps("", items);
    expect(count).toBe(0);
  });
});
