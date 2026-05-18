/**
 * TDD tests for hook multi-session parity with pi extension.
 *
 * Tests cover:
 * 1. Session registry CRUD (register, get, list, unregister)
 * 2. Session path routing (/s/<sessionId>/api/*)
 * 3. Decision state machine (pending → settled, listeners, SSE)
 * 4. Session limit enforcement
 * 5. Slug-based routing
 * 6. last-message subcommand parsing
 */

import { afterEach, describe, expect, test } from "bun:test";

// We'll import the module-under-test after it's written
// For now, define the test structure that MUST pass

describe("Session Registry", () => {
	afterEach(() => {
		// Clean up registry between tests
		const { clearSessions } = require("./session-registry");
		clearSessions();
	});

	test("register + get a session", () => {
		const { registerSession, getSession, clearSessions } = require("./session-registry");
		clearSessions();

		const { createSessionState } = require("./session-registry");
		const state = createSessionState({ plan: "# Test Plan\n\nHello world", origin: "claude-code" });

		registerSession(state);
		const found = getSession(state.sessionId);
		expect(found).toBeDefined();
		expect(found!.plan).toBe("# Test Plan\n\nHello world");
		expect(found!.origin).toBe("claude-code");
		expect(found!.mode).toBe("plan");
	});

	test("list returns all registered sessions", () => {
		const { registerSession, listSessions, createSessionState, clearSessions } = require("./session-registry");
		clearSessions();

		const s1 = createSessionState({ plan: "# Plan 1", origin: "claude-code" });
		const s2 = createSessionState({ plan: "# Plan 2", origin: "opencode" });

		registerSession(s1);
		registerSession(s2);

		const sessions = listSessions();
		expect(sessions.length).toBe(2);
	});

	test("unregister removes session and cleans up", () => {
		const { registerSession, unregisterSession, getSession, createSessionState, clearSessions } = require("./session-registry");
		clearSessions();

		const state = createSessionState({ plan: "# Plan", origin: "claude-code" });
		registerSession(state);
		expect(getSession(state.sessionId)).toBeDefined();

		unregisterSession(state.sessionId);
		expect(getSession(state.sessionId)).toBeUndefined();
	});

	test("session limit is enforced", () => {
		const { registerSession, getMaxSessions, createSessionState, clearSessions } = require("./session-registry");
		clearSessions();

		const limit = getMaxSessions();
		// Register up to the limit
		for (let i = 0; i < limit; i++) {
			const state = createSessionState({ plan: `# Plan ${i}`, origin: "test" });
			registerSession(state);
		}

		// Next one should throw
		const overflow = createSessionState({ plan: "# Overflow", origin: "test" });
		expect(() => registerSession(overflow)).toThrow(/limit reached/);
	});

	test("slug-based session lookup", () => {
		const { registerSession, getSession, createSessionState, clearSessions } = require("./session-registry");
		clearSessions();

		const state = createSessionState({ plan: "# My Feature Plan\n\nDetails here", origin: "claude-code" });
		registerSession(state);

		// The slug is derived from the plan heading + date
		// Try to find by the sanitized slug
		const sessions = require("./session-registry").listSessions();
		const slug = sessions[0].slug;
		expect(slug.length).toBeGreaterThan(0);

		const found = getSession(slug);
		expect(found).toBeDefined();
		expect(found!.sessionId).toBe(state.sessionId);
	});
});

describe("Session Path Parsing", () => {
	test("parses /s/<sessionId>/api/plan correctly", () => {
		const { parseSessionPath } = require("./session-registry");
		const result = parseSessionPath("/s/abc-123/api/plan");
		expect(result.sessionId).toBe("abc-123");
		expect(result.apiPath).toBe("/api/plan");
	});

	test("parses /s/<sessionId>/api/decision correctly", () => {
		const { parseSessionPath } = require("./session-registry");
		const result = parseSessionPath("/s/abc-123/api/decision");
		expect(result.sessionId).toBe("abc-123");
		expect(result.apiPath).toBe("/api/decision");
	});

	test("returns null sessionId for non-session paths", () => {
		const { parseSessionPath } = require("./session-registry");
		const result = parseSessionPath("/api/plan");
		expect(result.sessionId).toBeNull();
		expect(result.apiPath).toBe("/api/plan");
	});

	test("handles /s/<slug>/api/plan with slug-based routing", () => {
		const { parseSessionPath } = require("./session-registry");
		const result = parseSessionPath("/s/my-feature-plan/api/approve");
		expect(result.sessionId).toBe("my-feature-plan");
		expect(result.apiPath).toBe("/api/approve");
	});
});

