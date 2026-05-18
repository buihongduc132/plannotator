/**
 * Parity tests — endpoints and multi-session semantics that exist in the
 * Bun/OpenCode server but are missing or incomplete in the Pi server.
 *
 * These tests assert the expected parity behavior and guard against regression.
 * Multi-session semantics must stay aligned with Bun/OpenCode.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	getGitContext,
	runGitDiff,
	startAnnotateServer,
	startPlanReviewServer,
	startReviewServer,
} from "./server";

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
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
	});
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function initRepo(): string {
	const repoDir = makeTempDir("plannotator-pi-parity-repo-");
	git(repoDir, ["init"]);
	git(repoDir, ["branch", "-M", "main"]);
	git(repoDir, ["config", "user.email", "pi-parity@example.com"]);
	git(repoDir, ["config", "user.name", "Pi Parity"]);

	writeFileSync(join(repoDir, "tracked.txt"), "before\n", "utf-8");
	git(repoDir, ["add", "tracked.txt"]);
	git(repoDir, ["commit", "-m", "initial"]);

	return repoDir;
}

afterEach(() => {
	process.chdir(originalCwd);
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (originalPort === undefined) {
		delete process.env.PLANNOTATOR_PORT;
	} else {
		process.env.PLANNOTATOR_PORT = originalPort;
	}
	if (originalRemote === undefined) {
		delete process.env.PLANNOTATOR_REMOTE;
	} else {
		process.env.PLANNOTATOR_REMOTE = originalRemote;
	}
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("Pi plan server — parity with Bun server", () => {
	describe("POST /api/sessions (create session via HTTP)", () => {
		test("creates a session and returns sessionId, url, plan, slug, name, mode, project", async () => {
			const homeDir = makeTempDir("plannotator-pi-home-");
			process.env.HOME = homeDir;
			process.env.PLANNOTATOR_PORT = String(await reservePort());

			const server = await startPlanReviewServer({
				plan: "# My Plan\n\nSome content for the plan.",
				origin: "pi",
				htmlContent: "<!doctype html><html><body>plan</body></html>",
			});

			try {
				const response = await fetch(`${server.url}/api/sessions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						plan: "# New Plan\n\nCreated via HTTP API.",
						mode: "plan",
						name: "My Test Plan",
					}),
				});

				expect(response.status).toBe(200);
				const data = (await response.json()) as {
					sessionId: string;
					url: string;
					plan: string;
					slug: string;
					name: string | null;
					mode: string;
					project: string;
				};

				expect(data.sessionId).toBeTruthy();
				expect(data.url).toContain(data.sessionId);
				expect(data.plan).toBe("# New Plan\n\nCreated via HTTP API.");
				expect(data.slug).toBeTruthy();
				expect(data.name).toBe("My Test Plan");
				expect(data.mode).toBe("plan");
				expect(data.project).toBeTruthy();
			} finally {
				server.stop();
			}
		});

		test("returns 400 when plan is missing", async () => {
			const homeDir = makeTempDir("plannotator-pi-home-");
			process.env.HOME = homeDir;
			process.env.PLANNOTATOR_PORT = String(await reservePort());

			const server = await startPlanReviewServer({
				plan: "# Existing Plan",
				origin: "pi",
				htmlContent: "<!doctype html><html><body>plan</body></html>",
			});

			try {
				const response = await fetch(`${server.url}/api/sessions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ mode: "plan" }),
				});

				expect(response.status).toBe(400);
				const data = (await response.json()) as { error: string };
				expect(data.error).toContain("plan");
			} finally {
				server.stop();
			}
		});
	});

	describe("GET /api/decision (poll for plan decision)", () => {
		test("returns { pending: true } while no decision has been made", async () => {
			const homeDir = makeTempDir("plannotator-pi-home-");
			process.env.HOME = homeDir;
			process.env.PLANNOTATOR_PORT = String(await reservePort());

			const server = await startPlanReviewServer({
				plan: "# Plan\n\nContent here.",
				origin: "pi",
				htmlContent: "<!doctype html><html><body>plan</body></html>",
			});

			try {
				const response = await fetch(`${server.url}/api/decision`);
				expect(response.status).toBe(200);
				const data = (await response.json()) as { pending: boolean };
				expect(data.pending).toBe(true);
			} finally {
				server.stop();
			}
		});

		test("returns decision result after approve", async () => {
			const homeDir = makeTempDir("plannotator-pi-home-");
			process.env.HOME = homeDir;
			process.env.PLANNOTATOR_PORT = String(await reservePort());

			const server = await startPlanReviewServer({
				plan: "# Plan\n\nContent here.",
				origin: "pi",
				htmlContent: "<!doctype html><html><body>plan</body></html>",
			});

			try {
				const approveRes = await fetch(`${server.url}/api/approve`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				});
				expect(approveRes.status).toBe(200);

				const response = await fetch(`${server.url}/api/decision`);
				expect(response.status).toBe(200);
				const data = (await response.json()) as {
					pending?: boolean;
					approved: boolean;
					feedback?: string;
					savedPath?: string;
				};
				expect(data.pending).toBeUndefined();
				expect(data.approved).toBe(true);
			} finally {
				server.stop();
			}
		});
	});

	describe("GET /api/decision/stream (SSE for real-time decisions)", () => {
		test("returns SSE content-type and sends connected event", async () => {
			const homeDir = makeTempDir("plannotator-pi-home-");
			process.env.HOME = homeDir;
			process.env.PLANNOTATOR_PORT = String(await reservePort());

			const server = await startPlanReviewServer({
				plan: "# Plan\n\nContent here.",
				origin: "pi",
				htmlContent: "<!doctype html><html><body>plan</body></html>",
			});

			try {
				const response = await fetch(`${server.url}/api/decision/stream`);
				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toContain("text/event-stream");

				const reader = response.body?.getReader();
				expect(reader).toBeTruthy();
				if (!reader) throw new Error("No reader");

				const { value, done } = await reader.read();
				expect(done).toBe(false);
				const text = new TextDecoder().decode(value);
				expect(text).toContain("event: connected");
			} finally {
				server.stop();
			}
		});
	});

	describe("GET /api/plans (list plans from history)", () => {
		test("returns plans array with slug, versions, lastModified, project fields", async () => {
			const homeDir = makeTempDir("plannotator-pi-home-");
			process.env.HOME = homeDir;
			process.env.PLANNOTATOR_PORT = String(await reservePort());

			const server = await startPlanReviewServer({
				plan: "# Test Plan\n\nSome content.",
				origin: "pi",
				htmlContent: "<!doctype html><html><body>plan</body></html>",
			});

			try {
				const response = await fetch(`${server.url}/api/plans`);
				expect(response.status).toBe(200);
				const data = (await response.json()) as {
					plans: Array<{
						slug: string;
						versions: number;
						lastModified: string;
						project: string;
					}>;
				};

				expect(Array.isArray(data.plans)).toBe(true);
				expect(data.plans.length).toBeGreaterThanOrEqual(1);

				const plan = data.plans[0];
				expect(plan.slug).toBeTruthy();
				expect(typeof plan.versions).toBe("number");
				expect(plan.versions).toBeGreaterThanOrEqual(1);
				expect(plan.lastModified).toBeTruthy();
				expect(plan.project).toBeTruthy();
			} finally {
				server.stop();
			}
		});
	});
});

describe("Pi annotate server — parity with OpenCode multi-session routing", () => {
	test("honors provided sessionId in the returned URL and session listing", async () => {
		const homeDir = makeTempDir("plannotator-pi-home-");
		process.env.HOME = homeDir;
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		const server = await startAnnotateServer({
			markdown: "# Annotate\n\nBody",
			filePath: "/tmp/example.md",
			htmlContent: "<!doctype html><html><body>annotate</body></html>",
			origin: "pi",
			mode: "annotate-last",
			sessionId: "annotate-parity-001",
			cwd: "/tmp/pi-annotate-parity",
		} as any);

		try {
			expect(server.url).toContain("/s/annotate-parity-001");

			const sessionsResponse = await fetch(`${server.url}/api/sessions`);
			expect(sessionsResponse.status).toBe(200);
			const sessionsPayload = (await sessionsResponse.json()) as {
				sessions: Array<{ sessionId: string; cwd?: string; url: string }>;
			};
			expect(sessionsPayload.sessions).toHaveLength(1);
			expect(sessionsPayload.sessions[0]).toMatchObject({
				sessionId: "annotate-parity-001",
				cwd: "/tmp/pi-annotate-parity",
			});
			expect(sessionsPayload.sessions[0].url).toContain("/s/annotate-parity-001");
		} finally {
			server.stop();
		}
	});

	test("supports session-scoped draft routes and rejects mismatched session ids", async () => {
		const homeDir = makeTempDir("plannotator-pi-home-");
		process.env.HOME = homeDir;
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		const server = await startAnnotateServer({
			markdown: "# Annotate\n\nScoped draft",
			filePath: "/tmp/example.md",
			htmlContent: "<!doctype html><html><body>annotate</body></html>",
			origin: "pi",
			sessionId: "annotate-scope-001",
			cwd: "/tmp/pi-annotate-scope",
		} as any);

		try {
			const matching = await fetch(`${server.url}/s/annotate-scope-001/api/draft`);
			expect(matching.status).toBeLessThan(500);

			const mismatch = await fetch(`${server.url}/s/wrong-session/api/draft`);
			expect(mismatch.status).toBe(403);
			const payload = (await mismatch.json()) as { error?: string };
			expect(payload.error).toContain("Session mismatch");
		} finally {
			server.stop();
		}
	});
});

describe("Pi review server — parity with OpenCode multi-session routing", () => {
	test("includes session metadata in /api/diff and /api/sessions when sessionId is provided", async () => {
		const homeDir = makeTempDir("plannotator-pi-home-");
		const repoDir = initRepo();
		process.env.HOME = homeDir;
		process.chdir(repoDir);
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		writeFileSync(join(repoDir, "tracked.txt"), "after\n", "utf-8");
		const gitContext = await getGitContext();
		const diff = await runGitDiff("uncommitted", gitContext.defaultBranch);

		const server = await startReviewServer({
			rawPatch: diff.patch,
			gitRef: diff.label,
			error: diff.error,
			diffType: "uncommitted",
			gitContext,
			origin: "pi",
			htmlContent: "<!doctype html><html><body>review</body></html>",
			sessionId: "review-parity-001",
		} as any);

		try {
			const diffResponse = await fetch(`${server.url}/api/diff`);
			expect(diffResponse.status).toBe(200);
			const diffPayload = (await diffResponse.json()) as { sessionId?: string };
			expect(diffPayload.sessionId).toBe("review-parity-001");

			const sessionsResponse = await fetch(`${server.url}/api/sessions`);
			expect(sessionsResponse.status).toBe(200);
			const sessionsPayload = (await sessionsResponse.json()) as {
				sessions: Array<{ sessionId: string }>;
			};
			expect(sessionsPayload.sessions.map((session) => session.sessionId)).toContain(
				"review-parity-001",
			);
		} finally {
			server.stop();
		}
	});

	test("isolates drafts between review sessions sharing the same diff content", async () => {
		const homeDir = makeTempDir("plannotator-pi-home-");
		const repoDir = initRepo();
		process.env.HOME = homeDir;
		process.chdir(repoDir);
		process.env.PLANNOTATOR_PORT = String(await reservePort());

		writeFileSync(join(repoDir, "tracked.txt"), "after\n", "utf-8");
		const gitContext = await getGitContext();
		const diff = await runGitDiff("uncommitted", gitContext.defaultBranch);

		const first = await startReviewServer({
			rawPatch: diff.patch,
			gitRef: diff.label,
			error: diff.error,
			diffType: "uncommitted",
			gitContext,
			origin: "pi",
			htmlContent: "<!doctype html><html><body>review</body></html>",
			sessionId: "review-draft-a",
		} as any);
		const second = await startReviewServer({
			rawPatch: diff.patch,
			gitRef: diff.label,
			error: diff.error,
			diffType: "uncommitted",
			gitContext,
			origin: "pi",
			htmlContent: "<!doctype html><html><body>review</body></html>",
			sessionId: "review-draft-b",
		} as any);

		try {
			const saveResponse = await fetch(`${first.url}/api/draft`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ annotations: [{ id: "review-only" }] }),
			});
			expect(saveResponse.status).toBe(200);

			const secondLoad = await fetch(`${second.url}/api/draft`);
			expect(secondLoad.status).toBe(404);
			const body = (await secondLoad.json()) as { found?: boolean };
			expect(body).toEqual({ found: false });
		} finally {
			first.stop();
			second.stop();
		}
	});
});
