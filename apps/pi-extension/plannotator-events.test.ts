import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	PlannotatorRequest,
	PlannotatorResponse,
	PlannotatorResponseMap,
	PlannotatorRequestMap,
	PlannotatorReviewStatusResult,
} from "./plannotator-events";
import { PLANNOTATOR_REQUEST_CHANNEL, PLANNOTATOR_REVIEW_RESULT_CHANNEL } from "./plannotator-events";

// ── Review status file isolation ────────────────────────────────────────

const REVIEW_STATUS_PATH = join(homedir(), ".pi", "plannotator-review-status.json");

let savedStatusContent: string | null = null;

function backupReviewStatus(): void {
	try {
		savedStatusContent = readFileSync(REVIEW_STATUS_PATH, "utf-8");
	} catch {
		savedStatusContent = null;
	}
}

function restoreReviewStatus(): void {
	if (savedStatusContent !== null) {
		mkdirSync(dirname(REVIEW_STATUS_PATH), { recursive: true });
		writeFileSync(REVIEW_STATUS_PATH, savedStatusContent);
	} else {
		try {
			const { unlinkSync } = require("node:fs");
			unlinkSync(REVIEW_STATUS_PATH);
		} catch {
			// already gone
		}
	}
}

// ── Browser module mock ─────────────────────────────────────────────────

// These mocks capture the functions that registerPlannotatorEventListeners
// calls, so tests can assert on them without starting real servers.

const mockGetLastAssistantMessageText = mock(async (_ctx: unknown): Promise<string | null> => null);
const mockGetStartupErrorMessage = mock((err: unknown): string => err instanceof Error ? err.message : String(err));
const mockOpenArchiveBrowserAction = mock(async (_ctx: unknown, _customPlanPath?: string) => ({ opened: true }));
const mockOpenCodeReview = mock(async (_ctx: unknown, _opts?: unknown) => ({
	approved: true,
	feedback: undefined,
}));
const mockOpenLastMessageAnnotation = mock(async (
	_ctx: unknown,
	_text: string,
	_gate?: boolean,
) => ({
	feedback: "",
	exit: false,
}));
const mockOpenMarkdownAnnotation = mock(async (
	_ctx: unknown,
	_filePath: string,
	_markdown: string,
	_mode: string,
	_folderPath?: string,
	_sourceInfo?: string,
	_gate?: boolean,
) => ({
	feedback: "",
	exit: false,
}));
const mockStartPlanReviewBrowserSession = mock(async (_ctx: unknown, _planContent: string) => {
	const reviewId = `test-review-${Date.now()}`;
	return {
		reviewId,
		url: `http://localhost:9999/?id=${reviewId}`,
		waitForDecision: async () => ({ approved: true }),
		onDecision: (_listener: (result: unknown) => void | Promise<void>) => () => {},
		stop: () => {},
	};
});

// Must be declared before the mock.module call so bun hoists correctly
mock.module("./plannotator-browser.js", () => ({
	getLastAssistantMessageText: mockGetLastAssistantMessageText,
	getStartupErrorMessage: mockGetStartupErrorMessage,
	openArchiveBrowserAction: mockOpenArchiveBrowserAction,
	openCodeReview: mockOpenCodeReview,
	openLastMessageAnnotation: mockOpenLastMessageAnnotation,
	openMarkdownAnnotation: mockOpenMarkdownAnnotation,
	startPlanReviewBrowserSession: mockStartPlanReviewBrowserSession,
	openPlanReviewBrowser: mock(async (_ctx: unknown, _plan: string) => ({ approved: true })),
	hasPlanBrowserHtml: () => true,
	hasReviewBrowserHtml: () => true,
}));

// ── Mock pi construction ────────────────────────────────────────────────

type EventHandler = (...args: unknown[]) => Promise<void> | void;
type EventMap = Record<string, EventHandler[]>;

function createMockPi() {
	const piEventHandlers: Record<string, EventHandler> = {};
	const customEvents: EventMap = {};

	const mockPi = {
		on: mock((event: string, handler: EventHandler) => {
			piEventHandlers[event] = handler;
		}),
		events: {
			on: mock((channel: string, handler: EventHandler) => {
				if (!customEvents[channel]) customEvents[channel] = [];
				customEvents[channel].push(handler);
			}),
			emit: mock((channel: string, data: unknown) => {
				const handlers = customEvents[channel] ?? [];
				for (const handler of handlers) {
					handler(data);
				}
			}),
		},
		_internal: {
			piEventHandlers,
			customEvents,
		},
	};

	return mockPi;
}

