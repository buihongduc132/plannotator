/**
 * Session Registry for Claude Code hook — in-memory store for multi-session plan review.
 *
 * Modeled after apps/pi-extension/server/session-registry.ts to maintain parity.
 * Each session represents one plan/review/annotate flow with its own
 * plan content, decision state, and draft key.
 *
 * This module provides the data structures (SessionContext, decision state machine,
 * session path routing) used by the hook's multi-session features. It is consumed
 * by session-registry.test.ts (unit tests) and will be wired into the multi-session
 * HTTP server when that feature is added.
 *
 * Currently used indirectly: the `createSessionState` function defines the session
 * model that the `last-message` subcommand follows, and `parseSessionPath` will
 * enable /s/<sessionId>/api/* routing in the hook server.
 */

import { randomUUID } from "node:crypto";
import { contentHash } from "@plannotator/shared/draft";
import {
	generateSlug,
	getPlanVersion,
	getVersionCount,
	saveToHistory,
} from "@plannotator/shared/storage";

export interface PlanReviewDecision {
	approved: boolean;
	feedback?: string;
	savedPath?: string;
	agentSwitch?: string;
	permissionMode?: string;
}

export interface SessionContext {
	sessionId: string;
	plan: string;
	origin: string;
	permissionMode?: string;
	mode: "plan" | "archive" | "annotate" | "annotate-last";
	customPlanPath?: string | null;
	sharingEnabled: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	slug: string;
	project: string;
	draftKey: string;
	versionInfo: { version: number; totalVersions: number; project: string };
	currentPlanPath: string;
	previousPlan: string | null;
	htmlContent: string;

	// Decision state
	decisionSettled: boolean;
	decisionResult: PlanReviewDecision | null;
	decisionListeners: Set<(result: PlanReviewDecision) => void | Promise<void>>;
	resolveDecision: ((result: PlanReviewDecision) => void) | null;
	decisionPromise: Promise<PlanReviewDecision>;

	// SSE clients for decision streaming
	sseClients: Set<{ write: (data: string) => void; end: () => void; writableEnded?: boolean; destroyed?: boolean }>;

	// Archive state
	archivePlans: unknown[];
	resolveDone: (() => void) | undefined;
	donePromise: Promise<void> | undefined;

	// Annotate-specific
	filePath?: string;
	sourceInfo?: string;
	gate?: boolean;
}

const MAX_SESSIONS = (() => {
	const env = process.env.PLANNOTATOR_MAX_SESSIONS;
	const parsed = env ? parseInt(env, 10) : NaN;
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 50;
})();

const sessionRegistry = new Map<string, SessionContext>();
const slugToSessionId = new Map<string, string>();

