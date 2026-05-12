/**
 * Session Registry — in-memory store for multi-session plan review.
 *
 * Each session represents one plan/review/annotate flow with its own
 * plan content, decision state, and draft key. The registry allows a
 * single HTTP server to serve multiple concurrent sessions.
 *
 * Parity with Bun server (packages/server/index.ts):
 * - SessionContext with all fields from Bun's SessionContext
 * - slugToSessionId for name-based URL routing
 * - decisionResolvers for independent concurrent decisions
 * - MAX_SESSIONS via PLANNOTATOR_MAX_SESSIONS env var
 * - Integrations: Obsidian, Bear, Octarine, VS Code diff
 * - Archive mode per session
 */

import { randomUUID } from "node:crypto";
import { contentHash, deleteDraft } from "../generated/draft.js";
import {
	generateSlug,
	getPlanVersion,
	getPlanVersionPath,
	getVersionCount,
	listVersions,
	saveAnnotations,
	saveFinalSnapshot,
	saveToHistory,
} from "../generated/storage.js";
import { saveConfig, detectGitUser, getServerConfig } from "../generated/config.js";
import { detectProjectName } from "./project.js";
import {
	handleDraftRequest,
	handleFavicon,
	handleImageRequest,
	handleUploadRequest,
} from "./handlers.js";
import { detectWSL, html, json, parseBody, requestUrl } from "./helpers.js";
import { createEditorAnnotationHandler } from "./annotations.js";
import { createExternalAnnotationHandler } from "./external-annotations.js";
import { openEditorDiff } from "./ide.js";
import {
	type BearConfig,
	type IntegrationResult,
	type ObsidianConfig,
	type OctarineConfig,
	saveToBear,
	saveToObsidian,
	saveToOctarine,
} from "./integrations.js";
import {
	handleDocRequest,
	handleFileBrowserRequest,
	handleObsidianDocRequest,
	handleObsidianFilesRequest,
	handleObsidianVaultsRequest,
} from "./reference.js";

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



export const MAX_SESSIONS_LIMIT = MAX_SESSIONS;

export function registerSession(state: SessionContext): void {
	if (sessionRegistry.size >= MAX_SESSIONS) {
		throw new Error(`Concurrent session limit reached (${MAX_SESSIONS}). Set PLANNOTATOR_MAX_SESSIONS to increase.`);
	}
	sessionRegistry.set(state.sessionId, state);
	// Register name-based slug for /s/{name} routing
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
			if (!client.writableEnded) client.end();
		}
		state.sseClients.clear();
		// Clean up name-based slug mapping
		for (const [slug, id] of slugToSessionId.entries()) {
			if (id === sessionId) slugToSessionId.delete(slug);
		}
		sessionRegistry.delete(sessionId);
	}
}

export function getSession(sessionId: string): SessionContext | undefined {
	// Try direct ID lookup, then slug-based lookup
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
	mode?: "plan" | "archive";
	customPlanPath?: string | null;
	sessionId?: string;
}): SessionContext {
	const sessionId = options.sessionId || randomUUID();
	const isArchive = options.mode === "archive";
	const slug = !isArchive ? generateSlug(options.plan) : "";
	const project = detectProjectName();
	let version = 0;
	let totalVersions = 0;
	let currentPlanPath = "";
	let previousPlan: string | null = null;
	let draftKey = "";
	if (!isArchive) {
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
	}

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
		versionInfo: { version, totalVersions, project },
		currentPlanPath,
		previousPlan,
		editorAnnotations: isArchive ? null : createEditorAnnotationHandler(),
		externalAnnotations: isArchive ? null : createExternalAnnotationHandler("plan"),
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
		} catch {
			// Client already disconnected
		}
	}
	state.sseClients.clear();
	return true;
}

/**
 * Run integrations (Obsidian/Bear/Octarine) in parallel.
 */
async function runIntegrations(
	body: Record<string, unknown>,
): Promise<Record<string, IntegrationResult>> {
	const results: Record<string, IntegrationResult> = {};
	const promises: Promise<void>[] = [];

	const obsConfig = body.obsidian as ObsidianConfig | undefined;
	const bearConfig = body.bear as BearConfig | undefined;
	const octConfig = body.octarine as OctarineConfig | undefined;

	if (obsConfig?.vaultPath && obsConfig?.plan) {
		promises.push(saveToObsidian(obsConfig).then((r) => { results.obsidian = r; }));
	}
	if (bearConfig?.plan) {
		promises.push(saveToBear(bearConfig).then((r) => { results.bear = r; }));
	}
	if (octConfig?.plan && octConfig?.workspace) {
		promises.push(saveToOctarine(octConfig).then((r) => { results.octarine = r; }));
	}

	await Promise.allSettled(promises);
	for (const [name, result] of Object.entries(results)) {
		if (!result?.success && result) console.error(`[${name}] Save failed: ${result.error}`);
	}
	return results;
}

/**
 * Handle a plan API request for a specific session.
 * Returns true if the request was handled.
 */
