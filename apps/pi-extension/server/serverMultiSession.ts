/**
 * Multi-Session Plan Server — one port, many concurrent plan reviews.
 *
 * Usage: Two pi processes can both submit plans to the same server.
 * Each gets a unique session URL: http://host:port/s/{sessionId}
 *
 * First invocation starts the server. Subsequent invocations POST /api/sessions
 * to add their plan to the already-running server.
 */

import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import {
	type PlanReviewDecision,
	createSessionState,
	getSession,
	handleSessionApiRequest,
	listSessions,
	parseSessionPath,
	registerSession,
	unregisterSession,
	getSessionCount,
	MAX_SESSIONS_LIMIT,
} from "./session-registry.js";
import { listArchivedPlans, readArchivedPlan } from "../generated/storage.js";
import { detectProjectName } from "./project.js";
import { handleFavicon, handleImageRequest, handleUploadRequest } from "./handlers.js";
import { json, parseBody, requestUrl } from "./helpers.js";
import { buildServerUrl, getServerHost, getServerPort, isRemoteSession, listenOnPort, openBrowser } from "./network.js";
import { handleDocRequest, handleFileBrowserRequest, handleObsidianDocRequest, handleObsidianFilesRequest, handleObsidianVaultsRequest } from "./reference.js";

export interface MultiSessionPlanResult {
	reviewId: string;
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<PlanReviewDecision>;
	onDecision: (listener: (result: PlanReviewDecision) => void | Promise<void>) => () => void;
	stop: () => void;
}

// Singleton server
let sharedServer: Server | null = null;
let sharedPort = 0;
let sharedPortSource: "env" | "remote-default" | "random" = "random";
let sharedHtmlContent = "";
let sharedUrl = "";
let serverRefCount = 0;

