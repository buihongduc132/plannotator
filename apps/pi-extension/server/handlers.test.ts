import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import { handleImageRequest, handleUploadRequest, handleDraftRequest, handleFavicon } from "./handlers";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Mock helpers ---

function mockReq(opts: { method: string; url: string; body?: string; headers?: Record<string, string> }): IncomingMessage {
	const body = opts.body ?? "";
	const readable = body ? Readable.from([body]) : Readable.from([]);
	return Object.assign(readable as unknown as IncomingMessage, {
		method: opts.method,
		url: opts.url,
		headers: opts.headers ?? {},
	});
}

function mockRes(): ServerResponse & {
	data: string | Buffer;
	statusCode: number;
	headers: Record<string, string>;
} {
	return {
		data: "" as string | Buffer,
		statusCode: 200,
		headers: {} as Record<string, string>,
		writeHead(status: number, headers?: Record<string, string>) {
			(this as any).statusCode = status;
			if (headers) Object.assign((this as any).headers, headers);
		},
		end(data?: string | Buffer) {
			(this as any).data = data ?? "";
		},
	} as unknown as ServerResponse & {
		data: string | Buffer;
		statusCode: number;
		headers: Record<string, string>;
	};
}

function parseData(res: ReturnType<typeof mockRes>) {
	return JSON.parse(res.data as string);
}

// --- handleImageRequest ---

describe("handleImageRequest", () => {
	test("returns 400 when path is missing", () => {
		const res = mockRes();
		handleImageRequest(res, new URL("http://localhost/api/image"));
		expect(res.statusCode).toBe(400);
		expect(res.data).toContain("Missing path");
	});

	test("returns 404 for non-existent image", () => {
		const res = mockRes();
		handleImageRequest(res, new URL("http://localhost/api/image?path=/nonexistent/image.png"));
		expect(res.statusCode).toBe(404);
		expect(res.data).toContain("not found");
	});

	test("returns 403 for non-image extension", () => {
		const res = mockRes();
		handleImageRequest(res, new URL("http://localhost/api/image?path=/etc/passwd"));
		expect(res.statusCode).toBe(403);
	});

	test("serves existing image file", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "plannotator-img-"));
		const imgPath = join(tmpDir, "test.png");
		writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes

		try {
			const res = mockRes();
			handleImageRequest(res, new URL(`http://localhost/api/image?path=${imgPath}`));
			expect(res.statusCode).toBe(200);
			expect(res.headers["Content-Type"]).toBe("image/png");
		} finally {
			rmSync(tmpDir, { recursive: true });
		}
	});

	test("resolves relative path with base param", () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "plannotator-img-"));
		const imgPath = join(tmpDir, "test.jpg");
		writeFileSync(imgPath, Buffer.from([0xff, 0xd8])); // JPEG magic bytes

		try {
			const res = mockRes();
			handleImageRequest(res, new URL(`http://localhost/api/image?path=test.jpg&base=${tmpDir}`));
			expect(res.statusCode).toBe(200);
			expect(res.headers["Content-Type"]).toBe("image/jpeg");
		} finally {
			rmSync(tmpDir, { recursive: true });
		}
	});
});

// --- handleFavicon ---

describe("handleFavicon", () => {
	test("sends SVG favicon with caching headers", () => {
		const res = mockRes();
		handleFavicon(res);
		expect(res.statusCode).toBe(200);
		expect(res.headers["Content-Type"]).toBe("image/svg+xml");
		expect(res.headers["Cache-Control"]).toContain("max-age=86400");
		expect(res.data).toContain("<svg");
	});
});

// --- handleDraftRequest ---

describe("handleDraftRequest", () => {
	const draftKey = "test-draft-" + Date.now();

	test("GET returns 404 when no draft exists", () => {
		const res = mockRes();
		handleDraftRequest(
			mockReq({ method: "GET", url: "/api/draft" }),
			res,
			draftKey + "-nonexistent",
		);
		expect(res.statusCode).toBe(404);
		expect(parseData(res).found).toBe(false);
	});

	test("POST saves draft and GET retrieves it", async () => {
		// Save
		const saveRes = mockRes();
		await handleDraftRequest(
			mockReq({
				method: "POST",
				url: "/api/draft",
				body: JSON.stringify({ feedback: "test feedback", annotations: [] }),
			}),
			saveRes,
			draftKey,
		);
		expect(saveRes.statusCode).toBe(200);
		expect(parseData(saveRes).ok).toBe(true);

		// Retrieve
		const getRes = mockRes();
		handleDraftRequest(
			mockReq({ method: "GET", url: "/api/draft" }),
			getRes,
			draftKey,
		);
		expect(getRes.statusCode).toBe(200);
		const data = parseData(getRes);
		expect(data.feedback).toBe("test feedback");

		// Cleanup
		const delRes = mockRes();
		handleDraftRequest(
			mockReq({ method: "DELETE", url: "/api/draft" }),
			delRes,
			draftKey,
		);
		expect(delRes.statusCode).toBe(200);
	});
});

// --- handleUploadRequest ---

describe("handleUploadRequest", () => {
	test("returns error for empty body", async () => {
		// Empty readable body -> toWebRequest creates empty stream -> formData() fails
		const readable = Readable.from([]);
		const nodeReq = Object.assign(readable as unknown as IncomingMessage, {
			method: "POST",
			url: "/api/upload",
			headers: { "content-type": "multipart/form-data" },
		});
		const res = mockRes();
		await handleUploadRequest(nodeReq, res);
		// Will be 400 (no file) or 500 (parse error)
		expect([400, 500]).toContain(res.statusCode);
	});
});
