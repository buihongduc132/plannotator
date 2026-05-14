/**
 * Remote session detection and port configuration
 *
 * Environment variables:
 *   PLANNOTATOR_REMOTE     - Set to "1"/"true" to force remote, "0"/"false" to force local
 *   PLANNOTATOR_PORT       - Fixed port to use (default: random locally, 19432 for remote)
 *   PLANNOTATOR_SERVER_URL - Full base URL for remote deployments (e.g. http://192.168.1.161:19432)
 *
 * Legacy (still supported): SSH_TTY, SSH_CONNECTION
 */

const DEFAULT_REMOTE_PORT = 19432;
const LOOPBACK_HOST = "127.0.0.1";

function getRemoteOverride(): boolean | null {
  const remote = process.env.PLANNOTATOR_REMOTE;
  if (remote === undefined) {
    return null;
  }

  if (remote === "1" || remote?.toLowerCase() === "true") {
    return true;
  }

  if (remote === "0" || remote?.toLowerCase() === "false") {
    return false;
  }

  return null;
}

/**
 * Check if running in client mode — the plugin acts as an HTTP client
 * that connects to a running server instead of spawning its own.
 *
 * PLANNOTATOR_CLIENT_MODE=1 → true (plugin connects to server via HTTP)
 * PLANNOTATOR_SERVER_URL is set + PLANNOTATOR_CLIENT_MODE unset → true (auto-detect)
 */
export function isClientMode(): boolean {
  const mode = process.env.PLANNOTATOR_CLIENT_MODE;
  if (mode === "1" || mode?.toLowerCase() === "true") return true;
  if (mode === "0" || mode?.toLowerCase() === "false") return false;
  // Auto-detect: server URL is set → assume client mode (plugin connects to server)
  return !!process.env.PLANNOTATOR_SERVER_URL;
}

/**
 * Check if running in a remote session (SSH, devcontainer, etc.)
 */
export function isRemoteSession(): boolean {
  const remoteOverride = getRemoteOverride();
  if (remoteOverride !== null) {
    return remoteOverride;
  }

  // Legacy: SSH_TTY/SSH_CONNECTION (deprecated, silent)
  if (process.env.SSH_TTY || process.env.SSH_CONNECTION) {
    return true;
  }

  return false;
}

/**
 * Get the server port to use
 */
export function getServerPort(): number {
  // Explicit port from environment takes precedence
  const envPort = process.env.PLANNOTATOR_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
    console.error(
      `[Plannotator] Warning: Invalid PLANNOTATOR_PORT "${envPort}", using default`
    );
  }

  // Remote sessions use fixed port for port forwarding; local uses random
  return isRemoteSession() ? DEFAULT_REMOTE_PORT : 0;
}

/**
* Bind local sessions to loopback, but keep remote sessions reachable via the
 * container or host network interface for SSH/devcontainer/Docker forwarding.
 */
export function getServerHostname(): string {
  return isRemoteSession() ? "0.0.0.0" : LOOPBACK_HOST;
}

/**
* Get the server hostname to bind to.
 *
 * Remote: binds to 0.0.0.0 so any machine on the network can reach it.
 * Local:  binds to localhost (127.0.0.1) so only this machine can access it.
 *
 * Override with PLANNOTATOR_HOST env var.
 */
export function getServerHost(): string {
  const host = process.env.PLANNOTATOR_HOST;
  if (host) return host;
  return isRemoteSession() ? "0.0.0.0" : "127.0.0.1";
}

/**
 * Get the server base URL prefix.
 *
 * When PLANNOTATOR_SERVER_URL is set (e.g. for remote deployments), use it as-is.
 * Otherwise fall back to localhost.
 */
export function getServerBaseUrl(): string {
  const url = process.env.PLANNOTATOR_SERVER_URL;
  if (url) return url.replace(/\/$/, ""); // strip trailing slash
  return "http://localhost";
}

/**
 * Get the full server URL with port.
 *
 * When PLANNOTATOR_SERVER_URL is set, return it as-is (it already includes the port).
 * Otherwise compose http://localhost:{port}.
 */
export function getServerUrl(port: number): string {
  const url = process.env.PLANNOTATOR_SERVER_URL;
  if (url) return url.replace(/\/$/, "");
  return `http://localhost:${port}`;
}
