/**
 * Parity tests — endpoints that exist in the Bun server (packages/server/)
 * but are missing from the Pi server (apps/pi-extension/server/).
 *
 * These tests assert the EXPECTED behavior. They MUST fail until the
 * corresponding endpoints are implemented.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlanReviewServer } from "./server";

// ── Helpers (mirrors server.test.ts) ─────────────────────────────────────

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalPort = process.env.PLANNOTATOR_PORT;

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

afterEach(() => {
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
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ── Tests ───────────────────────────────────────────────────────────────

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
				// Approve the plan
				const approveRes = await fetch(`${server.url}/api/approve`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				});
				expect(approveRes.status).toBe(200);

				// Poll for decision
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

				// Read the first chunk — should contain "connected" event
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
				// The plan was saved to history on server start, so we expect at least one
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
