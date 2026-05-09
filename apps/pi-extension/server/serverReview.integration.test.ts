import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startReviewServer } from "../server";

let server: Awaited<ReturnType<typeof startReviewServer>> | null = null;

async function fetchFrom(path: string, opts?: { method?: string; body?: string }) {
	if (!server) throw new Error("server not started");
	return fetch(`http://localhost:${server.port}${path}`, {
		method: opts?.method ?? "GET",
		body: opts?.body,
		headers: { "Content-Type": "application/json" },
	});
}

beforeAll(async () => {
	const originalPort = process.env.PLANNOTATOR_PORT;
	const originalRemote = process.env.PLANNOTATOR_REMOTE;
	const originalShare = process.env.PLANNOTATOR_SHARE;
	process.env.PLANNOTATOR_PORT = "0";
	process.env.PLANNOTATOR_REMOTE = "0";
	process.env.PLANNOTATOR_SHARE = "disabled";
	try {
		server = await startReviewServer({
			rawPatch: "diff --git a/test.txt b/test.txt\n--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-old\n\\+new\n",
			gitRef: "main",
			htmlContent: "<html>review</html>",
			origin: "test",
			sharingEnabled: false,
		});
	} finally {
		process.env.PLANNOTATOR_PORT = originalPort;
		process.env.PLANNOTATOR_REMOTE = originalRemote;
		process.env.PLANNOTATOR_SHARE = originalShare;
	}
}, 30_000);

afterAll(() => {
	if (server) { try { server.stop(); } catch {} server = null; }
});

describe("review server — HTTP integration (shared server)", () => {
	test("GET /api/diff returns diff data", async () => {
		const res = await fetchFrom("/api/diff");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.rawPatch).toContain("diff --git");
		expect(data.gitRef).toBe("main");
		expect(data.origin).toBe("test");
		expect(data.sharingEnabled).toBe(false);
		expect(data.serverConfig).toBeDefined();
	});

	test("GET /api/sessions returns review session", async () => {
		const res = await fetchFrom("/api/sessions");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].mode).toBe("review");
		expect(data.sessions[0].origin).toBe("test");
	});

	test("GET /api/agents returns empty list", async () => {
		const res = await fetchFrom("/api/agents");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.agents).toEqual([]);
	});

	test("GET /api/agents/capabilities returns providers", async () => {
		const res = await fetchFrom("/api/agents/capabilities");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.mode).toBe("review");
		expect(data.providers).toBeInstanceOf(Array);
	});

	test("GET /api/agents/jobs returns empty initially", async () => {
		const res = await fetchFrom("/api/agents/jobs");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.jobs).toEqual([]);
	});

	test("DELETE /api/agents/jobs kills all (empty)", async () => {
		const res = await fetchFrom("/api/agents/jobs", { method: "DELETE" });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.killed).toBe(0);
	});

	test("GET /api/image returns 400 without path", async () => {
		const res = await fetchFrom("/api/image");
		expect(res.status).toBe(400);
	});

	test("GET /favicon.svg returns SVG", async () => {
		const res = await fetchFrom("/favicon.svg");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("svg");
	});

	test("GET /api/draft returns 404 when no draft", async () => {
		const res = await fetchFrom("/api/draft");
		expect(res.status).toBe(404);
	});

	test("GET /api/editor-annotations returns empty array", async () => {
		const res = await fetchFrom("/api/editor-annotations");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.annotations).toEqual([]);
	});

	test("GET /api/external-annotations returns empty snapshot", async () => {
		const res = await fetchFrom("/api/external-annotations");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.annotations).toEqual([]);
	});

	test("GET /api/file-content returns 400 without path", async () => {
		const res = await fetchFrom("/api/file-content");
		expect(res.status).toBe(400);
	});

	test("POST /api/git-add returns 400 without filePath", async () => {
		const res = await fetchFrom("/api/git-add", {
			method: "POST",
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/config saves config", async () => {
		const res = await fetchFrom("/api/config", {
			method: "POST",
			body: JSON.stringify({ displayName: "Test Reviewer" }),
		});
		expect(res.status).toBe(200);
	});

	test("GET / serves HTML content", async () => {
		const res = await fetchFrom("/");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("review");
	});

	test("POST /api/feedback resolves waitForDecision", async () => {
		// Need a fresh server for this test since decision is one-shot
		const originalPort = process.env.PLANNOTATOR_PORT;
		const originalRemote = process.env.PLANNOTATOR_REMOTE;
		const originalShare = process.env.PLANNOTATOR_SHARE;
		process.env.PLANNOTATOR_PORT = "0";
		process.env.PLANNOTATOR_REMOTE = "0";
		process.env.PLANNOTATOR_SHARE = "disabled";
		try {
			const s = await startReviewServer({
				rawPatch: "test",
				gitRef: "main",
				htmlContent: "<html>test</html>",
				sharingEnabled: false,
			});
			const decisionPromise = s.waitForDecision();
			const res = await fetch(`http://localhost:${s.port}/api/feedback`, {
				method: "POST",
				body: JSON.stringify({ approved: true, feedback: "LGTM", annotations: [] }),
				headers: { "Content-Type": "application/json" },
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
			expect(decision.feedback).toBe("LGTM");
			s.stop();
		} finally {
			process.env.PLANNOTATOR_PORT = originalPort;
			process.env.PLANNOTATOR_REMOTE = originalRemote;
			process.env.PLANNOTATOR_SHARE = originalShare;
		}
	}, 30_000);

	test("POST /api/exit resolves with exit=true", async () => {
		const originalPort = process.env.PLANNOTATOR_PORT;
		const originalRemote = process.env.PLANNOTATOR_REMOTE;
		const originalShare = process.env.PLANNOTATOR_SHARE;
		process.env.PLANNOTATOR_PORT = "0";
		process.env.PLANNOTATOR_REMOTE = "0";
		process.env.PLANNOTATOR_SHARE = "disabled";
		try {
			const s = await startReviewServer({
				rawPatch: "test",
				gitRef: "main",
				htmlContent: "<html>test</html>",
				sharingEnabled: false,
			});
			const decisionPromise = s.waitForDecision();
			const res = await fetch(`http://localhost:${s.port}/api/exit`, { method: "POST" });
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.exit).toBe(true);
			s.stop();
		} finally {
			process.env.PLANNOTATOR_PORT = originalPort;
			process.env.PLANNOTATOR_REMOTE = originalRemote;
			process.env.PLANNOTATOR_SHARE = originalShare;
		}
	}, 30_000);
});
