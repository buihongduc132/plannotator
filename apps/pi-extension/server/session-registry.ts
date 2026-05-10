/**
 * Session Registry — in-memory store for multi-session plan review.
 *
 * Each session represents one plan/review/annotate flow with its own
 * plan content, decision state, and draft key. The registry allows a
 * single HTTP server to serve multiple concurrent sessions.
 */

import { randomUUID } from "node:crypto";
import { contentHash, deleteDraft } from "../generated/draft.js";
import {
	generateSlug,
	getPlanVersion,
	getVersionCount,
	listVersions,
	saveAnnotations,
	saveFinalSnapshot,
	saveToHistory,
} from "../generated/storage.js";
import { saveConfig, detectGitUser, getServerConfig } from "../generated/config.js";
import { detectProjectName } from "./project.js";
import { handleDraftRequest, handleFavicon, handleImageRequest, handleUploadRequest } from "./handlers.js";
import { html, json, parseBody, requestUrl } from "./helpers.js";
import { createEditorAnnotationHandler } from "./annotations.js";
import { createExternalAnnotationHandler } from "./external-annotations.js";
import type { ArchivedPlan, listArchivedPlans, readArchivedPlan } from "../generated/storage.js";

export interface PlanReviewDecision {
	approved: boolean;
	feedback?: string;
	savedPath?: string;
	agentSwitch?: string;
	permissionMode?: string;
}

export interface SessionState {
	sessionId: string;
	plan: string;
	origin: string;
	permissionMode?: string;
	mode: "plan" | "archive";
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
	editorAnnotations: ReturnType<typeof createEditorAnnotationHandler> | null;
	externalAnnotations: ReturnType<typeof createExternalAnnotationHandler> | null;

	// Decision state
	decisionSettled: boolean;
	decisionResult: PlanReviewDecision | null;
	decisionListeners: Set<(result: PlanReviewDecision) => void | Promise<void>>;
	sseClients: Set<import("node:http").ServerResponse>;
	resolveDecision: ((result: PlanReviewDecision) => void) | null;
	decisionPromise: Promise<PlanReviewDecision>;

	// Archive state (only for mode=archive)
	archivePlans: any[];
	resolveDone: (() => void) | undefined;
	donePromise: Promise<void> | undefined;
}

const MAX_SESSIONS = 50;
const sessionRegistry = new Map<string, SessionState>();

export function registerSession(state: SessionState): void {
	if (sessionRegistry.size >= MAX_SESSIONS) {
		throw new Error(`Concurrent session limit reached (${MAX_SESSIONS})`);
	}
	sessionRegistry.set(state.sessionId, state);
}

export function unregisterSession(sessionId: string): void {
	const state = sessionRegistry.get(sessionId);
	if (state) {
		// Close SSE clients
		for (const client of state.sseClients) {
			if (!client.writableEnded) client.end();
		}
		state.sseClients.clear();
		sessionRegistry.delete(sessionId);
	}
}

export function getSession(sessionId: string): SessionState | undefined {
	return sessionRegistry.get(sessionId);
}

export function listSessions(): SessionState[] {
	return Array.from(sessionRegistry.values());
}

export function getSessionCount(): number {
	return sessionRegistry.size;
}

export const MAX_SESSIONS_LIMIT = MAX_SESSIONS;

/**
 * Parse /s/<sessionId>/api/* paths.
 */
export function parseSessionPath(pathname: string): { sessionId: string | null; apiPath: string } {
	const match = /^\/s\/([^/]+)(\/api\/.*)$/.exec(pathname);
	if (match) return { sessionId: match[1], apiPath: match[2] };
	return { sessionId: null, apiPath: pathname };
}

/**
 * Create a new session state from a plan string.
 */