export async function startMultiSessionPlanServer(options: {
	plan: string;
	htmlContent: string;
	origin?: string;
	permissionMode?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	sessionId?: string;
}): Promise<MultiSessionPlanResult> {
	const sessionId = options.sessionId || randomUUID();
	sharedHtmlContent = options.htmlContent;

	// Create session state
	const state = createSessionState({
		plan: options.plan,
		origin: options.origin,
		permissionMode: options.permissionMode,
		sharingEnabled: options.sharingEnabled,
		shareBaseUrl: options.shareBaseUrl,
		pasteApiUrl: options.pasteApiUrl,
		sessionId,
	});

	// If server already running, just register the session
	if (sharedServer && sharedServer.listening) {
		registerSession(state);
		serverRefCount++;

		const sessionUrl = `${sharedUrl}/s/${sessionId}`;
		return {
			reviewId: sessionId,
			port: sharedPort,
			portSource: sharedPortSource,
			url: sessionUrl,
			waitForDecision: () => state.decisionPromise,
			onDecision: (listener) => {
				state.decisionListeners.add(listener);
				return () => state.decisionListeners.delete(listener);
			},
			stop: () => {
				unregisterSession(sessionId);
				serverRefCount--;
				if (serverRefCount <= 0) {
					sharedServer?.close();
					sharedServer = null;
					serverRefCount = 0;
				}
			},
		};
	}

	// Start new server
	const server = createServer(async (req, res) => {
		const url = requestUrl(req);
		const { sessionId: pathSessionId, apiPath } = parseSessionPath(url.pathname);

		// --- Global endpoints (not session-specific) ---
		if (apiPath === "/api/sessions" && req.method === "POST") {
			try {
				const body = (await parseBody(req)) as { plan?: string; mode?: string; name?: string; sessionId?: string };
				if (!body.plan) { json(res, { error: "plan is required" }, 400); return; }
				const newSessionId = body.sessionId || randomUUID();
				const newState = createSessionState({
					plan: body.plan,
					sessionId: newSessionId,
				});
				registerSession(newState);
				json(res, {
					sessionId: newSessionId,
					url: `${sharedUrl}/s/${newSessionId}`,
					plan: body.plan.slice(0, 200),
					slug: newState.slug,
					name: body.name ?? null,
					mode: newState.mode,
					project: newState.project,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : "Failed to create session";
				json(res, { error: message }, 500);
			}
			return;
		}

		if (apiPath === "/api/sessions" && req.method === "GET") {
			const sessions = listSessions().map((s) => ({
				sessionId: s.sessionId,
				mode: s.mode,
				origin: s.origin,
				project: s.project,
				slug: s.slug,
				name: null,
				cwd: process.cwd(),
				url: `${sharedUrl}/s/${s.sessionId}`,
			}));
			json(res, { sessions, count: sessions.length, maxSessions: MAX_SESSIONS_LIMIT });
			return;
		}

		if (apiPath === "/api/plans" && req.method === "GET") {
			const project = detectProjectName();
			const { listProjectPlans } = await import("../generated/storage.js");
			json(res, { plans: listProjectPlans(project).map((e: any) => ({ ...e, project })) });
			return;
		}

		if (apiPath === "/api/agents" && req.method === "GET") {
			json(res, { agents: [] });
			return;
		}

		if (apiPath === "/api/archive/plans" && req.method === "GET") {
			const customPath = url.searchParams.get("customPath") || undefined;
			json(res, { plans: listArchivedPlans(customPath) });
			return;
		}

		if (apiPath === "/api/archive/plan" && req.method === "GET") {
			const filename = url.searchParams.get("filename");
			const customPath = url.searchParams.get("customPath") || undefined;
			if (!filename) { json(res, { error: "Missing filename" }, 400); return; }
			const markdown = readArchivedPlan(filename, customPath);
			if (!markdown) { json(res, { error: "Not found" }, 404); return; }
			json(res, { markdown, filepath: filename });
			return;
		}

		// --- Session-specific endpoints ---
		if (pathSessionId) {
			const sessionState = getSession(pathSessionId);
			if (!sessionState) {
				json(res, {
					error: "Session not found",
					sessionId: pathSessionId,
					message: `No active session with id "${pathSessionId}"`,
				}, 404);
				return;
			}
			const handled = await handleSessionApiRequest(req, res, sessionState, apiPath, sharedHtmlContent);
			if (handled) return;
		}

		// Static / shared routes
		if (apiPath === "/api/image") { handleImageRequest(res, url); return; }
		if (apiPath === "/api/upload" && req.method === "POST") { await handleUploadRequest(req, res); return; }
		if (apiPath === "/api/doc" && req.method === "GET") { handleDocRequest(res, url); return; }
		if (apiPath === "/api/obsidian/vaults") { handleObsidianVaultsRequest(res); return; }
		if (apiPath === "/api/reference/obsidian/files" && req.method === "GET") { handleObsidianFilesRequest(res, url); return; }
		if (apiPath === "/api/reference/obsidian/doc" && req.method === "GET") { handleObsidianDocRequest(res, url); return; }
		if (apiPath === "/api/reference/files" && req.method === "GET") { handleFileBrowserRequest(res, url); return; }
		if (apiPath === "/favicon.svg") { handleFavicon(res); return; }

		// Fallback: serve HTML
		html(res, sharedHtmlContent);
	});

	const result = await listenOnPort(server);
	sharedServer = server;
	sharedPort = result.port;
	sharedPortSource = result.portSource;
	sharedUrl = result.url;

	// Register the initial session
	registerSession(state);
	serverRefCount++;

	const sessionUrl = `${sharedUrl}/s/${sessionId}`;
	return {
		reviewId: sessionId,
		port: sharedPort,
		portSource: sharedPortSource,
		url: sessionUrl,
		waitForDecision: () => state.decisionPromise,
		onDecision: (listener) => {
			state.decisionListeners.add(listener);
			return () => state.decisionListeners.delete(listener);
		},
		stop: () => {
			unregisterSession(sessionId);
			serverRefCount--;
			if (serverRefCount <= 0) {
				server.close();
				sharedServer = null;
				serverRefCount = 0;
			}
		},
	};
}
