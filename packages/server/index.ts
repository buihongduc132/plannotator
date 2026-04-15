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
import { randomUUID } from "crypto";
import { resolve } from "path";
import { isRemoteSession, getServerHostname, getServerPort } from "./remote";
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
  readArchivedPlan,
  type ArchivedPlan,
  type SessionScope,
} from "./storage";
import { getRepoInfo } from "./repo";
import { detectProjectName } from "./project";
import { saveConfig, detectGitUser, getServerConfig } from "./config";
import { handleImage, handleUpload, handleAgents, handleServerReady, handleDraftSave, handleDraftLoad, handleDraftDelete, handleFavicon, type OpencodeClient } from "./shared-handlers";
import { contentHash, deleteDraft } from "./draft";
import { handleDoc, handleObsidianVaults, handleObsidianFiles, handleObsidianDoc, handleFileBrowserFiles } from "./reference-handlers";
import { createEditorAnnotationHandler } from "./editor-annotations";
import { createExternalAnnotationHandler } from "./external-annotations";
import { isWSL } from "./browser";

// Re-export utilities
export { isRemoteSession, getServerPort } from "./remote";
export { openBrowser } from "./browser";
export * from "./integrations";
export * from "./storage";
export { handleServerReady } from "./shared-handlers";
export { type VaultNode, buildFileTree } from "@plannotator/shared/reference-common";

// --- Session Registry ---

/**
 * Per-session state that replaces closure-based state for multi-session support.
 * Each session gets its own plan data, decision promise, and configuration.
 */

/**
 * Result of a plan review decision (approve / deny).
 * REQ-09: Decision promises are keyed by sessionId for independent resolution.
 */
export type DecisionResult = {
  approved: boolean;
  feedback?: string;
  savedPath?: string;
  agentSwitch?: string;
  permissionMode?: string;
};

export interface SessionContext {
  sessionId: string;
  plan: string;
  origin: Origin;
  permissionMode?: string;
  sharingEnabled: boolean;
  shareBaseUrl?: string;
  pasteApiUrl?: string;
  mode?: "archive";
  customPlanPath?: string | null;
  opencodeClient?: OpencodeClient;
  cwd: string;

  // Computed session state
  draftKey: string;
  slug: string;
  project: string;
  currentPlanPath: string;
  previousPlan: string | null;
  versionInfo: { version: number; totalVersions: number; project: string };
  repoInfo: Awaited<ReturnType<typeof getRepoInfo>> | null;

  // Archive mode state
  archivePlans: ArchivedPlan[];
  initialArchivePlan: string;
  resolveDone: (() => void) | undefined;

  // Plan review decision (REQ-09: resolution is handled via decisionResolvers Map, keyed by sessionId)
  decisionPromise: Promise<DecisionResult>;

  // Handler instances
  editorAnnotations: ReturnType<typeof createEditorAnnotationHandler> | null;
  externalAnnotations: ReturnType<typeof createExternalAnnotationHandler> | null;

  // Lazy cache for in-session archive browsing
  cachedArchivePlans: ArchivedPlan[] | null;
}

/**
 * Extract a SessionScope from a SessionContext for storage function calls.
 */
function scopeFromContext(ctx: SessionContext): SessionScope {
  return { cwd: ctx.cwd, sessionId: ctx.sessionId };
}

/**
 * In-memory session registry keyed by sessionId.
 * Used for multi-session routing: requests to /s/<sessionId>/api/* are resolved
 * by looking up the session context in this map.
 */
const sessionRegistry = new Map<string, SessionContext>();

/**
 * Register a session in the global registry.
 */
export function registerSessionContext(ctx: SessionContext): void {
  sessionRegistry.set(ctx.sessionId, ctx);
  console.log(`[plannotator] Registered session context: ${ctx.sessionId}`);
}

/**
 * Unregister a session from the global registry.
 */
export function unregisterSessionContext(sessionId: string): void {
  sessionRegistry.delete(sessionId);
  // REQ-09: Clean up decision resolver for this session to prevent memory leaks and
  // avoid dangling resolvers that could fire if resolveDecision is called after unregister.
  decisionResolvers.delete(sessionId);
  console.log(`[plannotator] Unregistered session context: ${sessionId}`);
}

/**
 * Look up a session context by ID. Returns undefined if not found.
 */
export function getSessionContext(sessionId: string): SessionContext | undefined {
  return sessionRegistry.get(sessionId);
}