export async function handleSessionApiRequest(
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	state: SessionContext,
	apiPath: string,
	htmlContent: string,
): Promise<boolean> {
	const url = requestUrl(req);
	const gitUser = detectGitUser();

	// GET /api/plan
	if (apiPath === "/api/plan" && req.method === "GET") {
		const wslFlag = detectWSL();
		if (state.mode === "archive") {
			json(res, {
				plan: state.archivePlans.length > 0 ? state.archivePlans[0] : "",
				origin: state.origin,
				mode: "archive",
				archivePlans: state.archivePlans,
				sharingEnabled: state.sharingEnabled,
				shareBaseUrl: state.shareBaseUrl,
				isWSL: wslFlag,
				serverConfig: getServerConfig(gitUser),
				sessionId: state.sessionId,
			});
		} else {
			json(res, {
				plan: state.plan,
				origin: state.origin,
				permissionMode: state.permissionMode,
				sharingEnabled: state.sharingEnabled,
				shareBaseUrl: state.shareBaseUrl,
				pasteApiUrl: state.pasteApiUrl,
				repoInfo: null,
				previousPlan: state.previousPlan,
				versionInfo: state.versionInfo,
				projectRoot: process.cwd(),
				cwd: process.cwd(),
				isWSL: wslFlag,
				serverConfig: getServerConfig(gitUser),
				sessionId: state.sessionId,
			});
		}
		return true;
	}

	// GET /api/plan/version?v=N
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

	// GET /api/plan/versions
	if (apiPath === "/api/plan/versions") {
		json(res, { project: state.project, slug: state.slug, versions: listVersions(state.project, state.slug) });
		return true;
	}

	// POST /api/approve
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
			// Run integrations
			await runIntegrations(body as Record<string, unknown>);
		} catch (err) {
			console.error("[Integration] Error:", err);
		}
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

	// POST /api/deny
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

	// GET /api/decision
	if (apiPath === "/api/decision" && req.method === "GET") {
		if (!state.decisionSettled) { json(res, { pending: true }); return true; }
		json(res, state.decisionResult ?? { pending: true });
		return true;
	}

	// GET /api/decision/stream (SSE)
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

	// POST /api/config
	if (apiPath === "/api/config" && req.method === "POST") {
		try {
			const body = (await parseBody(req)) as { displayName?: string; diffOptions?: Record<string, unknown>; conventionalComments?: boolean; conventionalLabels?: unknown[] | null };
			const toSave: Record<string, unknown> = {};
			if (body.displayName !== undefined) toSave.displayName = body.displayName;
			if (body.diffOptions !== undefined) toSave.diffOptions = body.diffOptions;
			if (body.conventionalComments !== undefined) toSave.conventionalComments = body.conventionalComments;
			if (body.conventionalLabels !== undefined) toSave.conventionalLabels = body.conventionalLabels;
			if (Object.keys(toSave).length > 0) saveConfig(toSave as Parameters<typeof saveConfig>[0]);
			json(res, { ok: true });
		} catch { json(res, { error: "Invalid request" }, 400); }
		return true;
	}

	// POST /api/done (archive mode)
	if (apiPath === "/api/done" && req.method === "POST") {
		state.resolveDone?.();
		json(res, { ok: true });
		return true;
	}

	// POST /api/exit (close session without feedback)
	if (apiPath === "/api/exit" && req.method === "POST") {
		deleteDraft(state.draftKey);
		publishDecision(state, { approved: false, feedback: "", savedPath: undefined });
		json(res, { ok: true });
		return true;
	}

	// POST /api/plan/vscode-diff
	if (apiPath === "/api/plan/vscode-diff" && req.method === "POST") {
		try {
			const body = await parseBody(req);
			const baseVersion = body.baseVersion as number;
			if (!baseVersion) { json(res, { error: "Missing baseVersion" }, 400); return true; }
			const basePath = getPlanVersionPath(state.project, state.slug, baseVersion);
			if (!basePath) { json(res, { error: `Version ${baseVersion} not found` }, 404); return true; }
			const result = await openEditorDiff(basePath, state.currentPlanPath);
			if ("error" in result) { json(res, { error: result.error }, 500); return true; }
			json(res, { ok: true });
		} catch (err) {
			json(res, { error: err instanceof Error ? err.message : "Failed to open VS Code diff" }, 500);
		}
		return true;
	}

	// POST /api/save-notes (Obsidian/Bear/Octarine)
	if (apiPath === "/api/save-notes" && req.method === "POST") {
		try {
			const body = (await parseBody(req)) as Record<string, unknown>;
			const results = await runIntegrations(body);
			json(res, { ok: true, results });
		} catch (err) {
			console.error("[Save Notes] Error:", err);
			json(res, { error: "Save failed" }, 500);
		}
		return true;
	}

	// Shared handlers
	if (apiPath === "/api/image") { handleImageRequest(res, url); return true; }
	if (apiPath === "/api/upload" && req.method === "POST") { await handleUploadRequest(req, res); return true; }
	if (apiPath === "/api/draft") { await handleDraftRequest(req, res, state.draftKey); return true; }
	if (apiPath === "/favicon.svg") { handleFavicon(res); return true; }

	if (state.editorAnnotations && await state.editorAnnotations.handle(req, res, url)) return true;
	if (state.externalAnnotations && await state.externalAnnotations.handle(req, res, url)) return true;

	return false;
}
