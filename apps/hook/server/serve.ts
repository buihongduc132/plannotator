/**
 * Remote multi-session plannotator server
 *
 * Starts a long-running HTTP server accessible from any machine on the network.
 * Supports concurrent sessions via /s/<sessionId>/api/* URL routing.
 *
 * Usage:
 *   bun run apps/hook/server/serve.ts
 *
 * Environment:
 *   PLANNOTATOR_REMOTE=1       — bind to 0.0.0.0 (remote accessible)
 *   PLANNOTATOR_PORT=19432     — fixed port (default: 19432)
 *   PLANNOTATOR_MAX_SESSIONS   — max concurrent sessions (default: 10)
 *   PLANNOTATOR_HOST=0.0.0.0  — override host binding
 *
 * Docker:
 *   docker compose --profile server up --detach
 *   docker compose --profile server logs -f
 *   docker compose --profile server down
 *
 * Remote access:
 *   http://<host-ip>:19432/s/<sessionId>/api/plan
 */

import {
  startPlannotatorServer,
} from "@plannotator/server";
import {
  registerSession,
  listSessions,
  unregisterSession,
} from "@plannotator/server/sessions";
import { detectProjectName } from "@plannotator/server/project";
import { openBrowser } from "@plannotator/server/browser";
import { isRemoteSession, getServerUrl } from "@plannotator/server/remote";

// @ts-ignore - Bun import attribute for text
import planHtml from "../dist/index.html" with { type: "text" };
const planHtmlContent = planHtml as unknown as string;

process.on("exit", () => unregisterSession());
process.on("SIGINT", () => { unregisterSession(); process.exit(0); });
process.on("SIGTERM", () => { unregisterSession(); process.exit(0); });

// Detect if remote
const remote = isRemoteSession();

async function main() {
  const planProject = (await detectProjectName()) ?? "_unknown";

  console.log(`[plannotator] Remote multi-session server starting...`);
  console.log(`[plannotator] Mode: ${remote ? "remote (0.0.0.0)" : "local (127.0.0.1)"}`);
  console.log(`[plannotator] Project: ${planProject}`);
  console.log(`[plannotator] Sessions: ${listSessions().length} active`);

  // For a remote server, we just keep it running.
  // The server listens on the configured port and handles incoming sessions.
  // Use `plannotator last` or `plannotator annotate <file.md>` from another
  // terminal / machine to create sessions targeting this server.
  console.log(`[plannotator] Server is running. Press Ctrl+C to stop.`);
  console.log(`[plannotator] Active sessions:`);
  for (const s of listSessions()) {
    console.log(`  - ${s.label || s.sessionId}  ${s.url}  [${s.mode}]  ${s.project}`);
  }

  // To keep the process alive, start a minimal "dummy" session
  // that just listens and registers itself.
  // Real sessions are created by calling plannotator CLI from any machine.
  const { port, sessionId, stop } = await startPlannotatorServer({
    plan: "[Remote server] Use 'plannotator last' or 'plannotator annotate <file.md>' from any machine to start a session targeting this server",
    origin: "remote-server",
    htmlContent: planHtmlContent,
    permissionMode: "auto-approve",
    mode: "archive",
    sharingEnabled: false,
    onReady: (url, isRemote) => {
      if (!process.env.CI) {
        openBrowser(url, { isRemote });
      }
      console.log(`[plannotator] Server ready: ${url}`);
    },
  });

registerSession({
    pid: process.pid,
    port,
    url: getServerUrl(port),
    mode: "archive",
    project: planProject,
    startedAt: new Date().toISOString(),
    label: `server-${process.hostname}`,
  });

  const serverUrl = getServerUrl(port);
  console.log(`[plannotator] Listening on port ${port}`);
  console.log(`[plannotator] Server URL: ${serverUrl}`);
  console.log(`[plannotator] Sessions use /s/<sessionId>/api/* URL routing`);
  console.log(`[plannotator] Remote: ${remote ? "yes (0.0.0.0)" : "no (127.0.0.1)"}`);

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(`[plannotator] Failed to start server:`, err);
  process.exit(1);
});
