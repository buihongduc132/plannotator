/**
 * Integration tests for serverReview.ts HTTP endpoints.
 * Uses real HTTP servers with reserved ports.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
	const repoDir = makeTempDir("plannotator-review-repo-");
	git(repoDir, ["init"]);
	git(repoDir, ["branch", "-M", "main"]);
	git(repoDir, ["config", "user.email", "review-test@example.com"]);
	git(repoDir, ["config", "user.name", "Review Test"]);
	writeFileSync(join(repoDir, "file.ts"), "const x = 1;\n", "utf-8");
	git(repoDir, ["add", "file.ts"]);
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

async function startReview(opts: {
	sessionId?: string;
	diffType?: string;
	gitContext?: any;
	error?: string;
	prMetadata?: any;
	noLocalAccess?: boolean;
} = {}) {
	const { startReviewServer } = await import("../server");
	const repoDir = initRepo();
	process.chdir(repoDir);

	// Make uncommitted changes so we have a diff
	writeFileSync(join(repoDir, "file.ts"), "const x = 2;\n", "utf-8");

	// Get the diff
	const diffResult = spawnSync("git", ["diff"], { cwd: repoDir, encoding: "utf-8" });
	const patch = diffResult.stdout || "";

	const gitContext = opts.gitContext || {
		cwd: repoDir,
		defaultBranch: "main",
		currentBranch: "main",
		isGitRepo: true,
		mergeBase: "",
		headSha: "",
		remoteUrl: null as string | null,
		upstream: null as string | null,
		hasUpstream: false,
		toplevel: repoDir,
		display: "review-test",
		branch: "main",
	};

	const homeDir = makeTempDir("plannotator-review-home-");
	process.env.HOME = homeDir;
	process.env.PLANNOTATOR_REMOTE = "false";
	process.env.PLANNOTATOR_PORT = String(await reservePort());

	const server = await startReviewServer({
		rawPatch: patch,
		gitRef: "main",
		htmlContent: "<!doctype html><html><head></head><body>review</body></html>",
		origin: "pi",
		diffType: (opts.diffType as any) || "uncommitted",
		gitContext: opts.noLocalAccess ? undefined : gitContext,
		sessionId: opts.sessionId,
		error: opts.error,
		prMetadata: opts.prMetadata,
	});
	return server;
}

// --- Tests ---

describe("Review server — /api/diff", () => {
	test("returns diff data with metadata", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/diff`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.rawPatch).toBeDefined();
			expect(data.origin).toBe("pi");
			expect(data.gitContext).toBeDefined();
			expect(data.base).toBeDefined();
			expect(data.serverConfig).toBeDefined();
		} finally { server.stop(); }
	});

	test("includes error field when provided", async () => {
		const server = await startReview({ error: "merge conflict" });
		try {
			const res = await fetch(`${server.url}/api/diff`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.error).toBe("merge conflict");
		} finally { server.stop(); }
	});

	test("omits gitContext when no local access", async () => {
		const server = await startReview({ noLocalAccess: true });
		try {
			const res = await fetch(`${server.url}/api/diff`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.gitContext).toBeUndefined();
			expect(data.base).toBeUndefined();
		} finally { server.stop(); }
	});
});

describe("Review server — /api/sessions", () => {
	test("returns session info", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/sessions`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.sessions).toHaveLength(1);
			expect(data.count).toBe(1);
			expect(data.sessions[0].mode).toBe("review");
		} finally { server.stop(); }
	});
});

describe("Review server — /api/feedback", () => {
	test("submits feedback and resolves decision", async () => {
		const server = await startReview();
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`${server.url}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					approved: true,
					feedback: "LGTM",
					annotations: [{ id: "a1" }],
				}),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
			expect(decision.feedback).toBe("LGTM");
			expect(decision.annotations).toHaveLength(1);
		} finally { server.stop(); }
	});

	test("submits feedback with agentSwitch", async () => {
		const server = await startReview();
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`${server.url}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					approved: false,
					feedback: "switch",
					annotations: [],
					agentSwitch: "opencode",
				}),
			});
			const decision = await decisionPromise;
			expect(decision.agentSwitch).toBe("opencode");
		} finally { server.stop(); }
	});

	test("defaults approved to false", async () => {
		const server = await startReview();
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`${server.url}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "meh" }),
			});
			const decision = await decisionPromise;
			expect(decision.approved).toBe(false);
		} finally { server.stop(); }
	});
});

describe("Review server — /api/exit", () => {
	test("exits and resolves decision with exit flag", async () => {
		const server = await startReview();
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

describe("Review server — /api/git-add", () => {
	test("returns 400 when filePath missing", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/git-add`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("stages a file", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/git-add`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filePath: "file.ts" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.ok).toBe(true);
		} finally { server.stop(); }
	});

	test("un-stages a file with undo", async () => {
		const server = await startReview();
		try {
			// Stage first
			await fetch(`${server.url}/api/git-add`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filePath: "file.ts" }),
			});
			// Then unstage
			const res = await fetch(`${server.url}/api/git-add`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filePath: "file.ts", undo: true }),
			});
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});
});

describe("Review server — /api/diff/switch", () => {
	test("diff/switch returns 400 without local access", async () => {
		const server = await startReview({ noLocalAccess: true });
		try {
			const res = await fetch(`${server.url}/api/diff/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ diffType: "staged" }),
			});
			expect(res.status).toBe(400);
			const data = await res.json() as any;
			expect(data.error).toContain("Not available");
		} finally { server.stop(); }
	});

	test("file-content returns 400 without local access and not PR mode", async () => {
		const server = await startReview({ noLocalAccess: true });
		try {
			const res = await fetch(`${server.url}/api/file-content?path=file.ts`);
			expect(res.status).toBe(400);
			const data = await res.json() as any;
			expect(data.error).toContain("No file access");
		} finally { server.stop(); }
	});

	test("git-add returns 400 for staged diff type", async () => {
		const server = await startReview({ diffType: "staged" });
		try {
			const res = await fetch(`${server.url}/api/git-add`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filePath: "file.ts" }),
			});
			expect(res.status).toBe(400);
			const data = await res.json() as any;
			expect(data.error).toContain("Staging not available");
		} finally { server.stop(); }
	});

	test("returns 400 without diffType", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/diff/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("switches to staged diff type", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/diff/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ diffType: "staged" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.diffType).toBe("staged");
		} finally { server.stop(); }
	});

	test("switches with custom base branch", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/diff/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ diffType: "uncommitted", base: "main" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.base).toBe("main");
		} finally { server.stop(); }
	});
});

describe("Review server — /api/file-content", () => {
	test("returns 400 when path missing", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/file-content`);
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("returns 400 for invalid path", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/file-content?path=../../../etc/passwd`);
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("returns file contents for valid path", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/file-content?path=file.ts`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			// Should have oldContent and/or newContent
			expect(data.oldContent !== undefined || data.newContent !== undefined).toBe(true);
		} finally { server.stop(); }
	});
});

describe("Review server — PR mode endpoints", () => {
	test("GET /api/pr-context returns 400 when not in PR mode", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/pr-context`);
			expect(res.status).toBe(400);
			const data = await res.json() as any;
			expect(data.error).toContain("Not in PR mode");
		} finally { server.stop(); }
	});

	test("POST /api/pr-action returns 400 when not in PR mode", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/pr-action`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "approve", body: "LGTM" }),
			});
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("POST /api/pr-viewed returns 400 when not in PR mode", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/pr-viewed`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filePaths: ["file.ts"], viewed: true }),
			});
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});
});

	describe("Review server — session-scoped endpoints", () => {
	test("exit with sessionId resolves correctly", async () => {
		const server = await startReview({ sessionId: "test-session" });
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

	test("feedback with sessionId resolves correctly", async () => {
		const server = await startReview({ sessionId: "test-session" });
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`${server.url}/api/feedback`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ approved: true, feedback: "session feedback", annotations: [] }),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
			expect(decision.feedback).toBe("session feedback");
		} finally { server.stop(); }
	});

	test("draft CRUD with sessionId", async () => {
		const server = await startReview({ sessionId: "draft-session" });
		try {
			// Save draft
			const saveRes = await fetch(`${server.url}/api/draft`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: "draft content" }),
			});
			expect(saveRes.status).toBe(200);

			// Retrieve draft
			const getRes = await fetch(`${server.url}/api/draft`);
			expect(getRes.status).toBe(200);
		} finally { server.stop(); }
	});
});

describe("Review server — onReady callback", () => {
	test("onReady is called with server info", async () => {
		const { startReviewServer } = await import("../server");
		const repoDir = initRepo();
		process.chdir(repoDir);
		writeFileSync(join(repoDir, "file.ts"), "const x = 2;\n", "utf-8");
		const diffResult = spawnSync("git", ["diff"], { cwd: repoDir, encoding: "utf-8" });

		let readyCalled = false;
		let readyUrl = "";
		let readyRemote = false;
		let readyPort = 0;

		const homeDir = makeTempDir("plannotator-ready-home-");
		process.env.HOME = homeDir;
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		const server = await startReviewServer({
			rawPatch: diffResult.stdout || "",
			gitRef: "main",
			htmlContent: "<!doctype html><html><head></head><body>review</body></html>",
			origin: "pi",
			onReady: (url, isRemote, port) => {
				readyCalled = true;
				readyUrl = url;
				readyRemote = isRemote;
				readyPort = port;
			},
		});
		try {
			expect(readyCalled).toBe(true);
			expect(readyUrl).toBeTruthy();
			expect(readyPort).toBeGreaterThan(0);
		} finally { server.stop(); }
	});

	test("onCleanup is called on stop", async () => {
		const { startReviewServer } = await import("../server");
		const repoDir = initRepo();
		process.chdir(repoDir);
		writeFileSync(join(repoDir, "file.ts"), "const x = 2;\n", "utf-8");
		const diffResult = spawnSync("git", ["diff"], { cwd: repoDir, encoding: "utf-8" });

		let cleanedUp = false;

		const homeDir = makeTempDir("plannotator-cleanup-home-");
		process.env.HOME = homeDir;
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		const server = await startReviewServer({
			rawPatch: diffResult.stdout || "",
			gitRef: "main",
			htmlContent: "<!doctype html><html><head></head><body>review</body></html>",
			origin: "pi",
			onCleanup: () => { cleanedUp = true; },
		});
		server.stop();
		expect(cleanedUp).toBe(true);
	});
});

describe("Review server — session routing", () => {
	test("session mismatch returns 403", async () => {
		const server = await startReview({ sessionId: "good-session" });
		const baseUrl = server.url.replace(/\/s\/.*$/, "");
		try {
			const res = await fetch(`${baseUrl}/s/bad-session/api/diff`);
			expect(res.status).toBe(403);
		} finally { server.stop(); }
	});

	test("correct session routes to diff", async () => {
		const server = await startReview({ sessionId: "my-session" });
		try {
			const res = await fetch(`${server.url}/api/diff`);
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});

	test("bare /s/{sessionId} serves HTML with session path injection", async () => {
		const server = await startReview({ sessionId: "my-session" });
		const baseUrl = server.url.replace(/\/s\/.*$/, "");
		try {
			const res = await fetch(`${baseUrl}/s/my-session`);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('review');
			expect(html).toContain('__PLANNOTATOR_SESSION_PATH__="/s/my-session"');
		} finally { server.stop(); }
	});

	test("bare /s/{wrongId} returns 403", async () => {
		const server = await startReview({ sessionId: "my-session" });
		const baseUrl = server.url.replace(/\/s\/.*$/, "");
		try {
			const res = await fetch(`${baseUrl}/s/wrong-session`);
			expect(res.status).toBe(403);
			const data = await res.json() as any;
			expect(data.error).toContain("Session mismatch");
		} finally { server.stop(); }
	});

	test("bare /s/{sessionId}/ with trailing slash serves HTML", async () => {
		const server = await startReview({ sessionId: "my-session" });
		const baseUrl = server.url.replace(/\/s\/.*$/, "");
		try {
			const res = await fetch(`${baseUrl}/s/my-session/`);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('__PLANNOTATOR_SESSION_PATH__="/s/my-session"');
		} finally { server.stop(); }
	});
});

describe("Review server — AI endpoints", () => {
	test("GET /api/ai/capabilities returns status", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/ai/capabilities`);
			// May be 200 or 404 depending on provider availability
			expect([200, 404]).toContain(res.status);
		} finally { server.stop(); }
	});

	test("GET /api/ai/sessions returns status", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/ai/sessions`);
			expect([200, 404]).toContain(res.status);
		} finally { server.stop(); }
	});
});

describe("Review server — agent jobs", () => {
	test("GET /api/agents/capabilities returns providers", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/agents/capabilities`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.mode).toBe("review");
			expect(data.providers).toBeInstanceOf(Array);
		} finally { server.stop(); }
	});

	test("GET /api/agents/jobs returns empty initially", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/agents/jobs`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.jobs).toEqual([]);
		} finally { server.stop(); }
	});
});

describe("Review server — external annotations", () => {
	test("GET /api/external-annotations returns snapshot", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/external-annotations`);
			expect(res.status).toBe(200);
			const data = await res.json() as any;
			expect(data.annotations).toEqual([]);
		} finally { server.stop(); }
	});
});

describe("Review server — agent jobs integration", () => {
	test("POST /api/agents/jobs launches via review server", async () => {
		const server = await startReview();
		try {
			// Check if claude is available
			const capRes = await fetch(`${server.url}/api/agents/capabilities`);
			const caps = await capRes.json() as any;
			const claudeProvider = caps.providers?.find((p: any) => p.id === "claude" && p.available);

			if (!claudeProvider) {
				console.log("Skipping agent job test — claude not available");
				return;
			}

			// Launch a job (the buildCommand callback will be exercised)
			const res = await fetch(`${server.url}/api/agents/jobs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: "claude",
					command: ["echo", "test"],
				}),
			});
			expect(res.status).toBe(201);
			const data = await res.json() as any;
			expect(data.job.id).toBeTruthy();

			// Wait for it to complete
			await new Promise(r => setTimeout(r, 2000));

			// Check job status
			const jobsRes = await fetch(`${server.url}/api/agents/jobs`);
			const jobs = await jobsRes.json() as any;
			expect(jobs.jobs.length).toBeGreaterThan(0);
			expect(["done", "failed", "running"]).toContain(jobs.jobs[0].status);
		} finally { server.stop(); }
	});
});

	describe("Review server — misc", () => {
	test("GET /favicon.svg returns SVG", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/favicon.svg`);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("<svg");
		} finally { server.stop(); }
	});

	test("unknown path returns HTML", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/some/path`);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain("review");
		} finally { server.stop(); }
	});

	test("GET /api/agents returns empty agents", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/agents`);
			expect(res.status).toBe(200);
			expect((await res.json() as any).agents).toEqual([]);
		} finally { server.stop(); }
	});

	test("POST /api/config saves config", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ displayName: "Reviewer" }),
			});
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});

	test("POST /api/config with multiple options", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/config`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					displayName: "Test",
					diffOptions: { contextLines: 5 },
					conventionalComments: true,
				}),
			});
			expect(res.status).toBe(200);
		} finally { server.stop(); }
	});

	test("GET /api/image returns 400 without path", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/image`);
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});

	test("GET /api/draft returns 404 when no draft", async () => {
		const server = await startReview();
		try {
			// Delete any leftover draft from previous test with same patch hash
			await fetch(`${server.url}/api/draft`, { method: "DELETE" });
			const res = await fetch(`${server.url}/api/draft`);
			expect(res.status).toBe(404);
		} finally { server.stop(); }
	});

	test("file-content with oldPath validates it", async () => {
		const server = await startReview();
		try {
			const res = await fetch(`${server.url}/api/file-content?path=file.ts&oldPath=../../../etc/passwd`);
			expect(res.status).toBe(400);
		} finally { server.stop(); }
	});
});
