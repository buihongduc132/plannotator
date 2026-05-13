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
import { detectWSL, html, json, parseBody, requestUrl } from "./helpers.js";

import { listenOnPort } from "./network.js";

import { getRepoInfo } from "./project.js";
import {
	handleDocRequest,
	handleFileBrowserRequest,
	handleObsidianVaultsRequest,
	handleObsidianFilesRequest,
	handleObsidianDocRequest,
} from "./reference.js";
import { createExternalAnnotationHandler } from "./external-annotations.js";

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
	gate?: boolean;
	sessionId?: string;
	cwd?: string;
}): Promise<AnnotateServerResult> {
	const gitUser = detectGitUser();
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;
	const sessionId = options.sessionId;
	const sessionCwd = options.cwd;

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

	const parseSessionPath = (pathname: string): { sessionId: string | null; apiPath: string } => {
		const match = /^\/s\/([^/]+)(\/api\/.*)$/.exec(pathname);
		if (match) return { sessionId: match[1], apiPath: match[2] };
		return { sessionId: null, apiPath: pathname };
	};

	const draftKey = contentHash(options.markdown);
	const repoInfo = getRepoInfo();
	let listenUrl = "";
	const externalAnnotations = createExternalAnnotationHandler("plan");

	let port = 0;
	const server = createServer(async (req, res) => {
		const url = requestUrl(req);
		const { sessionId: routeSessionId, apiPath } = sessionId
			? parseSessionPath(url.pathname)
			: { sessionId: null, apiPath: url.pathname };

		if (sessionId && routeSessionId && routeSessionId !== sessionId) {
			json(
				res,
				{
					error: "Session mismatch",
					message: `URL session "${routeSessionId}" does not match expected "${sessionId}"`,
				},
				403,
			);
			return;
		}
		if (sessionId && apiPath.startsWith("/s/")) {
			json(res, { error: "Session mismatch" }, 403);
			return;
		}

		if (await externalAnnotations.handle(req, res, url)) return;

		if (apiPath === "/api/plan" && req.method === "GET") {
			const wslFlag = detectWSL();
			json(res, {
				plan: options.markdown,
				origin: options.origin ?? "pi",
				mode: options.mode || "annotate",
				filePath: options.filePath,
				sourceInfo: options.sourceInfo,
				gate: options.gate ?? false,
				sharingEnabled,
				shareBaseUrl,
				pasteApiUrl,
				repoInfo,
				projectRoot: options.folderPath || sessionCwd || process.cwd(),
				cwd: sessionCwd,
				isWSL: wslFlag,
				sessionId,
				serverConfig: getServerConfig(gitUser),
			});
		} else if (apiPath === "/api/sessions" && req.method === "GET") {
			json(res, {
				sessions: [
					{
						sessionId: sessionId ?? "annotate",
						mode: options.mode || "annotate",
						origin: options.origin ?? "pi",
						project: repoInfo?.display ?? "Unknown",
						slug: options.filePath.split("/").pop() || "markdown",
						name: options.filePath.split("/").pop() || "Annotate",
						cwd: sessionCwd || process.cwd(),
						url: sessionId
							? `${listenUrl}/s/${sessionId}`
							: `${listenUrl}`,
					},
				],
				count: 1,
			});
		} else if (apiPath === "/api/config" && req.method === "POST") {
			try {
				const body = (await parseBody(req)) as { displayName?: string; diffOptions?: Record<string, unknown>; conventionalComments?: boolean; conventionalLabels?: unknown[] | null };
				const toSave: Record<string, unknown> = {};
				if (body.displayName !== undefined) toSave.displayName = body.displayName;
				if (body.diffOptions !== undefined) toSave.diffOptions = body.diffOptions;
				if (body.conventionalComments !== undefined) toSave.conventionalComments = body.conventionalComments;
				if (body.conventionalLabels !== undefined) toSave.conventionalLabels = body.conventionalLabels;
				if (Object.keys(toSave).length > 0) saveConfig(toSave as Parameters<typeof saveConfig>[0]);
				json(res, { ok: true });
			} catch {
				json(res, { error: "Invalid request" }, 400);
			}
		} else if (apiPath === "/api/image") {
			handleImageRequest(res, url);
		} else if (apiPath === "/api/upload" && req.method === "POST") {
			await handleUploadRequest(req, res);
		} else if (apiPath === "/api/draft") {
			await handleDraftRequest(
				req,
				res,
				draftKey,
				sessionId && sessionCwd ? { sessionId, cwd: sessionCwd } : undefined,
			);
		} else if (apiPath === "/api/doc" && req.method === "GET") {
			if (!url.searchParams.has("base") && options.filePath) {
				url.searchParams.set("base", dirname(resolvePath(options.filePath)));
			}
			handleDocRequest(res, url);
		} else if (apiPath === "/api/obsidian/vaults") {
			handleObsidianVaultsRequest(res);
		} else if (apiPath === "/api/reference/obsidian/files" && req.method === "GET") {
			handleObsidianFilesRequest(res, url);
		} else if (apiPath === "/api/reference/obsidian/doc" && req.method === "GET") {
			handleObsidianDocRequest(res, url);
		} else if (apiPath === "/api/reference/files" && req.method === "GET") {
			handleFileBrowserRequest(res, url);
		} else if (apiPath === "/favicon.svg" || url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (apiPath === "/api/exit" && req.method === "POST") {
			deleteDraft(draftKey, sessionId && sessionCwd ? { sessionId, cwd: sessionCwd } : undefined);
			resolveDecision({ feedback: "", annotations: [], exit: true });
			json(res, { ok: true });
		} else if (apiPath === "/api/approve" && req.method === "POST") {
			deleteDraft(draftKey, sessionId && sessionCwd ? { sessionId, cwd: sessionCwd } : undefined);
			resolveDecision({ feedback: "", annotations: [], approved: true });
			json(res, { ok: true });
		} else if (apiPath === "/api/feedback" && req.method === "POST") {
			try {
				const body = await parseBody(req);
				deleteDraft(draftKey, sessionId && sessionCwd ? { sessionId, cwd: sessionCwd } : undefined);
				resolveDecision({
					feedback: (body.feedback as string) || "",
					annotations: (body.annotations as unknown[]) || [],
				});
				json(res, { ok: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to process feedback";
				json(res, { error: message }, 500);
			}
		} else if (apiPath.startsWith("/api/")) {
			json(res, { error: "Not found", path: apiPath }, 404);
		} else {
			html(res, options.htmlContent);
		}
	});

	const result = await listenOnPort(server);
	port = result.port;
	listenUrl = result.url;

	return {
		port,
		portSource: result.portSource,
		url: sessionId ? `${listenUrl}/s/${sessionId}` : listenUrl,
		waitForDecision: () => decisionPromise,
		stop: () => server.close(),
	};
}
