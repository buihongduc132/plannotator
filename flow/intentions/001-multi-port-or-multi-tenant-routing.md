# INTENTION: Multi-Port / Multi-Project Session Routing

## User Intent

We want Plannotator to support multiple concurrent projects or sessions, each isolated — either by giving each project/session its own dedicated port, OR by reusing a single host:port but routing by a unique path prefix (e.g. `/s/<sessionId>/api/plan`) so that many plans can be in-flight simultaneously without port conflicts.

## Current Behaviour

- `startPlannotatorServer()` creates a single `Bun.serve()` instance bound to one port.
- All plan state lives in closure variables inside that function — one plan, one session at a time.
- If two agents call `submit_plan` concurrently on the same machine, they get `EADDRINUSE` after 5 retries.
- There is no routing, no session ID, and no multi-tenancy.

## Intended Behaviour

### Option A — Multi-Port (one port per session)

- Each `submit_plan` call acquires a unique port (e.g. `PLANNOTATOR_BASE_PORT + atomicCounter`, or from a managed port pool).
- Each port runs its own isolated Bun server, fully separated.
- The plugin layer (`apps/opencode-plugin/index.ts`) tracks `(sessionId → port)` in a registry so the result can be routed back.
- Port cleanup happens after `approve`/`deny` or on timeout.

### Option B — Multi-Tenant Single-Port (recommended)

- A **single** `Bun.serve()` instance handles ALL sessions on one port.
- Each session is identified by a `sessionId` (UUID), passed via:
  - Path prefix: `/s/<sessionId>/api/plan`, `/s/<sessionId>/api/approve`, etc.
  - OR `X-Session-Id` HTTP header.
- All per-session state (plan content, pending decision promise, slug, etc.) is stored in a `Map<sessionId, SessionContext>` registry.
- The fetch handler reads the `sessionId` from the URL path or header, looks up the context, and routes accordingly.
- `waitForDecision(sessionId)` resolves only the specific session's promise.
- `stop(sessionId)` tears down only that session's entry.
- New calls to `submit_plan` while a session is still pending → returns an error or creates a NEW session entry (both are valid policies, documented choice needed).

## Why Option B is Preferred

- Zero port configuration required.
- Works transparently behind any reverse proxy or Tailscale on a single address.
- Allows a single observability/monitoring point.
- Adding a new session is O(1) — no port exhaustion.
- Shutting down all sessions cleanly is a single `server.stop()`.

## Required Changes

1. **`packages/server/index.ts`** — Refactor out of closure-based state into a `SessionRegistry` map. Accept `sessionId` in `ServerOptions` or generate one. Route all `/api/*` paths under `/s/<sessionId>/api/*`.

2. **`packages/server/review.ts`** — Same refactoring as above for the review server.

3. **`apps/opencode-plugin/index.ts`** — Pass `context.sessionID` from the OpenCode tool execution context into `startPlannotatorServer({ sessionId })`. Track returned `ServerResult` keyed by sessionId. Handle `serverAlreadyRunning` case.

4. **`packages/server/remote.ts`** — Optionally extend `getServerPort()` to also return a base port for port-pool strategies (if Option A is ever needed).

## Non-Functional Requirements

- **Backwards compatibility**: Existing single-session use (no sessionId) must continue to work exactly as today.
- **No breaking API changes** to the exported function signatures — add optional fields to `ServerOptions`.
- **Thread safety**: Bun is single-threaded but `Map` operations are synchronous; no locks needed.
- **Cleanup**: Every session entry must be removed from the registry on `stop()`, approve, deny, or timeout.

---

> **Immutability Clause**
> This document describes the INTENDED final state. All implementation MUST match this description verbatim. Any deviation requires a new intention document and explicit approval before merging.
