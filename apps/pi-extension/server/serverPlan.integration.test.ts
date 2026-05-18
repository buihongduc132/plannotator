import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlanReviewServer } from "../server";

const tempDirs: string[] = [];
const servers: ReturnType<typeof startPlanReviewServer extends () => Promise<infer T> ? [T] : never> = [] as any;

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

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

async function startServer(opts: { plan?: string; mode?: "archive" } = {}) {
	const port = await reservePort();
	const originalPort = process.env.PLANNOTATOR_PORT;
	process.env.PLANNOTATOR_PORT = String(port);
	const originalShare = process.env.PLANNOTATOR_SHARE;
	process.env.PLANNOTATOR_SHARE = "disabled";
	try {
		const server = await startPlanReviewServer({
			plan: opts.plan ?? "# Test Plan\n\nBody text",
			htmlContent: "<html>test</html>",
			origin: "test",
			sharingEnabled: false,
			...(opts.mode && { mode: opts.mode }),
		});
		(servers as any[]).push(server);
		return { server, port, cleanup: () => { process.env.PLANNOTATOR_PORT = originalPort; process.env.PLANNOTATOR_SHARE = originalShare; } };
	} catch (e) {
		process.env.PLANNOTATOR_PORT = originalPort;
		process.env.PLANNOTATOR_SHARE = originalShare;
		throw e;
	}
}

async function fetchFrom(server: Awaited<ReturnType<typeof startPlanReviewServer>>, path: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }) {
	const url = `http://localhost:${server.port}${path}`;
	return fetch(url, {
		method: opts?.method ?? "GET",
		body: opts?.body,
		headers: { "Content-Type": "application/json", ...opts?.headers },
	});
}

afterEach(async () => {
	for (const s of servers as any[]) {
		try { s.stop(); } catch {}
	}
	(servers as any[]).length = 0;
	for (const dir of tempDirs) {
		try { rmSync(dir, { recursive: true }); } catch {}
	}
	tempDirs.length = 0;
});

