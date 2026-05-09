import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startPlanReviewServer } from "./serverPlan";

const HTML_CONTENT = "<!DOCTYPE html><html><body>plan</body></html>";
const PLAN = "# Test Plan\n\n1. Step one\n2. Step two";

describe("plan server integration", () => {
	let result: Awaited<ReturnType<typeof startPlanReviewServer>>;
	let baseUrl: string;

	beforeAll(async () => {
		result = await startPlanReviewServer({
			plan: PLAN,
			htmlContent: HTML_CONTENT,
			origin: "pi",
			sharingEnabled: false,
		});
		baseUrl = `http://localhost:${result.port}`;
	});

	afterAll(() => {
		result.stop();
	});

	test("GET /api/plan returns plan and metadata", async () => {
		const res = await fetch(`${baseUrl}/api/plan`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plan).toBe(PLAN);
		expect(data.origin).toBe("pi");
		expect(data.versionInfo).toBeDefined();
		expect(data.versionInfo.version).toBeGreaterThanOrEqual(1);
	});

	test("GET /api/decision returns pending before approval", async () => {
		const res = await fetch(`${baseUrl}/api/decision`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.pending).toBe(true);
	});

	test("GET /api/sessions returns session listing", async () => {
		const res = await fetch(`${baseUrl}/api/sessions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0].sessionId).toBe(result.reviewId);
	});

	test("POST /api/sessions creates a new session", async () => {
		const res = await fetch(`${baseUrl}/api/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ plan: "# New Session Plan\n\nSome content" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.sessionId).toBeDefined();
		expect(data.url).toContain("/s/");
	});

	test("POST /api/sessions returns 400 without plan", async () => {
		const res = await fetch(`${baseUrl}/api/sessions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("GET /api/plans returns plan history", async () => {
		const res = await fetch(`${baseUrl}/api/plans`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plans).toBeInstanceOf(Array);
	});

	test("GET /api/plan/versions returns version list", async () => {
		const res = await fetch(`${baseUrl}/api/plan/versions`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.versions).toBeInstanceOf(Array);
	});

	test("GET /api/plan/version returns 400 without v param", async () => {
		const res = await fetch(`${baseUrl}/api/plan/version`);
		expect(res.status).toBe(400);
	});

	test("GET /api/plan/version returns 400 for invalid v", async () => {
		const res = await fetch(`${baseUrl}/api/plan/version?v=abc`);
		expect(res.status).toBe(400);
	});

	test("GET /api/plan/version returns version content", async () => {
		const res = await fetch(`${baseUrl}/api/plan/version?v=1`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.plan).toBeDefined();
		expect(data.version).toBe(1);
	});

	test("GET /api/agents returns empty list", async () => {
		const res = await fetch(`${baseUrl}/api/agents`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.agents).toEqual([]);
	});

	test("GET /api/image returns 400 without path", async () => {
		const res = await fetch(`${baseUrl}/api/image`);
		expect(res.status).toBe(400);
	});

	test("GET /favicon.svg returns SVG", async () => {
		const res = await fetch(`${baseUrl}/favicon.svg`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("svg");
	});

	test("GET unknown path returns HTML content", async () => {
		const res = await fetch(`${baseUrl}/some/random/path`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("plan");
	});

	test("POST /api/approve resolves decision as approved", async () => {
		const server = await startPlanReviewServer({
			plan: "# Approve Test Plan",
			htmlContent: HTML_CONTENT,
			sharingEnabled: false,
		});
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`http://localhost:${server.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "LGTM", planSave: { enabled: false } }),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(true);
			expect(decision.feedback).toBe("LGTM");
		} finally {
			server.stop();
		}
	});

	test("POST /api/deny resolves decision as denied", async () => {
		const server = await startPlanReviewServer({
			plan: "# Deny Test Plan",
			htmlContent: HTML_CONTENT,
			sharingEnabled: false,
		});
		try {
			const decisionPromise = server.waitForDecision();
			const res = await fetch(`http://localhost:${server.port}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "Rework needed", planSave: { enabled: false } }),
			});
			expect(res.status).toBe(200);
			const decision = await decisionPromise;
			expect(decision.approved).toBe(false);
			expect(decision.feedback).toBe("Rework needed");
		} finally {
			server.stop();
		}
	});

	test("duplicate approve returns ok with duplicate flag", async () => {
		const server = await startPlanReviewServer({
			plan: "# Dup Test Plan",
			htmlContent: HTML_CONTENT,
			sharingEnabled: false,
		});
		try {
			await fetch(`http://localhost:${server.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planSave: { enabled: false } }),
			});
			// Second approve
			const res = await fetch(`http://localhost:${server.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ planSave: { enabled: false } }),
			});
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.duplicate).toBe(true);
		} finally {
			server.stop();
		}
	});

	test("POST /api/approve with agentSwitch includes it in decision", async () => {
		const server = await startPlanReviewServer({
			plan: "# Agent Switch Plan",
			htmlContent: HTML_CONTENT,
			sharingEnabled: false,
		});
		try {
			const decisionPromise = server.waitForDecision();
			await fetch(`http://localhost:${server.port}/api/approve`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ agentSwitch: "opencode", planSave: { enabled: false } }),
			});
			const decision = await decisionPromise;
			expect(decision.agentSwitch).toBe("opencode");
		} finally {
			server.stop();
		}
	});

	test("GET /api/decision/stream returns SSE headers", async () => {
		// Abort after headers to avoid hanging on SSE stream
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 500);
		const res = await fetch(`${baseUrl}/api/decision/stream`, { signal: controller.signal }).catch(() => null);
		if (res) {
			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toBe("text/event-stream");
		}
	});

	test("archive mode returns archive plans", async () => {
		const server = await startPlanReviewServer({
			plan: "",
			htmlContent: HTML_CONTENT,
			mode: "archive",
		});
		try {
			const res = await fetch(`http://localhost:${server.port}/api/plan`);
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.mode).toBe("archive");
			expect(data.archivePlans).toBeInstanceOf(Array);
		} finally {
			server.stop();
		}
	});

	test("onDecision listener receives result", async () => {
		const server = await startPlanReviewServer({
			plan: "# Listener Test",
			htmlContent: HTML_CONTENT,
			sharingEnabled: false,
		});
		try {
			let listenerResult: any = null;
			server.onDecision((r) => { listenerResult = r; });
			await fetch(`http://localhost:${server.port}/api/deny`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ feedback: "nope", planSave: { enabled: false } }),
			});
			// Wait a tick for the listener to fire
			await new Promise((r) => setTimeout(r, 50));
			expect(listenerResult).not.toBeNull();
			expect(listenerResult.approved).toBe(false);
		} finally {
			server.stop();
		}
	});
});
