import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import { createEditorAnnotationHandler } from "./annotations";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

// --- Mock helpers ---

function mockReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
	const body = opts.body ?? "";
	const readable = body ? Readable.from([body]) : Readable.from([]);
	return Object.assign(readable as unknown as IncomingMessage, {
		method: opts.method,
		url: opts.url,
		headers: {},
	});
}

function mockRes(): ServerResponse & {
	data: string;
	statusCode: number;
	headers: Record<string, string>;
} {
	return {
		data: "",
		statusCode: 200,
		headers: {} as Record<string, string>,
		writeHead(status: number, headers?: Record<string, string>) {
			(this as any).statusCode = status;
			if (headers) Object.assign((this as any).headers, headers);
		},
		end(data?: string) {
			(this as any).data = data ?? "";
		},
	} as unknown as ServerResponse & {
		data: string;
		statusCode: number;
		headers: Record<string, string>;
	};
}

function parseData(res: ReturnType<typeof mockRes>) {
	return JSON.parse(res.data);
}

// --- Tests ---

describe("editor annotations", () => {
	const handler = createEditorAnnotationHandler();

	test("GET /api/editor-annotations returns empty array initially", async () => {
		const res = mockRes();
		const req = mockReq({ method: "GET", url: "/api/editor-annotations" });
		await handler.handle(req, res, new URL("http://localhost/api/editor-annotations"));
		expect(res.statusCode).toBe(200);
		expect(parseData(res).annotations).toEqual([]);
	});

	test("POST /api/editor-annotation creates annotation", async () => {
		const res = mockRes();
		const req = mockReq({
			method: "POST",
			url: "/api/editor-annotation",
			body: JSON.stringify({
				filePath: "/test/file.ts",
				selectedText: "const x = 1",
				lineStart: 10,
				lineEnd: 12,
				comment: "Should use let",
			}),
		});
		await handler.handle(req, res, new URL("http://localhost/api/editor-annotation"));
		expect(res.statusCode).toBe(200);
		expect(parseData(res).id).toBeDefined();
	});

	test("GET /api/editor-annotations returns created annotation", async () => {
		const res = mockRes();
		const req = mockReq({ method: "GET", url: "/api/editor-annotations" });
		await handler.handle(req, res, new URL("http://localhost/api/editor-annotations"));
		expect(res.statusCode).toBe(200);
		const data = parseData(res);
		expect(data.annotations.length).toBe(1);
		expect(data.annotations[0].filePath).toBe("/test/file.ts");
		expect(data.annotations[0].comment).toBe("Should use let");
	});

	test("POST returns 400 for missing fields", async () => {
		const res = mockRes();
		const req = mockReq({
			method: "POST",
			url: "/api/editor-annotation",
			body: JSON.stringify({ filePath: "/test.ts" }),
		});
		await handler.handle(req, res, new URL("http://localhost/api/editor-annotation"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Missing");
	});

	test("DELETE /api/editor-annotation removes annotation", async () => {
		// First get the ID
		const listRes = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/editor-annotations" }),
			listRes,
			new URL("http://localhost/api/editor-annotations"),
		);
		const id = parseData(listRes).annotations[0].id;

		// Delete it
		const delRes = mockRes();
		await handler.handle(
			mockReq({ method: "DELETE", url: `/api/editor-annotation?id=${id}` }),
			delRes,
			new URL(`http://localhost/api/editor-annotation?id=${id}`),
		);
		expect(delRes.statusCode).toBe(200);
		expect(parseData(delRes).ok).toBe(true);

		// Verify it's gone
		const verifyRes = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/editor-annotations" }),
			verifyRes,
			new URL("http://localhost/api/editor-annotations"),
		);
		expect(parseData(verifyRes).annotations.length).toBe(0);
	});

	test("DELETE returns 400 for missing id", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({ method: "DELETE", url: "/api/editor-annotation" }),
			res,
			new URL("http://localhost/api/editor-annotation"),
		);
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Missing id");
	});

	test("DELETE non-existent annotation still returns ok", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({ method: "DELETE", url: "/api/editor-annotation?id=nonexistent-id" }),
			res,
			new URL("http://localhost/api/editor-annotation?id=nonexistent-id"),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).ok).toBe(true);
	});

	test("returns false for unmatched route", async () => {
		const res = mockRes();
		const handled = await handler.handle(
			mockReq({ method: "GET", url: "/api/unknown" }),
			res,
			new URL("http://localhost/api/unknown"),
		);
		expect(handled).toBe(false);
	});

	test("POST without comment still creates annotation", async () => {
		const res = mockRes();
		const req = mockReq({
			method: "POST",
			url: "/api/editor-annotation",
			body: JSON.stringify({
				filePath: "/test/file2.ts",
				selectedText: "some code",
				lineStart: 5,
				lineEnd: 6,
			}),
		});
		await handler.handle(req, res, new URL("http://localhost/api/editor-annotation"));
		expect(res.statusCode).toBe(200);
		expect(parseData(res).id).toBeDefined();
	});

	test("POST with invalid JSON returns 400 (missing fields)", async () => {
		const res = mockRes();
		const req = mockReq({
			method: "POST",
			url: "/api/editor-annotation",
			body: "not json{{{",
		});
		await handler.handle(req, res, new URL("http://localhost/api/editor-annotation"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Missing");
	});
});
