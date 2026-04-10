# INTENTION: 004 — Serve on 0.0.0.0 or Tailscale Network Address

## User Intent

be able to serve in 0.0.0.0 or in tailscale itself

## Current Behaviour

- `startPlannotatorServer()` in `packages/server/index.ts` calls `Bun.serve({ port: configuredPort })` without specifying `hostname`.
- Bun defaults to binding `127.0.0.1` on IPv4 (or `::1` on IPv6).
- The server URL is always constructed as `http://localhost:${server.port}`.
- There is no support for `PLANNOTATOR_HOST`, Tailscale address detection, or TLS.
- Remote sessions (devcontainer/SSH) currently rely on the user manually setting up SSH port forwarding.

## Intended Behaviour

### Hostname Configuration

- `packages/server/remote.ts` gains a new function:
  ```typescript
  export function getServerHostname(): string {
    if (process.env.PLANNOTATOR_HOST) return process.env.PLANNOTATOR_HOST;
    if (isRemoteSession()) return "0.0.0.0";  // remote = bind all interfaces
    return "127.0.0.1";  // local = only localhost
  }
  ```
- `Bun.serve()` is called with `hostname` parameter:
  ```typescript
  server = Bun.serve({
    hostname: getServerHostname(),
    port: configuredPort,
    fetch(req) { ... }
  });
  ```

### Tailscale Support

- New env var: `PLANNOTATOR_TAILSCALE=1` or `PLANNOTATOR_TAILSCALE=true`.
- When set, detect the Tailscale IP at startup using the following priority:
  1. `TS_LOCAL_ADDR` env var first (set by `tailscale serve` / `tailscale Funnel`).
  2. Fall back to `tailscale status --json` output cached at startup (not re-read on every request).
     - Locate the `tailscale` binary via `Bun.which("tailscale")` or fall back to `tailscale` in PATH.
     - Run with a 5-second timeout via `Bun.spawn({ cmd: ["tailscale", "status", "--json"], timeout: 5000 })`.
     - Parse the `Self.DNSName` or `Self.IPv4` field from the JSON output.
     - Cache the result in a module-level variable.
  3. If both fail, log a warning and fall back to `PLANNOTATOR_HOST` if set, otherwise bind to the configured hostname.
- Construct the server URL using the resolved Tailscale IP:
  ```
  http://<tailscale-ip>:<port>
  ```
- Print this URL to the terminal so the user can open it on another machine.
- For Tailscale Funnel mode (HTTPS), detect if the env var indicates a Funnel URL and use `https://` scheme.

### URL Reporting

- `handleServerReady(url, isRemote, port)` is updated to pass the resolved hostname/IP so callers can report the correct URL.
- The OpenCode plugin logs the URL (including Tailscale IP) to the terminal for easy copy-paste.

### TLS (Future / Documented)

- Direct TLS support is out of scope for this intention, but the architecture should not prevent adding it later.
- The recommended path for HTTPS is Tailscale Funnel (handled at the Tailscale layer, not in-app) or a reverse proxy (Caddy, nginx) in front of the Bun server.

## Required Changes

1. **`packages/server/remote.ts`**:
   - Add `getServerHostname(): string` function.
   - Add Tailscale IP detection (`PLANNOTATOR_TAILSCALE` env var, `TS_LOCAL_ADDR`, `tailscale status --json` with 5s timeout and `Bun.which` fallback).
   - Add `PLANNOTATOR_TAILSCALE_URL_BASE` env var for explicit Funnel URLs.
   - Re-export `getServerHostname` from `packages/server/index.ts`.

2. **`packages/server/index.ts`**:
   - Call `getServerHostname()` and pass `hostname` to `Bun.serve()`.
   - Construct `serverUrl` using the actual bound hostname (not hardcoded `localhost`).
   - Update `onReady` callback signature to include hostname: `onReady?: (url: string, isRemote: boolean, port: number, hostname: string) => void`.

3. **`packages/server/review.ts`** — Same changes as above.

4. **`apps/opencode-plugin/index.ts`** — Update `handleServerReady` call to handle the new hostname parameter (even if just ignored for now).

5. **`CLAUDE.md`** — Document the new `PLANNOTATOR_HOST`, `PLANNOTATOR_TAILSCALE`, and `PLANNOTATOR_TAILSCALE_URL_BASE` environment variables.

## Non-Functional Requirements

- **Local default must not change**: default binding stays `127.0.0.1` to avoid exposing local servers to the network without intent.
- **Tailscale detection must be resilient**: if `tailscale status` fails or times out, fall back to `PLANNOTATOR_HOST` env var with a warning log.
- **No breaking changes**: existing deployments without `PLANNOTATOR_HOST` or Tailscale config behave identically to before.
- **Port binding on `0.0.0.0` requires firewall awareness**: document that users on remote machines need their firewall open for the chosen port.

---

<immutable_block>
be able to serve in 0.0.0.0 or in tailscale itself
</immutable_block>
