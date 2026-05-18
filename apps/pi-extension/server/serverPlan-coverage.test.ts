import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startPlanReviewServer } from "./serverPlan";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HTML = "<!DOCTYPE html><html><body>x</body></html>";

// Helper to make temp markdown file
function makeTempMd(content: string): string {
	const dir = join(tmpdir(), `plannotator-coverage-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const p = join(dir, "doc.md");
	writeFileSync(p, content);
	return dir;
}

describe("plan server — coverage expansion", () => {
	let server: Awaited<ReturnType<typeof startPlanReviewServer>>;
	let url: string;

	beforeAll(async () => {
		server = await startPlanReviewServer({
			plan: "# Coverage Plan\n\nDetails here",
			htmlContent: HTML,
			origin: "pi",
			sharingEnabled: false,
		});
		url = `http://localhost:${server.port}`;
	});

	afterAll(() => server.stop());

	test("POST /api/config saves displayName", async () => {
		const res = await fetch(`${url}/api/config`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayName: "Test User" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
	});

	test("GET /api/obsidian/vaults returns vaults array", async () => {
		const res = await fetch(`${url}/api/obsidian/vaults`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.vaults).toBeInstanceOf(Array);
	});

	test("GET /api/archive/plans returns plans array", async () => {
		const res = await fetch(`${url}/api/archive/plans`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plans).toBeInstanceOf(Array);
	});

	test("GET /api/archive/plan returns 400 without filename", async () => {
		const res = await fetch(`${url}/api/archive/plan`);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain("filename");
	});

	test("GET /api/archive/plan returns 404 for non-existent", async () => {
		const res = await fetch(`${url}/api/archive/plan?filename=nonexistent.md`);
		expect(res.status).toBe(404);
	});

	test("GET /api/doc returns 400 without path", async () => {
		const res = await fetch(`${url}/api/doc`);
		expect(res.status).toBe(400);
	});

	test("POST /api/save-notes returns results", async () => {
		const res = await fetch(`${url}/api/save-notes`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.ok).toBe(true);
		expect(data.results).toBeDefined();
	});

	test("POST /api/deny with default feedback", async () => {
		const s = await startPlanReviewServer({
			plan: "# Deny Default",
			htmlContent: HTML,
			sharingEnabled: false,
		});
		try {
			const p = s.waitForDecision();
			const res = await fetch(`http://localhost:${s.port}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planSave: { enabled: false } }),
			});
			expect(res.status).toBe(200);
			const d = await p;
			expect(d.approved).toBe(false);
			expect(d.feedback).toBe("Plan rejected by user");
		} finally {
			s.stop();
		}
	});

	test("POST /api/deny duplicate returns duplicate flag", async () => {
		const s = await startPlanReviewServer({
			plan: "# Deny Dup",
			htmlContent: HTML,
			sharingEnabled: false,
		});
		try {
			await fetch(`http://localhost:${s.port}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planSave: { enabled: false } }),
			});
			const res = await fetch(`http://localhost:${s.port}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planSave: { enabled: false } }),
			});
			expect(res.status).toBe(200);
			expect((await res.json()).duplicate).toBe(true);
		} finally {
			s.stop();
		}
	});

	test("POST /api/approve with planSave enabled saves snapshot", async () => {
		const s = await startPlanReviewServer({
			plan: "# Save Snapshot Test",
			htmlContent: HTML,
			sharingEnabled: false,
		});
		try {
			const p = s.waitForDecision();
			const res = await fetch(`http://localhost:${s.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "ok", planSave: { enabled: true } }),
			});
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.savedPath).toBeDefined();
			const d = await p;
			expect(d.savedPath).toBeDefined();
		} finally {
			s.stop();
		}
	});

	test("POST /api/approve with obsidian/bear/octarine integrations", async () => {
		const s = await startPlanReviewServer({
			plan: "# Integration Test",
			htmlContent: HTML,
			sharingEnabled: false,
		});
		try {
			const p = s.waitForDecision();
			const res = await fetch(`http://localhost:${s.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					planSave: { enabled: false },
					obsidian: { vaultPath: "/nonexistent", folder: "notes", plan: "test" },
					bear: { plan: "test" },
					octarine: { plan: "test", workspace: "ws" },
				}),
			});
			expect(res.status).toBe(200);
			await p;
		} finally {
			s.stop();
		}
	});

	test("GET /api/decision after approval returns result", async () => {
		const s = await startPlanReviewServer({
			plan: "# Decision Result",
			htmlContent: HTML,
			sharingEnabled: false,
		});
		try {
			await fetch(`http://localhost:${s.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planSave: { enabled: false } }),
			});
			// Now check decision endpoint
			const res = await fetch(`http://localhost:${s.port}/api/decision`);
			const data = await res.json();
			expect(data.approved).toBe(true);
		} finally {
			s.stop();
		}
	});

	test("POST /api/plan/vscode-diff returns 400 without baseVersion", async () => {
		const res = await fetch(`${url}/api/plan/vscode-diff`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/plan/vscode-diff returns 404 for non-existent version", async () => {
		const res = await fetch(`${url}/api/plan/vscode-diff`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ baseVersion: 999 }),
		});
		expect(res.status).toBe(404);
	});

	test("POST /api/done in archive mode resolves waitForDone", async () => {
		const s = await startPlanReviewServer({
			plan: "",
			htmlContent: HTML,
			mode: "archive",
		});
		try {
			const donePromise = s.waitForDone!();
			await fetch(`http://localhost:${s.port}/api/done`, { method: "POST" });
			await donePromise; // Should resolve
		} finally {
			s.stop();
		}
	});
});
