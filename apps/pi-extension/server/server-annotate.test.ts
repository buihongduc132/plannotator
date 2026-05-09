/**
 * Integration tests for serverAnnotate.ts HTTP endpoints.
 * Uses real HTTP servers with reserved ports.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalPort = process.env.PLANNOTATOR_PORT;
const originalRemote = process.env.PLANNOTATOR_REMOTE;
const originalCwd = process.cwd();

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function reservePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createNetServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to reserve test port"));
				return;
			}
			const { port } = address;
			server.close((error) => {
				if (error) { reject(error); return; }
				resolve(port);
			});
		});
	});
}

afterEach(() => {
	process.chdir(originalCwd);
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (originalPort === undefined) delete process.env.PLANNOTATOR_PORT;
	else process.env.PLANNOTATOR_PORT = originalPort;
	if (originalRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
	else process.env.PLANNOTATOR_REMOTE = originalRemote;
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function startAnnotateServer(opts: { sessionId?: string; gate?: boolean } = {}) {
	const { startAnnotateServer: start } = await import("../server");
	const homeDir = makeTempDir("plannotator-annotate-home-");
	const mdFile = join(homeDir, "test.md");
	writeFileSync(mdFile, "# Test Document\n\nSome content to annotate.");

	process.env.HOME = homeDir;
	process.env.PLANNOTATOR_REMOTE = "false";
	process.env.PLANNOTATOR_PORT = String(await reservePort());

	const server = await start({
		markdown: "# Test Document\n\nSome content to annotate.",
		filePath: mdFile,
		htmlContent: "<!doctype html><html><body>annotate</body></html>",
		origin: "pi",
		sessionId: opts.sessionId,
		gate: opts.gate,
	});
	return server;
}

// --- Tests ---

describe("Annotate server — /api/plan", () => {
	test("returns annotate mode with filePath", async () => {
		const server = await startAnnotateServer();
		try {
			const res = await fetch(`${server.url}/api/plan`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.plan).toContain("Test Document");
			expect(data.mode).toBe("annotate");
			expect(data.filePath).toBeTruthy();
			expect(data.gate).toBe(false);
		} finally { server.stop(); }
	});

	test("includes gate flag when enabled", async () => {
		const server = await startAnnotateServer({ gate: true });
		try {
			const res = await fetch(`${server.url}/api/plan`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.gate).toBe(true);
		} finally { server.stop(); }
	});
});

describe("Annotate server — /api/feedback", () => {
	test("submits feedback and resolves decision", async () => {
		const server = await startAnnotateServer();
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`${server.url}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "Add more details", annotations: [{ id: "1" }] }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);

			const decision = await decisionPromise;
			expect(decision.feedback).toBe("Add more details");
			expect(decision.annotations).toHaveLength(1);
		} finally { server.stop(); }
	});
});

describe("Annotate server — /api/approve (gate mode)", () => {
	test("approves without feedback in gate mode", async () => {
		const server = await startAnnotateServer({ gate: true });
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});
			expect(res.status).toBe(200);

			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
		} finally { server.stop(); }
	});
});

describe("Annotate server — /api/exit", () => {
	test("exits session and resolves decision", async () => {
		const server = await startAnnotateServer();
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`${server.url}/api/exit`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});
			expect(res.status).toBe(200);

			const decision = await decisionPromise;
			expect(decision.exit).toBe(true);
		} finally { server.stop(); }
	});
});

describe("Annotate server — /api/sessions", () => {
	test("returns session info", async () => {
		const server = await startAnnotateServer();
		try {
			const res = await fetch(`${server.url}/api/sessions`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.sessions).toHaveLength(1);
			expect(data.count).toBe(1);
		} finally { server.stop(); }
	});
});

describe("Annotate server — session routing", () => {
	test("session mismatch returns 403", async () => {
		const server = await startAnnotateServer({ sessionId: "correct-session-id" });
		// server.url already has /s/correct-session-id prefix
		// Request with wrong session in the URL path
		const baseUrl = server.url.replace(/\/s\/.*$/, "");
		try {
			const res = await fetch(`${baseUrl}/s/wrong-session-id/api/plan`);
			expect(res.status).toBe(403);
			const data = await res.json() as any;
			expect(data.error).toContain("Session mismatch");
		} finally { server.stop(); }
	});

	test("correct session routes successfully", async () => {
		const server = await startAnnotateServer({ sessionId: "my-session" });
		// server.url = http://localhost:PORT/s/my-session
		try {
			const res = await fetch(`${server.url}/api/plan`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.plan).toContain("Test Document");
		} finally { server.stop(); }
	});
});

describe("Annotate server — misc", () => {
	test("GET /favicon.svg returns SVG", async () => {
		const server = await startAnnotateServer();
		try {
			const res = await fetch(`${server.url}/favicon.svg`);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("<svg");
		} finally { server.stop(); }
	});

	test("unknown path returns HTML", async () => {
		const server = await startAnnotateServer();
		try {
			const res = await fetch(`${server.url}/some/path`);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("annotate");
		} finally { server.stop(); }
	});

	test("POST /api/config saves config", async () => {
		const server = await startAnnotateServer();
		try {
			const res = await fetch(`${server.url}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ displayName: "Annotator" }),
			});
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});
});
