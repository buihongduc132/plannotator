import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { contentHash, deleteDraft } from "../generated/draft.js";
import {
	type ArchivedPlan,
	generateSlug,
	getPlanVersion,
	getPlanVersionPath,
	getVersionCount,
	listArchivedPlans,
	listProjectPlans,
	listVersions,
	readArchivedPlan,
	saveAnnotations,
	saveFinalSnapshot,
	saveToHistory,
} from "../generated/storage.js";
import { createEditorAnnotationHandler } from "./annotations.js";
import { createExternalAnnotationHandler } from "./external-annotations.js";
import {
	handleDraftRequest,
	handleFavicon,
	handleImageRequest,
	handleUploadRequest,
} from "./handlers.js";
import { detectWSL, html, json, parseBody, requestUrl } from "./helpers.js";
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
import { listenOnPort } from "./network.js";

import { saveConfig, detectGitUser, getServerConfig } from "../generated/config.js";
import { detectProjectName, getRepoInfo } from "./project.js";
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

export interface PlanServerResult {
	reviewId: string;
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	waitForDecision: () => Promise<PlanReviewDecision>;
	onDecision: (listener: (result: PlanReviewDecision) => void | Promise<void>) => () => void;
	waitForDone?: () => Promise<void>;
	stop: () => void;
}

