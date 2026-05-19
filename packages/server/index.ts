/**
 * Plannotator Shared Server
 *
 * Provides a consistent server implementation for both Claude Code and OpenCode plugins.
 *
 * Environment variables:
 *   PLANNOTATOR_REMOTE - Set to "1"/"true" for remote, "0"/"false" for local
 *   PLANNOTATOR_PORT   - Fixed port to use (default: random locally, 19432 for remote)
 *   PLANNOTATOR_ORIGIN - Explicit origin override; validated against AGENT_CONFIG
 *                        in packages/shared/agents.ts. Supported values:
 *                        "claude-code", "opencode", "codex", "copilot-cli",
 *                        "gemini-cli", "pi".
 */

import type { Origin } from "@plannotator/shared/agents";
import { resolve } from "path";
import { isRemoteSession, getServerHostname, getServerPort, getServerUrl } from "./remote";
import { openEditorDiff } from "./ide";
import {
  saveToObsidian,
  saveToBear,
  saveToOctarine,
  type ObsidianConfig,
  type BearConfig,
  type OctarineConfig,
  type IntegrationResult,
} from "./integrations";
import {
  generateSlug,
  savePlan,
  saveAnnotations,
  saveFinalSnapshot,
  saveToHistory,
  getPlanVersion,
  getPlanVersionPath,
  getVersionCount,
  listVersions,
  listArchivedPlans,
  listProjectPlans,
  readArchivedPlan,
  type ArchivedPlan,
} from "./storage";
import { getRepoInfo } from "./repo";
import { detectProjectName } from "./project";
import { loadConfig, saveConfig, detectGitUser, getServerConfig } from "./config";
import { readImprovementHook, getImprovementHookExpectedPath } from "@plannotator/shared/improvement-hooks";
import { composeImproveContext } from "@plannotator/shared/pfm-reminder";
import { handleImage, handleUpload, handleAgents, handleServerReady, handleDraftSave, handleDraftLoad, handleDraftDelete, handleFavicon, type OpencodeClient } from "./shared-handlers";
import { contentHash, deleteDraft } from "./draft";
import { handleDoc, handleDocExists, handleObsidianVaults, handleObsidianFiles, handleObsidianDoc, handleFileBrowserFiles } from "./reference-handlers";
import { warmFileListCache } from "@plannotator/shared/resolve-file";
import { createEditorAnnotationHandler } from "./editor-annotations";
import { createExternalAnnotationHandler } from "./external-annotations";
import { isWSL } from "./browser";

// Re-export utilities
export { isRemoteSession, getServerPort, getServerUrl, getServerHostname } from "./remote";
export { openBrowser } from "./browser";
export * from "./integrations";
export * from "./storage";
export { handleServerReady } from "./shared-handlers";
export { type VaultNode, buildFileTree } from "@plannotator/shared/reference-common";

// --- Types ---

export interface ServerOptions {
  /** The plan markdown content */
  plan: string;
  /** Origin identifier (e.g., "claude-code", "opencode") */
  origin: Origin;
  /** HTML content to serve for the UI */
  htmlContent: string;
  /** Current permission mode to preserve (Claude Code only) */
  permissionMode?: string;
  /** Whether URL sharing is enabled (default: true) */
  sharingEnabled?: boolean;
  /** Custom base URL for share links (default: https://share.plannotator.ai) */
  shareBaseUrl?: string;
  /** Base URL of the paste service API for short URL sharing */
  pasteApiUrl?: string;
  /** Called when server starts with the URL, remote status, and port */
  onReady?: (url: string, isRemote: boolean, port: number) => void;
  /** OpenCode client for querying available agents (OpenCode only) */
  opencodeClient?: OpencodeClient;
  /** Optional session ID for isolating storage and decisions per session */
  sessionId?: string;
  /** Working directory for the project (defaults to process.cwd()) */
  cwd?: string;
  /** When set to "archive", server runs in read-only archive browser mode */
  mode?: "archive";
  /** Custom plan save path — used by archive mode to find saved plans */
  customPlanPath?: string | null;
}

