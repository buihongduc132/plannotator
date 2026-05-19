import { createServer } from "node:http";
import { dirname, resolve as resolvePath } from "node:path";

import { contentHash, deleteDraft } from "../generated/draft.js";
import { saveConfig, detectGitUser, getServerConfig } from "../generated/config.js";

import {
	handleDraftRequest,
	handleFavicon,
	handleImageRequest,
	handleUploadRequest,
} from "./handlers.js";
import { html, json, parseBody, requestUrl, extractSessionSlug, injectSessionPath } from "./helpers.js";

import { listenOnPort, buildServerUrl, getServerHostname } from "./network.js";

import { getRepoInfo } from "./project.js";
import {
	handleDocRequest,
	handleDocExistsRequest,
	handleFileBrowserRequest,
	handleObsidianVaultsRequest,
	handleObsidianFilesRequest,
	handleObsidianDocRequest,
} from "./reference.js";
import { warmFileListCache } from "../generated/resolve-file.js";
import { createExternalAnnotationHandler } from "./external-annotations.js";
import { parseSessionPath } from "./session-registry.js";

export interface AnnotateServerResult {
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<{ feedback: string; annotations: unknown[]; exit?: boolean; approved?: boolean }>;
	stop: () => void;
}

export async function startAnnotateServer(options: {
	markdown: string;
	filePath: string;
	htmlContent: string;
	origin?: string;
	mode?: string;
	folderPath?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	sourceInfo?: string;
	sourceConverted?: boolean;
	gate?: boolean;
	rawHtml?: string;
	renderHtml?: boolean;
	sessionId?: string;
	cwd?: string;
}): Promise<AnnotateServerResult> {
	// Side-channel pre-warm so /api/doc/exists POSTs land on warm cache.
	void warmFileListCache(process.cwd(), "code");
	const gitUser = detectGitUser();
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;

	let resolveDecision!: (result: {
		feedback: string;
		annotations: unknown[];
		exit?: boolean;
		approved?: boolean;
	}) => void;
	const decisionPromise = new Promise<{
		feedback: string;
		annotations: unknown[];
		exit?: boolean;
		approved?: boolean;
	}>((r) => {
		resolveDecision = r;
	});

	// Folder annotation has no stable markdown body, so key drafts by folder path instead.
	const draftSource =
		options.mode === "annotate-folder" && options.folderPath
			? `folder:${resolvePath(options.folderPath)}`
			: options.renderHtml && options.rawHtml ? options.rawHtml : options.markdown;
	const draftKey = contentHash(draftSource);

	// Detect repo info (cached for this session)
	const repoInfo = getRepoInfo();

	const externalAnnotations = createExternalAnnotationHandler("plan");

	// Session info
	const sessionId = options.sessionId;
	const serverCwd = options.cwd || process.cwd();

	// Track this server's own session for /api/sessions
	const ownSession = {
		sessionId: sessionId || "default",
		mode: (options.mode || "annotate") as string,
		filePath: options.filePath,
		port: 0 as number,
	};

	const server = createServer(async (req, res) => {
		const url = requestUrl(req);

		// --- Session routing ---
		const { sessionId: pathSessionId, apiPath } = parseSessionPath(url.pathname);

		if (pathSessionId !== null) {
			// This is a /s/{sessionId}/... path — validate session
			if (pathSessionId !== sessionId) {
				json(res, { error: "Session mismatch" }, 403);
				return;
			}
			// Rewrite pathname to the apiPath for downstream handlers
			url.pathname = apiPath;
		}

		// External annotations handler (after session routing so URL is rewritten)
		if (await externalAnnotations.handle(req, res, url)) return;

		if (url.pathname === "/api/plan" && req.method === "GET") {
			const response: Record<string, unknown> = {
				plan: options.markdown,
				origin: options.origin ?? "pi",
				mode: options.mode || "annotate",
				filePath: options.filePath,
				sourceInfo: options.sourceInfo,
				sourceConverted: options.sourceConverted ?? false,
				gate: options.gate ?? false,
				renderAs: options.renderHtml && options.rawHtml ? 'html' : 'markdown',
				...(options.renderHtml && options.rawHtml ? { rawHtml: options.rawHtml } : {}),
				sharingEnabled,
				shareBaseUrl,
				pasteApiUrl,
				repoInfo,
				projectRoot: options.folderPath || serverCwd,
				cwd: serverCwd,
				serverConfig: getServerConfig(gitUser),
			};
			if (sessionId) response.sessionId = sessionId;
			json(res, response);
		} else if (url.pathname === "/api/config" && req.method === "POST") {
			try {
				const body = (await parseBody(req)) as { displayName?: string; diffOptions?: Record<string, unknown>; conventionalComments?: boolean };
				const toSave: Record<string, unknown> = {};
				if (body.displayName !== undefined) toSave.displayName = body.displayName;
				if (body.diffOptions !== undefined) toSave.diffOptions = body.diffOptions;
				if (body.conventionalComments !== undefined) toSave.conventionalComments = body.conventionalComments;
				if (Object.keys(toSave).length > 0) saveConfig(toSave as Parameters<typeof saveConfig>[0]);
				json(res, { ok: true });
			} catch {
				json(res, { error: "Invalid request" }, 400);
			}
		} else if (url.pathname === "/api/image") {
			handleImageRequest(res, url);
		} else if (url.pathname === "/api/upload" && req.method === "POST") {
			await handleUploadRequest(req, res);
		} else if (url.pathname === "/api/draft") {
			await handleDraftRequest(req, res, draftKey);
		} else if (url.pathname === "/api/doc" && req.method === "GET") {
			// Inject source file's directory as base for relative path resolution.
			// Skip for URL annotations — there's no local directory to resolve against.
			if (!url.searchParams.has("base") && options.filePath && !/^https?:\/\//i.test(options.filePath)) {
				url.searchParams.set("base", dirname(resolvePath(options.filePath)));
			}
			await handleDocRequest(res, url);
		} else if (url.pathname === "/api/doc/exists" && req.method === "POST") {
			await handleDocExistsRequest(res, req);
		} else if (url.pathname === "/api/obsidian/vaults") {
			handleObsidianVaultsRequest(res);
		} else if (url.pathname === "/api/reference/obsidian/files" && req.method === "GET") {
			handleObsidianFilesRequest(res, url);
		} else if (url.pathname === "/api/reference/obsidian/doc" && req.method === "GET") {
			handleObsidianDocRequest(res, url);
		} else if (url.pathname === "/api/reference/files" && req.method === "GET") {
			handleFileBrowserRequest(res, url);
		} else if (url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (url.pathname === "/api/sessions" && req.method === "GET") {
			json(res, {
				sessions: [{
					sessionId: ownSession.sessionId,
					mode: ownSession.mode,
					filePath: ownSession.filePath,
					url: `${buildServerUrl(getServerHostname(), ownSession.port)}${sessionId ? `/s/${sessionId}` : ""}`,
				}],
				count: 1,
			});
		} else if (url.pathname === "/api/exit" && req.method === "POST") {
			deleteDraft(draftKey);
			resolveDecision({ feedback: "", annotations: [], exit: true });
			json(res, { ok: true });
		} else if (url.pathname === "/api/approve" && req.method === "POST") {
			deleteDraft(draftKey);
			resolveDecision({ feedback: "", annotations: [], approved: true });
			json(res, { ok: true });
		} else if (url.pathname === "/api/feedback" && req.method === "POST") {
			try {
				const body = await parseBody(req);
				deleteDraft(draftKey);
				resolveDecision({
					feedback: (body.feedback as string) || "",
					annotations: (body.annotations as unknown[]) || [],
				});
				json(res, { ok: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to process feedback";
				json(res, { error: message }, 500);
			}
		} else {
			// Check for bare /s/{sessionId} or /s/{sessionId}/ paths (no API route)
			const bareSlug = extractSessionSlug(url.pathname);
			if (bareSlug !== null) {
				if (bareSlug !== sessionId) {
					json(res, { error: "Session mismatch" }, 403);
					return;
				}
				html(res, injectSessionPath(options.htmlContent, bareSlug));
				return;
			}
			html(res, options.htmlContent);
		}
	});

	const { port, portSource } = await listenOnPort(server);
	ownSession.port = port;

	const baseUrl = buildServerUrl(getServerHostname(), port);
	const sessionUrl = sessionId ? `${baseUrl}/s/${sessionId}` : baseUrl;

	return {
		port,
		portSource,
		url: sessionUrl,
		waitForDecision: () => decisionPromise,
		stop: () => server.close(),
	};
}