export async function startPlanReviewServer(options: {
	plan: string;
	htmlContent: string;
	origin?: string;
	permissionMode?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	mode?: "archive";
	customPlanPath?: string | null;
}): Promise<PlanServerResult> {
	const gitUser = detectGitUser();
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;

	// --- Archive mode setup ---
	let archivePlans: ArchivedPlan[] = [];
	let initialArchivePlan = "";
	let resolveDone: (() => void) | undefined;
	let donePromise: Promise<void> | undefined;

	if (options.mode === "archive") {
		archivePlans = listArchivedPlans(options.customPlanPath ?? undefined);
		initialArchivePlan =
			archivePlans.length > 0
				? (readArchivedPlan(
						archivePlans[0].filename,
						options.customPlanPath ?? undefined,
					) ?? "")
				: "";
		donePromise = new Promise<void>((resolve) => {
			resolveDone = resolve;
		});
	}

	// --- Plan review mode setup (skip in archive mode) ---
	const repoInfo = options.mode !== "archive" ? getRepoInfo() : null;
	const slug = options.mode !== "archive" ? generateSlug(options.plan) : "";
	const project = options.mode !== "archive" ? detectProjectName() : "";
	const historyResult =
		options.mode !== "archive"
			? saveToHistory(project, slug, options.plan)
			: { version: 0, path: "", isNew: false };
	const previousPlan =
		options.mode !== "archive" && historyResult.version > 1
			? getPlanVersion(project, slug, historyResult.version - 1)
			: null;
	const versionInfo =
		options.mode !== "archive"
			? {
					version: historyResult.version,
					totalVersions: getVersionCount(project, slug),
					project,
				}
			: null;

	const reviewId = randomUUID();
	let resolveDecision!: (result: PlanReviewDecision) => void;
	const decisionListeners = new Set<(result: PlanReviewDecision) => void | Promise<void>>();
	const sseClients = new Set<import("node:http").ServerResponse>();
	let decisionSettled = false;
	let decisionResult: PlanReviewDecision | null = null;
	const decisionPromise = new Promise<PlanReviewDecision>((r) => {
		resolveDecision = r;
	});
	const publishDecision = (result: PlanReviewDecision): boolean => {
		if (decisionSettled) return false;
		decisionSettled = true;
		decisionResult = result;
		resolveDecision(result);
		for (const listener of decisionListeners) {
			Promise.resolve(listener(result)).catch((error) => {
				console.error("[Plan Review] Decision listener failed:", error);
			});
		}
		const payload = `event: decision\ndata: ${JSON.stringify(result)}\n\n`;
		for (const client of sseClients) {
			try {
				if (!client.writableEnded && !client.destroyed) {
					client.write(payload);
					client.end();
				}
			} catch {
				// Client already disconnected
			}
		}
		sseClients.clear();
		return true;
	};

	// Draft key for annotation persistence
	const draftKey = options.mode !== "archive" ? contentHash(options.plan) : "";

	// Editor annotations (in-memory, VS Code integration — skip in archive mode)
	const editorAnnotations = options.mode !== "archive" ? createEditorAnnotationHandler() : null;
	const externalAnnotations = options.mode !== "archive" ? createExternalAnnotationHandler("plan") : null;

	// Lazy cache for in-session archive tab
	let cachedArchivePlans: ArchivedPlan[] | null = null;

	// Will be set after listenOnPort
	let serverUrl = "";

	const server = createServer(async (req, res) => {
		const url = requestUrl(req);

		if (url.pathname === "/api/done" && req.method === "POST") {
			resolveDone?.();
			json(res, { ok: true });
		} else if (url.pathname === "/api/archive/plans" && req.method === "GET") {
			const customPath = url.searchParams.get("customPath") || undefined;
			if (!cachedArchivePlans)
				cachedArchivePlans = listArchivedPlans(customPath);
			json(res, { plans: cachedArchivePlans });
		} else if (url.pathname === "/api/archive/plan" && req.method === "GET") {
			const filename = url.searchParams.get("filename");
			const customPath = url.searchParams.get("customPath") || undefined;
			if (!filename) {
				json(res, { error: "Missing filename" }, 400);
				return;
			}
			const markdown = readArchivedPlan(filename, customPath);
			if (!markdown) {
				json(res, { error: "Not found" }, 404);
				return;
			}
			json(res, { markdown, filepath: filename });
		} else if (url.pathname === "/api/sessions" && req.method === "POST") {
			try {
				const body = (await parseBody(req)) as {
					plan?: string;
					mode?: string;
					name?: string;
				};
				if (!body.plan) {
					json(res, { error: "plan is required" }, 400);
					return;
				}
				const createdSlug = generateSlug(body.plan);
				const createdProject = detectProjectName();
				saveToHistory(createdProject, createdSlug, body.plan);
				const sessionId = randomUUID();
				json(res, {
					sessionId,
					url: `${serverUrl}/s/${sessionId}`,
					plan: body.plan,
					slug: createdSlug,
					name: body.name ?? null,
					mode: body.mode ?? "plan",
					project: createdProject,
				});
			} catch (error) {
				json(
					res,
					{ error: error instanceof Error ? error.message : "Failed to create session" },
					500,
				);
			}
		} else if (url.pathname === "/api/sessions" && req.method === "GET") {
			json(res, {
				sessions: [
					{
						sessionId: reviewId,
						mode: options.mode ?? "plan",
						origin: options.origin ?? "pi",
						project,
						slug,
						name: null,
						cwd: process.cwd(),
						url: `${serverUrl}/s/${reviewId}`,
					},
				],
				count: 1,
			});
		} else if (url.pathname === "/api/plans" && req.method === "GET") {
			json(res, { plans: listProjectPlans(project).map((entry) => ({ ...entry, project })) });
		} else if (url.pathname === "/api/decision" && req.method === "GET") {
			if (!decisionSettled) {
				json(res, { pending: true });
				return;
			}
			json(res, decisionResult ?? { pending: true });
		} else if (url.pathname === "/api/decision/stream" && req.method === "GET") {
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
			});
			res.write("event: connected\ndata: {}\n\n");
			if (decisionSettled && decisionResult) {
				res.write(`event: decision\ndata: ${JSON.stringify(decisionResult)}\n\n`);
				res.end();
				return;
			}
			sseClients.add(res);
			req.on("close", () => {
				sseClients.delete(res);
			});
		} else if (url.pathname === "/api/plan/version") {
			const vParam = url.searchParams.get("v");
			if (!vParam) {
				json(res, { error: "Missing v parameter" }, 400);
				return;
			}
			const v = parseInt(vParam, 10);
			if (Number.isNaN(v) || v < 1) {
				json(res, { error: "Invalid version number" }, 400);
				return;
			}
			const content = getPlanVersion(project, slug, v);
			if (content === null) {
				json(res, { error: "Version not found" }, 404);
				return;
			}
			json(res, { plan: content, version: v });
		} else if (url.pathname === "/api/plan/versions") {
			json(res, { project, slug, versions: listVersions(project, slug) });
		} else if (url.pathname === "/api/plan") {
			const wslFlag = detectWSL();
			if (options.mode === "archive") {
				json(res, {
					plan: initialArchivePlan,
					origin: options.origin ?? "pi",
					mode: "archive",
					archivePlans,
					sharingEnabled,
					shareBaseUrl,
					isWSL: wslFlag,
					serverConfig: getServerConfig(gitUser),
					sessionId: reviewId,
				});
			} else {
				json(res, {
					plan: options.plan,
					origin: options.origin ?? "pi",
					permissionMode: options.permissionMode,
					previousPlan,
					versionInfo,
					sharingEnabled,
					shareBaseUrl,
					pasteApiUrl,
					repoInfo,
					projectRoot: process.cwd(),
					cwd: process.cwd(),
					isWSL: wslFlag,
					serverConfig: getServerConfig(gitUser),
					sessionId: reviewId,
				});
			}
		} else if (url.pathname === "/api/config" && req.method === "POST") {
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
		} else if (url.pathname === "/api/image") {
			handleImageRequest(res, url);
		} else if (url.pathname === "/api/upload" && req.method === "POST") {
			await handleUploadRequest(req, res);
		} else if (url.pathname === "/api/draft") {
			await handleDraftRequest(req, res, draftKey);
		} else if (editorAnnotations && (await editorAnnotations.handle(req, res, url))) {
			return;
		} else if (externalAnnotations && (await externalAnnotations.handle(req, res, url))) {
			return;
		} else if (url.pathname === "/api/doc" && req.method === "GET") {
			handleDocRequest(res, url);
		} else if (url.pathname === "/api/obsidian/vaults") {
			handleObsidianVaultsRequest(res);
		} else if (url.pathname === "/api/reference/obsidian/files" && req.method === "GET") {
			handleObsidianFilesRequest(res, url);
		} else if (url.pathname === "/api/reference/obsidian/doc" && req.method === "GET") {
			handleObsidianDocRequest(res, url);
		} else if (url.pathname === "/api/reference/files" && req.method === "GET") {
			handleFileBrowserRequest(res, url);
		} else if (
			url.pathname === "/api/plan/vscode-diff" &&
			req.method === "POST"
		) {
			try {
				const body = await parseBody(req);
				const baseVersion = body.baseVersion as number;
				if (!baseVersion) {
					json(res, { error: "Missing baseVersion" }, 400);
					return;
				}
				const basePath = getPlanVersionPath(project, slug, baseVersion);
				if (!basePath) {
					json(res, { error: `Version ${baseVersion} not found` }, 404);
					return;
				}
				const result = await openEditorDiff(basePath, historyResult.path);
				if ("error" in result) {
					json(res, { error: result.error }, 500);
					return;
				}
				json(res, { ok: true });
			} catch (err) {
				json(
					res,
					{
						error:
							err instanceof Error
								? err.message
								: "Failed to open VS Code diff",
					},
					500,
				);
			}
		} else if (url.pathname === "/api/agents" && req.method === "GET") {
			json(res, { agents: [] });
		} else if (url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (url.pathname === "/api/save-notes" && req.method === "POST") {
			const results: {
				obsidian?: IntegrationResult;
				bear?: IntegrationResult;
				octarine?: IntegrationResult;
			} = {};
			try {
				const body = await parseBody(req);
				const promises: Promise<void>[] = [];
				const obsConfig = body.obsidian as ObsidianConfig | undefined;
				const bearConfig = body.bear as BearConfig | undefined;
				const octConfig = body.octarine as OctarineConfig | undefined;
				if (obsConfig?.vaultPath && obsConfig?.plan) {
					promises.push(
						saveToObsidian(obsConfig).then((r) => {
							results.obsidian = r;
						}).catch(() => { /* integration save failed, non-critical */ }),
					);
				}
				if (bearConfig?.plan) {
					promises.push(
						saveToBear(bearConfig).then((r) => {
							results.bear = r;
						}).catch(() => { /* integration save failed, non-critical */ }),
					);
				}
				if (octConfig?.plan && octConfig?.workspace) {
					promises.push(
						saveToOctarine(octConfig).then((r) => {
							results.octarine = r;
						}).catch(() => { /* integration save failed, non-critical */ }),
					);
				}
				await Promise.allSettled(promises);
				for (const [name, result] of Object.entries(results)) {
					if (!result?.success && result)
						console.error(`[${name}] Save failed: ${result.error}`);
				}
			} catch (err) {
				console.error(`[Save Notes] Error:`, err);
				json(res, { error: "Save failed" }, 500);
				return;
			}
			json(res, { ok: true, results });
		} else if (url.pathname === "/api/approve" && req.method === "POST") {
			if (decisionSettled) {
				json(res, { ok: true, duplicate: true });
				return;
			}
			let feedback: string | undefined;
			let agentSwitch: string | undefined;
			let requestedPermissionMode: string | undefined;
			let planSaveEnabled = true;
			let planSaveCustomPath: string | undefined;
			try {
				const body = await parseBody(req);
				if (body.feedback) feedback = body.feedback as string;
				if (body.agentSwitch) agentSwitch = body.agentSwitch as string;
				if (body.permissionMode)
					requestedPermissionMode = body.permissionMode as string;
				if (body.planSave !== undefined) {
					const ps = body.planSave as { enabled: boolean; customPath?: string };
					planSaveEnabled = ps.enabled;
					planSaveCustomPath = ps.customPath;
				}
				// Run note integrations in parallel
				const integrationResults: Record<string, IntegrationResult> = {};
				const integrationPromises: Promise<void>[] = [];
				const obsConfig = body.obsidian as ObsidianConfig | undefined;
				const bearConfig = body.bear as BearConfig | undefined;
				const octConfig = body.octarine as OctarineConfig | undefined;
				if (obsConfig?.vaultPath && obsConfig?.plan) {
					integrationPromises.push(
						saveToObsidian(obsConfig).then((r) => {
							integrationResults.obsidian = r;
						}).catch(() => { /* integration save failed, non-critical */ }),
					);
				}
				if (bearConfig?.plan) {
					integrationPromises.push(
						saveToBear(bearConfig).then((r) => {
							integrationResults.bear = r;
						}).catch(() => { /* integration save failed, non-critical */ }),
					);
				}
				if (octConfig?.plan && octConfig?.workspace) {
					integrationPromises.push(
						saveToOctarine(octConfig).then((r) => {
							integrationResults.octarine = r;
						}).catch(() => { /* integration save failed, non-critical */ }),
					);
				}
				await Promise.allSettled(integrationPromises);
				for (const [name, result] of Object.entries(integrationResults)) {
					if (!result?.success && result)
						console.error(`[${name}] Save failed: ${result.error}`);
				}
			} catch (err) {
				console.error(`[Integration] Error:`, err);
			}
			// Save annotations and final snapshot
			let savedPath: string | undefined;
			if (planSaveEnabled) {
				const annotations = feedback || "";
				if (annotations) saveAnnotations(slug, annotations, planSaveCustomPath);
				savedPath = saveFinalSnapshot(
					slug,
					"approved",
					options.plan,
					annotations,
					planSaveCustomPath,
				);
			}
			deleteDraft(draftKey);
			const effectivePermissionMode = requestedPermissionMode || options.permissionMode;
			publishDecision({
				approved: true,
				feedback,
				savedPath,
				agentSwitch,
				permissionMode: effectivePermissionMode,
			});
			json(res, { ok: true, savedPath });
		} else if (url.pathname === "/api/deny" && req.method === "POST") {
			if (decisionSettled) {
				json(res, { ok: true, duplicate: true });
				return;
			}
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
			} catch {
				/* use default feedback */
			}
			let savedPath: string | undefined;
			if (planSaveEnabled) {
				saveAnnotations(slug, feedback, planSaveCustomPath);
				savedPath = saveFinalSnapshot(
					slug,
					"denied",
					options.plan,
					feedback,
					planSaveCustomPath,
				);
			}
			deleteDraft(draftKey);
			publishDecision({ approved: false, feedback, savedPath });
			json(res, { ok: true, savedPath });
		} else if (url.pathname.startsWith("/api/")) {
			json(res, { error: "Not found", path: url.pathname }, 404);
		} else {
			html(res, options.htmlContent);
		}
	});

	server.on("close", () => {
		for (const client of sseClients) {
			if (!client.writableEnded) {
				client.end();
			}
		}
		sseClients.clear();
	});

	const result = await listenOnPort(server);
	const port = result.port;
	const portSource = result.portSource;
	serverUrl = result.url;

	return {
		reviewId,
		port,
		portSource,
		url: serverUrl,
		waitForDecision: () => decisionPromise,
		onDecision: (listener) => {
			decisionListeners.add(listener);
			return () => {
				decisionListeners.delete(listener);
			};
		},
		...(donePromise && { waitForDone: () => donePromise }),
		stop: () => server.close(),
	};
}