type MockPi = ReturnType<typeof createMockPi>;

function emitSessionStart(pi: MockPi, ctx: unknown): Promise<void> {
	const handler = pi._internal.piEventHandlers["session_start"];
	if (!handler) throw new Error("session_start handler not registered");
	return handler({} as unknown, ctx) as Promise<void>;
}

function emitRequest(pi: MockPi, request: Partial<PlannotatorRequest>): Promise<unknown> {
	const response: { value: unknown } = { value: undefined };
	const wrappedRequest = {
		...request,
		respond: (resp: unknown) => {
			response.value = resp;
		},
	};
	const handlers = pi._internal.customEvents[PLANNOTATOR_REQUEST_CHANNEL] ?? [];
	if (handlers.length === 0) throw new Error("No handler registered for plannotator:request");

	const results = handlers.map((handler) => handler(wrappedRequest));
	return Promise.all(results).then(() => response.value);
}

// ── Test suite ──────────────────────────────────────────────────────────

// Import after mocks are set up so the module gets the mocked dependencies
// @ts-expect-error — bun test auto-mocking
const { registerPlannotatorEventListeners } = await import("./plannotator-events.js") as typeof import("./plannotator-events.js");

describe("plannotator shared event API", () => {
	let pi: MockPi;
	const mockCtx = {
		ui: { notify: mock(() => {}), setStatus: mock(() => {}), setWidget: mock(() => {}) },
		hasUI: true,
		cwd: "/test/repo",
		sessionManager: {
			getEntries: () => [],
			getSessionId: () => "test-session-1",
			getSessionName: () => undefined,
		},
	};

	// Backup review status once before all tests, restore in afterEach
	// (bun:test has no afterAll, so we restore conditionally in afterEach)
	let reviewStatusBackedUp = false;

	beforeEach(() => {
		if (!reviewStatusBackedUp) {
			backupReviewStatus();
			reviewStatusBackedUp = true;
		}
	});

	afterEach(() => {
		restoreReviewStatus();
	});

	beforeEach(() => {
		// Clear all mocks
		mockGetLastAssistantMessageText.mockClear();
		mockGetStartupErrorMessage.mockClear();
		mockOpenArchiveBrowserAction.mockClear();
		mockOpenCodeReview.mockClear();
		mockOpenLastMessageAnnotation.mockClear();
		mockOpenMarkdownAnnotation.mockClear();
		mockStartPlanReviewBrowserSession.mockClear();

		pi = createMockPi();
		registerPlannotatorEventListeners(pi as any);
	});

	// ── annotate-last ──────────────────────────────────────────────────

	describe("annotate-last", () => {
		test("uses pre-supplied markdown from payload instead of getLastAssistantMessageText", async () => {
			await emitSessionStart(pi, mockCtx);

			const response = await emitRequest(pi, {
				requestId: "r1",
				action: "annotate-last",
				payload: {
					filePath: "last-message",
					markdown: "# Pre-supplied content\n\nSome notes.",
				},
			});

			expect(response).toEqual({
				status: "handled",
				result: { feedback: "", exit: false },
			});
			// Should NOT call getLastAssistantMessageText when markdown is provided
			expect(mockGetLastAssistantMessageText).not.toHaveBeenCalled();
			expect(mockOpenLastMessageAnnotation).toHaveBeenCalledTimes(1);
			expect(mockOpenLastMessageAnnotation.mock.calls[0]?.[1]).toBe("# Pre-supplied content\n\nSome notes.");
		});

		test("falls back to getLastAssistantMessageText when no markdown in payload", async () => {
			await emitSessionStart(pi, mockCtx);

			mockGetLastAssistantMessageText.mockImplementationOnce(async () => "Assistant text from session");

			const response = await emitRequest(pi, {
				requestId: "r2",
				action: "annotate-last",
				payload: { filePath: "last-message" },
			});

			expect(response).toEqual({
				status: "handled",
				result: { feedback: "", exit: false },
			});
			expect(mockGetLastAssistantMessageText).toHaveBeenCalledTimes(1);
			expect(mockOpenLastMessageAnnotation).toHaveBeenCalledTimes(1);
			expect(mockOpenLastMessageAnnotation.mock.calls[0]?.[1]).toBe("Assistant text from session");
		});

		test("responds unavailable when no assistant message found", async () => {
			await emitSessionStart(pi, mockCtx);

			mockGetLastAssistantMessageText.mockImplementationOnce(async () => null);

			const response = await emitRequest(pi, {
				requestId: "r3",
				action: "annotate-last",
				payload: { filePath: "last-message" },
			});

			expect(response).toEqual({
				status: "unavailable",
				error: "No assistant message found in session.",
			});
			expect(mockOpenLastMessageAnnotation).not.toHaveBeenCalled();
		});

		test("passes gate flag to openLastMessageAnnotation", async () => {
			await emitSessionStart(pi, mockCtx);

			mockGetLastAssistantMessageText.mockImplementationOnce(async () => "Some text");

			await emitRequest(pi, {
				requestId: "r4",
				action: "annotate-last",
				payload: { filePath: "last-message", gate: true },
			});

			expect(mockOpenLastMessageAnnotation).toHaveBeenCalledTimes(1);
			// 3rd argument is gate
			expect(mockOpenLastMessageAnnotation.mock.calls[0]?.[2]).toBe(true);
		});

		test("responds unavailable when no active session context", async () => {
			// Do NOT emit session_start — no context set
			const response = await emitRequest(pi, {
				requestId: "r5",
				action: "annotate-last",
				payload: { filePath: "last-message", markdown: "hello" },
			});

			expect(response).toEqual({
				status: "unavailable",
				error: "Plannotator context is not ready yet.",
			});
		});
	});

	// ── plan-review ────────────────────────────────────────────────────

	describe("plan-review", () => {
		test("responds error when planContent is empty", async () => {
			await emitSessionStart(pi, mockCtx);

			const response = await emitRequest(pi, {
				requestId: "r6",
				action: "plan-review",
				payload: { planContent: "" },
			});

			expect(response).toEqual({
				status: "error",
				error: "Missing planContent for plan-review request.",
			});
		});

		test("responds error when planContent is whitespace-only", async () => {
			await emitSessionStart(pi, mockCtx);

			const response = await emitRequest(pi, {
				requestId: "r7",
				action: "plan-review",
				payload: { planContent: "   \n\t  " },
			});

			expect(response).toEqual({
				status: "error",
				error: "Missing planContent for plan-review request.",
			});
		});

		test("responds error when planContent is not a string", async () => {
			await emitSessionStart(pi, mockCtx);

			const response = await emitRequest(pi, {
				requestId: "r8",
				action: "plan-review",
				payload: { planContent: undefined },
			});

			expect(response).toEqual({
				status: "error",
				error: "Missing planContent for plan-review request.",
			});
		});

		test("opens browser session and responds with pending reviewId", async () => {
			await emitSessionStart(pi, mockCtx);

			mockStartPlanReviewBrowserSession.mockImplementationOnce(async (_ctx: unknown, _plan: string) => ({
				reviewId: "rev-001",
				url: "http://localhost:9999",
				waitForDecision: async () => ({ approved: true }),
				onDecision: () => () => {},
				stop: () => {},
			}));

			const response = await emitRequest(pi, {
				requestId: "r9",
				action: "plan-review",
				payload: { planContent: "# Plan\n\n- [ ] Step 1" },
			});

			expect(mockStartPlanReviewBrowserSession).toHaveBeenCalledTimes(1);
			expect(response).toEqual({
				status: "handled",
				result: {
					status: "pending",
					reviewId: "rev-001",
				},
			});
		});

		test("responds unavailable when no active session context", async () => {
			// Do NOT emit session_start
			const response = await emitRequest(pi, {
				requestId: "r10",
				action: "plan-review",
				payload: { planContent: "# Plan" },
			});

			expect(response).toEqual({
				status: "unavailable",
				error: "Plannotator context is not ready yet.",
			});
		});

		test("responds error when browser session throws generic error", async () => {
			await emitSessionStart(pi, mockCtx);

			mockStartPlanReviewBrowserSession.mockImplementationOnce(async () => {
				throw new Error("Server failed to start");
			});

			const response = await emitRequest(pi, {
				requestId: "r11",
				action: "plan-review",
				payload: { planContent: "# Plan" },
			});

			expect(response).toEqual({
				status: "error",
				error: "Server failed to start",
			});
		});

		test("responds unavailable when browser session throws unavailable error", async () => {
			await emitSessionStart(pi, mockCtx);

			mockStartPlanReviewBrowserSession.mockImplementationOnce(async () => {
				throw new Error("Plannotator browser review is unavailable in this session.");
			});

			const response = await emitRequest(pi, {
				requestId: "r12",
				action: "plan-review",
				payload: { planContent: "# Plan" },
			});

			expect(response).toEqual({
				status: "unavailable",
				error: "Plannotator browser review is unavailable in this session.",
			});
		});
	});

	// ── review-status ──────────────────────────────────────────────────

	describe("review-status", () => {
		test("responds missing for unknown reviewId", async () => {
			const response = await emitRequest(pi, {
				requestId: "r13",
				action: "review-status",
				payload: { reviewId: "nonexistent-id" },
			});

			expect(response).toEqual({
				status: "handled",
				result: { status: "missing" },
			});
		});

		test("responds error when reviewId is missing", async () => {
			const response = await emitRequest(pi, {
				requestId: "r14",
				action: "review-status",
				payload: {},
			});

			expect(response).toEqual({
				status: "error",
				error: "Missing reviewId for review-status request.",
			});
		});

		test("responds error when reviewId is empty string", async () => {
			const response = await emitRequest(pi, {
				requestId: "r15",
				action: "review-status",
				payload: { reviewId: "   " },
			});

			expect(response).toEqual({
				status: "error",
				error: "Missing reviewId for review-status request.",
			});
		});

		test("returns pending status after plan-review creates a session", async () => {
			await emitSessionStart(pi, mockCtx);

			const reviewId = "rev-status-test";
			mockStartPlanReviewBrowserSession.mockImplementationOnce(async () => ({
				reviewId,
				url: "http://localhost:9999",
				waitForDecision: async () => ({ approved: true }),
				onDecision: () => () => {},
				stop: () => {},
			}));

			// First: create the session
			await emitRequest(pi, {
				requestId: "r16a",
				action: "plan-review",
				payload: { planContent: "# Plan" },
			});

			// Then: query the status
			const response = await emitRequest(pi, {
				requestId: "r16b",
				action: "review-status",
				payload: { reviewId },
			});

			expect(response).toEqual({
				status: "handled",
				result: { status: "pending" },
			});
		});

		test("does not require active session context", async () => {
			// Do NOT emit session_start — review-status should work without context
			const response = await emitRequest(pi, {
				requestId: "r17",
				action: "review-status",
				payload: { reviewId: "some-id" },
			});

			// Should respond (not "unavailable")
			expect((response as any)?.status).toBe("handled");
		});
	});

	// ── annotate ───────────────────────────────────────────────────────

	describe("annotate", () => {
		test("responds error when filePath is missing", async () => {
			await emitSessionStart(pi, mockCtx);

			const response = await emitRequest(pi, {
				requestId: "r18",
				action: "annotate",
				payload: {},
			});

			expect(response).toEqual({
				status: "error",
				error: "Missing filePath for annotate request.",
			});
		});

		test("opens markdown annotation with provided params", async () => {
			await emitSessionStart(pi, mockCtx);

			const response = await emitRequest(pi, {
				requestId: "r19",
				action: "annotate",
				payload: {
					filePath: "/path/to/notes.md",
					markdown: "# Notes",
					mode: "annotate",
				},
			});

			expect(response).toEqual({
				status: "handled",
				result: { feedback: "", exit: false },
			});
			expect(mockOpenMarkdownAnnotation).toHaveBeenCalledTimes(1);
			expect(mockOpenMarkdownAnnotation.mock.calls[0]?.[1]).toBe("/path/to/notes.md");
			expect(mockOpenMarkdownAnnotation.mock.calls[0]?.[2]).toBe("# Notes");
			expect(mockOpenMarkdownAnnotation.mock.calls[0]?.[3]).toBe("annotate");
		});
	});

	// ── code-review ────────────────────────────────────────────────────

	describe("code-review", () => {
		test("opens code review and returns result", async () => {
			await emitSessionStart(pi, mockCtx);

			mockOpenCodeReview.mockImplementationOnce(async () => ({
				approved: false,
				feedback: "Fix the error handling",
			}));

			const response = await emitRequest(pi, {
				requestId: "r20",
				action: "code-review",
				payload: { diffType: "unstaged" },
			});

			expect(response).toEqual({
				status: "handled",
				result: {
					approved: false,
					feedback: "Fix the error handling",
				},
			});
		});

		test("responds unavailable when no active session context", async () => {
			const response = await emitRequest(pi, {
				requestId: "r21",
				action: "code-review",
				payload: {},
			});

			expect(response).toEqual({
				status: "unavailable",
				error: "Plannotator context is not ready yet.",
			});
		});
	});

	// ── archive ────────────────────────────────────────────────────────

	describe("archive", () => {
		test("opens archive browser and returns result", async () => {
			await emitSessionStart(pi, mockCtx);

			mockOpenArchiveBrowserAction.mockImplementationOnce(async () => ({ opened: true }));

			const response = await emitRequest(pi, {
				requestId: "r22",
				action: "archive",
				payload: {},
			});

			expect(response).toEqual({
				status: "handled",
				result: { opened: true },
			});
		});

		test("passes customPlanPath when provided", async () => {
			await emitSessionStart(pi, mockCtx);

			await emitRequest(pi, {
				requestId: "r23",
				action: "archive",
				payload: { customPlanPath: "/custom/plans" },
			});

			expect(mockOpenArchiveBrowserAction).toHaveBeenCalledTimes(1);
			expect(mockOpenArchiveBrowserAction.mock.calls[0]?.[1]).toBe("/custom/plans");
		});
	});

	// ── edge cases ────────────────────────────────────────────────────

	describe("edge cases", () => {
		test("ignores requests with no action", async () => {
			const response = await emitRequest(pi, {
				requestId: "r24",
				action: undefined as any,
				payload: {},
			});

			// No respond called → response stays undefined
			expect(response).toBeUndefined();
		});

		test("ignores requests with invalid action", async () => {
			const response = await emitRequest(pi, {
				requestId: "r25",
				action: "bogus-action" as any,
				payload: {},
			});

			expect(response).toBeUndefined();
		});

		test("ignores null request", async () => {
			// Emit null directly
			const handlers = pi._internal.customEvents[PLANNOTATOR_REQUEST_CHANNEL] ?? [];
			const response = { value: undefined };
			for (const handler of handlers) {
				await handler(null);
			}
			expect(response.value).toBeUndefined();
		});

		test("ignores request without respond function", async () => {
			const handlers = pi._internal.customEvents[PLANNOTATOR_REQUEST_CHANNEL] ?? [];
			const response = { value: undefined };
			for (const handler of handlers) {
				await handler({ action: "annotate", payload: {} });
			}
			expect(response.value).toBeUndefined();
		});

		test("session_start updates active context for subsequent requests", async () => {
			// Before session_start — no context
			const beforeResponse = await emitRequest(pi, {
				requestId: "r26a",
				action: "annotate-last",
				payload: { filePath: "last-message", markdown: "hello" },
			});
			expect(beforeResponse).toEqual({
				status: "unavailable",
				error: "Plannotator context is not ready yet.",
			});

			// After session_start — context available
			await emitSessionStart(pi, mockCtx);

			const afterResponse = await emitRequest(pi, {
				requestId: "r26b",
				action: "annotate-last",
				payload: { filePath: "last-message", markdown: "hello" },
			});
			expect(afterResponse).toEqual({
				status: "handled",
				result: { feedback: "", exit: false },
			});
		});
	});

	// ── plan-review decision callback ──────────────────────────────────

	describe("plan-review decision lifecycle", () => {
		test("fires review-result event and updates stored status on decision", async () => {
			await emitSessionStart(pi, mockCtx);

			let capturedDecision: unknown = null;
			const reviewId = "rev-lifecycle";

			// Register listener on the result channel
			const resultHandlers = pi._internal.customEvents[PLANNOTATOR_REVIEW_RESULT_CHANNEL] ?? [];

			mockStartPlanReviewBrowserSession.mockImplementationOnce(async () => ({
				reviewId,
				url: "http://localhost:9999",
				waitForDecision: async () => ({ approved: true }),
				onDecision: (listener: (result: unknown) => void) => {
					// Simulate the decision callback firing immediately
					// (in real code, this fires when the user approves/denies)
					// We'll capture the listener so we can call it manually
					(listener as (r: { approved: boolean; feedback?: string }) => void)({
						approved: false,
						feedback: "Needs work",
					});
					return () => {};
				},
				stop: () => {},
			}));

			// Register a listener for review-result
			pi.events.on(PLANNOTATOR_REVIEW_RESULT_CHANNEL, (data: unknown) => {
				capturedDecision = data;
			});

			// Initiate plan review
			await emitRequest(pi, {
				requestId: "r27",
				action: "plan-review",
				payload: { planContent: "# Plan" },
			});

			// The decision callback should have fired during onDecision registration
			expect(capturedDecision).toEqual({
				reviewId: "rev-lifecycle",
				approved: false,
				feedback: "Needs work",
			});

			// Status should now be completed
			const statusResponse = await emitRequest(pi, {
				requestId: "r27b",
				action: "review-status",
				payload: { reviewId: "rev-lifecycle" },
			});

			expect(statusResponse).toEqual({
				status: "handled",
				result: {
					status: "completed",
					reviewId: "rev-lifecycle",
					approved: false,
					feedback: "Needs work",
				},
			});
		});
	});
});
