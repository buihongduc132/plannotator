/**
 * Annotate Server
 *
 * Provides a server for annotating arbitrary markdown files.
 * Follows the same patterns as the review server but serves
 * markdown content via /api/plan so the plan editor UI can
 * render it without modifications.
 *
 * Environment variables:
 *   PLANNOTATOR_REMOTE - Set to "1"/"true" for remote, "0"/"false" for local
 *   PLANNOTATOR_PORT   - Fixed port to use (default: random locally, 19432 for remote)
 */

import { isRemoteSession, getServerPort, getServerHost, getServerUrl } from "./remote";
import { extractSessionSlug, injectSessionPath } from "./index";
import { getRepoInfo } from "./repo";
import type { Origin } from "@plannotator/shared/agents";
import { handleImage, handleUpload, handleServerReady, handleDraftSave, handleDraftLoad, handleDraftDelete, handleFavicon } from "./shared-handlers";
import { handleDoc, handleFileBrowserFiles, handleObsidianVaults, handleObsidianFiles, handleObsidianDoc } from "./reference-handlers";
import { contentHash, deleteDraft } from "./draft";
import { createExternalAnnotationHandler } from "./external-annotations";
import { saveConfig, detectGitUser, getServerConfig } from "./config";
import { dirname, resolve as resolvePath } from "path";
import { isWSL } from "./browser";

// Re-export utilities
export { isRemoteSession, getServerPort } from "./remote";
export { openBrowser } from "./browser";
export { handleServerReady as handleAnnotateServerReady } from "./shared-handlers";

// --- Types ---

export interface AnnotateServerOptions {
  /** Markdown content of the file to annotate */
  markdown: string;
  /** Original file path (for display purposes) */
  filePath: string;
  /** HTML content to serve for the UI */
  htmlContent: string;
  /** Origin identifier for UI customization */
  origin?: Origin;
  /** UI mode: "annotate" for files, "annotate-last" for last agent message, "annotate-folder" for folders */
  mode?: "annotate" | "annotate-last" | "annotate-folder";
  /** Folder path when annotating a directory (used as projectRoot for file browser) */
  folderPath?: string;
  /** Whether URL sharing is enabled (default: true) */
  sharingEnabled?: boolean;
  /** Custom base URL for share links */
  shareBaseUrl?: string;
  /** Base URL of the paste service API for short URL sharing */
  pasteApiUrl?: string;
  /** Source attribution: original URL or filename (e.g. "https://..." or "index.html") */
  sourceInfo?: string;
  /** Enable review-gate UX: adds an Approve button alongside Close/Send Annotations (#570) */
  gate?: boolean;
  /** Called when server starts with the URL, remote status, and port */
  onReady?: (url: string, isRemote: boolean, port: number) => void;
  /** OpenCode session ID for storage isolation */
  sessionId?: string;
  /** Working directory as outer namespace */
  cwd?: string;
}

export interface AnnotateServerResult {
  /** The port the server is running on */
  port: number;
  /** The full URL to access the server */
  url: string;
  /** Whether running in remote mode */
  isRemote: boolean;
  /** Wait for user feedback submission */
  waitForDecision: () => Promise<{
    feedback: string;
    annotations: unknown[];
    exit?: boolean;
    approved?: boolean;
  }>;
  /** Stop the server */
  stop: () => void;
}

// --- Server Implementation ---

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;

/**
 * Start the Annotate server
 *
 * Handles:
 * - Remote detection and port configuration
 * - API routes (/api/plan with mode:"annotate", /api/feedback)
 * - Port conflict retries
 */