/**
 * Regex to extract sessionId from URL path: /s/<sessionId>/api/...
 */
const SESSION_PATH_REGEX = /^\/s\/([^/]+)(\/api\/.*)$/;

/**
 * Parse a URL pathname to extract optional sessionId and the remaining API path.
 * Returns { sessionId, apiPath } if the path matches /s/<id>/api/...,
 * or { sessionId: null, apiPath } for flat /api/... paths (single-session mode).
 */
function parseSessionPath(pathname: string): { sessionId: string | null; apiPath: string } {
  const match = SESSION_PATH_REGEX.exec(pathname);
  if (match) {
    return { sessionId: match[1], apiPath: match[2] };
  }
  return { sessionId: null, apiPath: pathname };
}

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
  /** When set to "archive", server runs in read-only archive browser mode */
  mode?: "archive";
  /** Custom plan save path — used by archive mode to find saved plans */
  customPlanPath?: string | null;
  /** Session ID used to track state in the session store */
  sessionId?: string;
  /** Current working directory for file operations */
  cwd?: string;
}

export interface ServerResult {
  /** The port the server is running on */
  port: number;
  /** The full URL to access the server */
  url: string;
  /** Whether running in remote mode */
  isRemote: boolean;
  /** The session ID for this server instance */
  sessionId: string;
  /** Wait for user decision (approve/deny) for a specific session */
  waitForDecision: (sessionId: string) => Promise<{
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

// --- Server Implementation ---

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;

/**
 * Maximum concurrent sessions allowed.
 * Controlled via PLANNOTATOR_MAX_SESSIONS env var (default: 10).
 */
const MAX_SESSIONS = (() => {
  const env = process.env.PLANNOTATOR_MAX_SESSIONS;
  const parsed = env ? parseInt(env, 10) : NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 10;
})();

/**
 * REQ-09: Decision resolvers keyed by sessionId — enables independent concurrent resolutions.
 * Each session's approve/deny is isolated; no cross-contamination between sessions.
 */
const decisionResolvers = new Map<string, (result: DecisionResult) => void>();

/**
 * REQ-09: Wait for a decision on a specific session.
 * Registers the resolver in decisionResolvers so resolveDecision() can find it.
 */
function waitForDecision(sessionId: string): Promise<DecisionResult> {
  return new Promise((resolve) => {
    decisionResolvers.set(sessionId, resolve);
  });
}

/**
 * REQ-09: Resolve a specific session's decision promise.
 * Only resolves the session identified by sessionId — other sessions are unaffected.
 */
function resolveDecision(sessionId: string, result: DecisionResult): void {
  const resolver = decisionResolvers.get(sessionId);
  if (resolver) {
    resolver(result);
    decisionResolvers.delete(sessionId);
  }
}

/**
 * Start the Plannotator server
 *
 * Handles:
 * - Remote detection and port configuration
 * - All API routes (/s/<sessionId>/api/plan, /api/plan, etc.)
 * - Obsidian/Bear integrations
 * - Port conflict retries
 *
 * Multi-session: Routes are matched as /s/<sessionId>/api/* when a session
 * prefix is present, or /api/* for backward-compatible single-session mode.
 */
export async function startPlannotatorServer(
  options: ServerOptions
): Promise<ServerResult> {
  const { plan, origin, htmlContent, permissionMode, sharingEnabled = true, shareBaseUrl, pasteApiUrl, onReady, mode, customPlanPath, sessionId: optSessionId } = options;

  const sessionId = optSessionId ?? randomUUID();
  console.log(`[plannotator] ${optSessionId ? "sessionId:" : "sessionId not provided, generated:"} ${sessionId}`);

  const { cwd: optCwd } = options;
  const cwd = optCwd ?? process.cwd();
  console.log("[plannotator] cwd:", cwd);

  const isRemote = isRemoteSession();
  const configuredPort = getServerPort();
  const wslFlag = await isWSL();
  const gitUser = detectGitUser();

  // --- Archive mode setup ---
  let archivePlans: ArchivedPlan[] = [];
  let initialArchivePlan = "";
  let resolveDone: (() => void) | undefined;
  let donePromise: Promise<void> | undefined;

  if (mode === "archive") {
    // Archive mode doesn't have per-session isolation — use cwd only
    const archiveScope: SessionScope = { cwd, sessionId };
    archivePlans = listArchivedPlans(customPlanPath ?? undefined, archiveScope);
    initialArchivePlan = archivePlans.length > 0
      ? readArchivedPlan(archivePlans[0].filename, customPlanPath ?? undefined, archiveScope) ?? ""
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

  // REQ-09: decisionPromise is obtained via waitForDecision(sessionId) — keyed by sessionId
  let decisionPromise: Promise<DecisionResult>;
  let repoInfo: Awaited<ReturnType<typeof getRepoInfo>> | null = null;
  let project = "";
  let currentPlanPath = "";
  let previousPlan: string | null = null;
  let versionInfo = { version: 0, totalVersions: 0, project: "" };

  if (mode !== "archive") {
    repoInfo = await getRepoInfo();
    project = (await detectProjectName()) ?? "_unknown";
    const sessionScope: SessionScope = { cwd, sessionId };
    const historyResult = saveToHistory(project, slug, plan, sessionScope);
    currentPlanPath = historyResult.path;
    previousPlan =
      historyResult.version > 1
        ? getPlanVersion(project, slug, historyResult.version - 1, sessionScope)
        : null;
    versionInfo = {
      version: historyResult.version,
      totalVersions: getVersionCount(project, slug, sessionScope),
      project,
    };
    // REQ-09: Register this session's resolver so concurrent sessions don't interfere
    decisionPromise = waitForDecision(sessionId);
  } else {
    // Never-resolving promise — archive mode uses waitForDone instead
    decisionPromise = new Promise<DecisionResult>(() => {});
  }

  // --- Concurrent session limit check ---
  if (sessionRegistry.size >= MAX_SESSIONS) {
    const activeSessions = Array.from(sessionRegistry.values()).map(
      (s) => `  - ${s.sessionId}  [${s.origin}]  ${s.project || "(no project)"}`,
    );
    const error = new Error(
      `Concurrent session limit reached (${MAX_SESSIONS}). ` +
        `Please wait for an existing session to complete before starting a new one.\n\n` +
        `Active sessions:\n${activeSessions.join("\n")}\n\n` +
        `You can increase the limit via PLANNOTATOR_MAX_SESSIONS env var.`,
    );
    (error as NodeJS.ErrnoException).code = "SESSION_LIMIT_REACHED";
    throw error;
  }

  // --- Build session context and register in global registry ---
  const sessionCtx: SessionContext = {
    sessionId,
    plan,
    origin,
    permissionMode,
    sharingEnabled,
    shareBaseUrl,
    pasteApiUrl,
    mode,
    customPlanPath,
    opencodeClient: options.opencodeClient,
    cwd,
    draftKey,
    slug,
    project,
    currentPlanPath,
    previousPlan,
    versionInfo,
    repoInfo,
    archivePlans,
    initialArchivePlan,
    resolveDone,
    decisionPromise,
    editorAnnotations,
    externalAnnotations,
    cachedArchivePlans,
  };

  registerSessionContext(sessionCtx);

  // Start server with retry logic
  let server: ReturnType<typeof Bun.serve> | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      server = Bun.serve({
        hostname: getServerHostname(),
        port: configuredPort,

        async fetch(req, server) {
          const url = new URL(req.url);
          const parsed = parseSessionPath(url.pathname);

          // --- Resolve session context ---
          // Multi-session mode: /s/<sessionId>/api/*
          let ctx: SessionContext;
          if (parsed.sessionId) {
            const found = getSessionContext(parsed.sessionId);
            if (!found) {
              return Response.json(
                {
                  error: "Session not found",
                  sessionId: parsed.sessionId,
                  message: `No active session with id "${parsed.sessionId}". The session may have expired or the server was restarted.`,
                },
                { status: 404 },
              );
            }
            ctx = found;
          } else {
            // Single-session backward compatibility: flat /api/* paths
            // Use the current (most recently registered) session
            ctx = sessionCtx;
          }

          // Rewrite url.pathname to the extracted apiPath for route matching
          const apiPath = parsed.apiPath;

          // API: Get a specific plan version from history
          if (apiPath === "/api/plan/version") {
            const vParam = url.searchParams.get("v");
            if (!vParam) {
              return new Response("Missing v parameter", { status: 400 });
            }
            const v = parseInt(vParam, 10);
            if (isNaN(v) || v < 1) {
              return new Response("Invalid version number", { status: 400 });
            }
            const content = getPlanVersion(ctx.project, ctx.slug, v, scopeFromContext(ctx));
            if (content === null) {
              return Response.json({ error: "Version not found" }, { status: 404 });
            }
            return Response.json({ plan: content, version: v });
          }

          // API: List all versions for the current plan
          if (apiPath === "/api/plan/versions") {
            return Response.json({
              project: ctx.project,
              slug: ctx.slug,
              versions: listVersions(ctx.project, ctx.slug, scopeFromContext(ctx)),
            });
          }

          // API: List archived plans (from ~/.plannotator/plans/)
          // Cached for session lifetime — new plans won't appear during a single review
          if (apiPath === "/api/archive/plans" && req.method === "GET") {
            const customPath = url.searchParams.get("customPath") || undefined;
            if (!ctx.cachedArchivePlans) ctx.cachedArchivePlans = listArchivedPlans(customPath, scopeFromContext(ctx));
            return Response.json({ plans: ctx.cachedArchivePlans });
          }

          // API: Get a specific archived plan
          if (apiPath === "/api/archive/plan" && req.method === "GET") {
            const filename = url.searchParams.get("filename");
            if (!filename) {
              return Response.json({ error: "Missing filename parameter" }, { status: 400 });
            }
            const customPath = url.searchParams.get("customPath") || undefined;
            const content = readArchivedPlan(filename, customPath, scopeFromContext(ctx));
            if (content === null) {
              return Response.json({ error: "Plan not found" }, { status: 404 });
            }
            return Response.json({ markdown: content, filepath: filename });
          }

          // API: Close archive browser (archive mode only)
          if (apiPath === "/api/done" && req.method === "POST") {
            ctx.resolveDone?.();
            return Response.json({ ok: true });
          }

          // API: Get plan content
          if (apiPath === "/api/plan") {
            if (ctx.mode === "archive") {
              return Response.json({
                plan: ctx.initialArchivePlan,
                origin: ctx.origin,
                mode: "archive",
                archivePlans: ctx.archivePlans,
                sharingEnabled: ctx.sharingEnabled,
                shareBaseUrl: ctx.shareBaseUrl,
                isWSL: wslFlag,
                serverConfig: getServerConfig(gitUser),
                sessionId: ctx.sessionId,
              });
            }
            return Response.json({
              plan: ctx.plan,
              origin: ctx.origin,
              permissionMode: ctx.permissionMode,
              sharingEnabled: ctx.sharingEnabled,
              shareBaseUrl: ctx.shareBaseUrl,
              pasteApiUrl: ctx.pasteApiUrl,
              repoInfo: ctx.repoInfo,
              previousPlan: ctx.previousPlan,
              versionInfo: ctx.versionInfo,
              projectRoot: process.cwd(),
              isWSL: wslFlag,
              serverConfig: getServerConfig(gitUser),
              sessionId: ctx.sessionId,
            });
          }

          // API: Serve a linked markdown document
          if (apiPath === "/api/doc" && req.method === "GET") {
            return handleDoc(req);
          }

          // API: Update user config (write-back to ~/.plannotator/config.json)
          if (apiPath === "/api/config" && req.method === "POST") {
            try {
              const body = (await req.json()) as { displayName?: string; diffOptions?: Record<string, unknown>; conventionalComments?: boolean; conventionalLabels?: unknown[] | null };
              const toSave: Record<string, unknown> = {};
              if (body.displayName !== undefined) toSave.displayName = body.displayName;
              if (body.diffOptions !== undefined) toSave.diffOptions = body.diffOptions;
              if (body.conventionalComments !== undefined) toSave.conventionalComments = body.conventionalComments;
              if (body.conventionalLabels !== undefined) toSave.conventionalLabels = body.conventionalLabels;
              if (Object.keys(toSave).length > 0) saveConfig(toSave as Parameters<typeof saveConfig>[0]);
              return Response.json({ ok: true });
            } catch {
              return Response.json({ error: "Invalid request" }, { status: 400 });
            }
          }

          // API: Serve images (local paths or temp uploads)
          if (apiPath === "/api/image") {
            return handleImage(req);
          }

          // API: Upload image -> save to temp -> return path
          if (apiPath === "/api/upload" && req.method === "POST") {
            return handleUpload(req);
          }

          // API: Open plan diff in VS Code
          if (apiPath === "/api/plan/vscode-diff" && req.method === "POST") {
            try {
              const body = (await req.json()) as { baseVersion: number };

              if (!body.baseVersion) {
                return Response.json({ error: "Missing baseVersion" }, { status: 400 });
              }

              const basePath = getPlanVersionPath(ctx.project, ctx.slug, body.baseVersion, scopeFromContext(ctx));
              if (!basePath) {
                return Response.json({ error: `Version ${body.baseVersion} not found` }, { status: 404 });
              }

              const result = await openEditorDiff(basePath, ctx.currentPlanPath);
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
          if (apiPath === "/api/obsidian/vaults") {
            return handleObsidianVaults();
          }

          // API: List Obsidian vault files as a tree
          if (apiPath === "/api/reference/obsidian/files" && req.method === "GET") {
            return handleObsidianFiles(req);
          }

          // API: Read an Obsidian vault document
          if (apiPath === "/api/reference/obsidian/doc" && req.method === "GET") {
            return handleObsidianDoc(req);
          }

          // API: List markdown files in a directory as a tree
          if (apiPath === "/api/reference/files" && req.method === "GET") {
            return handleFileBrowserFiles(req);
          }

          // API: Get available agents (OpenCode only)
          if (apiPath === "/api/agents") {
            return handleAgents(ctx.opencodeClient);
          }

          // API: Annotation draft persistence
          if (apiPath === "/api/draft") {
            const draftScope = scopeFromContext(ctx);
            if (req.method === "POST") return handleDraftSave(req, ctx.draftKey, draftScope);
            if (req.method === "DELETE") return handleDraftDelete(ctx.draftKey, draftScope);
            return handleDraftLoad(ctx.draftKey, draftScope);
          }

          // API: Editor annotations (VS Code extension)
          const editorResponse = await ctx.editorAnnotations?.handle(req, url);
          if (editorResponse) return editorResponse;

          // API: External annotations (SSE-based, for any external tool)
          const externalResponse = await ctx.externalAnnotations?.handle(req, url, {
            disableIdleTimeout: () => server.timeout(req, 0),
          });
          if (externalResponse) return externalResponse;

          // API: Save to notes (decoupled from approve/deny)
          if (apiPath === "/api/save-notes" && req.method === "POST") {
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
          if (apiPath === "/api/approve" && req.method === "POST") {
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
            const approveScope = scopeFromContext(ctx);
            if (planSaveEnabled) {
              const annotations = feedback || "";
              if (annotations) {
                saveAnnotations(ctx.slug, annotations, planSaveCustomPath, approveScope);
              }
              savedPath = saveFinalSnapshot(ctx.slug, "approved", ctx.plan, annotations, planSaveCustomPath, approveScope);
            }

            // Clean up draft on successful submit
            deleteDraft(ctx.draftKey, approveScope);

            const effectivePermissionMode = requestedPermissionMode || ctx.permissionMode;
            // REQ-09: Resolve via session-keyed map — ctx no longer holds resolveDecision
            resolveDecision(ctx.sessionId, { approved: true, feedback, savedPath, agentSwitch, permissionMode: effectivePermissionMode });
            return Response.json({ ok: true, savedPath });
          }

          // API: Deny with feedback
          if (apiPath === "/api/deny" && req.method === "POST") {
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
            const denyScope = scopeFromContext(ctx);
            if (planSaveEnabled) {
              saveAnnotations(ctx.slug, feedback, planSaveCustomPath, denyScope);
              savedPath = saveFinalSnapshot(ctx.slug, "denied", ctx.plan, feedback, planSaveCustomPath, denyScope);
            }

            deleteDraft(ctx.draftKey, denyScope);
            // REQ-09: Resolve via session-keyed map — ctx no longer holds resolveDecision
            resolveDecision(ctx.sessionId, { approved: false, feedback, savedPath });
            return Response.json({ ok: true, savedPath });
          }

          // Favicon
          if (url.pathname === "/favicon.svg") return handleFavicon();

          // Serve embedded HTML for all other routes (SPA)
          return new Response(htmlContent, {
            headers: { "Content-Type": "text/html" },
          });
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
  const serverUrl = `http://localhost:${port}`;

  // Notify caller that server is ready
  if (onReady) {
    onReady(serverUrl, isRemote, port);
  }

  return {
    port,
    url: serverUrl,
    isRemote,
    sessionId,
    waitForDecision: (sessionId: string) => {
      const ctx = sessionRegistry.get(sessionId);
      if (!ctx) throw new Error(`Session not found: ${sessionId}`);
      return ctx.decisionPromise;
    },
    ...(donePromise && { waitForDone: () => donePromise }),
    stop: () => {
      unregisterSessionContext(sessionId);
      server.stop();
    },
  };
}
