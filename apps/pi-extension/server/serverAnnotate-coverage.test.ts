import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startAnnotateServer } from "./serverAnnotate";

const HTML = "<!DOCTYPE html><html><body>ann</body></html>";

describe("annotate server — coverage expansion", () => {
	let server: Awaited<ReturnType<typeof startAnnotateServer>>;
	let url: string;

	beforeAll(async () => {
		server = await startAnnotateServer({
			markdown: "# Test\n\nContent",
			filePath: "/tmp/test.md",
			htmlContent: HTML,
			origin: "pi",
			sessionId: "cov-session",
			cwd: "/tmp",
		});
		url = `http://localhost:${server.port}`;
	});

	afterAll(() => server.stop());

	test("POST /api/config saves config", async () => {
		const res = await fetch(`${url}/api/config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayName: "Coverage User" }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);
	});

	test("GET /api/doc returns 400 without path", async () => {
		const res = await fetch(`${url}/api/doc`);
		expect(res.status).toBe(400);
	});

	test("GET /api/obsidian/vaults returns array", async () => {
		const res = await fetch(`${url}/api/obsidian/vaults`);
		expect(res.status).toBe(200);
		expect((await res.json()).vaults).toBeInstanceOf(Array);
	});

	test("GET /api/reference/files returns 400 without dirPath", async () => {
		const res = await fetch(`${url}/api/reference/files`);
		expect(res.status).toBe(400);
	});

	test("GET /api/external-annotations returns snapshot", async () => {
		const res = await fetch(`${url}/api/external-annotations`);
		expect(res.status).toBe(200);
		expect((await res.json()).annotations).toBeInstanceOf(Array);
	});

	test("POST /api/feedback with invalid JSON still resolves", async () => {
		const s = await startAnnotateServer({
			markdown: "# Bad Body",
			filePath: "/tmp/bad.md",
			htmlContent: HTML,
		});
		try {
			const p = s.waitForDecision();
			const res = await fetch(`http://localhost:${s.port}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not-json{{",
			});
			// Server returns 200 with empty feedback or 500 — either way, no hang
			expect([200, 500]).toContain(res.status);
		} finally {
			s.stop();
		}
	});

	test("annotate with folder mode sets mode=annotate-folder", async () => {
		const s = await startAnnotateServer({
			markdown: "",
			filePath: "/tmp/folder",
			htmlContent: HTML,
			mode: "annotate-folder",
			folderPath: "/tmp/folder",
		});
		try {
			const res = await fetch(`http://localhost:${s.port}/api/plan`);
			const data = await res.json();
			expect(data.mode).toBe("annotate-folder");
		} finally {
			s.stop();
		}
	});

	test("annotate with sourceInfo includes it in response", async () => {
		const s = await startAnnotateServer({
			markdown: "# Source",
			filePath: "/tmp/src.html",
			htmlContent: HTML,
			sourceInfo: "src.html",
		});
		try {
			const res = await fetch(`http://localhost:${s.port}/api/plan`);
			const data = await res.json();
			expect(data.sourceInfo).toBe("src.html");
		} finally {
			s.stop();
		}
	});

	test("GET /s/ with session but matching session serves normally", async () => {
		const res = await fetch(`${url}/s/cov-session/api/plan`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plan).toContain("Test");
	});
});
