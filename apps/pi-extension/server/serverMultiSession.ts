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
	MAX_SESSIONS_LIMIT,
} from "./session-registry.js";
import { listArchivedPlans, readArchivedPlan } from "../generated/storage.js";
import { detectProjectName } from "./project.js";
import { handleFavicon, handleImageRequest, handleUploadRequest } from "./handlers.js";
import { html, json, parseBody, requestUrl } from "./helpers.js";
import { buildServerUrl, getServerHost, getServerPort, isRemoteSession, listenOnPort, openBrowser } from "./network.js";
import { handleDocRequest, handleFileBrowserRequest, handleObsidianDocRequest, handleObsidianFilesRequest, handleObsidianVaultsRequest } from "./reference.js";

/**
 * Regex to extract slug from bare session paths: /s/<slug> or /s/<slug>/anything
 */
const BARE_SESSION_SLUG_REGEX = /^\/s\/([^/]+)(?:\/.*)?$/;

/**
 * Extract session slug from any /s/<slug>... path.
 */
function extractSessionSlug(pathname: string): string | null {
	const match = BARE_SESSION_SLUG_REGEX.exec(pathname);
	return match ? match[1] : null;
}

/**
 * Inject session base path into HTML so client-side fetch('/api/...') resolves correctly.
 * Uses lastIndexOf for </head> because the bundled JS (DOMPurify source) contains that literal.
 */
function injectSessionPath(htmlContent: string, slug: string): string {
	if (!htmlContent) return htmlContent;
	const headCloseIdx = htmlContent.lastIndexOf("</head>");
	if (headCloseIdx === -1) return htmlContent;
	const injection = `<script>window.__PLANNOTATOR_SESSION_PATH__="/s/${slug}"<` + `/script>`;
	return htmlContent.slice(0, headCloseIdx) + injection + htmlContent.slice(headCloseIdx);
}

export interface MultiSessionPlanResult {
	reviewId: string;
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<PlanReviewDecision>;
	onDecision: (listener: (result: PlanReviewDecision) => void | Promise<void>) => () => void;
	waitForDone?: () => Promise<void>;
	stop: () => void;
}

// Singleton server
let sharedServer: Server | null = null;
let sharedPort = 0;
let sharedPortSource: "env" | "remote-default" | "random" = "random";
let sharedHtmlContent = "";
let sharedUrl = "";
let serverRefCount = 0;

async function probeExistingServer(port: number): Promise<{ alive: boolean; url: string }> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 500);
		const res = await fetch(`http://localhost:${port}/api/agents`, { signal: controller.signal });
		clearTimeout(timeout);
		if (res.ok) {
			const body = (await res.json()) as any;
			if (body && typeof body === "object" && "agents" in body) {
				return { alive: true, url: `http://localhost:${port}` };
			}
		}
		return { alive: false, url: "" };
	} catch {
		return { alive: false, url: "" };
	}
}

