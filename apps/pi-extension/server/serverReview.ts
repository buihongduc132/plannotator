import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";

import { Readable } from "node:stream";

import { contentHash, deleteDraft } from "../generated/draft.js";
import { saveConfig, detectGitUser, getServerConfig } from "../generated/config.js";

export type {
	DiffOption,
	DiffType,
	GitContext,
} from "../generated/review-core.js";

import {
	getDisplayRepo,
	getMRLabel,
	getMRNumberLabel,
	type PRMetadata,
	type PRReviewFileComment,
	prRefFromMetadata,
} from "../generated/pr-provider.js";
import {
	type DiffType,
	type GitCommandResult,
	type GitContext,
	getFileContentsForDiff as getFileContentsForDiffCore,
	getGitContext as getGitContextCore,
	gitAddFile as gitAddFileCore,
	gitResetFile as gitResetFileCore,
	parseWorktreeDiffType,
	type ReviewGitRuntime,
	runGitDiff as runGitDiffCore,
	validateFilePath,
} from "../generated/review-core.js";

import { createEditorAnnotationHandler } from "./annotations.js";
import { createAgentJobHandler } from "./agent-jobs.js";
import { createExternalAnnotationHandler } from "./external-annotations.js";
import {
	handleDraftRequest,
	handleFavicon,
	handleImageRequest,
	handleUploadRequest,
} from "./handlers.js";
import { detectWSL, html, json, parseBody, requestUrl, toWebRequest } from "./helpers.js";

import { isRemoteSession, listenOnPort } from "./network.js";

/** Regex to extract slug from bare session paths: /s/<slug> or /s/<slug>/anything */
const BARE_SESSION_SLUG_REGEX = /^\/s\/([^/]+)(?:\/.*)?$/;

function extractSessionSlug(pathname: string): string | null {
	const match = BARE_SESSION_SLUG_REGEX.exec(pathname);
	return match ? match[1] : null;
}

/** Inject session base path into HTML for client-side routing. */
function injectSessionPath(htmlContent: string, slug: string): string {
	if (!htmlContent) return htmlContent;
	const headCloseIdx = htmlContent.lastIndexOf("</head>");
	if (headCloseIdx === -1) return htmlContent;
	const injection = `<script>window.__PLANNOTATOR_SESSION_PATH__="/s/${slug}"<` + `/script>`;
	return htmlContent.slice(0, headCloseIdx) + injection + htmlContent.slice(headCloseIdx);
}

import {
	fetchPRContext,
	fetchPRFileContent,
	fetchPRViewedFiles,
	getPRUser,
	markPRFilesViewed,
	submitPRReview,
} from "./pr.js";
import { getRepoInfo } from "./project.js";
import {
	CODEX_REVIEW_SYSTEM_PROMPT,
	buildCodexReviewUserMessage,
	buildCodexCommand,
	generateOutputPath,
	parseCodexOutput,
	transformReviewFindings,
} from "../generated/codex-review.js";
import {
	CLAUDE_REVIEW_PROMPT,
	buildClaudeCommand,
	parseClaudeStreamOutput,
	transformClaudeFindings,
} from "../generated/claude-review.js";


export interface ReviewServerResult {
	port: number;
	portSource: "env" | "remote-default" | "random";
	url: string;
	isRemote: boolean;
	waitForDecision: () => Promise<{
		approved: boolean;
		feedback: string;
		annotations: unknown[];
		agentSwitch?: string;
		exit?: boolean;
	}>;
	stop: () => void;
}

export const reviewRuntime: ReviewGitRuntime = {
	async runGit(
		args: string[],
		options?: { cwd?: string },
	): Promise<GitCommandResult> {
		const result = spawnSync("git", args, {
			cwd: options?.cwd,
			encoding: "utf-8",
		});
		return {
			stdout: result.stdout ?? "",
			stderr: result.stderr ?? "",
			exitCode: result.status ?? (result.error ? 1 : 0),
		};
	},

	async readTextFile(path: string): Promise<string | null> {
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return null;
		}
	},
};

