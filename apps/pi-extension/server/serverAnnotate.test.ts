import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startAnnotateServer } from "./serverAnnotate";
import type { Server } from "node:http";

const HTML_CONTENT = "<!DOCTYPE html><html><body>annotate</body></html>";

describe("annotate server integration", () => {
	let result: Awaited<ReturnType<typeof startAnnotateServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		result = await startAnnotateServer({
			markdown: "# Test Document\n\nSome content to annotate.",
			filePath: "/tmp/test-annotate.md",
			htmlContent: HTML_CONTENT,
			origin: "pi",
			sessionId: "test-session-123",
			cwd: "/tmp",
		});
		baseUrl = `http://localhost:${result.port}`;
	});

	afterAll(() => {
		result.stop();
	});

	test("GET /api/plan returns annotate mode payload", async () => {
		const res = await fetch(`${baseUrl}/api/plan`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.mode).toBe("annotate");
		expect(data.plan).toContain("Test Document");
		expect(data.filePath).toBe("/tmp/test-annotate.md");
		expect(data.sessionId).toBe("test-session-123");
		expect(data.gate).toBe(false);
	});

	test("GET /api/plan with gate mode", async () => {
		const gated = await startAnnotateServer({
			markdown: "# Gated Doc",
			filePath: "/tmp/gated.md",
			htmlContent: HTML_CONTENT,
			gate: true,
		});
		try {
			const res = await fetch(`http://localhost:${gated.port}/api/plan`);
			const data = await res.json();
			expect(data.gate).toBe(true);
		} finally {
			gated.stop();
		}
	});

	test("GET /api/sessions returns session listing", async () => {
		const res = await fetch(`${baseUrl}/api/sessions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].sessionId).toBe("test-session-123");
		expect(data.sessions[0].mode).toBe("annotate");
	});

	test("GET /s/WRONG-session-id/api/plan returns 403", async () => {
		const res = await fetch(`${baseUrl}/s/wrong-session/api/plan`);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toContain("Session mismatch");
	});

	test("POST /api/approve resolves decision with approved=true", async () => {
		const server = await startAnnotateServer({
			markdown: "# Approve Test",
			filePath: "/tmp/approve-test.md",
			htmlContent: HTML_CONTENT,
		});
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`http://localhost:${server.port}/api/approve`, { method: "POST" });
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("POST /api/exit resolves decision with exit=true", async () => {
		const server = await startAnnotateServer({
			markdown: "# Exit Test",
			filePath: "/tmp/exit-test.md",
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
	});

	test("POST /api/feedback resolves decision with feedback content", async () => {
		const server = await startAnnotateServer({
			markdown: "# Feedback Test",
			filePath: "/tmp/feedback-test.md",
			htmlContent: HTML_CONTENT,
		});
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`http://localhost:${server.port}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					feedback: "This needs work",
					annotations: [{ id: "1", type: "COMMENT", text: "fix this" }],
				}),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.feedback).toBe("This needs work");
			expect(decision.annotations).toHaveLength(1);
		} finally {
			server.stop();
		}
	});

	test("GET /api/image returns 400 without path", async () => {
		const res = await fetch(`${baseUrl}/api/image`);
		expect(res.status).toBe(400);
	});

	test("GET /favicon.svg returns SVG", async () => {
		const res = await fetch(`${baseUrl}/favicon.svg`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("svg");
	});

	test("GET unknown path returns HTML content", async () => {
		const res = await fetch(`${baseUrl}/some/random/path`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("annotate");
	});

	test("GET /api/plan without session returns no sessionId", async () => {
		const server = await startAnnotateServer({
			markdown: "# No Session",
			filePath: "/tmp/no-session.md",
			htmlContent: HTML_CONTENT,
		});
		try {
			const res = await fetch(`http://localhost:${server.port}/api/plan`);
			const data = await res.json();
			expect(data.sessionId).toBeUndefined();
		} finally {
			server.stop();
		}
	});
});