export async function startAnnotateServer(
  options: AnnotateServerOptions
): Promise<AnnotateServerResult> {
  const {
    markdown,
    filePath,
    htmlContent,
    origin,
    mode = "annotate",
    folderPath,
    sourceInfo,
    sharingEnabled = true,
    shareBaseUrl,
    pasteApiUrl,
    gate = false,
    onReady,
    cwd,
  } = options;
  // REQ-14: sessionId and cwd enable /s/<sessionId>/api/... routing
  const sessionId = options.sessionId ?? crypto.randomUUID();

  const isRemote = isRemoteSession();
  const configuredPort = getServerPort();
  const wslFlag = await isWSL();
  const gitUser = detectGitUser();
  const draftSource =
    mode === "annotate-folder" && folderPath
      ? `folder:${resolvePath(folderPath)}`
      : markdown;
  const draftKey = contentHash(draftSource);
  const externalAnnotations = createExternalAnnotationHandler("plan");

  // Detect repo info (cached for this session)
  const repoInfo = await getRepoInfo();

  // Decision promise
  let resolveDecision: (result: {
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
  }>((resolve) => {
    resolveDecision = resolve;
  });

  // REQ-14: Regex to extract sessionId from URL path: /s/<sessionId>/api/...
  const SESSION_PATH_REGEX = /^\/s\/([^/]+)(\/api\/.*)$/;

  /**
   * Parse a URL pathname to extract optional sessionId and the remaining API path.
   * Returns { sessionId, apiPath } if the path matches /s/<id>/api/...,
   * or { sessionId: null, apiPath } for flat /api/... paths.
   */
  function parseAnnotateSessionPath(pathname: string): { sessionId: string | null; apiPath: string } {
    const match = SESSION_PATH_REGEX.exec(pathname);
    if (match) {
      return { sessionId: match[1], apiPath: match[2] };
    }
    return { sessionId: null, apiPath: pathname };
  }

  // Capture configured port so retries can fall back to dynamic allocation
  const configuredPortValue = configuredPort;

  // Start server with retry logic
  let server: ReturnType<typeof Bun.serve> | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // After the first EADDRINUSE, fall back to a dynamic port so multiple servers
    // can coexist (PLANNOTATOR_PORT defines the *preferred* port, not a hard requirement)
    const port = attempt === 1 ? configuredPortValue : 0;

    try {
      server = Bun.serve({
        hostname: getServerHost(),
        port,

        async fetch(req, server) {
          const url = new URL(req.url);
          // REQ-14: Support /s/<sessionId>/api/... routing when sessionId is provided
          const parsed = sessionId
            ? parseAnnotateSessionPath(url.pathname)
            : { sessionId: null as string | null, apiPath: url.pathname };

          // When sessionId is in the URL path, verify it matches the expected session
          if (sessionId && parsed.sessionId && parsed.sessionId !== sessionId) {
            return Response.json(
              {
                error: "Session mismatch",
                message: `URL session "${parsed.sessionId}" does not match expected "${sessionId}"`,
              },
              { status: 403 },
            );
          }

          const apiPath = parsed.apiPath;

          // API: Get plan content (reuse /api/plan so the plan editor UI works)
          if (apiPath === "/api/plan" && req.method === "GET") {
            return Response.json({
              plan: markdown,
              origin,
              mode,
              filePath,
              sourceInfo,
              gate,
              sharingEnabled,
              shareBaseUrl,
              pasteApiUrl,
              repoInfo,
              projectRoot: folderPath || cwd || process.cwd(),
              cwd,
              sessionId,
              isWSL: wslFlag,
              serverConfig: getServerConfig(gitUser),
            });
          }

          // API: List all active sessions (GET)
          if (apiPath === "/api/sessions" && req.method === "GET") {
            const sessions = [{
              sessionId: sessionId ?? "annotate",
              mode: mode,
              origin: origin ?? "claude-code",
              project: repoInfo?.display ?? "Unknown",
              slug: filePath.split('/').pop() || "markdown",
              name: filePath.split('/').pop() || "Annotate",
              cwd: cwd || process.cwd(),
              url: sessionId ? `${getServerUrl(server.port)}/s/${sessionId}` : getServerUrl(server.port),
            }];
            return Response.json({
              sessions,
              count: 1,
              maxSessions: 1,
            });
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

          // API: Serve a linked markdown document
          // Inject source file's directory as base for relative path resolution.
          // Skip base injection for URL annotations — there's no local directory to resolve against.
          if (apiPath === "/api/doc" && req.method === "GET") {
            if (!url.searchParams.has("base") && !/^https?:\/\//i.test(filePath)) {
              const docUrl = new URL(req.url);
              docUrl.searchParams.set("base", dirname(filePath));
              return handleDoc(new Request(docUrl.toString()));
            }
            return handleDoc(req);
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

          // API: Upload image -> save to temp -> return path
          if (apiPath === "/api/upload" && req.method === "POST") {
            return handleUpload(req);
          }

          // API: Annotation draft persistence
          if (apiPath === "/api/draft") {
            if (req.method === "POST") return handleDraftSave(req, draftKey, { sessionId, cwd });
            if (req.method === "DELETE") return handleDraftDelete(draftKey, { sessionId, cwd });
            return handleDraftLoad(draftKey, { sessionId, cwd });
          }

          // API: External annotations (SSE-based, for any external tool)
          const externalResponse = await externalAnnotations.handle(req, url, {
            disableIdleTimeout: () => server.timeout(req, 0),
          });
          if (externalResponse) return externalResponse;

          // API: Exit annotation session without feedback
          if (apiPath === "/api/exit" && req.method === "POST") {
            deleteDraft(draftKey);
            resolveDecision({ feedback: "", annotations: [], exit: true });
            return Response.json({ ok: true });
          }

          // API: Approve the annotation session (review-gate UX, #570)
          if (apiPath === "/api/approve" && req.method === "POST") {
            deleteDraft(draftKey);
            resolveDecision({ feedback: "", annotations: [], approved: true });
            return Response.json({ ok: true });
          }

          // API: Submit annotation feedback
          if (apiPath === "/api/feedback" && req.method === "POST") {
            try {
              const body = (await req.json()) as {
                feedback: string;
                annotations: unknown[];
              };

              deleteDraft(draftKey);
              resolveDecision({
                feedback: body.feedback || "",
                annotations: body.annotations || [],
              });

              return Response.json({ ok: true });
            } catch (err) {
              const message =
                err instanceof Error
                  ? err.message
                  : "Failed to process feedback";
              return Response.json({ error: message }, { status: 500 });
            }
          }

          // Favicon
          if (url.pathname === "/favicon.svg") return handleFavicon();

          // API routes that fell through should 404
          if (url.pathname.startsWith("/api/")) {
            return Response.json({ error: "Not found", path: url.pathname }, { status: 404 });
          }

          // Serve embedded HTML for all other routes (SPA)
          const slug = extractSessionSlug(url.pathname);
          if (slug) {
            return new Response(injectSessionPath(htmlContent, slug), {
              headers: { "Content-Type": "text/html" },
            });
          }
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
      // Bun surfaces EADDRINUSE as "Failed to start server. Is port X in use?" — match
      // that message text since err.code may be undefined in bundled builds.
      const errMsg = err instanceof Error ? err.message : String(err);
      const errCode = (err as { code?: unknown }).code;
      const hasEADDRINUSE =
        errMsg.toLowerCase().includes("in use") ||
        errCode === "EADDRINUSE";

      if (hasEADDRINUSE && attempt < MAX_RETRIES) {
        await Bun.sleep(RETRY_DELAY_MS);
        continue;
      }

      // Retry exhausted with EADDRINUSE (should not normally happen since we fall back
      // to port 0 on retry), or a completely unrelated error — propagate it.
      throw err;
    }
  }

  if (!server) {
    throw new Error("Failed to start server");
  }

  const port = server.port!;
  // REQ-14: When sessionId is provided, embed it in the URL path so clients
  // can target this specific session via /s/<sessionId>/api/... routing.
  const serverUrl = sessionId
    ? `${getServerUrl(port)}/s/${sessionId}`
    : getServerUrl(port);

  // Notify caller that server is ready
  if (onReady) {
    onReady(serverUrl, isRemote, port);
  }

  return {
    port,
    url: serverUrl,
    isRemote,
    waitForDecision: () => decisionPromise,
    stop: () => server.stop(),
  };
}
