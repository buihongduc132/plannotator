import { describe, test, expect } from "bun:test";
import {
  serializeSSEEvent,
  transformPlanInput,
  transformReviewInput,
  createAnnotationStore,
  HEARTBEAT_COMMENT,
  HEARTBEAT_INTERVAL_MS,
} from "./external-annotation";
import type { StorableAnnotation, ExternalAnnotationEvent } from "./external-annotation";

describe("SSE helpers", () => {
  test("HEARTBEAT_COMMENT is correct", () => {
    expect(HEARTBEAT_COMMENT).toBe(":\n\n");
  });

  test("HEARTBEAT_INTERVAL_MS is 30 seconds", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  test("serializeSSEEvent formats snapshot", () => {
    const event = { type: "snapshot" as const, annotations: [{ id: "1" }] };
    const result = serializeSSEEvent(event);
    expect(result).toMatch(/^data: /);
    expect(result).toMatch(/\n\n$/);
    expect(result).toContain('"type":"snapshot"');
  });

  test("serializeSSEEvent formats add", () => {
    const event = { type: "add" as const, annotations: [] };
    const result = serializeSSEEvent(event);
    expect(result).toContain('"type":"add"');
  });

  test("serializeSSEEvent formats remove", () => {
    const event = { type: "remove" as const, ids: ["a", "b"] };
    const result = serializeSSEEvent(event);
    expect(result).toContain('"type":"remove"');
  });

  test("serializeSSEEvent formats clear", () => {
    const event = { type: "clear" as const };
    const result = serializeSSEEvent(event);
    expect(result).toContain('"type":"clear"');
  });
});

describe("transformPlanInput", () => {
  test("accepts single annotation with source and text", () => {
    const result = transformPlanInput({
      source: "eslint",
      text: "Unexpected any",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].type).toBe("GLOBAL_COMMENT");
    expect(result.annotations[0].text).toBe("Unexpected any");
    expect(result.annotations[0].source).toBe("eslint");
    expect(result.annotations[0].blockId).toBe("external");
  });

  test("accepts batch annotations", () => {
    const result = transformPlanInput({
      annotations: [
        { source: "eslint", text: "Error 1" },
        { source: "prettier", text: "Error 2" },
      ],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations).toHaveLength(2);
  });

  test("sets id as UUID", () => {
    const result = transformPlanInput({
      source: "test",
      text: "issue",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("sets createdA to current timestamp", () => {
    const before = Date.now();
    const result = transformPlanInput({
      source: "test",
      text: "issue",
    });
    const after = Date.now();
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].createdA).toBeGreaterThanOrEqual(before);
    expect(result.annotations[0].createdA).toBeLessThanOrEqual(after);
  });

  test("defaults to GLOBAL_COMMENT type", () => {
    const result = transformPlanInput({
      source: "test",
      text: "issue",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].type).toBe("GLOBAL_COMMENT");
  });

  test("accepts COMMENT type with originalText", () => {
    const result = transformPlanInput({
      source: "reviewer",
      text: "Consider refactoring",
      type: "COMMENT",
      originalText: "old code here",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].type).toBe("COMMENT");
    expect(result.annotations[0].originalText).toBe("old code here");
  });

  test("rejects COMMENT without originalText", () => {
    const result = transformPlanInput({
      source: "reviewer",
      text: "Consider refactoring",
      type: "COMMENT",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("COMMENT requires non-empty");
    }
  });

  test("accepts DELETION type with originalText", () => {
    const result = transformPlanInput({
      source: "editor",
      text: "Remove this",
      type: "DELETION",
      originalText: "text to delete",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].type).toBe("DELETION");
  });

  test("rejects DELETION without originalText", () => {
    const result = transformPlanInput({
      source: "editor",
      text: "Remove this",
      type: "DELETION",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("DELETION type requires");
    }
  });

  test("rejects invalid type", () => {
    const result = transformPlanInput({
      source: "test",
      text: "issue",
      type: "INVALID",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("invalid type");
    }
  });

  test("rejects missing source", () => {
    const result = transformPlanInput({
      text: "issue",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("source");
    }
  });

  test("rejects missing text", () => {
    const result = transformPlanInput({
      source: "test",
    });
    expect("error" in result).toBe(true);
  });

  test("rejects non-object body", () => {
    const result = transformPlanInput("string");
    expect("error" in result).toBe(true);
  });

  test("rejects null body", () => {
    const result = transformPlanInput(null);
    expect("error" in result).toBe(true);
  });

  test("rejects empty annotations array", () => {
    const result = transformPlanInput({ annotations: [] });
    expect("error" in result).toBe(true);
  });

  test("rejects non-object in annotations array", () => {
    const result = transformPlanInput({ annotations: ["string"] });
    expect("error" in result).toBe(true);
  });

  test("sets optional author field", () => {
    const result = transformPlanInput({
      source: "test",
      text: "issue",
      author: "reviewer",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].author).toBe("reviewer");
  });

  test("author is undefined when not provided", () => {
    const result = transformPlanInput({
      source: "test",
      text: "issue",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].author).toBeUndefined();
  });
});

describe("transformReviewInput", () => {
  test("accepts valid review annotation", () => {
    const result = transformReviewInput({
      source: "reviewer",
      filePath: "src/index.ts",
      lineStart: 10,
      lineEnd: 15,
      text: "Consider using const",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].filePath).toBe("src/index.ts");
    expect(result.annotations[0].lineStart).toBe(10);
    expect(result.annotations[0].lineEnd).toBe(15);
    expect(result.annotations[0].type).toBe("comment");
    expect(result.annotations[0].side).toBe("new");
  });

  test("accepts suggestion type with suggestedCode", () => {
    const result = transformReviewInput({
      source: "ai",
      filePath: "src/app.ts",
      lineStart: 1,
      lineEnd: 5,
      suggestedCode: "const x = 1;",
      type: "suggestion",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].type).toBe("suggestion");
    expect(result.annotations[0].suggestedCode).toBe("const x = 1;");
  });

  test("accepts concern type", () => {
    const result = transformReviewInput({
      source: "security",
      filePath: "src/auth.ts",
      lineStart: 20,
      lineEnd: 30,
      text: "Potential vulnerability",
      type: "concern",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].type).toBe("concern");
  });

  test("defaults side to 'new'", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].side).toBe("new");
  });

  test("accepts side: old", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
      side: "old",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].side).toBe("old");
  });

  test("rejects invalid side", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
      side: "middle",
    });
    expect("error" in result).toBe(true);
  });

  test("rejects invalid type", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
      type: "invalid",
    });
    expect("error" in result).toBe(true);
  });

  test("rejects missing filePath", () => {
    const result = transformReviewInput({
      source: "test",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("filePath");
  });

  test("rejects missing lineStart", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineEnd: 2,
      text: "fix",
    });
    expect("error" in result).toBe(true);
  });

  test("rejects missing both text and suggestedCode", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("text");
  });

  test("defaults scope to 'line'", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].scope).toBe("line");
  });

  test("rejects invalid scope", () => {
    const result = transformReviewInput({
      source: "test",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
      scope: "invalid",
    });
    expect("error" in result).toBe(true);
  });

  test("accepts optional severity and reasoning", () => {
    const result = transformReviewInput({
      source: "ai",
      filePath: "a.ts",
      lineStart: 1,
      lineEnd: 2,
      text: "fix",
      severity: "important",
      reasoning: "This is critical because...",
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations[0].severity).toBe("important");
    expect(result.annotations[0].reasoning).toBe("This is critical because...");
  });

  test("accepts batch review annotations", () => {
    const result = transformReviewInput({
      annotations: [
        { source: "a", filePath: "f1.ts", lineStart: 1, lineEnd: 2, text: "fix 1" },
        { source: "b", filePath: "f2.ts", lineStart: 3, lineEnd: 4, text: "fix 2" },
      ],
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.annotations).toHaveLength(2);
  });
});

