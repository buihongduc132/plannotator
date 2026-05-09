import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleDocRequest, handleObsidianVaultsRequest, handleObsidianFilesRequest, handleObsidianDocRequest, handleFileBrowserRequest } from "./reference";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Mock response ---

function mockRes(): ServerResponse & {
	data: string;
	statusCode: number;
	headers: Record<string, string>;
	ended: boolean;
} {
	const res = {
		data: "",
		statusCode: 200,
		headers: {} as Record<string, string>,
		ended: false,
		writeHead(status: number, headers?: Record<string, string>) {
			res.statusCode = status;
			if (headers) Object.assign(res.headers, headers);
		},
		end(data?: string) {
			res.data = data ?? "";
			res.ended = true;
		},
	} as unknown as ServerResponse & {
		data: string;
		statusCode: number;
		headers: Record<string, string>;
		ended: boolean;
	};
	return res;
}

function parseData(res: ReturnType<typeof mockRes>) {
	return JSON.parse(res.data);
}

// --- Tests ---

describe("handleDocRequest", () => {
	test("returns 400 when path parameter is missing", () => {
		const res = mockRes();
		handleDocRequest(res, new URL("http://localhost/api/doc"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Missing path");
	});

	test("returns 404 for non-existent file", () => {
		const res = mockRes();
		handleDocRequest(res, new URL("http://localhost/api/doc?path=/nonexistent/file.md"));
		expect(res.statusCode).toBe(404);
		expect(parseData(res).error).toContain("not found");
	});

	test("returns 404 for non-markdown file extension", () => {
		const res = mockRes();
		const testPath = import.meta.path.replace(/\.test\.ts$/, ".ts");
		handleDocRequest(res, new URL(`http://localhost/api/doc?path=${testPath}`));
		// .ts files are not recognized as markdown — resolveMarkdownFile won't find them
		expect(res.statusCode).toBe(404);
	});

	test("resolves markdown file via base directory", () => {
		const res = mockRes();
		// Create a temp .md file
		const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
		const { join } = require("node:path");
		const { tmpdir } = require("node:os");
		const tmp = mkdtempSync(join(tmpdir(), "plannotator-doc-test-"));
		writeFileSync(join(tmp, "test.md"), "# Hello");
		try {
			handleDocRequest(res, new URL(`http://localhost/api/doc?path=test.md&base=${tmp}`));
			expect(res.statusCode).toBe(200);
			expect(parseData(res).markdown).toBe("# Hello");
		} finally {
			rmSync(tmp, { recursive: true });
		}
	});
});

describe("handleObsidianVaultsRequest", () => {
	test("returns vaults array (may be empty)", () => {
		const res = mockRes();
		handleObsidianVaultsRequest(res);
		expect(res.statusCode).toBe(200);
		expect(parseData(res).vaults).toBeInstanceOf(Array);
	});
});

describe("handleObsidianFilesRequest", () => {
	test("returns 400 when vaultPath is missing", () => {
		const res = mockRes();
		handleObsidianFilesRequest(res, new URL("http://localhost/api/reference/obsidian/files"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("vaultPath");
	});

	test("returns 400 for invalid vault path", () => {
		const res = mockRes();
		handleObsidianFilesRequest(res, new URL("http://localhost/api/reference/obsidian/files?vaultPath=/nonexistent/path"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Invalid");
	});

	test("returns tree for valid directory", () => {
		const res = mockRes();
		// Use the pi-extension source directory as a test vault
		const dir = import.meta.dir;
		handleObsidianFilesRequest(res, new URL(`http://localhost/api/reference/obsidian/files?vaultPath=${dir}`));
		expect(res.statusCode).toBe(200);
		const data = parseData(res);
		expect(data.tree).toBeDefined();
	});
});

describe("handleObsidianDocRequest", () => {
	test("returns 400 when vaultPath or path is missing", () => {
		const res = mockRes();
		handleObsidianDocRequest(res, new URL("http://localhost/api/reference/obsidian/doc?vaultPath=/tmp"));
		expect(res.statusCode).toBe(400);
	});

	test("returns 400 for non-markdown file", () => {
		const res = mockRes();
		handleObsidianDocRequest(res, new URL("http://localhost/api/reference/obsidian/doc?vaultPath=/tmp&path=file.txt"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("markdown");
	});

	test("returns 403 for path outside vault", () => {
		const res = mockRes();
		handleObsidianDocRequest(res, new URL("http://localhost/api/reference/obsidian/doc?vaultPath=/tmp&path=../../etc/passwd.md"));
		expect(res.statusCode).toBe(403);
		expect(parseData(res).error).toContain("outside vault");
	});

	test("returns 404 for non-existent file in vault", () => {
		const res = mockRes();
		const dir = import.meta.dir;
		handleObsidianDocRequest(res, new URL(`http://localhost/api/reference/obsidian/doc?vaultPath=${dir}&path=nonexistent-file.md`));
		expect(res.statusCode).toBe(404);
	});
});

describe("handleFileBrowserRequest", () => {
	test("returns 400 when dirPath is missing", () => {
		const res = mockRes();
		handleFileBrowserRequest(res, new URL("http://localhost/api/file-browser"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("dirPath");
	});

	test("returns 400 for invalid directory", () => {
		const res = mockRes();
		handleFileBrowserRequest(res, new URL("http://localhost/api/file-browser?dirPath=/nonexistent/path"));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Invalid");
	});

	test("returns tree for valid directory", () => {
		const res = mockRes();
		const dir = import.meta.dir;
		handleFileBrowserRequest(res, new URL(`http://localhost/api/file-browser?dirPath=${dir}`));
		expect(res.statusCode).toBe(200);
		const data = parseData(res);
		expect(data.tree).toBeDefined();
	});
});