describe("plan server — HTTP integration", () => {
	test("GET /api/plan returns plan with metadata", async () => {
		const { server } = await startServer({ plan: "# My Plan\n\nContent here" });
		const res = await fetchFrom(server, "/api/plan");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plan).toContain("My Plan");
		expect(data.origin).toBe("test");
		expect(data.sharingEnabled).toBe(false);
		expect(data.versionInfo).toBeDefined();
		expect(data.repoInfo).toBeDefined();
		expect(data.serverConfig).toBeDefined();
	});

	test("GET /api/sessions returns current session", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/sessions");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].sessionId).toBe(server.reviewId);
		expect(data.sessions[0].mode).toBe("plan");
		expect(data.count).toBe(1);
	});

	test("POST /api/sessions creates a new session", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/sessions", {
			method: "POST",
			body: JSON.stringify({ plan: "# New Session Plan\n\nDetails", name: "test-session" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessionId).toBeDefined();
		expect(data.plan).toContain("New Session Plan");
		expect(data.name).toBe("test-session");
	});

	test("POST /api/sessions returns 400 without plan", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/sessions", {
			method: "POST",
			body: JSON.stringify({ name: "no-plan" }),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain("plan is required");
	});

	test("GET /api/decision returns pending when no decision", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/decision");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.pending).toBe(true);
	});

	test("GET /api/decision returns result after approve", async () => {
		const { server } = await startServer();
		// Approve first
		await fetchFrom(server, "/api/approve", {
			method: "POST",
			body: JSON.stringify({ feedback: "looks good" }),
		});
		const res = await fetchFrom(server, "/api/decision");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.approved).toBe(true);
		expect(data.feedback).toBe("looks good");
	});

	test("GET /api/decision/stream SSE receives connected event", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/decision/stream");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		// Read first chunk then cancel
		const reader = res.body!.getReader();
		const { value } = await reader.read();
		reader.cancel();
		const text = new TextDecoder().decode(value);
		expect(text).toContain("event: connected");
	});

	test("GET /api/decision/stream SSE receives decision after approve", async () => {
		const { server } = await startServer();
		// Approve
		await fetchFrom(server, "/api/approve", {
			method: "POST",
			body: JSON.stringify({ feedback: "approved!" }),
		});
		// Connect to SSE — should immediately receive the decision
		const res = await fetchFrom(server, "/api/decision/stream");
		const text = await res.text();
		expect(text).toContain("event: decision");
		expect(text).toContain("approved");
	});

	test("POST /api/approve resolves waitForDecision", async () => {
		const { server } = await startServer();
		const decisionPromise = server.waitForDecision();
		await fetchFrom(server, "/api/approve", {
			method: "POST",
			body: JSON.stringify({ feedback: "LGTM", agentSwitch: "opencode" }),
		});
		const decision = await decisionPromise;
		expect(decision.approved).toBe(true);
		expect(decision.feedback).toBe("LGTM");
		expect(decision.agentSwitch).toBe("opencode");
	});

	test("POST /api/deny resolves waitForDecision with rejected", async () => {
		const { server } = await startServer();
		const decisionPromise = server.waitForDecision();
		await fetchFrom(server, "/api/deny", {
			method: "POST",
			body: JSON.stringify({ feedback: "needs work" }),
		});
		const decision = await decisionPromise;
		expect(decision.approved).toBe(false);
		expect(decision.feedback).toBe("needs work");
	});

	test("POST /api/approve returns duplicate on second call", async () => {
		const { server } = await startServer();
		await fetchFrom(server, "/api/approve", { method: "POST", body: "{}" });
		const res = await fetchFrom(server, "/api/approve", { method: "POST", body: "{}" });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.duplicate).toBe(true);
	});

	test("POST /api/deny returns duplicate on second call", async () => {
		const { server } = await startServer();
		await fetchFrom(server, "/api/deny", { method: "POST", body: "{}" });
		const res = await fetchFrom(server, "/api/deny", { method: "POST", body: "{}" });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.duplicate).toBe(true);
	});

	test("onDecision listener fires on approve", async () => {
		const { server } = await startServer();
		let captured: any = null;
		server.onDecision((d) => { captured = d; });
		await fetchFrom(server, "/api/approve", {
			method: "POST",
			body: JSON.stringify({ feedback: "from-listener-test" }),
		});
		// Give microtasks a chance
		await new Promise((r) => setTimeout(r, 50));
		expect(captured).not.toBeNull();
		expect(captured.approved).toBe(true);
		expect(captured.feedback).toBe("from-listener-test");
	});

	test("GET /api/plan/versions returns version list", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/plan/versions");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.versions).toBeInstanceOf(Array);
	});

	test("GET /api/plan/version returns version content", async () => {
		const { server } = await startServer({ plan: "# Versioned Plan\n\nv1 content" });
		const res = await fetchFrom(server, "/api/plan/version?v=1");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.version).toBe(1);
		expect(data.plan).toContain("Versioned Plan");
	});

	test("GET /api/plan/version returns 400 without v param", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/plan/version");
		expect(res.status).toBe(400);
	});

	test("GET /api/plan/version returns 400 for invalid version", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/plan/version?v=abc");
		expect(res.status).toBe(400);
	});

	test("GET /api/plan/version returns 404 for non-existent version", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/plan/version?v=999");
		expect(res.status).toBe(404);
	});

	test("GET /api/plans returns project plans list", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/plans");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plans).toBeInstanceOf(Array);
	});

	test("POST /api/config saves config", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/config", {
			method: "POST",
			body: JSON.stringify({ displayName: "Test User" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
	});

	test("GET /favicon.svg returns SVG", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/favicon.svg");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("svg");
	});

	test("GET / serves HTML content", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/");
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("<html>");
	});

	test("GET /api/agents returns empty list", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/agents");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.agents).toEqual([]);
	});

	test("GET /api/image returns 400 without path", async () => {
		const { server } = await startServer();
		const res = await fetchFrom(server, "/api/image");
		expect(res.status).toBe(400);
	});
});

describe("plan server — archive mode", () => {
	test("GET /api/plan returns archive mode", async () => {
		const { server } = await startServer({ mode: "archive" });
		const res = await fetchFrom(server, "/api/plan");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.mode).toBe("archive");
		expect(data.archivePlans).toBeDefined();
	});

	test("GET /api/archive/plans returns list", async () => {
		const { server } = await startServer({ mode: "archive" });
		const res = await fetchFrom(server, "/api/archive/plans");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plans).toBeInstanceOf(Array);
	});

	test("POST /api/done resolves waitForDone", async () => {
		const { server } = await startServer({ mode: "archive" });
		expect(server.waitForDone).toBeDefined();
		const donePromise = server.waitForDone!();
		await fetchFrom(server, "/api/done", { method: "POST" });
		await donePromise; // Should resolve
	});
});
