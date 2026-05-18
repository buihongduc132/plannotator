import { describe, expect, test, afterEach } from "bun:test";
import { parseBody, json, html, send, requestUrl, toWebRequest } from "./helpers";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

// --- Helpers to create mock req/res ---

function mockReq(
	opts: Partial<{ method: string; url: string; headers: Record<string, string>; body?: string }>,
): IncomingMessage {
	const body = opts.body ?? "";
	const readable = body ? Readable.from([body]) : Readable.from([]);
	return Object.assign(readable as unknown as IncomingMessage, {
		method: opts.method ?? "GET",
		url: opts.url ?? "/",
		headers: opts.headers ?? {},
	});
}

function mockRes(): ServerResponse & {
	data: string | Buffer;
	statusCode: number;
	headers: Record<string, string>;
} {
	const res = {
		data: "" as string | Buffer,
		statusCode: 200,
		headers: {} as Record<string, string>,
		writeHead(status: number, headers?: Record<string, string>) {
			res.statusCode = status;
			if (headers) Object.assign(res.headers, headers);
		},
		end(data?: string | Buffer) {
			res.data = data ?? "";
		},
	} as unknown as ServerResponse & {
		data: string | Buffer;
		statusCode: number;
		headers: Record<string, string>;
	};
	return res;
}

// --- Tests ---

describe("parseBody", () => {
	test("parses valid JSON body", async () => {
		const req = mockReq({ method: "POST", body: '{"key":"value"}' });
		const result = await parseBody(req);
		expect(result).toEqual({ key: "value" });
	});

	test("returns empty object on invalid JSON", async () => {
		const req = mockReq({ method: "POST", body: "not json" });
		const result = await parseBody(req);
		expect(result).toEqual({});
	});

	test("returns empty object on empty body", async () => {
		const req = mockReq({ method: "POST", body: "" });
		const result = await parseBody(req);
		expect(result).toEqual({});
	});
});

describe("json", () => {
	test("sends JSON with default status 200", () => {
		const res = mockRes();
		json(res, { ok: true });
		expect(res.statusCode).toBe(200);
		expect(res.headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(res.data as string)).toEqual({ ok: true });
	});

	test("sends JSON with custom status", () => {
		const res = mockRes();
		json(res, { error: "bad" }, 400);
		expect(res.statusCode).toBe(400);
	});
});

describe("html", () => {
	test("sends HTML with content type", () => {
		const res = mockRes();
		html(res, "<h1>Hello</h1>");
		expect(res.statusCode).toBe(200);
		expect(res.headers["Content-Type"]).toBe("text/html");
		expect(res.data).toBe("<h1>Hello</h1>");
	});
});

describe("send", () => {
	test("sends string body with status and headers", () => {
		const res = mockRes();
		send(res, "hello", 200, { "Content-Type": "text/plain" });
		expect(res.statusCode).toBe(200);
		expect(res.headers["Content-Type"]).toBe("text/plain");
		expect(res.data).toBe("hello");
	});

	test("sends Buffer body", () => {
		const res = mockRes();
		const buf = Buffer.from("binary data");
		send(res, buf, 200);
		expect(res.data).toBe(buf);
	});

	test("uses default status 200 and empty headers", () => {
		const res = mockRes();
		send(res, "ok");
		expect(res.statusCode).toBe(200);
	});
});

describe("requestUrl", () => {
	test("constructs URL from request", () => {
		const req = mockReq({ url: "/api/test?foo=bar" });
		const url = requestUrl(req as IncomingMessage);
		expect(url.pathname).toBe("/api/test");
		expect(url.searchParams.get("foo")).toBe("bar");
	});

	test("defaults to / when url is undefined", () => {
		const req = mockReq({ url: undefined as unknown as string });
		const url = requestUrl(req as IncomingMessage);
		expect(url.pathname).toBe("/");
	});
});

describe("toWebRequest", () => {
	test("converts GET request with headers", async () => {
		const req = mockReq({
			method: "GET",
			url: "/api/test",
			headers: { "x-custom": "value" },
		});
		const webReq = toWebRequest(req as IncomingMessage);
		expect(webReq.method).toBe("GET");
		expect(webReq.headers.get("x-custom")).toBe("value");
		expect(webReq.url).toContain("/api/test");
	});

	test("converts POST request with body", async () => {
		const req = mockReq({
			method: "POST",
			url: "/api/test",
			body: '{"data":"test"}',
			headers: { "content-type": "application/json" },
		});
		const webReq = toWebRequest(req as IncomingMessage);
		expect(webReq.method).toBe("POST");
		const text = await webReq.text();
		expect(text).toBe('{"data":"test"}');
	});

	test("handles array header values", () => {
		const req = mockReq({
			method: "GET",
			headers: { "accept": ["text/html", "application/json"] } as unknown as Record<string, string>,
		});
		const webReq = toWebRequest(req as IncomingMessage);
		// Should not throw
		expect(webReq.method).toBe("GET");
	});
});