export interface ServerResult {
  /** The port the server is running on */
  port: number;
  /** The full URL to access the server */
  url: string;
  /** Whether running in remote mode */
  isRemote: boolean;
  /** Session ID (provided or auto-generated) */
  sessionId: string;
  /** Working directory for the project */
  cwd: string;
  /** Wait for user decision (approve/deny) */
  waitForDecision: () => Promise<{
    approved: boolean;
    feedback?: string;
    savedPath?: string;
    agentSwitch?: string;
    permissionMode?: string;
  }>;
  /** Wait for user to close (archive mode only) */
  waitForDone?: () => Promise<void>;
  /** Stop the server */
  stop: () => void;
}

// --- Multi-Session Registry ---
//
// Lightweight in-memory registry for concurrent sessions within a single Bun server.
// Modeled after apps/pi-extension/server/session-registry.ts but using Bun primitives.

interface RegisteredSession {
  sessionId: string;
  mode: string;
  origin: string;
  project: string;
  slug: string;
  cwd: string;
  plan: string;
  port: number;
  registeredAt: number;
}

const MAX_SESSIONS_LIMIT = (() => {
  const env = process.env.PLANNOTATOR_MAX_SESSIONS;
  const parsed = env ? parseInt(env, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 50;
})();

const sessionRegistry = new Map<string, RegisteredSession>();

function registerSession(s: RegisteredSession): void {
  if (sessionRegistry.size >= MAX_SESSIONS_LIMIT) {
    throw new Error(`Concurrent session limit reached (${MAX_SESSIONS_LIMIT}). Set PLANNOTATOR_MAX_SESSIONS to increase.`);
  }
  sessionRegistry.set(s.sessionId, s);
}

function unregisterSession(sessionId: string): void {
  sessionRegistry.delete(sessionId);
}

// Aliases for test compatibility (session context API)
export function getSessionContext(sessionId: string): RegisteredSession | undefined {
  return sessionRegistry.get(sessionId);
}

export function registerSessionContext(s: RegisteredSession): void {
  registerSession(s);
}

export function unregisterSessionContext(sessionId: string): void {
  unregisterSession(sessionId);
}

// --- Server Implementation ---

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;

/**
 * Start the Plannotator server
 *
 * Handles:
 * - Remote detection and port configuration
 * - All API routes (/api/plan, /api/approve, /api/deny, etc.)
 * - Obsidian/Bear integrations
 * - Port conflict retries
 */
export async function startPlannotatorServer(
  options: ServerOptions
): Promise<ServerResult> {
  const { plan, origin, htmlContent, permissionMode, sharingEnabled = true, shareBaseUrl, pasteApiUrl, onReady, mode, customPlanPath, sessionId: optSessionId, cwd: optCwd } = options;
  const sessionId = optSessionId ?? crypto.randomUUID();
  const cwd = optCwd ?? process.cwd();

  const isRemote = isRemoteSession();
  const configuredPort = getServerPort();
  const wslFlag = await isWSL();
  const gitUser = detectGitUser();

  // Side-channel pre-warm: kick off the code-file walk now so the
  // renderer's POST /api/doc/exists lands on warm cache.
  void warmFileListCache(process.cwd(), "code");

  // --- Archive mode setup ---
  let archivePlans: ArchivedPlan[] = [];
  let initialArchivePlan = "";
  let resolveDone: (() => void) | undefined;
  let donePromise: Promise<void> | undefined;

  if (mode === "archive") {
    archivePlans = listArchivedPlans(customPlanPath ?? undefined);
    initialArchivePlan = archivePlans.length > 0
      ? readArchivedPlan(archivePlans[0].filename, customPlanPath ?? undefined) ?? ""
      : "";
    donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
  }

  // --- Plan review mode setup (skip in archive mode) ---
  const draftKey = mode !== "archive" ? contentHash(plan) : "";
  const editorAnnotations = mode !== "archive" ? createEditorAnnotationHandler() : null;
  const externalAnnotations = mode !== "archive" ? createExternalAnnotationHandler("plan") : null;
  const slug = mode !== "archive" ? generateSlug(plan) : "";

  // Lazy cache for in-session archive browsing (plan review sidebar tab)
  let cachedArchivePlans: ReturnType<typeof listArchivedPlans> | null = null;

  // Plan-specific: repo info, version history, decision promise
  let repoInfo: Awaited<ReturnType<typeof getRepoInfo>> | null = null;
  let project = "";
  let currentPlanPath = "";
  let previousPlan: string | null = null;
  let versionInfo = { version: 0, totalVersions: 0, project: "" };

  let resolveDecision: (result: {
    approved: boolean;
    feedback?: string;
    savedPath?: string;
    agentSwitch?: string;
    permissionMode?: string;
  }) => void;
  let decisionResult: {
    approved: boolean;
    feedback?: string;
    savedPath?: string;
    agentSwitch?: string;
    permissionMode?: string;
  } | null = null;
  let decisionPromise: Promise<{
    approved: boolean;
    feedback?: string;
    savedPath?: string;
    agentSwitch?: string;
    permissionMode?: string;
  }>;

  if (mode !== "archive") {
    repoInfo = await getRepoInfo();
    project = (await detectProjectName()) ?? "_unknown";
    const historyResult = saveToHistory(project, slug, plan);
    currentPlanPath = historyResult.path;
    previousPlan =
      historyResult.version > 1
        ? getPlanVersion(project, slug, historyResult.version - 1)
        : null;
    versionInfo = {
      version: historyResult.version,
      totalVersions: getVersionCount(project, slug),
      project,
    };

    decisionPromise = new Promise((resolve) => {
      resolveDecision = resolve;
    });
  } else {
    // Never-resolving promise — archive mode uses waitForDone instead
    decisionPromise = new Promise(() => {});
  }

  // Start server with retry logic
  let server: ReturnType<typeof Bun.serve> | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      server = Bun.serve({
        hostname: getServerHostname(),
        port: configuredPort,

        async fetch(req, server) {
          const url = new URL(req.url);

          // Parse session-scoped paths: /s/<sessionId>/api/...
          const sessionRouteMatch = /^\/s\/([^/]+)(\/.+)$/.exec(url.pathname);
          const resolvedPath = sessionRouteMatch ? sessionRouteMatch[2] : url.pathname;
          const routeSessionId = sessionRouteMatch?.[1] ?? null;

          // API: Get a specific plan version from history
          if (resolvedPath === "/api/plan/version") {
            const vParam = url.searchParams.get("v");
            if (!vParam) {
              return new Response("Missing v parameter", { status: 400 });
            }
            const v = parseInt(vParam, 10);
            if (isNaN(v) || v < 1) {
              return new Response("Invalid version number", { status: 400 });
            }
            const content = getPlanVersion(project, slug, v);
            if (content === null) {
              return Response.json({ error: "Version not found" }, { status: 404 });
            }
            return Response.json({ plan: content, version: v });
          }

          // API: List all versions for the current plan
          if (resolvedPath === "/api/plan/versions") {
            return Response.json({
              project,
              slug,
              versions: listVersions(project, slug),
            });
          }

          // API: List archived plans (from ~/.plannotator/plans/)
          // Cached for session lifetime — new plans won't appear during a single review
          if (resolvedPath === "/api/archive/plans" && req.method === "GET") {
            const customPath = url.searchParams.get("customPath") || undefined;
            if (!cachedArchivePlans) cachedArchivePlans = listArchivedPlans(customPath);
            return Response.json({ plans: cachedArchivePlans });
          }

          // API: Get a specific archived plan
          if (resolvedPath === "/api/archive/plan" && req.method === "GET") {
            const filename = url.searchParams.get("filename");
            if (!filename) {
              return Response.json({ error: "Missing filename parameter" }, { status: 400 });
            }
            const customPath = url.searchParams.get("customPath") || undefined;
            const content = readArchivedPlan(filename, customPath);
            if (content === null) {
              return Response.json({ error: "Plan not found" }, { status: 404 });
            }
            return Response.json({ markdown: content, filepath: filename });
          }

          // API: Close archive browser (archive mode only)
          if (resolvedPath === "/api/done" && req.method === "POST") {
            resolveDone?.();
            return Response.json({ ok: true });
          }

          // API: Get plan content
          if (resolvedPath === "/api/plan") {
            if (mode === "archive") {
              return Response.json({
                plan: initialArchivePlan,
                origin,
                mode: "archive",
                archivePlans,
                sharingEnabled,
                shareBaseUrl,
                isWSL: wslFlag,
                serverConfig: getServerConfig(gitUser),
              });
            }
            return Response.json({ plan, origin, permissionMode, sharingEnabled, shareBaseUrl, pasteApiUrl, repoInfo, previousPlan, versionInfo, projectRoot: process.cwd(), cwd, isWSL: wslFlag, serverConfig: getServerConfig(gitUser) });
          }

          // API: Serve a linked markdown document
          if (resolvedPath === "/api/doc" && req.method === "GET") {
            return handleDoc(req);
          }

          // API: Batch existence check for code-file paths the renderer detected
          if (resolvedPath === "/api/doc/exists" && req.method === "POST") {
            return handleDocExists(req);
          }

          // API: Hook status for the Settings Hooks tab
          if (resolvedPath === "/api/hooks/status" && req.method === "GET") {
            const config = loadConfig();
            const hook = readImprovementHook("enterplanmode-improve");
            const pfmEnabled = config.pfmReminder === true;
            const composed = composeImproveContext({
              pfmEnabled,
              improvementHookContent: hook?.content ?? null,
            });
            return Response.json({
              pfmReminder: { enabled: pfmEnabled },
              improvementHook: {
                present: !!hook,
                filePath: hook?.filePath ?? getImprovementHookExpectedPath("enterplanmode-improve"),
                fileSize: hook?.content?.length ?? null,
                content: hook?.content ?? null,
              },
              composedLength: composed?.length ?? null,
            });
          }

          // API: Update user config (write-back to ~/.plannotator/config.json)
          if (resolvedPath === "/api/config" && req.method === "POST") {
            try {
              const body = (await req.json()) as { displayName?: string; diffOptions?: Record<string, unknown>; conventionalComments?: boolean; conventionalLabels?: unknown[] | null; pfmReminder?: boolean };
              const toSave: Record<string, unknown> = {};
              if (body.displayName !== undefined) toSave.displayName = body.displayName;
              if (body.diffOptions !== undefined) toSave.diffOptions = body.diffOptions;
              if (body.conventionalComments !== undefined) toSave.conventionalComments = body.conventionalComments;
              if (body.conventionalLabels !== undefined) toSave.conventionalLabels = body.conventionalLabels;
              if (body.pfmReminder !== undefined) toSave.pfmReminder = body.pfmReminder;
              if (Object.keys(toSave).length > 0) saveConfig(toSave as Parameters<typeof saveConfig>[0]);
              return Response.json({ ok: true });
            } catch {
              return Response.json({ error: "Invalid request" }, { status: 400 });
            }
          }

          // API: Serve images (local paths or temp uploads)
          if (resolvedPath === "/api/image") {
            return handleImage(req);
          }

          // API: Upload image -> save to temp -> return path
          if (resolvedPath === "/api/upload" && req.method === "POST") {
            return handleUpload(req);
          }

          // API: Open plan diff in VS Code
          if (resolvedPath === "/api/plan/vscode-diff" && req.method === "POST") {
            try {
              const body = (await req.json()) as { baseVersion: number };

              if (!body.baseVersion) {
                return Response.json({ error: "Missing baseVersion" }, { status: 400 });
              }

              const basePath = getPlanVersionPath(project, slug, body.baseVersion);
              if (!basePath) {
                return Response.json({ error: `Version ${body.baseVersion} not found` }, { status: 404 });
              }

              const result = await openEditorDiff(basePath, currentPlanPath);
              if ("error" in result) {
                return Response.json({ error: result.error }, { status: 500 });
              }
              return Response.json({ ok: true });
            } catch (err) {
              const message = err instanceof Error ? err.message : "Failed to open VS Code diff";
              return Response.json({ error: message }, { status: 500 });
            }
          }

          // API: Detect Obsidian vaults
          if (resolvedPath === "/api/obsidian/vaults") {
            return handleObsidianVaults();
          }

          // API: List Obsidian vault files as a tree
          if (resolvedPath === "/api/reference/obsidian/files" && req.method === "GET") {
            return handleObsidianFiles(req);
          }

          // API: Read an Obsidian vault document
          if (resolvedPath === "/api/reference/obsidian/doc" && req.method === "GET") {
            return handleObsidianDoc(req);
          }

          // API: List markdown files in a directory as a tree
          if (resolvedPath === "/api/reference/files" && req.method === "GET") {
            return handleFileBrowserFiles(req);
          }

          // API: Get available agents (OpenCode only)
          if (resolvedPath === "/api/agents") {
            return handleAgents(options.opencodeClient);
          }

          // API: Annotation draft persistence
          if (resolvedPath === "/api/draft") {
            if (req.method === "POST") return handleDraftSave(req, draftKey);
            if (req.method === "DELETE") return handleDraftDelete(draftKey);
            return handleDraftLoad(draftKey);
          }

          // API: Editor annotations (VS Code extension)
          const editorResponse = await editorAnnotations?.handle(req, url);
          if (editorResponse) return editorResponse;

          // API: External annotations (SSE-based, for any external tool)
          const externalResponse = await externalAnnotations?.handle(req, url, {
            disableIdleTimeout: () => server.timeout(req, 0),
          });
          if (externalResponse) return externalResponse;

          // API: Save to notes (decoupled from approve/deny)
          if (resolvedPath === "/api/save-notes" && req.method === "POST") {
            const results: { obsidian?: IntegrationResult; bear?: IntegrationResult; octarine?: IntegrationResult } = {};

            try {
              const body = (await req.json()) as {
                obsidian?: ObsidianConfig;
                bear?: BearConfig;
                octarine?: OctarineConfig;
              };

              // Run integrations in parallel — they're independent
              const promises: Promise<void>[] = [];
              if (body.obsidian?.vaultPath && body.obsidian?.plan) {
                promises.push(saveToObsidian(body.obsidian).then(r => { results.obsidian = r; }));
              }
              if (body.bear?.plan) {
                promises.push(saveToBear(body.bear).then(r => { results.bear = r; }));
              }
              if (body.octarine?.plan && body.octarine?.workspace) {
                promises.push(saveToOctarine(body.octarine).then(r => { results.octarine = r; }));
              }
              await Promise.allSettled(promises);

              for (const [name, result] of Object.entries(results)) {
                if (!result?.success && result) {
                  console.error(`[${name}] Save failed: ${result.error}`);
                }
              }
            } catch (err) {
              console.error(`[Save Notes] Error:`, err);
              return Response.json({ error: "Save failed" }, { status: 500 });
            }

            return Response.json({ ok: true, results });
          }

          // API: Approve plan
          if (resolvedPath === "/api/approve" && req.method === "POST") {
            // Check for note integrations and optional feedback
            let feedback: string | undefined;
            let agentSwitch: string | undefined;
            let requestedPermissionMode: string | undefined;
            let planSaveEnabled = true; // default to enabled for backwards compat
            let planSaveCustomPath: string | undefined;
            try {
              const body = (await req.json().catch(() => ({}))) as {
                obsidian?: ObsidianConfig;
                bear?: BearConfig;
                octarine?: OctarineConfig;
                feedback?: string;
                agentSwitch?: string;
                planSave?: { enabled: boolean; customPath?: string };
                permissionMode?: string;
              };

              // Capture feedback if provided (for "approve with notes")
              if (body.feedback) {
                feedback = body.feedback;
              }

              // Capture agent switch setting for OpenCode
              if (body.agentSwitch) {
                agentSwitch = body.agentSwitch;
              }

              // Capture permission mode from client request (Claude Code)
              if (body.permissionMode) {
                requestedPermissionMode = body.permissionMode;
              }

              // Capture plan save settings
              if (body.planSave !== undefined) {
                planSaveEnabled = body.planSave.enabled;
                planSaveCustomPath = body.planSave.customPath;
              }

              // Run integrations in parallel — they're independent
              const integrationResults: Record<string, IntegrationResult> = {};
              const integrationPromises: Promise<void>[] = [];
              if (body.obsidian?.vaultPath && body.obsidian?.plan) {
                integrationPromises.push(saveToObsidian(body.obsidian).then(r => { integrationResults.obsidian = r; }));
              }
              if (body.bear?.plan) {
                integrationPromises.push(saveToBear(body.bear).then(r => { integrationResults.bear = r; }));
              }
              if (body.octarine?.plan && body.octarine?.workspace) {
                integrationPromises.push(saveToOctarine(body.octarine).then(r => { integrationResults.octarine = r; }));
              }
              await Promise.allSettled(integrationPromises);

              for (const [name, result] of Object.entries(integrationResults)) {
                if (!result?.success && result) {
                  console.error(`[${name}] Save failed: ${result.error}`);
                }
              }
            } catch (err) {
              // Don't block approval on integration errors
              console.error(`[Integration] Error:`, err);
            }

            // Save annotations and final snapshot (if enabled)
            let savedPath: string | undefined;
            if (planSaveEnabled) {
              const annotations = feedback || "";
              if (annotations) {
                saveAnnotations(slug, annotations, planSaveCustomPath);
              }
              savedPath = saveFinalSnapshot(slug, "approved", plan, annotations, planSaveCustomPath);
            }

            // Clean up draft on successful submit
            deleteDraft(draftKey);

            // Use permission mode from client request if provided, otherwise fall back to hook input
            const effectivePermissionMode = requestedPermissionMode || permissionMode;
            const result = { approved: true, feedback, savedPath, agentSwitch, permissionMode: effectivePermissionMode };
            decisionResult = result;
            resolveDecision(result);
            return Response.json({ ok: true, savedPath });
          }

          // API: Deny with feedback
          if (resolvedPath === "/api/deny" && req.method === "POST") {
            let feedback = "Plan rejected by user";
            let planSaveEnabled = true; // default to enabled for backwards compat
            let planSaveCustomPath: string | undefined;
            try {
              const body = (await req.json()) as {
                feedback?: string;
                planSave?: { enabled: boolean; customPath?: string };
              };
              feedback = body.feedback || feedback;

              // Capture plan save settings
              if (body.planSave !== undefined) {
                planSaveEnabled = body.planSave.enabled;
                planSaveCustomPath = body.planSave.customPath;
              }
            } catch {
              // Use default feedback
            }

            // Save annotations and final snapshot (if enabled)
            let savedPath: string | undefined;
            if (planSaveEnabled) {
              saveAnnotations(slug, feedback, planSaveCustomPath);
              savedPath = saveFinalSnapshot(slug, "denied", plan, feedback, planSaveCustomPath);
            }

            deleteDraft(draftKey);
            const result = { approved: false, feedback, savedPath };
            decisionResult = result;
            resolveDecision(result);
            return Response.json({ ok: true, savedPath });
          }

          // --- Decision polling endpoint ---
          // For remote clients that can't await waitForDecision() directly.
          if (resolvedPath === "/api/decision" && req.method === "GET") {
            // Check if the decision has been made by looking at the stored result
            if (decisionResult) {
              return Response.json(decisionResult);
            }
            return Response.json({ pending: true });
          }

          // --- Decision SSE stream ---
          // Real-time notification for remote clients.
          if (resolvedPath === "/api/decision/stream" && req.method === "GET") {
            const stream = new ReadableStream({
              start(controller) {
                const encoder = new TextEncoder();
                const send = (data: unknown) => {
                  try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                  } catch { /* stream already closed */ }
                };

                // If already decided, send immediately
                if (decisionResult) {
                  send(decisionResult);
                  controller.close();
                  return;
                }

                // Poll until decided (simpler than promise-based for single-session)
                const interval = setInterval(() => {
                  if (decisionResult) {
                    clearInterval(interval);
                    send(decisionResult);
                    try { controller.close(); } catch { /* already closed */ }
                  }
                }, 200);

                // Abort cleanup
                req.signal.addEventListener("abort", () => {
                  clearInterval(interval);
                  try { controller.close(); } catch { /* already closed */ }
                });
              },
            });

            return new Response(stream, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              },
            });
          }

          // --- Multi-Session Discovery API ---

          // sessionRouteMatch, resolvedPath, routeSessionId are parsed at top of fetch handler

          // If accessing via /s/<wrongId>/api/..., validate the session exists
          if (routeSessionId && resolvedPath.startsWith("/api/") && !sessionRegistry.has(routeSessionId)) {
            return Response.json(
              { error: "Session not found", sessionId: routeSessionId },
              { status: 403 },
            );
          }

          // GET /api/sessions — list active in-memory sessions
          if (resolvedPath === "/api/sessions" && req.method === "GET") {
            const sessions = Array.from(sessionRegistry.values()).map((s) => ({
              sessionId: s.sessionId,
              mode: s.mode,
              origin: s.origin,
              project: s.project,
              slug: s.slug,
              cwd: s.cwd,
              url: `${serverUrl}/s/${s.sessionId}`,
            }));
            return Response.json({
              sessions,
              count: sessions.length,
              maxSessions: MAX_SESSIONS_LIMIT,
            });
          }

          // POST /api/sessions — create a new session
          if (resolvedPath === "/api/sessions" && req.method === "POST") {
            try {
              const body = await req.json() as {
                plan?: string;
                mode?: string;
                cwd?: string;
                sessionId?: string;
              };
              if (!body.plan) {
                return Response.json({ error: "plan is required" }, { status: 400 });
              }
              const newSessionId = body.sessionId || crypto.randomUUID();
              const newSlug = generateSlug(body.plan);
              const newProject = (await detectProjectName()) ?? "_unknown";
              const newCwd = body.cwd ?? process.cwd();

              // Save to history
              saveToHistory(newProject, newSlug, body.plan);

              const regSession: RegisteredSession = {
                sessionId: newSessionId,
                mode: body.mode ?? "plan",
                origin,
                project: newProject,
                slug: newSlug,
                cwd: newCwd,
                plan: body.plan,
                port,
                registeredAt: Date.now(),
              };
              registerSession(regSession);

              return Response.json({
                sessionId: newSessionId,
                url: `${serverUrl}/s/${newSessionId}`,
                plan: body.plan.slice(0, 200),
                slug: newSlug,
                mode: regSession.mode,
                project: newProject,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : "Failed to create session";
              return Response.json({ error: message }, { status: 500 });
            }
          }

          // GET /api/plans — list all plans from history
          if (resolvedPath === "/api/plans" && req.method === "GET") {
            const plansProject = (await detectProjectName()) ?? "_unknown";
            const plans = listProjectPlans(plansProject).map((p) => ({
              ...p,
              project: plansProject,
            }));
            return Response.json({ plans });
          }

          // GET /api/sessions/:sessionId — get session details
          const sessionDetailMatch = /^\/api\/sessions\/([^/]+)$/.exec(resolvedPath);
          if (sessionDetailMatch && req.method === "GET") {
            const targetId = sessionDetailMatch[1];
            const s = sessionRegistry.get(targetId);
            if (!s) {
              return Response.json(
                { error: "Session not found", sessionId: targetId },
                { status: 404 },
              );
            }
            return Response.json({
              sessionId: s.sessionId,
              mode: s.mode,
              origin: s.origin,
              project: s.project,
              slug: s.slug,
              cwd: s.cwd,
              planPreview: s.plan.slice(0, 300),
            });
          }

          // Favicon
          if (url.pathname === "/favicon.svg") return handleFavicon();

          // API 404 guard: unknown /api/* routes should return JSON, not HTML
          if (resolvedPath.startsWith("/api/")) {
            return Response.json(
              { error: "Not found", path: resolvedPath },
              { status: 404 },
            );
          }

          // SPA routing: /s/<sessionId>/... or root or any non-API path
          const spaSessionMatch = /^\/s\/([^/]+)(\/?)$/.exec(url.pathname);
          const spaSubPath = /^\/s\/([^/]+)\/(.*)$/.exec(url.pathname);
          if (spaSessionMatch || spaSubPath || url.pathname === "/" || url.pathname === "") {
            // Inject session base path so client JS knows to fetch /s/{id}/api/...
            let html = htmlContent;
            const spaId = spaSessionMatch?.[1] ?? spaSubPath?.[1];
            if (spaId) {
              // Validate the session exists
              if (!sessionRegistry.has(spaId)) {
                return new Response(
                  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session Not Found</title>` +
                  `<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#a1a1aa}` +
                  `main{text-align:center;max-width:480px;padding:2rem}h1{font-size:1.25rem;margin-bottom:0.5rem;color:#f4f4f5}` +
                  `p{color:#71717a;font-size:0.875rem;line-height:1.5}code{background:#27272a;padding:0.15em 0.4em;border-radius:4px;font-size:0.8rem}</style>` +
                  `</head><body><main><h1>Session Not Found</h1>` +
                  `<p>Session <code>${spaId}</code> is no longer active.</p></main></body></html>`,
                  { status: 404, headers: { "Content-Type": "text/html" } },
                );
              }
              html = html.replace(/<head>/, `<head><script>window.__PLANNOTATOR_SESSION_ID__="${spaId}";</script>`);
            }
            return new Response(html, {
              headers: { "Content-Type": "text/html" },
            });
          }
        },

        error(err) {
          console.error("[plannotator] Server error:", err);
          return new Response(
            `Internal Server Error: ${err instanceof Error ? err.message : String(err)}`,
            { status: 500, headers: { "Content-Type": "text/plain" } },
          );
        },
      });

      break; // Success, exit retry loop
    } catch (err: unknown) {
      const isAddressInUse =
        err instanceof Error && err.message.includes("EADDRINUSE");

      if (isAddressInUse && attempt < MAX_RETRIES) {
        await Bun.sleep(RETRY_DELAY_MS);
        continue;
      }

      if (isAddressInUse) {
        const hint = isRemote ? " (set PLANNOTATOR_PORT to use different port)" : "";
        throw new Error(`Port ${configuredPort} in use after ${MAX_RETRIES} retries${hint}`);
      }

      throw err;
    }
  }

  if (!server) {
    throw new Error("Failed to start server");
  }

  const port = server.port!;
  let serverUrl = getServerUrl(port);

  // Register this session in the multi-session registry
  if (mode !== "archive") {
    registerSession({
      sessionId,
      mode: mode ?? "plan",
      origin,
      project,
      slug,
      cwd,
      plan,
      port,
      registeredAt: Date.now(),
    });
  }

  if (sessionId) {
    serverUrl = `${serverUrl}/s/${sessionId}`;
  }

  // Notify caller that server is ready
  if (onReady) {
    onReady(serverUrl, isRemote, port);
  }

  return {
    port,
    url: serverUrl,
    isRemote,
    sessionId,
    cwd,
    waitForDecision: () => decisionPromise,
    ...(donePromise && { waitForDone: () => donePromise }),
    stop: () => {
      unregisterSession(sessionId);
      server.stop();
    },
  };
}
