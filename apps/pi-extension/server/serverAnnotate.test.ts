import { describe, expect, test, afterEach } from "bun:test";
import { createServer as createNetServer } from "node:net";
import { startAnnotateServer } from "./serverAnnotate";

const HTML_CONTENT = "<!DOCTYPE html><html><body>annotate</body></html>";

const servers: any[] = [];

const originalPort = process.env.PLANNOTATOR_PORT;
const originalRemote = process.env.PLANNOTATOR_REMOTE;

function reservePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createNetServer();
		srv.once("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address();
			if (!addr || typeof addr === "string") { srv.close(); reject(new Error("no port")); return; }
			const { port } = addr;
			srv.close((e) => (e ? reject(e) : resolve(port)));
		});
	});
}

afterEach(() => {
	for (const s of servers) { try { s.stop(); } catch {} }
	servers.length = 0;
	if (originalPort === undefined) delete process.env.PLANNOTATOR_PORT;
	else process.env.PLANNOTATOR_PORT = originalPort;
	if (originalRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
	else process.env.PLANNOTATOR_REMOTE = originalRemote;
});

async function startServer(opts: { sessionId?: string; cwd?: string; gate?: boolean; mode?: string; folderPath?: string; sourceInfo?: string } = {}) {
	const port = await reservePort();
	process.env.PLANNOTATOR_PORT = String(port);
	process.env.PLANNOTATOR_REMOTE = "false";
	const server = await startAnnotateServer({
		markdown: "# Test Document\n\nSome content to annotate.",
		filePath: "/tmp/test-annotate.md",
		htmlContent: HTML_CONTENT,
		origin: "pi",
		sessionId: opts.sessionId,
		cwd: opts.cwd,
		gate: opts.gate,
		mode: opts.mode,
		folderPath: opts.folderPath,
		sourceInfo: opts.sourceInfo,
	});
	servers.push(server);
	return server;
}

describe("annotate server integration", () => {
	test("GET /api/plan returns annotate mode payload", async () => {
		const server = await startServer({ sessionId: "test-session-123", cwd: "/tmp" });
		const res = await fetch(`${server.url}/api/plan`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.mode).toBe("annotate");
		expect(data.plan).toContain("Test Document");
		expect(data.filePath).toBe("/tmp/test-annotate.md");
		expect(data.sessionId).toBe("test-session-123");
		expect(data.gate).toBe(false);
	});

	test("GET /api/plan with gate mode", async () => {
		const server = await startServer({ gate: true });
		const res = await fetch(`${server.url}/api/plan`);
		const data = await res.json();
		expect(data.gate).toBe(true);
	});

	test("GET /api/sessions returns session listing", async () => {
		const server = await startServer({ sessionId: "test-session-123" });
		const res = await fetch(`${server.url}/api/sessions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].sessionId).toBe("test-session-123");
		expect(data.sessions[0].mode).toBe("annotate");
	});

	test("GET /s/WRONG-session-id/api/plan returns 403", async () => {
		const server = await startServer({ sessionId: "test-session-123" });
		const baseUrl = server.url.replace(/\/s\/.*$/, "");
		const res = await fetch(`${baseUrl}/s/wrong-session/api/plan`);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toContain("Session mismatch");
	});

	test("POST /api/approve resolves decision with approved=true", async () => {
		const server = await startServer();
		const decisionPromise = server.waitForDecision();
		const res = await fetch(`${server.url}/api/approve`, { method: "POST" });
		expect(res.status).toBe(200);
		const decision = await decisionPromise;
		expect(decision.approved).toBe(true);
	});

	test("POST /api/exit resolves decision with exit=true", async () => {
		const server = await startServer();
		const decisionPromise = server.waitForDecision();
		const res = await fetch(`${server.url}/api/exit`, { method: "POST" });
		expect(res.status).toBe(200);
		const decision = await decisionPromise;
		expect(decision.exit).toBe(true);
	});

	test("POST /api/feedback resolves decision with feedback content", async () => {
		const server = await startServer();
		const decisionPromise = server.waitForDecision();
		const res = await fetch(`${server.url}/api/feedback`, {
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
	});

	test("GET /api/image returns 400 without path", async () => {
		const server = await startServer();
		const res = await fetch(`${server.url}/api/image`);
		expect(res.status).toBe(400);
	});

	test("GET /favicon.svg returns SVG", async () => {
		const server = await startServer();
		const res = await fetch(`${server.url}/favicon.svg`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("svg");
	});

	test("GET unknown path returns HTML content", async () => {
		const server = await startServer();
		const res = await fetch(`${server.url}/some/random/path`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("annotate");
	});

	test("GET /api/plan without session returns no sessionId", async () => {
		const server = await startServer();
		const res = await fetch(`${server.url}/api/plan`);
		const data = await res.json();
		expect(data.sessionId).toBeUndefined();
	});
});
