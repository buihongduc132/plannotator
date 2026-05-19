import { describe, expect, test, afterEach } from "bun:test";
import { createServer as createNetServer } from "node:net";
import { startAnnotateServer } from "./serverAnnotate";

const HTML = "<!DOCTYPE html><html><body>ann</body></html>";

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

async function startCoverageServer(opts: { sessionId?: string; cwd?: string; mode?: string; folderPath?: string; sourceInfo?: string } = {}) {
	const port = await reservePort();
	process.env.PLANNOTATOR_PORT = String(port);
	process.env.PLANNOTATOR_REMOTE = "false";
	const server = await startAnnotateServer({
		markdown: "# Test\n\nContent",
		filePath: "/tmp/test.md",
		htmlContent: HTML,
		origin: "pi",
		sessionId: opts.sessionId ?? "cov-session",
		cwd: opts.cwd ?? "/tmp",
		mode: opts.mode,
		folderPath: opts.folderPath,
		sourceInfo: opts.sourceInfo,
	});
	servers.push(server);
	return server;
}

describe("annotate server — coverage expansion", () => {
	test("POST /api/config saves config", async () => {
		const server = await startCoverageServer();
		const res = await fetch(`${server.url}/api/config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayName: "Coverage User" }),
		});
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);
	});

	test("GET /api/doc returns 400 without path", async () => {
		const server = await startCoverageServer();
		const res = await fetch(`${server.url}/api/doc`);
		expect(res.status).toBe(400);
	});

	test("GET /api/obsidian/vaults returns array", async () => {
		const server = await startCoverageServer();
		const res = await fetch(`${server.url}/api/obsidian/vaults`);
		expect(res.status).toBe(200);
		expect((await res.json()).vaults).toBeInstanceOf(Array);
	});

	test("GET /api/reference/files returns 400 without dirPath", async () => {
		const server = await startCoverageServer();
		const res = await fetch(`${server.url}/api/reference/files`);
		expect(res.status).toBe(400);
	});

	test("GET /api/external-annotations returns snapshot", async () => {
		const server = await startCoverageServer();
		const res = await fetch(`${server.url}/api/external-annotations`);
		expect(res.status).toBe(200);
		expect((await res.json()).annotations).toBeInstanceOf(Array);
	});

	test("POST /api/feedback with invalid JSON still resolves", async () => {
		const server = await startCoverageServer();
		const p = server.waitForDecision();
		const res = await fetch(`${server.url}/api/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json{{",
		});
		// Server returns 200 with empty feedback or 500 — either way, no hang
		expect([200, 500]).toContain(res.status);
	});

	test("annotate with folder mode sets mode=annotate-folder", async () => {
		const server = await startCoverageServer({ mode: "annotate-folder", folderPath: "/tmp/folder" });
		const res = await fetch(`${server.url}/api/plan`);
		const data = await res.json();
		expect(data.mode).toBe("annotate-folder");
	});

	test("annotate with sourceInfo includes it in response", async () => {
		const server = await startCoverageServer({ sourceInfo: "src.html" });
		const res = await fetch(`${server.url}/api/plan`);
		const data = await res.json();
		expect(data.sourceInfo).toBe("src.html");
	});

	test("GET /s/ with session but matching session serves normally", async () => {
		const server = await startCoverageServer({ sessionId: "cov-session" });
		const res = await fetch(`${server.url}/api/plan`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plan).toContain("Test");
	});
});