export function getGitContext(cwd?: string): Promise<GitContext> {
	return getGitContextCore(reviewRuntime, cwd);
}

export function runGitDiff(
	diffType: DiffType,
	defaultBranch = "main",
	cwd?: string,
): Promise<{ patch: string; label: string; error?: string }> {
	return runGitDiffCore(reviewRuntime, diffType, defaultBranch, cwd);
}

export async function startReviewServer(options: {
	rawPatch: string;
	gitRef: string;
	htmlContent: string;
	origin?: string;
	diffType?: DiffType;
	gitContext?: GitContext;
	error?: string;
	sharingEnabled?: boolean;
	shareBaseUrl?: string;
	pasteApiUrl?: string;
	prMetadata?: PRMetadata;
	agentCwd?: string;
	onCleanup?: () => void | Promise<void>;
	onReady?: (url: string, isRemote: boolean, port: number) => void;
	sessionId?: string;
	initialBase?: string;
}): Promise<ReviewServerResult> {
	const gitUser = detectGitUser();
	const draftKey = contentHash(`${options.rawPatch}:${options.sessionId ?? "default"}`);
	const prMeta = options.prMetadata;
	const isPRMode = !!prMeta;
	const hasLocalAccess = !!options.gitContext;
	const isRemote = isRemoteSession();
	const wslFlag = detectWSL();
	const prRef = prMeta ? prRefFromMetadata(prMeta) : null;
	const platformUser = prRef ? await getPRUser(prRef) : null;
	const sessionId = options.sessionId;
	const parseSessionPath = (pathname: string): { sessionId: string | null; apiPath: string } => {
		const match = /^\/s\/([^/]+)(\/api\/.*)$/.exec(pathname);
		if (match) return { sessionId: match[1], apiPath: match[2] };
		return { sessionId: null, apiPath: pathname };
	};

	let initialViewedFiles: string[] = [];
	if (isPRMode && prRef) {
		try {
			const viewedMap = await fetchPRViewedFiles(prRef);
			initialViewedFiles = Object.entries(viewedMap)
				.filter(([, isViewed]) => isViewed)
				.map(([path]) => path);
		} catch {}
	}
	const repoInfo = prMeta
		? {
				display: getDisplayRepo(prMeta),
				branch: `${getMRLabel(prMeta)} ${getMRNumberLabel(prMeta)}`,
			}
		: getRepoInfo();
	const editorAnnotations = createEditorAnnotationHandler();
	const externalAnnotations = createExternalAnnotationHandler("review");

	let currentPatch = options.rawPatch;
	let currentGitRef = options.gitRef;
	let currentDiffType: DiffType = options.diffType || "uncommitted";
	let currentError = options.error;
	let currentBase = options.initialBase || options.gitContext?.defaultBranch || "main";

	let serverUrl = "";
	function resolveAgentCwd(): string {
		if (options.agentCwd) return options.agentCwd;
		if (currentDiffType.startsWith("worktree:")) {
			const parsed = parseWorktreeDiffType(currentDiffType);
			if (parsed) return parsed.path;
		}
		return options.gitContext?.cwd ?? process.cwd();
	}
	const agentJobs = createAgentJobHandler({
		mode: "review",
		getServerUrl: () => serverUrl,
		getCwd: resolveAgentCwd,

		async buildCommand(provider) {
			const cwd = resolveAgentCwd();
			const hasAgentLocalAccess = !!options.agentCwd || !!options.gitContext;
			const userMessage = buildCodexReviewUserMessage(
				currentPatch,
				currentDiffType,
				{ defaultBranch: currentBase, hasLocalAccess: hasAgentLocalAccess },
				options.prMetadata,
			);

			if (provider === "codex") {
				const outputPath = generateOutputPath();
				const prompt = CODEX_REVIEW_SYSTEM_PROMPT + "\n\n---\n\n" + userMessage;
				const command = await buildCodexCommand({ cwd, outputPath, prompt });
				return { command, outputPath, prompt, label: "Codex Review" };
			}

			if (provider === "claude") {
				const prompt = CLAUDE_REVIEW_PROMPT + "\n\n---\n\n" + userMessage;
				const { command, stdinPrompt } = buildClaudeCommand(prompt);
				return { command, stdinPrompt, prompt, cwd, label: "Claude Code Review", captureStdout: true };
			}

			return null;
		},

		async onJobComplete(job, meta) {
			const cwd = resolveAgentCwd();

			if (job.provider === "codex" && meta.outputPath) {
				const output = await parseCodexOutput(meta.outputPath);
				if (!output) return;

				const hasBlockingFindings = output.findings.some((f: any) => f.priority !== null && f.priority <= 1);
				job.summary = {
					correctness: hasBlockingFindings ? "Issues Found" : output.overall_correctness,
					explanation: output.overall_explanation,
					confidence: output.overall_confidence_score,
				};

				if (output.findings.length > 0) {
					const annotations = transformReviewFindings(output.findings, job.source, cwd, "Codex");
					const result = externalAnnotations.addAnnotations({ annotations });
					if ("error" in result) console.error(`[codex-review] addAnnotations error:`, result.error);
				}
				return;
			}

			if (job.provider === "claude" && meta.stdout) {
				const output = parseClaudeStreamOutput(meta.stdout);
				if (!output) return;

				const total = output.summary.important + output.summary.nit + output.summary.pre_existing;
				job.summary = {
					correctness: output.summary.important === 0 ? "Correct" : "Issues Found",
					explanation: `${output.summary.important} important, ${output.summary.nit} nit, ${output.summary.pre_existing} pre-existing`,
					confidence: total === 0 ? 1.0 : Math.max(0, 1.0 - (output.summary.important * 0.2)),
				};

				if (output.findings.length > 0) {
					const annotations = transformClaudeFindings(output.findings, job.source, cwd);
					const result = externalAnnotations.addAnnotations({ annotations });
					if ("error" in result) console.error(`[claude-review] addAnnotations error:`, result.error);
				}
				return;
			}
		},
	});
	const sharingEnabled =
		options.sharingEnabled ?? process.env.PLANNOTATOR_SHARE !== "disabled";
	const shareBaseUrl =
		(options.shareBaseUrl ?? process.env.PLANNOTATOR_SHARE_URL) || undefined;
	const pasteApiUrl =
		(options.pasteApiUrl ?? process.env.PLANNOTATOR_PASTE_URL) || undefined;
	let resolveDecision!: (result: {
		approved: boolean;
		feedback: string;
		annotations: unknown[];
		agentSwitch?: string;
		exit?: boolean;
	}) => void;
	const decisionPromise = new Promise<{
		approved: boolean;
		feedback: string;
		annotations: unknown[];
		agentSwitch?: string;
		exit?: boolean;
	}>((r) => {
		resolveDecision = r;
	});

	let aiEndpoints: Record<string, (req: Request) => Promise<Response>> | null = null;
	let aiSessionManager: { disposeAll: () => void } | null = null;
	let aiRegistry: { disposeAll: () => void } | null = null;
	try {
		const ai = await import("../generated/ai/index.js");
		const registry = new ai.ProviderRegistry();
		const sessionManager = new ai.SessionManager();
		const whichCmd = (cmd: string): string | null => {
			try {
				return (
					execSync(`which ${cmd}`, {
						encoding: "utf-8",
						stdio: ["pipe", "pipe", "pipe"],
					}).trim() || null
				);
			} catch {
				return null;
			}
		};

		try {
			await import("../generated/ai/providers/claude-agent-sdk.js");
			const claudePath = whichCmd("claude");
			const provider = await ai.createProvider({
				type: "claude-agent-sdk",
				cwd: process.cwd(),
				...(claudePath && { claudeExecutablePath: claudePath }),
			});
			registry.register(provider);
		} catch {}

		try {
			await import("../generated/ai/providers/codex-sdk.js");
			await import("@openai/codex-sdk");
			const codexPath = whichCmd("codex");
			const provider = await ai.createProvider({
				type: "codex-sdk",
				cwd: process.cwd(),
				...(codexPath && { codexExecutablePath: codexPath }),
			});
			registry.register(provider);
		} catch {}

		try {
			await import("../generated/ai/providers/pi-sdk-node.js");
			const piPath = whichCmd("pi");
			if (piPath) {
				const provider = await ai.createProvider({
					type: "pi-sdk",
					cwd: process.cwd(),
					piExecutablePath: piPath,
				} as any);
				if (provider && "fetchModels" in provider) {
					await (provider as { fetchModels: () => Promise<void> }).fetchModels();
				}
				registry.register(provider);
			}
		} catch {}

		try {
			await import("../generated/ai/providers/opencode-sdk.js");
			const opencodePath = whichCmd("opencode");
			if (opencodePath) {
				const provider = await ai.createProvider({
					type: "opencode-sdk",
					cwd: process.cwd(),
				});
				if (provider && "fetchModels" in provider) {
					await (provider as { fetchModels: () => Promise<void> }).fetchModels();
				}
				registry.register(provider);
			}
		} catch {}

		if (registry.size > 0) {
			aiEndpoints = ai.createAIEndpoints({
				registry,
				sessionManager,
				getCwd: resolveAgentCwd,
			});
			aiSessionManager = sessionManager;
			aiRegistry = registry;
		}
	} catch {}

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
		// REQ-14: Bare /s/{sessionId} path (SPA navigation) — inject session base
		// and serve HTML. Only reject if the slug doesn't match our session.
		if (sessionId && !routeSessionId && apiPath.startsWith("/s/")) {
			const slug = extractSessionSlug(url.pathname);
			if (slug && slug !== sessionId) {
				json(res, { error: "Session mismatch", message: `URL session "${slug}" does not match expected "${sessionId}"` }, 403);
				return;
			}
			html(res, injectSessionPath(options.htmlContent, sessionId));
			return;
		}

		if (apiPath === "/api/diff" && req.method === "GET") {
			json(res, {
				rawPatch: currentPatch,
				gitRef: currentGitRef,
				origin: options.origin ?? "pi",
				diffType: hasLocalAccess ? currentDiffType : undefined,
				base: hasLocalAccess ? currentBase : undefined,
				gitContext: hasLocalAccess ? options.gitContext : undefined,
				sharingEnabled,
				shareBaseUrl,
				pasteApiUrl,
				repoInfo,
				isWSL: wslFlag,
				sessionId,
				...(options.agentCwd && { agentCwd: options.agentCwd }),
				...(isPRMode && { prMetadata: prMeta, platformUser }),
				...(isPRMode && initialViewedFiles.length > 0 && { viewedFiles: initialViewedFiles }),
				...(currentError && { error: currentError }),
				serverConfig: getServerConfig(gitUser),
			});
		} else if (apiPath === "/api/sessions" && req.method === "GET") {
			json(res, {
				sessions: [
					{
						sessionId: sessionId ?? "review",
						mode: "review",
						origin: options.origin ?? "pi",
						project: repoInfo?.display ?? "Unknown",
						slug: currentGitRef,
						name: repoInfo ? `${repoInfo.display} (${currentGitRef})` : "Code Review",
						cwd: resolveAgentCwd(),
						url: sessionId ? `${serverUrl}/s/${sessionId}` : serverUrl,
					},
				],
				count: 1,
			});
		} else if (apiPath === "/api/diff/switch" && req.method === "POST") {
			if (!hasLocalAccess) {
				json(res, { error: "Not available without local file access" }, 400);
				return;
			}
			try {
				const body = await parseBody(req);
				const newType = body.diffType as DiffType;
				if (!newType) {
					json(res, { error: "Missing diffType" }, 400);
					return;
				}
				const requestedBase = typeof body.base === "string" ? body.base : undefined;
				const base = requestedBase || currentBase;
				const defaultCwd = options.gitContext?.cwd;
				const result = await runGitDiff(newType, base, defaultCwd);
				currentPatch = result.patch;
				currentGitRef = result.label;
				currentDiffType = newType;
				currentBase = base;
				currentError = result.error;
				json(res, {
					rawPatch: currentPatch,
					gitRef: currentGitRef,
					diffType: currentDiffType,
					base: currentBase,
					...(currentError ? { error: currentError } : {}),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to switch diff";
				json(res, { error: message }, 500);
			}
		} else if (apiPath === "/api/pr-context" && req.method === "GET") {
			if (!isPRMode || !prRef) {
				json(res, { error: "Not in PR mode" }, 400);
				return;
			}
			try {
				const context = await fetchPRContext(prRef);
				json(res, context);
			} catch (err) {
				json(
					res,
					{
						error: err instanceof Error ? err.message : "Failed to fetch PR context",
					},
					500,
				);
			}
		} else if (apiPath === "/api/pr-action" && req.method === "POST") {
			if (!isPRMode || !prMeta || !prRef) {
				json(res, { error: "Not in PR mode" }, 400);
				return;
			}
			try {
				const body = await parseBody(req);
				const fileComments = (body.fileComments as PRReviewFileComment[]) || [];
				await submitPRReview(
					prRef,
					prMeta.headSha,
					body.action as "approve" | "comment",
					body.body as string,
					fileComments,
				);
				json(res, { ok: true, prUrl: prMeta.url });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to submit PR review";
				json(res, { error: message }, 500);
			}
		} else if (apiPath === "/api/pr-viewed" && req.method === "POST") {
			if (!isPRMode || !prMeta || !prRef) {
				json(res, { error: "Not in PR mode" }, 400);
				return;
			}
			if (prMeta.platform !== "github") {
				json(res, { error: "Viewed sync only supported for GitHub" }, 400);
				return;
			}
			const prNodeId = prMeta.prNodeId;
			if (!prNodeId) {
				json(res, { error: "PR node ID not available" }, 400);
				return;
			}
			try {
				const body = await parseBody(req);
				await markPRFilesViewed(
					prRef,
					prNodeId,
					body.filePaths as string[],
					body.viewed as boolean,
				);
				json(res, { ok: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to update viewed state";
				json(res, { error: message }, 500);
			}
		} else if (apiPath === "/api/file-content" && req.method === "GET") {
			const filePath = url.searchParams.get("path");
			if (!filePath) {
				json(res, { error: "Missing path" }, 400);
				return;
			}
			try {
				validateFilePath(filePath);
			} catch {
				json(res, { error: "Invalid path" }, 400);
				return;
			}
			const oldPath = url.searchParams.get("oldPath") || undefined;
			if (oldPath) {
				try {
					validateFilePath(oldPath);
				} catch {
					json(res, { error: "Invalid path" }, 400);
					return;
				}
			}

			if (hasLocalAccess && !isPRMode) {
				const defaultCwd = options.gitContext?.cwd;
				const result = await getFileContentsForDiffCore(
					reviewRuntime,
					currentDiffType,
					currentBase,
					filePath,
					oldPath,
					defaultCwd,
				);
				json(res, result);
				return;
			}

			if (isPRMode && prRef && prMeta) {
				try {
					const oldSha = prMeta.mergeBaseSha ?? prMeta.baseSha;
					const [oldContent, newContent] = await Promise.all([
						fetchPRFileContent(prRef, oldSha, oldPath || filePath),
						fetchPRFileContent(prRef, prMeta.headSha, filePath),
					]);
					json(res, { oldContent, newContent });
				} catch (err) {
					json(
						res,
						{
							error: err instanceof Error ? err.message : "Failed to fetch file content",
						},
						500,
					);
				}
				return;
			}

			json(res, { error: "No file access available" }, 400);
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
		} else if (apiPath === "/api/agents" && req.method === "GET") {
			json(res, { agents: [] });
		} else if (apiPath === "/api/git-add" && req.method === "POST") {
			const baseDiffType = currentDiffType.startsWith("worktree:")
				? (parseWorktreeDiffType(currentDiffType)?.subType ?? currentDiffType)
				: currentDiffType;
			const canStage = baseDiffType === "uncommitted" || baseDiffType === "unstaged";
			if (isPRMode || !canStage) {
				json(res, { error: "Staging not available" }, 400);
				return;
			}
			try {
				const body = await parseBody(req);
				const filePath = body.filePath as string | undefined;
				if (!filePath) {
					json(res, { error: "Missing filePath" }, 400);
					return;
				}
				let cwd: string | undefined;
				if (currentDiffType.startsWith("worktree:")) {
					const parsed = parseWorktreeDiffType(currentDiffType);
					if (parsed) cwd = parsed.path;
				}
				if (!cwd) {
					cwd = options.gitContext?.cwd;
				}
				if (body.undo) {
					await gitResetFileCore(reviewRuntime, filePath, cwd);
				} else {
					await gitAddFileCore(reviewRuntime, filePath, cwd);
				}
				json(res, { ok: true });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to stage file";
				json(res, { error: message }, 500);
			}
		} else if (apiPath === "/api/draft") {
			await handleDraftRequest(
				req,
				res,
				draftKey,
				sessionId ? { sessionId, cwd: resolveAgentCwd() } : undefined,
			);
		} else if (apiPath === "/favicon.svg" || url.pathname === "/favicon.svg") {
			handleFavicon(res);
		} else if (await editorAnnotations.handle(req, res, url)) {
			return;
		} else if (await externalAnnotations.handle(req, res, url)) {
			return;
		} else if (await agentJobs.handle(req, res, url)) {
			return;
		} else if (aiEndpoints && apiPath.startsWith("/api/ai/")) {
			const handler = aiEndpoints[apiPath];
			if (handler) {
				try {
					const webReq = toWebRequest(req);
					const webRes = await handler(webReq);
					const headers: Record<string, string> = {};
					webRes.headers.forEach((v, k) => {
						headers[k] = v;
					});
					res.writeHead(webRes.status, headers);
					if (webRes.body) {
						const nodeStream = Readable.fromWeb(webRes.body as any);
						nodeStream.pipe(res);
					} else {
						res.end();
					}
				} catch (err) {
					json(
						res,
						{ error: err instanceof Error ? err.message : "AI endpoint error" },
						500,
					);
				}
				return;
			}
			json(res, { error: "Not found" }, 404);
		} else if (apiPath === "/api/exit" && req.method === "POST") {
			deleteDraft(draftKey, sessionId ? { sessionId, cwd: resolveAgentCwd() } : undefined);
			resolveDecision({ approved: false, feedback: "", annotations: [], exit: true });
			json(res, { ok: true });
		} else if (apiPath === "/api/feedback" && req.method === "POST") {
			try {
				const body = await parseBody(req);
				deleteDraft(draftKey, sessionId ? { sessionId, cwd: resolveAgentCwd() } : undefined);
				resolveDecision({
					approved: (body.approved as boolean) ?? false,
					feedback: (body.feedback as string) || "",
					annotations: (body.annotations as unknown[]) || [],
					agentSwitch: body.agentSwitch as string | undefined,
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

	const { port: boundPort, portSource, url: listenUrl } = await listenOnPort(server);
	port = boundPort;
	serverUrl = sessionId ? `${listenUrl}/s/${sessionId}` : listenUrl;
	const exitHandler = () => agentJobs.killAll();
	process.once("exit", exitHandler);

	if (options.onReady) {
		options.onReady(serverUrl, isRemote, port);
	}

	return {
		port,
		portSource,
		url: serverUrl,
		isRemote,
		waitForDecision: () => decisionPromise,
		stop: () => {
			process.removeListener("exit", exitHandler);
			agentJobs.killAll();
			aiSessionManager?.disposeAll();
			aiRegistry?.disposeAll();
			server.close();
			if (options.onCleanup) {
				try {
					const result = options.onCleanup();
					if (result instanceof Promise) result.catch(() => {});
				} catch {}
			}
		},
	};
}