export function createSessionState(options: {
	plan: string;
	origin?: string;
	permissionMode?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	mode?: "plan" | "archive";
	customPlanPath?: string | null;
	sessionId?: string;
}): SessionState {
	const sessionId = options.sessionId || randomUUID();
	const slug = generateSlug(options.plan);
	const project = detectProjectName();
	const historyResult = saveToHistory(project, slug, options.plan);
	const previousPlan = historyResult.version > 1
		? getPlanVersion(project, slug, historyResult.version - 1)
		: null;
	const draftKey = contentHash(options.plan);

	let resolveDecision!: (result: PlanReviewDecision) => void;
	const decisionListeners = new Set<(result: PlanReviewDecision) => void | Promise<void>>();
	const sseClients = new Set<import("node:http").ServerResponse>();
	const decisionPromise = new Promise<PlanReviewDecision>((r) => {
		resolveDecision = r;
	});

	return {
		sessionId,
		plan: options.plan,
		origin: options.origin ?? "pi",
		permissionMode: options.permissionMode,
		mode: options.mode ?? "plan",
		customPlanPath: options.customPlanPath,
		sharingEnabled: options.sharingEnabled ?? true,
		shareBaseUrl: options.shareBaseUrl,
		pasteApiUrl: options.pasteApiUrl,
		slug,
		project,
		draftKey,
		versionInfo: {
			version: historyResult.version,
			totalVersions: getVersionCount(project, slug),
			project,
		},
		currentPlanPath: historyResult.path,
		previousPlan,
		editorAnnotations: createEditorAnnotationHandler(),
		externalAnnotations: createExternalAnnotationHandler("plan"),
		decisionSettled: false,
		decisionResult: null,
		decisionListeners,
		sseClients,
		resolveDecision,
		decisionPromise,
		archivePlans: [],
		resolveDone: undefined,
		donePromise: undefined,
	};
}

/**
 * Publish a decision for a specific session.
 */
export function publishDecision(state: SessionState, result: PlanReviewDecision): boolean {
	if (state.decisionSettled) return false;
	state.decisionSettled = true;
	state.decisionResult = result;
	state.resolveDecision?.(result);

	for (const listener of state.decisionListeners) {
		Promise.resolve(listener(result)).catch((error) => {
			console.error("[Plan Review] Decision listener failed:", error);
		});
	}

	const payload = `event: decision\ndata: ${JSON.stringify(result)}\n\n`;
	for (const client of state.sseClients) {
		client.write(payload);
		client.end();
	}
	state.sseClients.clear();
	return true;
}

/**
 * Handle a plan API request for a specific session.
 * Returns true if the request was handled.
 */
