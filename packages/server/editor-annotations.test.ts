import { describe, test, expect } from "bun:test";
import { createEditorAnnotationHandler } from "./editor-annotations";

function mockRequest(method: string, pathname: string, body?: unknown): Request {
  const url = new URL(`http://localhost${pathname}`);
  const init: RequestInit = { method, url: url.toString() };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(url.toString(), init);
}

describe("editor-annotations", () => {
  test("GET /api/editor-annotations returns empty array initially", async () => {
    const handler = createEditorAnnotationHandler();
    const req = mockRequest("GET", "/api/editor-annotations");
    const url = new URL(req.url);
    const resp = await handler.handle(req, url);

    expect(resp).not.toBeNull();
    const data = await resp!.json();
    expect(data.annotations).toEqual([]);
  });

  test("POST /api/editor-annotation adds an annotation", async () => {
    const handler = createEditorAnnotationHandler();
    const body = {
      filePath: "/src/index.ts",
      selectedText: "const x = 1",
      lineStart: 10,
      lineEnd: 12,
      comment: "This looks wrong",
    };
    const req = mockRequest("POST", "/api/editor-annotation", body);
    const url = new URL(req.url);
    const resp = await handler.handle(req, url);

    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(200);
    const data = await resp!.json();
    expect(data.id).toBeDefined();
    expect(typeof data.id).toBe("string");
  });

  test("GET /api/editor-annotations returns added annotations", async () => {
    const handler = createEditorAnnotationHandler();

    // Add an annotation first
    const addReq = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/src/foo.ts",
      selectedText: "hello",
      lineStart: 5,
      lineEnd: 6,
      comment: "check this",
    });
    await handler.handle(addReq, new URL(addReq.url));

    // Now GET
    const getReq = mockRequest("GET", "/api/editor-annotations");
    const resp = await handler.handle(getReq, new URL(getReq.url));
    const data = await resp!.json();

    expect(data.annotations).toHaveLength(1);
    expect(data.annotations[0].filePath).toBe("/src/foo.ts");
    expect(data.annotations[0].selectedText).toBe("hello");
    expect(data.annotations[0].lineStart).toBe(5);
    expect(data.annotations[0].lineEnd).toBe(6);
    expect(data.annotations[0].comment).toBe("check this");
    expect(data.annotations[0].id).toBeDefined();
    expect(data.annotations[0].createdAt).toBeDefined();
  });

  test("POST /api/editor-annotation returns 400 when required fields are missing", async () => {
    const handler = createEditorAnnotationHandler();

    // Missing lineStart and lineEnd
    const req = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/src/index.ts",
      selectedText: "some text",
    });
    const resp = await handler.handle(req, new URL(req.url));

    expect(resp!.status).toBe(400);
    const data = await resp!.json();
    expect(data.error).toContain("Missing required fields");
  });

  test("POST /api/editor-annotation returns 400 for invalid JSON", async () => {
    const handler = createEditorAnnotationHandler();
    const url = new URL("http://localhost/api/editor-annotation");
    const req = new Request(url.toString(), {
      method: "POST",
      body: "not valid json{{{",
      headers: { "Content-Type": "application/json" },
    });

    const resp = await handler.handle(req, url);
    expect(resp!.status).toBe(400);
    const data = await resp!.json();
    expect(data.error).toContain("Invalid JSON");
  });

  test("DELETE /api/editor-annotation removes an annotation", async () => {
    const handler = createEditorAnnotationHandler();

    // Add
    const addReq = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/src/bar.ts",
      selectedText: "delete me",
      lineStart: 1,
      lineEnd: 2,
    });
    const addResp = await handler.handle(addReq, new URL(addReq.url));
    const { id } = await addResp!.json();

    // Verify it's there
    const getReq = mockRequest("GET", "/api/editor-annotations");
    const getResp = await handler.handle(getReq, new URL(getReq.url));
    expect((await getResp!.json()).annotations).toHaveLength(1);

    // Delete
    const delReq = mockRequest("DELETE", `/api/editor-annotation?id=${id}`);
    const delResp = await handler.handle(delReq, new URL(delReq.url));
    expect(delResp!.status).toBe(200);
    expect((await delResp!.json()).ok).toBe(true);

    // Verify it's gone
    const getReq2 = mockRequest("GET", "/api/editor-annotations");
    const getResp2 = await handler.handle(getReq2, new URL(getReq2.url));
    expect((await getResp2!.json()).annotations).toHaveLength(0);
  });

  test("DELETE /api/editor-annotation with missing id returns 400", async () => {
    const handler = createEditorAnnotationHandler();
    const req = mockRequest("DELETE", "/api/editor-annotation");
    const resp = await handler.handle(req, new URL(req.url));

    expect(resp!.status).toBe(400);
    const data = await resp!.json();
    expect(data.error).toContain("Missing id");
  });

  test("DELETE /api/editor-annotation with non-existent id succeeds (no-op)", async () => {
    const handler = createEditorAnnotationHandler();
    const req = mockRequest("DELETE", "/api/editor-annotation?id=nonexistent");
    const resp = await handler.handle(req, new URL(req.url));

    expect(resp!.status).toBe(200);
    expect((await resp!.json()).ok).toBe(true);
  });

  test("returns null for unmatched routes", async () => {
    const handler = createEditorAnnotationHandler();
    const req = mockRequest("GET", "/api/something-else");
    const resp = await handler.handle(req, new URL(req.url));
    expect(resp).toBeNull();
  });

  test("returns null for wrong method on annotation endpoint", async () => {
    const handler = createEditorAnnotationHandler();
    // PUT is not handled
    const req = mockRequest("PUT", "/api/editor-annotation");
    const resp = await handler.handle(req, new URL(req.url));
    expect(resp).toBeNull();
  });

  test("annotation has createdAt timestamp", async () => {
    const handler = createEditorAnnotationHandler();
    const before = Date.now();

    const addReq = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/src/ts",
      selectedText: "x",
      lineStart: 1,
      lineEnd: 1,
    });
    await handler.handle(addReq, new URL(addReq.url));

    const getReq = mockRequest("GET", "/api/editor-annotations");
    const resp = await handler.handle(getReq, new URL(getReq.url));
    const data = await resp!.json();
    const after = Date.now();

    expect(data.annotations[0].createdAt).toBeGreaterThanOrEqual(before);
    expect(data.annotations[0].createdAt).toBeLessThanOrEqual(after);
  });

  test("annotation id is a valid UUID format", async () => {
    const handler = createEditorAnnotationHandler();
    const addReq = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/a.ts",
      selectedText: "y",
      lineStart: 1,
      lineEnd: 2,
    });
    const addResp = await handler.handle(addReq, new URL(addReq.url));
    const { id } = await addResp!.json();

    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("comment is optional on POST", async () => {
    const handler = createEditorAnnotationHandler();
    const addReq = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/b.ts",
      selectedText: "z",
      lineStart: 3,
      lineEnd: 4,
      // no comment
    });
    const addResp = await handler.handle(addReq, new URL(addReq.url));
    expect(addResp!.status).toBe(200);

    const getReq = mockRequest("GET", "/api/editor-annotations");
    const getResp = await handler.handle(getReq, new URL(getReq.url));
    const data = await getResp!.json();
    expect(data.annotations[0].comment).toBeUndefined();
  });

  test("multiple annotations accumulate", async () => {
    const handler = createEditorAnnotationHandler();

    for (let i = 0; i < 5; i++) {
      const req = mockRequest("POST", "/api/editor-annotation", {
        filePath: `/file${i}.ts`,
        selectedText: `text${i}`,
        lineStart: i,
        lineEnd: i + 1,
      });
      await handler.handle(req, new URL(req.url));
    }

    const getReq = mockRequest("GET", "/api/editor-annotations");
    const resp = await handler.handle(getReq, new URL(getReq.url));
    const data = await resp!.json();
    expect(data.annotations).toHaveLength(5);
  });

  test("each handler instance has independent state", async () => {
    const handler1 = createEditorAnnotationHandler();
    const handler2 = createEditorAnnotationHandler();

    const addReq = mockRequest("POST", "/api/editor-annotation", {
      filePath: "/h1.ts",
      selectedText: "a",
      lineStart: 1,
      lineEnd: 2,
    });
    await handler1.handle(addReq, new URL(addReq.url));

    const getReq1 = mockRequest("GET", "/api/editor-annotations");
    const resp1 = await handler1.handle(getReq1, new URL(getReq1.url));
    expect((await resp1!.json()).annotations).toHaveLength(1);

    const getReq2 = mockRequest("GET", "/api/editor-annotations");
    const resp2 = await handler2.handle(getReq2, new URL(getReq2.url));
    expect((await resp2!.json()).annotations).toHaveLength(0);
  });
});
