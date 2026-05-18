import { afterEach, describe, expect, test } from "bun:test";
import { createServer as createNetServer } from "node:net";
import { startAnnotateServer } from "../server";

const servers: any[] = [];

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

async function startServer(opts: { sessionId?: string; gate?: boolean } = {}) {
	const port = await reservePort();
	const originalPort = process.env.PLANNOTATOR_PORT;
	process.env.PLANNOTATOR_PORT = String(port);
	const originalShare = process.env.PLANNOTATOR_SHARE;
	process.env.PLANNOTATOR_SHARE = "disabled";
	try {
		const server = await startAnnotateServer({
			markdown: "# Document to Annotate\n\nSome content here.",
			filePath: "/tmp/test-annotate.md",
			htmlContent: "<html>annotate</html>",
			origin: "test",
			sharingEnabled: false,
			sessionId: opts.sessionId,
			gate: opts.gate,
		});
		servers.push(server);
		return { server, port, cleanup: () => { process.env.PLANNOTATOR_PORT = originalPort; process.env.PLANNOTATOR_SHARE = originalShare; } };
	} catch (e) {
		process.env.PLANNOTATOR_PORT = originalPort;
		process.env.PLANNOTATOR_SHARE = originalShare;
		throw e;
	}
}

async function fetchFrom(server: any, path: string, opts?: { method?: string; body?: string }) {
	return fetch(`http://localhost:${server.port}${path}`, {
		method: opts?.method ?? "GET",
		body: opts?.body,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(async () => {
	for (const s of servers) { try { s.stop(); } catch {} }
	servers.length = 0;
});

describe("annotate server — HTTP integration", () => {
	test("GET /api/plan returns annotate mode", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/plan");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plan).toContain("Document to Annotate");
		expect(data.mode).toBe("annotate");
		expect(data.filePath).toBe("/tmp/test-annotate.md");
		expect(data.gate).toBe(false);
	});

	test("GET /api/plan includes gate=true when enabled", async () => {
		const { server } = await startServer({ gate: true });
		const res = await fetchFrom(server, "/api/plan");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.gate).toBe(true);
	});

	test("GET /api/sessions returns annotate session", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/sessions");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].mode).toBe("annotate");
	});

	test("POST /api/feedback resolves waitForDecision", async () => {
		const { server } = await startServer();
		const decisionPromise = server.waitForDecision();
		await fetchFrom(server, "/api/feedback", {
			method: "POST",
			body: JSON.stringify({ feedback: "Great doc!", annotations: [{ id: "1", text: "note" }] }),
		});
		const decision = await decisionPromise;
		expect(decision.feedback).toBe("Great doc!");
		expect(decision.annotations).toHaveLength(1);
	});

	test("POST /api/approve resolves waitForDecision with approved", async () => {
		const { server } = await startServer({ gate: true });
		const decisionPromise = server.waitForDecision();
		await fetchFrom(server, "/api/approve", { method: "POST" });
		const decision = await decisionPromise;
		expect(decision.approved).toBe(true);
	});

	test("POST /api/exit resolves waitForDecision with exit", async () => {
		const { server } = await startServer();
		const decisionPromise = server.waitForDecision();
		await fetchFrom(server, "/api/exit", { method: "POST" });
		const decision = await decisionPromise;
		expect(decision.exit).toBe(true);
	});

	test("GET /api/draft returns 404 when no draft", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/draft");
		expect(res.status).toBe(404);
	});

	test("GET / serves HTML content", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("annotate");
	});

	test("GET /favicon.svg returns SVG", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/favicon.svg");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("svg");
	});
});

describe("annotate server — session routing", () => {
	test("sessionId routes work correctly", async () => {
		const sid = "test-session-123";
		const { server } = await startServer({ sessionId: sid });
		// Valid session route
		const res = await fetchFrom(server, `/s/${sid}/api/plan`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessionId).toBe(sid);
	});

	test("wrong sessionId returns 403", async () => {
		const { server } = await startServer({ sessionId: "correct-session" });
		const res = await fetchFrom(server, "/s/wrong-session/api/plan");
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toContain("Session mismatch");
	});

	test("sessionId sessions endpoint works", async () => {
		const sid = "sess-456";
		const { server } = await startServer({ sessionId: sid });
		const res = await fetchFrom(server, `/s/${sid}/api/sessions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions[0].sessionId).toBe(sid);
	});
});