describe("Decision State Machine", () => {
	test("initial state is pending", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		expect(state.decisionSettled).toBe(false);
		expect(state.decisionResult).toBeNull();
	});

	test("publishDecision settles the state", async () => {
		const { createSessionState, publishDecision } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		const result = publishDecision(state, { approved: true, feedback: "LGTM" });
		expect(result).toBe(true);
		expect(state.decisionSettled).toBe(true);
		expect(state.decisionResult).toEqual({ approved: true, feedback: "LGTM" });

		// decisionPromise should resolve
		const decision = await state.decisionPromise;
		expect(decision.approved).toBe(true);
		expect(decision.feedback).toBe("LGTM");
	});

	test("publishDecision returns false on duplicate", () => {
		const { createSessionState, publishDecision } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		publishDecision(state, { approved: true });
		const second = publishDecision(state, { approved: false });
		expect(second).toBe(false);
		// State should remain as first decision
		expect(state.decisionResult!.approved).toBe(true);
	});

	test("decision listeners are notified", async () => {
		const { createSessionState, publishDecision } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		let received: any = null;
		state.decisionListeners.add((result) => { received = result; });

		publishDecision(state, { approved: false, feedback: "Needs work" });

		// Listener should be called synchronously (via Promise.resolve)
		await new Promise((r) => setTimeout(r, 10));
		expect(received).toEqual({ approved: false, feedback: "Needs work" });
	});

	test("SSE clients receive decision event", () => {
		const { createSessionState, publishDecision } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		let written = "";
		let ended = false;
		state.sseClients.add({
			write: (data: string) => { written += data; },
			end: () => { ended = true; },
			writableEnded: false,
			destroyed: false,
		});

		publishDecision(state, { approved: true });

		expect(written).toContain("event: decision");
		expect(written).toContain('"approved":true');
		expect(ended).toBe(true);
		expect(state.sseClients.size).toBe(0); // cleaned up
	});

	test("SSE client already ended is skipped", () => {
		const { createSessionState, publishDecision } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		let written = "";
		state.sseClients.add({
			write: (data: string) => { written += data; },
			end: () => {},
			writableEnded: true, // already ended
			destroyed: false,
		});

		publishDecision(state, { approved: true });

		expect(written).toBe(""); // nothing written to ended client
	});
});

describe("Create Session State", () => {
	test("plan mode saves to history and tracks versions", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({ plan: "# Test Plan\n\nBody", origin: "claude-code" });

		expect(state.mode).toBe("plan");
		expect(state.slug.length).toBeGreaterThan(0);
		expect(state.versionInfo.version).toBeGreaterThanOrEqual(1);
		expect(state.draftKey.length).toBeGreaterThan(0);
	});

	test("annotate mode skips history", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({
			plan: "Some markdown content",
			origin: "claude-code",
			mode: "annotate",
			filePath: "/path/to/file.md",
			sourceInfo: "file.md",
		});

		expect(state.mode).toBe("annotate");
		expect(state.slug).toBe(""); // no slug for annotate
		expect(state.filePath).toBe("/path/to/file.md");
	});

	test("annotate-last mode stores gate flag", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({
			plan: "Last message content",
			origin: "claude-code",
			mode: "annotate-last",
			filePath: "last-message",
			gate: true,
		});

		expect(state.mode).toBe("annotate-last");
		expect(state.gate).toBe(true);
		expect(state.filePath).toBe("last-message");
	});

	test("archive mode skips history and slug", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({ plan: "", origin: "claude-code", mode: "archive" });

		expect(state.mode).toBe("archive");
		expect(state.slug).toBe("");
	});

	test("custom sessionId is preserved", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test", sessionId: "my-custom-id" });

		expect(state.sessionId).toBe("my-custom-id");
	});

	test("generates UUID when no sessionId provided", () => {
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({ plan: "# Plan", origin: "test" });

		expect(state.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/); // UUID format
	});
});

describe("last-message subcommand", () => {
	test("last-message creates annotate-last session with plan review UI", () => {
		// This tests the data flow: the subcommand should create a session
		// with mode "annotate-last" and filePath "last-message"
		const { createSessionState } = require("./session-registry");
		const state = createSessionState({
			plan: "This is the last assistant message content",
			origin: "claude-code",
			mode: "annotate-last",
			filePath: "last-message",
		});

		expect(state.mode).toBe("annotate-last");
		expect(state.filePath).toBe("last-message");
		expect(state.plan).toBe("This is the last assistant message content");
		expect(state.origin).toBe("claude-code");
	});
});
