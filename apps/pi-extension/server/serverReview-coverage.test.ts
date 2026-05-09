import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startReviewServer } from "./serverReview";

const HTML = "<!DOCTYPE html><html><body>review</body></html>";
const PATCH = `diff --git a/a.txt b/a.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/a.txt
@@ -0,0 +1 @@
+hello`;

describe("review server — coverage expansion", () => {
	let server: Awaited<ReturnType<typeof startReviewServer>>;
	let url: string;

	beforeAll(async () => {
		server = await startReviewServer({
			rawPatch: PATCH,
			gitRef: "abc123",
			htmlContent: HTML,
			origin: "pi",
			diffType: "uncommitted",
			gitContext: {
				cwd: process.cwd(),
				defaultBranch: "main",
				currentBranch: "test",
				remote: "origin",
				repoRoot: process.cwd(),
			},
		});
		url = `http://localhost:${server.port}`;
	}, 30000);

	afterAll(() => server.stop());

	test("POST /api/config saves config", async () => {
		const res = await fetch(`${url}/api/config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ diffOptions: { context: 5 } }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);
	});

	test("GET /api/diff/switch returns 400 without diffType", async () => {
		const res = await fetch(`${url}/api/diff/switch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("GET /api/file-content returns 400 for invalid path", async () => {
		const res = await fetch(`${url}/api/file-content?path=../../../etc/passwd`);
		expect(res.status).toBe(400);
	});

	test("GET /api/agents/jobs returns empty jobs", async () => {
		const res = await fetch(`${url}/api/agents/jobs`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.jobs).toEqual([]);
	});

	test("DELETE /api/agents/jobs kills all", async () => {
		const res = await fetch(`${url}/api/agents/jobs`, { method: "DELETE" });
		expect(res.status).toBe(200);
		expect((await res.json()).killed).toBe(0);
	});

	test("GET /api/external-annotations returns snapshot", async () => {
		const res = await fetch(`${url}/api/external-annotations`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.annotations).toBeInstanceOf(Array);
	});

	test("GET /api/editor-annotations returns empty array", async () => {
		const res = await fetch(`${url}/api/editor-annotations`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.annotations).toEqual([]);
	});

	test("GET /api/pr-context returns 400 when not in PR mode", async () => {
		const res = await fetch(`${url}/api/pr-context`);
		expect(res.status).toBe(400);
	});

	test("POST /api/pr-action returns 400 when not in PR mode", async () => {
		const res = await fetch(`${url}/api/pr-action`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "approve", body: "LGTM" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/pr-viewed returns 400 when not in PR mode", async () => {
		const res = await fetch(`${url}/api/pr-viewed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ filePaths: ["a.ts"], viewed: true }),
		});
		expect(res.status).toBe(400);
	});

	test("GET /api/draft returns 404 when no draft exists", async () => {
		const res = await fetch(`${url}/api/draft`);
		expect(res.status).toBe(404);
	});

	test("GET /api/file-content returns 400 without path param", async () => {
		const res = await fetch(`${url}/api/file-content`);
		expect(res.status).toBe(400);
	});

	test("POST /api/git-add returns 400 for missing filePath", async () => {
		const res = await fetch(`${url}/api/git-add`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});
});