export async function startMultiSessionPlanServer(options: {
	plan: string;
	htmlContent: string;
	origin?: string;
	permissionMode?: string;
	mode?: "plan" | "archive";
	customPlanPath?: string | null;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	sessionId?: string;
}): Promise<MultiSessionPlanResult> {
	const sessionId = options.sessionId || randomUUID();

	// --- Client mode: connect to existing server ---
	const fixedPort = parseInt(process.env.PLANNOTATOR_PI_PORT || "19432", 10);
	const probe = await probeExistingServer(fixedPort);

	if (probe.alive) {
		// Register session via HTTP
		const newSessionId = sessionId;
		try {
			const res = await fetch(`${probe.url}/api/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ plan: options.plan, sessionId: newSessionId, mode: options.mode }),
			});
			if (!res.ok) throw new Error(`POST /api/sessions failed: ${res.status}`);

			const sessionUrl = `${probe.url}/s/${newSessionId}`;

			// Return client-mode result — stop is no-op, decision polling
			let decisionResolve: (value: any) => void;
			const decisionPromise = new Promise<any>((resolve) => {
				decisionResolve = resolve;
			});
			let stopped = false;
			let decisionSettled = false;
			let pollAttempts = 0;
			const MAX_POLL_ATTEMPTS = 120; // 2 minutes at 1s interval

			const clientListeners = new Set<Function>();

			// Poll for decision
			const pollInterval = setInterval(async () => {
				if (stopped) { clearInterval(pollInterval); return; }
				pollAttempts++;
				if (pollAttempts > MAX_POLL_ATTEMPTS) {
					clearInterval(pollInterval);
					if (!decisionSettled) {
						decisionSettled = true;
						decisionResolve!({ approved: false, feedback: "Polling timed out — server unreachable" });
					}
					return;
				}
				try {
					const r = await fetch(`${probe.url}/api/sessions/${newSessionId}/decision`);
					if (r.ok) {
						const data = (await r.json()) as any;
						if (data.settled) {
							clearInterval(pollInterval);
							if (!decisionSettled) {
								decisionSettled = true;
								decisionResolve!(data.result ?? { approved: false });
							}
						}
					}
				} catch {
					// Server might be temporarily unreachable, keep polling
				}
			}, 1000);

			return {
				reviewId: newSessionId,
				port: fixedPort,
				portSource: "env" as const,
				url: sessionUrl,
				waitForDecision: () => decisionPromise,
				onDecision: (listener) => {
					clientListeners.add(listener);
					decisionPromise.then((r) => {
						if (clientListeners.has(listener)) listener(r);
					});
					return () => { clientListeners.delete(listener); };
				},
				waitForDone: undefined,
				stop: () => {
					stopped = true;
					clearInterval(pollInterval);
					if (!decisionSettled) {
						decisionSettled = true;
						decisionResolve!({ approved: false, feedback: "Client stopped" });
					}
				},
			};
		} catch {
			// POST failed — server died between probe and register
			// Fall through to start own server
		}
	}

	// Create session state
	const state = createSessionState({
		plan: options.plan,
		origin: options.origin,
		permissionMode: options.permissionMode,
		mode: options.mode,
		customPlanPath: options.customPlanPath,
		sharingEnabled: options.sharingEnabled,
		shareBaseUrl: options.shareBaseUrl,
		pasteApiUrl: options.pasteApiUrl,
		sessionId,
		htmlContent: options.htmlContent,
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
			waitForDone: state.donePromise ? () => state.donePromise! : undefined,
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

		// NEW: Decision polling endpoint
		const decisionMatch = /^\/api\/sessions\/([^/]+)\/decision$/.exec(apiPath);
		if (decisionMatch && req.method === "GET") {
			const targetSessionId = decisionMatch[1];
			const sessionState = getSession(targetSessionId);
			if (!sessionState) {
				json(res, { error: "Session not found" }, 404);
				return;
			}
			const settled = sessionState.decisionSettled;
			json(res, {
				settled,
				result: settled ? sessionState.decisionResult : undefined,
			});
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
			const handled = await handleSessionApiRequest(req, res, sessionState, apiPath);
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

		// API routes without a session should 404, not serve HTML
		if (apiPath.startsWith("/api/")) {
			json(res, { error: "Session required for API routes", path: apiPath }, 404);
			return;
		}

		// SPA fallback: inject session base path into HTML so client JS
		// knows to fetch /s/{slug}/api/... instead of flat /api/...
		const slug = pathSessionId || extractSessionSlug(url.pathname);
		if (slug) {
			const sessState = getSession(slug);
			if (!sessState) {
				json(res, { error: "Session not found", sessionId: slug }, 404);
				return;
			}
			const content = sessState.htmlContent || sharedHtmlContent;
			html(res, injectSessionPath(content, slug));
		} else {
			// Root URL — serve HTML with no session injection (shows session picker or demo)
			html(res, sharedHtmlContent);
		}
	});

	// For multi-session mode, use fixed port so other pi processes can discover us
	const host = getServerHost();
	const multiPort = parseInt(process.env.PLANNOTATOR_PI_PORT || process.env.PLANNOTATOR_PORT || '19432', 10);

	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(multiPort, host, () => {
				server.removeListener('error', reject);
				resolve();
			});
		});
	} catch (err: unknown) {
		// Fixed port unavailable — fall back to random
		if (server.listening) {
			await new Promise<void>((r, j) => server.close((e) => e ? j(e) : r()));
		}
		const fallback = await listenOnPort(server);
		sharedPort = fallback.port;
		sharedPortSource = fallback.portSource;
		sharedUrl = fallback.url;
		sharedServer = server;
		sharedHtmlContent = options.htmlContent;
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
			waitForDone: state.donePromise ? () => state.donePromise! : undefined,
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

	const addr = server.address() as { port: number };
	sharedServer = server;
	sharedHtmlContent = options.htmlContent;
	sharedPort = addr.port;
	sharedPortSource = 'env';
	sharedUrl = buildServerUrl(host, addr.port);

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
		waitForDone: state.donePromise ? () => state.donePromise! : undefined,
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
