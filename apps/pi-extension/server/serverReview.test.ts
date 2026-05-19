import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startReviewServer } from "./serverReview";

const HTML_CONTENT = "<!DOCTYPE html><html><body>review</body></html>";
const MOCK_PATCH = `diff --git a/test.txt b/test.txt
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/test.txt
@@ -0,0 +1 @@
+hello world`;

/** Helper to create a review server with random port (avoids 19432 conflicts). */
async function createTestServer(opts: Parameters<typeof startReviewServer>[0]) {
	const origPort = process.env.PLANNOTATOR_PORT;
	const origRemote = process.env.PLANNOTATOR_REMOTE;
	process.env.PLANNOTATOR_PORT = "0";
	process.env.PLANNOTATOR_REMOTE = "0";
	const server = await startReviewServer(opts);
	// Restore env after server is fully listening
	if (origPort === undefined) delete process.env.PLANNOTATOR_PORT;
	else process.env.PLANNOTATOR_PORT = origPort;
	if (origRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
	else process.env.PLANNOTATOR_REMOTE = origRemote;
	return server;
}

describe("review server integration", () => {
	let result: Awaited<ReturnType<typeof startReviewServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		result = await createTestServer({
			rawPatch: MOCK_PATCH,
			gitRef: "abc123",
			htmlContent: HTML_CONTENT,
			origin: "pi",
			diffType: "uncommitted",
			sessionId: "review-session-456",
			gitContext: {
				cwd: process.cwd(),
				defaultBranch: "main",
				currentBranch: "test-branch",
				remote: "origin",
				repoRoot: process.cwd(),
			},
		});
		baseUrl = `http://localhost:${result.port}`;
	}, 30000);

	afterAll(() => {
		result.stop();
	}, 10000);

	test("GET /api/diff returns patch and metadata", async () => {
		const res = await fetch(`${baseUrl}/api/diff`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.rawPatch).toBe(MOCK_PATCH);
		expect(data.origin).toBe("pi");
		expect(data.diffType).toBe("uncommitted");
		expect(data.sessionId).toBe("review-session-456");
		expect(data.base).toMatch(/main$/);
	});

	test("GET /api/sessions returns session listing", async () => {
		const res = await fetch(`${baseUrl}/api/sessions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].sessionId).toBe("review-session-456");
		expect(data.sessions[0].mode).toBe("review");
	});

	test("GET /s/WRONG-session-id/api/diff returns 403", async () => {
		const res = await fetch(`${baseUrl}/s/wrong-session/api/diff`);
		expect(res.status).toBe(403);
	});

	test("POST /api/feedback resolves decision with approved=false by default", async () => {
		const server = await createTestServer({
			rawPatch: MOCK_PATCH,
			gitRef: "abc",
			htmlContent: HTML_CONTENT,
		});
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`http://localhost:${server.port}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					feedback: "Needs changes",
					annotations: [],
				}),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(false);
			expect(decision.feedback).toBe("Needs changes");
		} finally {
			server.stop();
		}
	}, 30000);

	test("POST /api/feedback with approved=true resolves approved", async () => {
		const server = await createTestServer({
			rawPatch: MOCK_PATCH,
			gitRef: "abc",
			htmlContent: HTML_CONTENT,
		});
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`http://localhost:${server.port}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					approved: true,
					feedback: "LGTM",
				}),
			});
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
		} finally {
			server.stop();
		}
	}, 30000);

	test("POST /api/exit resolves decision with exit=true", async () => {
		const server = await createTestServer({
			rawPatch: MOCK_PATCH,
			gitRef: "abc",
			htmlContent: HTML_CONTENT,
		});
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`http://localhost:${server.port}/api/exit`, { method: "POST" });
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.exit).toBe(true);
		} finally {
			server.stop();
		}
	}, 30000);

	test("GET /api/image returns 400 without path", async () => {
		const res = await fetch(`${baseUrl}/api/image`);
		expect(res.status).toBe(400);
	});

	test("GET /favicon.svg returns SVG", async () => {
		const res = await fetch(`${baseUrl}/favicon.svg`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("svg");
	});

	test("GET /api/agents returns empty agents list", async () => {
		const res = await fetch(`${baseUrl}/api/agents`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.agents).toEqual([]);
	});

	test("GET /api/agents/capabilities returns providers", async () => {
		const res = await fetch(`${baseUrl}/api/agents/capabilities`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.mode).toBe("review");
		expect(data.providers).toBeInstanceOf(Array);
	});

	test("GET /api/file-content returns 400 without path", async () => {
		const res = await fetch(`${baseUrl}/api/file-content`);
		expect(res.status).toBe(400);
	});

	test("GET unknown path returns HTML content", async () => {
		const res = await fetch(`${baseUrl}/some/random/path`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("review");
	});

	test("GET /api/diff with error option includes error field", async () => {
		const server = await createTestServer({
			rawPatch: "",
			gitRef: "",
			htmlContent: HTML_CONTENT,
			error: "git diff failed",
		});
		try {
			const res = await fetch(`http://localhost:${server.port}/api/diff`);
			const data = await res.json();
			expect(data.error).toBe("git diff failed");
		} finally {
			server.stop();
		}
	}, 30000);

	test("initialBase overrides gitContext.defaultBranch", async () => {
		const server = await createTestServer({
			rawPatch: MOCK_PATCH,
			gitRef: "abc",
			htmlContent: HTML_CONTENT,
			gitContext: {
				cwd: process.cwd(),
				defaultBranch: "main",
				currentBranch: "test",
				remote: "origin",
				repoRoot: process.cwd(),
			},
			initialBase: "develop",
		});
		try {
			const res = await fetch(`http://localhost:${server.port}/api/diff`);
			const data = await res.json();
			expect(data.base).toBe("develop");
		} finally {
			server.stop();
		}
	}, 30000);

	test("POST /api/git-add returns 400 for missing filePath", async () => {
		const res = await fetch(`${baseUrl}/api/git-add`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/pr-context returns 400 when not in PR mode", async () => {
		const res = await fetch(`${baseUrl}/api/pr-context`);
		expect(res.status).toBe(400);
	});

	test("POST /api/pr-action returns 400 when not in PR mode", async () => {
		const res = await fetch(`${baseUrl}/api/pr-action`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "approve", body: "LGTM" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/feedback with agentSwitch includes it in decision", async () => {
		const server = await createTestServer({
			rawPatch: MOCK_PATCH,
			gitRef: "abc",
			htmlContent: HTML_CONTENT,
		});
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`http://localhost:${server.port}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					feedback: "switch",
					agentSwitch: "opencode",
				}),
			});
			const decision = await decisionPromise;
			expect(decision.agentSwitch).toBe("opencode");
		} finally {
			server.stop();
		}
	}, 30000);
});