function sanitizeForSlug(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

function resolveUniqueSlug(baseSlug: string): string {
	if (!slugToSessionId.has(baseSlug)) return baseSlug;
	let i = 2;
	while (slugToSessionId.has(`${baseSlug}-${i}`)) i++;
	return `${baseSlug}-${i}`;
}

export function getMaxSessions(): number {
	return MAX_SESSIONS;
}

export function registerSession(state: SessionContext): void {
	if (sessionRegistry.size >= MAX_SESSIONS) {
		throw new Error(`Concurrent session limit reached (${MAX_SESSIONS}). Set PLANNOTATOR_MAX_SESSIONS to increase.`);
	}
	sessionRegistry.set(state.sessionId, state);
	const baseNameSlug = sanitizeForSlug(state.slug);
	if (baseNameSlug) {
		const uniqueSlug = resolveUniqueSlug(baseNameSlug);
		slugToSessionId.set(uniqueSlug, state.sessionId);
	}
}

export function unregisterSession(sessionId: string): void {
	const state = sessionRegistry.get(sessionId);
	if (state) {
		for (const client of state.sseClients) {
			try {
				if (!client.writableEnded && !client.destroyed) client.end();
			} catch { /* already disconnected */ }
		}
		state.sseClients.clear();
		for (const [slug, id] of slugToSessionId.entries()) {
			if (id === sessionId) slugToSessionId.delete(slug);
		}
		sessionRegistry.delete(sessionId);
	}
}

export function getSession(sessionId: string): SessionContext | undefined {
	let found = sessionRegistry.get(sessionId);
	if (!found) {
		const mapped = slugToSessionId.get(sessionId);
		if (mapped) found = sessionRegistry.get(mapped);
	}
	return found;
}

export function listSessions(): SessionContext[] {
	return Array.from(sessionRegistry.values());
}

export function getSessionCount(): number {
	return sessionRegistry.size;
}

export function clearSessions(): void {
	sessionRegistry.clear();
	slugToSessionId.clear();
}

export function parseSessionPath(pathname: string): { sessionId: string | null; apiPath: string } {
	const match = /^\/s\/([^/]+)(\/api\/.*)$/.exec(pathname);
	if (match) return { sessionId: match[1], apiPath: match[2] };
	return { sessionId: null, apiPath: pathname };
}

export function createSessionState(options: {
	plan: string;
	origin?: string;
	permissionMode?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	mode?: "plan" | "archive" | "annotate" | "annotate-last";
	customPlanPath?: string | null;
	sessionId?: string;
	htmlContent?: string;
	filePath?: string;
	sourceInfo?: string;
	gate?: boolean;
}): SessionContext {
	const sessionId = options.sessionId || randomUUID();
	const isArchive = options.mode === "archive";
	const isAnnotate = options.mode === "annotate" || options.mode === "annotate-last";
	const slug = !isArchive && !isAnnotate ? generateSlug(options.plan) : "";
	const project = "_unknown"; // sync fallback; caller sets via detectProjectName()

	let version = 0;
	let totalVersions = 0;
	let currentPlanPath = "";
	let previousPlan: string | null = null;
	let draftKey = "";

	if (!isArchive && !isAnnotate) {
		try {
			const historyResult = saveToHistory(project, slug, options.plan);
			version = historyResult.version;
			totalVersions = getVersionCount(project, slug);
			currentPlanPath = historyResult.path;
			previousPlan = version > 1 ? getPlanVersion(project, slug, version - 1) : null;
			draftKey = contentHash(options.plan);
		} catch (err) {
			console.error("[plannotator] Warning: saveToHistory failed:", err);
			draftKey = contentHash(options.plan);
		}
	} else if (isAnnotate) {
		draftKey = contentHash(options.plan);
	}

	let resolveDecision!: (result: PlanReviewDecision) => void;
	const decisionListeners = new Set<(result: PlanReviewDecision) => void | Promise<void>>();
	const sseClients = new Set<{ write: (data: string) => void; end: () => void; writableEnded?: boolean; destroyed?: boolean }>();
	const decisionPromise = new Promise<PlanReviewDecision>((r) => {
		resolveDecision = r;
	});

	return {
		sessionId,
		plan: options.plan,
		origin: options.origin ?? "claude-code",
		permissionMode: options.permissionMode,
		mode: options.mode ?? "plan",
		customPlanPath: options.customPlanPath,
		sharingEnabled: options.sharingEnabled ?? true,
		shareBaseUrl: options.shareBaseUrl,
		pasteApiUrl: options.pasteApiUrl,
		slug,
		project,
		draftKey,
		versionInfo: { version, totalVersions, project },
		currentPlanPath,
		previousPlan,
		htmlContent: options.htmlContent ?? "",
		decisionSettled: false,
		decisionResult: null,
		decisionListeners,
		sseClients,
		resolveDecision,
		decisionPromise,
		archivePlans: [],
		resolveDone: undefined,
		donePromise: undefined,
		filePath: options.filePath,
		sourceInfo: options.sourceInfo,
		gate: options.gate,
	};
}

export function publishDecision(state: SessionContext, result: PlanReviewDecision): boolean {
	if (state.decisionSettled) return false;
	state.decisionSettled = true;
	state.decisionResult = result;
	state.resolveDecision?.(result);

	for (const listener of state.decisionListeners) {
		Promise.resolve(listener(result)).catch((error) => {
			console.error("[Plan Review] Decision listener failed:", error);
		});
	}

	let payload: string;
	try {
		payload = `event: decision\ndata: ${JSON.stringify(result)}\n\n`;
	} catch (err) {
		payload = `event: decision\ndata: {}\n\n`;
		console.error("[Plan Review] JSON.stringify failed for decision:", err);
	}
	for (const client of state.sseClients) {
		try {
			if (!client.writableEnded && !client.destroyed) {
				client.write(payload);
				client.end();
			}
		} catch { /* Client already disconnected */ }
	}
	state.sseClients.clear();
	return true;
}
