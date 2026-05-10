import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startMultiSessionPlanServer } from "./serverMultiSession";

const HTML = "<!DOCTYPE html><html><body>plan</body></html>";

describe("multi-session plan server", () => {
	test("two sessions on the same port with different session IDs", async () => {
		// Start first session
		const s1 = await startMultiSessionPlanServer({
			plan: "# Plan Alpha\n\nAlpha content",
			htmlContent: HTML,
			sharingEnabled: false,
		});

		// Start second session on same server (same port)
		const s2 = await startMultiSessionPlanServer({
			plan: "# Plan Beta\n\nBeta content",
			htmlContent: HTML,
			sharingEnabled: false,
		});

		// Same port, different session IDs, different URLs
		expect(s1.port).toBe(s2.port);
		expect(s1.reviewId).not.toBe(s2.reviewId);
		expect(s1.url).toContain(`/s/${s1.reviewId}`);
		expect(s2.url).toContain(`/s/${s2.reviewId}`);

		// Each session returns its own plan
		const r1 = await fetch(`${s1.url}/api/plan`);
		const d1 = await r1.json();
		expect(d1.plan).toContain("Plan Alpha");

		const r2 = await fetch(`${s2.url}/api/plan`);
		const d2 = await r2.json();
		expect(d2.plan).toContain("Plan Beta");

		// GET /api/sessions lists both
		const sessionsRes = await fetch(`http://localhost:${s1.port}/api/sessions`);
		const sessionsData = await sessionsRes.json();
		expect(sessionsData.sessions).toHaveLength(2);
		expect(sessionsData.count).toBe(2);

		// Each session can be approved independently
		const decision1 = s1.waitForDecision();
		await fetch(`${s1.url}/api/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ feedback: "Alpha approved", planSave: { enabled: false } }),
		});
		const result1 = await decision1;
		expect(result1.approved).toBe(true);
		expect(result1.feedback).toBe("Alpha approved");

		// Session 2 is still pending
		const d2check = await fetch(`${s2.url}/api/decision`);
		const d2data = await d2check.json();
		expect(d2data.pending).toBe(true);

		// Approve session 2
		const decision2 = s2.waitForDecision();
		await fetch(`${s2.url}/api/deny`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ feedback: "Beta denied", planSave: { enabled: false } }),
		});
		const result2 = await decision2;
		expect(result2.approved).toBe(false);
		expect(result2.feedback).toBe("Beta denied");

		// Cleanup
		s1.stop();
		s2.stop();
	});

	test("POST /api/sessions creates a new session on running server", async () => {
		const server = await startMultiSessionPlanServer({
			plan: "# Initial Plan",
			htmlContent: HTML,
			sharingEnabled: false,
		});

		try {
			// Create a new session via HTTP API
			const res = await fetch(`http://localhost:${server.port}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ plan: "# HTTP Session Plan\n\nVia HTTP" }),
			});
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.sessionId).toBeDefined();
			expect(data.url).toContain(`/s/${data.sessionId}`);

			// Fetch the new session's plan
			const planRes = await fetch(`${data.url}/api/plan`);
			const planData = await planRes.json();
			expect(planData.plan).toContain("HTTP Session Plan");

			// Sessions list now has 2
			const sessionsRes = await fetch(`http://localhost:${server.port}/api/sessions`);
			const sessionsData = await sessionsRes.json();
			expect(sessionsData.count).toBe(2);
		} finally {
			server.stop();
		}
	});

	test("session not found returns 404", async () => {
		const server = await startMultiSessionPlanServer({
			plan: "# Test",
			htmlContent: HTML,
			sharingEnabled: false,
		});

		try {
			const res = await fetch(`http://localhost:${server.port}/s/nonexistent-session-id/api/plan`);
			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error).toContain("Session not found");
		} finally {
			server.stop();
		}
	});

	test("decision/stream SSE works per session", async () => {
		const server = await startMultiSessionPlanServer({
			plan: "# SSE Test",
			htmlContent: HTML,
			sharingEnabled: false,
		});

		try {
			// SSE endpoint returns headers
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 500);
			const res = await fetch(`${server.url}/api/decision/stream`, { signal: controller.signal }).catch(() => null);
			if (res) {
				expect(res.status).toBe(200);
				expect(res.headers.get("Content-Type")).toBe("text/event-stream");
			}
		} finally {
			server.stop();
		}
	});

	test("version endpoints work per session", async () => {
		const server = await startMultiSessionPlanServer({
			plan: "# Versioned Plan",
			htmlContent: HTML,
			sharingEnabled: false,
		});

		try {
			const versionsRes = await fetch(`${server.url}/api/plan/versions`);
			expect(versionsRes.status).toBe(200);
			const vdata = await versionsRes.json();
			expect(vdata.versions).toBeInstanceOf(Array);

			const versionRes = await fetch(`${server.url}/api/plan/version?v=1`);
			expect(versionRes.status).toBe(200);
			const vd = await versionRes.json();
			expect(vd.plan).toContain("Versioned Plan");
		} finally {
			server.stop();
		}
	});
});