describe("createAnnotationStore", () => {
  interface TestAnno extends StorableAnnotation {
    id: string;
    source?: string;
    text: string;
  }

  function createStore() {
    return createAnnotationStore<TestAnno>();
  }

  test("starts empty", () => {
    const store = createStore();
    expect(store.getAll()).toEqual([]);
    expect(store.version).toBe(0);
  });

  test("add returns items and increments version", () => {
    const store = createStore();
    const items: TestAnno[] = [
      { id: "1", source: "a", text: "first" },
      { id: "2", source: "b", text: "second" },
    ];
    const result = store.add(items);
    expect(result).toEqual(items);
    expect(store.getAll()).toHaveLength(2);
    expect(store.version).toBe(1);
  });

  test("add with empty array is no-op", () => {
    const store = createStore();
    store.add([]);
    expect(store.getAll()).toEqual([]);
    expect(store.version).toBe(0);
  });

  test("remove by id", () => {
    const store = createStore();
    store.add([{ id: "1", text: "a" }, { id: "2", text: "b" }]);
    expect(store.remove("1")).toBe(true);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].id).toBe("2");
    expect(store.version).toBe(2);
  });

  test("remove returns false for missing id", () => {
    const store = createStore();
    expect(store.remove("missing")).toBe(false);
    expect(store.version).toBe(0);
  });

  test("update merges fields", () => {
    const store = createStore();
    store.add([{ id: "1", text: "original" }]);
    const updated = store.update("1", { text: "modified" });
    expect(updated).not.toBeNull();
    expect(updated!.text).toBe("modified");
    expect(updated!.id).toBe("1"); // id is preserved
    expect(store.version).toBe(2);
  });

  test("update returns null for missing id", () => {
    const store = createStore();
    expect(store.update("missing", { text: "x" })).toBeNull();
  });

  test("clearBySource removes matching annotations", () => {
    const store = createStore();
    store.add([
      { id: "1", source: "eslint", text: "a" },
      { id: "2", source: "prettier", text: "b" },
      { id: "3", source: "eslint", text: "c" },
    ]);
    const removed = store.clearBySource("eslint");
    expect(removed).toBe(2);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].id).toBe("2");
  });

  test("clearBySource returns 0 for unknown source", () => {
    const store = createStore();
    store.add([{ id: "1", source: "eslint", text: "a" }]);
    expect(store.clearBySource("prettier")).toBe(0);
  });

  test("clearAll removes everything", () => {
    const store = createStore();
    store.add([{ id: "1", text: "a" }, { id: "2", text: "b" }]);
    const count = store.clearAll();
    expect(count).toBe(2);
    expect(store.getAll()).toEqual([]);
    expect(store.version).toBe(2); // add + clearAll
  });

  test("clearAll on empty store returns 0 and no version bump", () => {
    const store = createStore();
    expect(store.clearAll()).toBe(0);
    expect(store.version).toBe(0);
  });

  test("getAll returns snapshot (not reference)", () => {
    const store = createStore();
    store.add([{ id: "1", text: "a" }]);
    const snapshot = store.getAll();
    store.clearAll();
    expect(snapshot).toHaveLength(1); // snapshot unchanged
  });

  test("onMutation fires on add", () => {
    const store = createStore();
    const events: ExternalAnnotationEvent<TestAnno>[] = [];
    store.onMutation((e) => events.push(e));

    store.add([{ id: "1", text: "a" }]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("add");
  });

  test("onMutation fires on remove", () => {
    const store = createStore();
    store.add([{ id: "1", text: "a" }]);
    const events: ExternalAnnotationEvent<TestAnno>[] = [];
    store.onMutation((e) => events.push(e));

    store.remove("1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("remove");
  });

  test("onMutation fires on update", () => {
    const store = createStore();
    store.add([{ id: "1", text: "a" }]);
    const events: ExternalAnnotationEvent<TestAnno>[] = [];
    store.onMutation((e) => events.push(e));

    store.update("1", { text: "b" });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("update");
  });

  test("onMutation fires on clearAll", () => {
    const store = createStore();
    store.add([{ id: "1", text: "a" }]);
    const events: ExternalAnnotationEvent<TestAnno>[] = [];
    store.onMutation((e) => events.push(e));

    store.clearAll();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("clear");
  });

  test("onMutation returns unsubscribe function", () => {
    const store = createStore();
    const events: ExternalAnnotationEvent<TestAnno>[] = [];
    const unsub = store.onMutation((e) => events.push(e));

    store.add([{ id: "1", text: "a" }]);
    expect(events).toHaveLength(1);

    unsub();
    store.add([{ id: "2", text: "b" }]);
    expect(events).toHaveLength(1); // no new event after unsub
  });

  test("failing listener doesn't break store", () => {
    const store = createStore();
    store.onMutation(() => { throw new Error("boom"); });
    const events: ExternalAnnotationEvent<TestAnno>[] = [];
    store.onMutation((e) => events.push(e));

    // Should not throw
    store.add([{ id: "1", text: "a" }]);
    expect(events).toHaveLength(1); // second listener still works
  });

  test("multiple listeners all receive events", () => {
    const store = createStore();
    const events1: ExternalAnnotationEvent<TestAnno>[] = [];
    const events2: ExternalAnnotationEvent<TestAnno>[] = [];
    store.onMutation((e) => events1.push(e));
    store.onMutation((e) => events2.push(e));

    store.add([{ id: "1", text: "a" }]);
    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
  });
});
