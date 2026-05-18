/**
 * Integration tests for serverPlan.ts HTTP endpoints.
 * Uses real HTTP servers with reserved ports — same pattern as server-parity.test.ts.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	return result.stdout.trim();
}

function initRepo(): string {
	const repoDir = makeTempDir("plannotator-plan-repo-");
	git(repoDir, ["init"]);
	git(repoDir, ["branch", "-M", "main"]);
	git(repoDir, ["config", "user.email", "plan-test@example.com"]);
	git(repoDir, ["config", "user.name", "Plan Test"]);
	writeFileSync(join(repoDir, "readme.md"), "hello\n", "utf-8");
	git(repoDir, ["add", "readme.md"]);
	git(repoDir, ["commit", "-m", "initial"]);
	return repoDir;
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

async function startServer(planContent = "# Test Plan\n\nPlan body here.") {
	const { startPlanReviewServer } = await import("../server");
	const homeDir = makeTempDir("plannotator-plan-home-");
	process.env.HOME = homeDir;
	process.env.PLANNOTATOR_REMOTE = "false";
	process.env.PLANNOTATOR_PORT = String(await reservePort());

	const server = await startPlanReviewServer({
		plan: planContent,
		origin: "pi",
		htmlContent: "<!doctype html><html><body>plan</body></html>",
	});
	return server;
}

// --- Tests ---

describe("Plan server — /api/plan endpoints", () => {
	test("GET /api/plan returns plan and metadata", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.plan).toContain("Test Plan");
			expect(data.origin).toBe("pi");
			expect(data.versionInfo).toBeDefined();
			expect(data.sharingEnabled).toBeDefined();
		} finally { server.stop(); }
	});

	test("GET /api/plan/version requires v parameter", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/version`);
			expect(res.status).toBe(400);
			const data = await res.json() as any;
			expect(data.error).toContain("Missing v");
		} finally { server.stop(); }
	});

	test("GET /api/plan/version returns 400 for invalid version", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/version?v=abc`);
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("GET /api/plan/version returns 404 for non-existent version", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/version?v=999`);
			expect(res.status).toBe(404);
		} finally { server.stop(); }
	});

	test("GET /api/plan/versions returns version list", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/versions`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.versions).toBeDefined();
			expect(Array.isArray(data.versions)).toBe(true);
		} finally { server.stop(); }
	});

	test("GET /api/plans returns plan history", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plans`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.plans).toBeDefined();
			expect(Array.isArray(data.plans)).toBe(true);
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/decision endpoints", () => {
	test("GET /api/decision returns pending when not settled", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/decision`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.pending).toBe(true);
		} finally { server.stop(); }
	});

	test("GET /api/decision returns result after approve", async () => {
		const server = await startServer();
		try {
			// Approve the plan
			const approveRes = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "looks good" }),
			});
			expect(approveRes.status).toBe(200);

			// Now check decision
			const res = await fetch(`${server.url}/api/decision`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.pending).toBeUndefined();
			expect(data.approved).toBe(true);
			expect(data.feedback).toBe("looks good");
		} finally { server.stop(); }
	});

	test("GET /api/decision/stream SSE returns connected event", async () => {
		const server = await startServer();
		try {
			const controller = new AbortController();
			const res = await fetch(`${server.url}/api/decision/stream`, { signal: controller.signal });
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");
			// Read just enough to verify connected event, then abort
			const reader = res.body?.getReader();
			if (reader) {
				const { value } = await reader.read();
				const text = new TextDecoder().decode(value);
				expect(text).toContain("connected");
				reader.cancel();
			}
			controller.abort();
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/approve", () => {
	test("approves plan and returns ok", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "approved!" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
		} finally { server.stop(); }
	});

	test("duplicate approve returns ok with duplicate flag", async () => {
		const server = await startServer();
		try {
			await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "first" }),
			});
			const res = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "duplicate" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
			expect(data.duplicate).toBe(true);
		} finally { server.stop(); }
	});

	test("waitForDecision resolves after approve", async () => {
		const server = await startServer();
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "resolved" }),
			});
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
			expect(decision.feedback).toBe("resolved");
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/deny", () => {
	test("denies plan and returns ok", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "needs work" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
		} finally { server.stop(); }
	});

	test("waitForDecision resolves after deny", async () => {
		const server = await startServer();
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`${server.url}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "rejected" }),
			});
			const decision = await decisionPromise;
			expect(decision.approved).toBe(false);
			expect(decision.feedback).toBe("rejected");
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/sessions", () => {
	test("GET /api/sessions returns session info", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/sessions`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.sessions).toHaveLength(1);
			expect(data.sessions[0].sessionId).toBe(server.reviewId);
			expect(data.count).toBe(1);
		} finally { server.stop(); }
	});

	test("POST /api/sessions creates a new session", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ plan: "# New Plan\n\ncontent", name: "Test" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.sessionId).toBeTruthy();
			expect(data.plan).toContain("New Plan");
			expect(data.name).toBe("Test");
		} finally { server.stop(); }
	});

	test("POST /api/sessions returns 400 without plan", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "No Plan" }),
			});
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/approve with integrations", () => {
	test("approve with agentSwitch passes it to decision", async () => {
		const server = await startServer();
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					feedback: "switch it",
					agentSwitch: "opencode",
					permissionMode: "plan",
				}),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
			expect(decision.agentSwitch).toBe("opencode");
			expect(decision.permissionMode).toBe("plan");
		} finally { server.stop(); }
	});

	test("approve with planSave disabled skips saving", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planSave: { enabled: false },
				}),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
			expect(data.savedPath).toBeUndefined();
		} finally { server.stop(); }
	});

	test("approve with bear integration", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					feedback: "good",
					bear: { plan: "# My Plan\ncontent", tags: ["test"] },
				}),
			});
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});

	test("deny with planSave disabled", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					feedback: "bad plan",
					planSave: { enabled: false },
				}),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
			expect(data.savedPath).toBeUndefined();
		} finally { server.stop(); }
	});

	test("deny default feedback with invalid JSON body", async () => {
		const server = await startServer();
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`${server.url}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: "not json",
			});
			const decision = await decisionPromise;
			expect(decision.approved).toBe(false);
			expect(decision.feedback).toBe("Plan rejected by user");
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/save-notes", () => {
	test("saves to bear integration", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/save-notes`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					bear: { plan: "# Plan", tags: ["tag"] },
				}),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
		} finally { server.stop(); }
	});

	test("saves to octarine integration", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/save-notes`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					octarine: { plan: "# Plan", workspace: "ws", folder: "notes" },
				}),
			});
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/plan/vscode-diff", () => {
	test("returns 400 without baseVersion", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/vscode-diff`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("returns 404 for non-existent version", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/vscode-diff`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ baseVersion: 999 }),
			});
			expect(res.status).toBe(404);
		} finally { server.stop(); }
	});

	test("diffs against valid base version", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/plan/vscode-diff`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ baseVersion: 1 }),
			});
			// May fail if VS Code not installed, but shouldn't crash
			expect([200, 500]).toContain(res.status);
		} finally { server.stop(); }
	});
});

describe("Plan server — /api/decision/stream with settled decision", () => {
	test("stream immediately sends decision if already settled", async () => {
		const server = await startServer();
		try {
			// First settle the decision
			await fetch(`${server.url}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "pre-approved" }),
			});

			// Now connect to stream — should get decision immediately
			const controller = new AbortController();
			const res = await fetch(`${server.url}/api/decision/stream`, { signal: controller.signal });
			expect(res.status).toBe(200);
			const reader = res.body?.getReader();
			if (reader) {
				const chunks: string[] = [];
				while (true) {
					const { value, done } = await reader.read();
					if (done) break;
					chunks.push(new TextDecoder().decode(value));
					if (chunks.join("").includes("decision")) break;
				}
				const allText = chunks.join("");
				expect(allText).toContain("decision");
				expect(allText).toContain("pre-approved");
			}
			controller.abort();
		} finally { server.stop(); }
	});
});

describe("Plan server — archive mode", () => {
	async function startArchiveServer() {
		const { startPlanReviewServer } = await import("../server");
		const homeDir = makeTempDir("plannotator-archive-home-");
		process.env.HOME = homeDir;
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		return startPlanReviewServer({
			plan: "",
			origin: "pi",
			htmlContent: "<!doctype html><html><body>archive</body></html>",
			mode: "archive",
		});
	}

	test("GET /api/plan returns archive mode", async () => {
		const server = await startArchiveServer();
		try {
			const res = await fetch(`${server.url}/api/plan`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.mode).toBe("archive");
			expect(data.archivePlans).toBeDefined();
		} finally { server.stop(); }
	});

	test("POST /api/done resolves waitForDone", async () => {
		const server = await startArchiveServer();
		try {
			const donePromise = server.waitForDone?.();
			const res = await fetch(`${server.url}/api/done`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
			});
			expect(res.status).toBe(200);
			if (donePromise) await donePromise;
		} finally { server.stop(); }
	});
});

describe("Plan server — misc endpoints", () => {
	test("GET /favicon.svg returns SVG", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/favicon.svg`);
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).toContain("<svg");
		} finally { server.stop(); }
	});

	test("POST /api/config saves config", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ displayName: "Test User" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
		} finally { server.stop(); }
	});

	test("GET /api/archive/plans returns plan list", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/archive/plans`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.plans).toBeDefined();
		} finally { server.stop(); }
	});

	test("GET /api/archive/plan returns 400 without filename", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/archive/plan`);
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("unknown path returns HTML", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/some/random/path`);
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(text).toContain("plan");
		} finally { server.stop(); }
	});

	test("GET /api/agents returns empty agents", async () => {
		const server = await startServer();
		try {
			const res = await fetch(`${server.url}/api/agents`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.agents).toEqual([]);
		} finally { server.stop(); }
	});
});