export async function handleSessionApiRequest(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	state: SessionState,
	apiPath: string,
	htmlContent: string,
): Promise<boolean> {
	const url = requestUrl(req);
	const gitUser = detectGitUser();

	if (apiPath === "/api/plan" && req.method === "GET") {
		if (state.mode === "archive") {
			json(res, {
				plan: state.archivePlans.length > 0 ? state.archivePlans[0] : "",
				origin: state.origin,
				mode: "archive",
				archivePlans: state.archivePlans,
				sharingEnabled: state.sharingEnabled,
				shareBaseUrl: state.shareBaseUrl,
				serverConfig: getServerConfig(gitUser),
			});
		} else {
			json(res, {
				plan: state.plan,
				origin: state.origin,
				permissionMode: state.permissionMode,
				previousPlan: state.previousPlan,
				versionInfo: state.versionInfo,
				sharingEnabled: state.sharingEnabled,
				shareBaseUrl: state.shareBaseUrl,
				pasteApiUrl: state.pasteApiUrl,
				repoInfo: null,
				projectRoot: process.cwd(),
				serverConfig: getServerConfig(gitUser),
			});
		}
		return true;
	}

	if (apiPath === "/api/plan/version") {
		const vParam = url.searchParams.get("v");
		if (!vParam) { json(res, { error: "Missing v parameter" }, 400); return true; }
		const v = parseInt(vParam, 10);
		if (Number.isNaN(v) || v < 1) { json(res, { error: "Invalid version number" }, 400); return true; }
		const content = getPlanVersion(state.project, state.slug, v);
		if (content === null) { json(res, { error: "Version not found" }, 404); return true; }
		json(res, { plan: content, version: v });
		return true;
	}

	if (apiPath === "/api/plan/versions") {
		json(res, { project: state.project, slug: state.slug, versions: listVersions(state.project, state.slug) });
		return true;
	}

	if (apiPath === "/api/approve" && req.method === "POST") {
		if (state.decisionSettled) { json(res, { ok: true, duplicate: true }); return true; }
		let feedback: string | undefined;
		let agentSwitch: string | undefined;
		let requestedPermissionMode: string | undefined;
		let planSaveEnabled = true;
		let planSaveCustomPath: string | undefined;
		try {
			const body = await parseBody(req);
			if (body.feedback) feedback = body.feedback as string;
			if (body.agentSwitch) agentSwitch = body.agentSwitch as string;
			if (body.permissionMode) requestedPermissionMode = body.permissionMode as string;
			if (body.planSave !== undefined) {
				const ps = body.planSave as { enabled: boolean; customPath?: string };
				planSaveEnabled = ps.enabled;
				planSaveCustomPath = ps.customPath;
			}
		} catch {}
		let savedPath: string | undefined;
		if (planSaveEnabled) {
			const annotations = feedback || "";
			if (annotations) saveAnnotations(state.slug, annotations, planSaveCustomPath);
			savedPath = saveFinalSnapshot(state.slug, "approved", state.plan, annotations, planSaveCustomPath);
		}
		deleteDraft(state.draftKey);
		publishDecision(state, {
			approved: true,
			feedback,
			savedPath,
			agentSwitch,
			permissionMode: requestedPermissionMode || state.permissionMode,
		});
		json(res, { ok: true, savedPath });
		return true;
	}

	if (apiPath === "/api/deny" && req.method === "POST") {
		if (state.decisionSettled) { json(res, { ok: true, duplicate: true }); return true; }
		let feedback = "Plan rejected by user";
		let planSaveEnabled = true;
		let planSaveCustomPath: string | undefined;
		try {
			const body = await parseBody(req);
			feedback = (body.feedback as string) || feedback;
			if (body.planSave !== undefined) {
				const ps = body.planSave as { enabled: boolean; customPath?: string };
				planSaveEnabled = ps.enabled;
				planSaveCustomPath = ps.customPath;
			}
		} catch {}
		let savedPath: string | undefined;
		if (planSaveEnabled) {
			saveAnnotations(state.slug, feedback, planSaveCustomPath);
			savedPath = saveFinalSnapshot(state.slug, "denied", state.plan, feedback, planSaveCustomPath);
		}
		deleteDraft(state.draftKey);
		publishDecision(state, { approved: false, feedback, savedPath });
		json(res, { ok: true, savedPath });
		return true;
	}

	if (apiPath === "/api/decision" && req.method === "GET") {
		if (!state.decisionSettled) { json(res, { pending: true }); return true; }
		json(res, state.decisionResult ?? { pending: true });
		return true;
	}

	if (apiPath === "/api/decision/stream" && req.method === "GET") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		});
		res.write("event: connected\ndata: {}\n\n");
		if (state.decisionSettled && state.decisionResult) {
			res.write(`event: decision\ndata: ${JSON.stringify(state.decisionResult)}\n\n`);
			res.end();
			return true;
		}
		state.sseClients.add(res);
		req.on("close", () => { state.sseClients.delete(res); });
		return true;
	}

	if (apiPath === "/api/config" && req.method === "POST") {
		try {
			const body = (await parseBody(req)) as { displayName?: string; diffOptions?: Record<string, unknown>; conventionalComments?: boolean };
			const toSave: Record<string, unknown> = {};
			if (body.displayName !== undefined) toSave.displayName = body.displayName;
			if (body.diffOptions !== undefined) toSave.diffOptions = body.diffOptions;
			if (body.conventionalComments !== undefined) toSave.conventionalComments = body.conventionalComments;
			if (Object.keys(toSave).length > 0) saveConfig(toSave as Parameters<typeof saveConfig>[0]);
			json(res, { ok: true });
		} catch { json(res, { error: "Invalid request" }, 400); }
		return true;
	}

	if (apiPath === "/api/done" && req.method === "POST") {
		state.resolveDone?.();
		json(res, { ok: true });
		return true;
	}

	if (apiPath === "/api/image") { handleImageRequest(res, url); return true; }
	if (apiPath === "/api/upload" && req.method === "POST") { await handleUploadRequest(req, res); return true; }
	if (apiPath === "/api/draft") { await handleDraftRequest(req, res, state.draftKey); return true; }

	if (apiPath === "/favicon.svg") { handleFavicon(res); return true; }

	if (state.editorAnnotations && await state.editorAnnotations.handle(req, res, url)) return true;
	if (state.externalAnnotations && await state.externalAnnotations.handle(req, res, url)) return true;

	return false;
}
