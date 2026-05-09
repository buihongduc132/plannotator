import { describe, expect, test } from "bun:test";
import { createExternalAnnotationHandler } from "./external-annotations";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

// --- Mock helpers ---

function mockReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
	const body = opts.body ?? "";
	const readable = body ? Readable.from([body]) : Readable.from([]);
	return Object.assign(readable as unknown as IncomingMessage, {
		method: opts.method,
		url: opts.url,
		headers: { "content-type": "application/json" },
	});
}

function mockRes(): ServerResponse & {
	data: string;
	statusCode: number;
	headers: Record<string, string>;
	writes: string[];
} {
	return {
		data: "",
		statusCode: 200,
		headers: {} as Record<string, string>,
		writes: [] as string[],
		writeHead(status: number, headers?: Record<string, string>) {
			(this as any).statusCode = status;
			if (headers) Object.assign((this as any).headers, headers);
		},
		write(data: string) {
			(this as any).writes.push(data);
		},
		end(data?: string) {
			(this as any).data = data ?? "";
		},
		setTimeout(_ms: number) { /* no-op */ },
		on(event: string, fn: () => void) { /* no-op */ },
	} as unknown as ServerResponse & {
		data: string;
		statusCode: number;
		headers: Record<string, string>;
		writes: string[];
	};
}

function parseData(res: ReturnType<typeof mockRes>) {
	return JSON.parse(res.data);
}

// Shared valid plan annotation payload
const planAnnotation = (overrides: Record<string, unknown> = {}) => ({
	source: "test-suite",
	text: "a comment",
	type: "COMMENT",
	originalText: "some text",
	blockId: "block-1",
	startOffset: 0,
	endOffset: 10,
	createdA: Date.now(),
	...overrides,
});

// Shared valid review annotation payload
const reviewAnnotation = (overrides: Record<string, unknown> = {}) => ({
	source: "test-suite",
	text: "review comment",
	type: "comment",
	filePath: "/src/test.ts",
	lineStart: 10,
	lineEnd: 15,
	createdA: Date.now(),
	...overrides,
});

// --- Tests ---

describe("external annotations — plan mode", () => {
	const handler = createExternalAnnotationHandler("plan");

	test("GET /api/external-annotations returns empty snapshot", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations" }),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).annotations).toEqual([]);
		expect(parseData(res).version).toBe(0);
	});

	test("POST /api/external-annotations adds annotation", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [planAnnotation()] }),
			}),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(201);
		expect(parseData(res).ids).toHaveLength(1);
	});

	test("GET returns created annotation", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations" }),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(parseData(res).annotations.length).toBe(1);
	});

	test("GET with same version returns 304", async () => {
		const snapRes = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations" }),
			snapRes,
			new URL("http://localhost/api/external-annotations"),
		);
		const version = parseData(snapRes).version;

		const res = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: `/api/external-annotations?since=${version}` }),
			res,
			new URL(`http://localhost/api/external-annotations?since=${version}`),
		);
		expect(res.statusCode).toBe(304);
	});

	test("GET with stale version returns snapshot", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations?since=0" }),
			res,
			new URL("http://localhost/api/external-annotations?since=0"),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).annotations.length).toBeGreaterThanOrEqual(1);
	});

	test("PATCH updates annotation text", async () => {
		const listRes = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations" }),
			listRes,
			new URL("http://localhost/api/external-annotations"),
		);
		const annId = parseData(listRes).annotations[0].id;

		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "PATCH",
				url: `/api/external-annotations?id=${annId}`,
				body: JSON.stringify({ text: "updated comment" }),
			}),
			res,
			new URL(`http://localhost/api/external-annotations?id=${annId}`),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).annotation.text).toBe("updated comment");
	});

	test("PATCH returns 404 for non-existent id", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "PATCH",
				url: "/api/external-annotations?id=nonexistent",
				body: JSON.stringify({ text: "test" }),
			}),
			res,
			new URL("http://localhost/api/external-annotations?id=nonexistent"),
		);
		expect(res.statusCode).toBe(404);
	});

	test("PATCH returns 400 for missing id", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "PATCH",
				url: "/api/external-annotations",
				body: JSON.stringify({ text: "test" }),
			}),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(400);
	});

	test("DELETE by id removes annotation", async () => {
		const listRes = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations" }),
			listRes,
			new URL("http://localhost/api/external-annotations"),
		);
		const annId = parseData(listRes).annotations[0].id;

		const res = mockRes();
		await handler.handle(
			mockReq({ method: "DELETE", url: `/api/external-annotations?id=${annId}` }),
			res,
			new URL(`http://localhost/api/external-annotations?id=${annId}`),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).ok).toBe(true);
	});

	test("DELETE by source removes matching annotations", async () => {
		// Add annotation with specific source
		const addRes = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [planAnnotation({ source: "eslint", blockId: "b2" })] }),
			}),
			addRes,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(addRes.statusCode).toBe(201);

		const res = mockRes();
		await handler.handle(
			mockReq({ method: "DELETE", url: "/api/external-annotations?source=eslint" }),
			res,
			new URL("http://localhost/api/external-annotations?source=eslint"),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).removed).toBeGreaterThanOrEqual(1);
	});

	test("DELETE without params clears all", async () => {
		// Add something first
		const addRes = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [planAnnotation({ blockId: "b-clear" })] }),
			}),
			addRes,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(addRes.statusCode).toBe(201);

		const res = mockRes();
		await handler.handle(
			mockReq({ method: "DELETE", url: "/api/external-annotations" }),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).removed).toBeGreaterThanOrEqual(1);
	});

	test("POST returns 400 for invalid body structure", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ bad: "structure" }),
			}),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(400);
	});

	test("POST returns 400 for missing source", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [{ text: "hello", type: "COMMENT" }] }),
			}),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(400);
	});

	test("POST returns 400 for missing text", async () => {
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [{ source: "x", type: "COMMENT" }] }),
			}),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(400);
	});

	test("SSE stream returns snapshot on connect", async () => {
		// Add an annotation first
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [planAnnotation({ blockId: "b-sse" })] }),
			}),
			mockRes(),
			new URL("http://localhost/api/external-annotations"),
		);

		const res = mockRes();
		await handler.handle(
			mockReq({ method: "GET", url: "/api/external-annotations/stream" }),
			res,
			new URL("http://localhost/api/external-annotations/stream"),
		);
		expect(res.statusCode).toBe(200);
		expect(res.headers["Content-Type"]).toBe("text/event-stream");
		expect(res.writes.length).toBeGreaterThan(0);
		expect(res.writes[0]).toContain("snapshot");
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

	test("addAnnotations (programmatic) returns ids", () => {
		const result = handler.addAnnotations({
			annotations: [planAnnotation({ blockId: "b-prog" })],
		});
		if ("ids" in result) {
			expect(result.ids).toHaveLength(1);
		} else {
			expect.unreachable("Expected ids");
		}
	});

	test("addAnnotations returns error for invalid input", () => {
		const result = handler.addAnnotations({ bad: "data" });
		if ("error" in result) {
			expect(result.error).toBeDefined();
		} else {
			expect.unreachable("Expected error");
		}
	});
});

describe("external annotations — review mode", () => {
	test("POST accepts review-mode annotations", async () => {
		const handler = createExternalAnnotationHandler("review");
		const res = mockRes();
		await handler.handle(
			mockReq({
				method: "POST",
				url: "/api/external-annotations",
				body: JSON.stringify({ annotations: [reviewAnnotation()] }),
			}),
			res,
			new URL("http://localhost/api/external-annotations"),
		);
		expect(res.statusCode).toBe(201);
	});
});
