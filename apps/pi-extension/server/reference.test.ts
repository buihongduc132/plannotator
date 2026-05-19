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

	test("returns 200 for code file (.ts) extension", async () => {
		const res = mockRes();
		const testPath = import.meta.path.replace(/\.test\.ts$/, ".ts");
		await handleDocRequest(res, new URL(`http://localhost/api/doc?path=${testPath}`));
		// .ts files are now recognized as code files and served with syntax highlighting
		expect(res.statusCode).toBe(200);
		const data = parseData(res);
		expect(data.codeFile).toBe(true);
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

describe("walkMarkdownFiles — recursive directory scanning", () => {
	const tmp = mkdtempSync(join(tmpdir(), "plannotator-ref-test-"));

	afterEach(() => {
		try { rmSync(tmp, { recursive: true }); } catch {}
	});

	test("returns tree with nested markdown files", () => {
		mkdirSync(join(tmp, "sub"), { recursive: true });
		writeFileSync(join(tmp, "root.md"), "# Root");
		writeFileSync(join(tmp, "sub", "nested.md"), "# Nested");
		writeFileSync(join(tmp, "sub", "ignore.txt"), "not md");

		const res = mockRes();
		handleFileBrowserRequest(res, new URL(`http://localhost/api/file-browser?dirPath=${tmp}`));
		expect(res.statusCode).toBe(200);
		const data = parseData(res);
		expect(data.tree).toBeDefined();
		// Should find both .md files
		const treeStr = JSON.stringify(data.tree);
		expect(treeStr).toContain("root.md");
		expect(treeStr).toContain("nested.md");
		expect(treeStr).not.toContain("ignore.txt");
	});

	test("returns tree with .mdx files", () => {
		mkdirSync(join(tmp, "docs"), { recursive: true });
		writeFileSync(join(tmp, "docs", "page.mdx"), "# MDX Page");

		const res = mockRes();
		handleFileBrowserRequest(res, new URL(`http://localhost/api/file-browser?dirPath=${tmp}`));
		expect(res.statusCode).toBe(200);
		const data = parseData(res);
		const treeStr = JSON.stringify(data.tree);
		expect(treeStr).toContain("page.mdx");
	});
});

describe("handleObsidianDocRequest — bare filename search", () => {
	const tmp = mkdtempSync(join(tmpdir(), "plannotator-vault-test-"));

	afterEach(() => {
		try { rmSync(tmp, { recursive: true }); } catch {}
	});

	test("finds file by bare filename within vault", () => {
		mkdirSync(join(tmp, "notes"), { recursive: true });
		writeFileSync(join(tmp, "notes", "journal.md"), "# Journal");

		const res = mockRes();
		handleObsidianDocRequest(res, new URL(`http://localhost/api/reference/obsidian/doc?vaultPath=${tmp}&path=journal.md`));
		expect(res.statusCode).toBe(200);
		expect(parseData(res).markdown).toBe("# Journal");
	});

	test("returns 400 for ambiguous bare filename", () => {
		mkdirSync(join(tmp, "a"), { recursive: true });
		mkdirSync(join(tmp, "b"), { recursive: true });
		writeFileSync(join(tmp, "a", "dup.md"), "# Dup A");
		writeFileSync(join(tmp, "b", "dup.md"), "# Dup B");

		const res = mockRes();
		handleObsidianDocRequest(res, new URL(`http://localhost/api/reference/obsidian/doc?vaultPath=${tmp}&path=dup.md`));
		expect(res.statusCode).toBe(400);
		expect(parseData(res).error).toContain("Ambiguous");
	});
});
