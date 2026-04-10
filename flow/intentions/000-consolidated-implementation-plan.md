# INTENTION: Consolidated Implementation Strategy — Multi-Session Plannotator

## Intent

This document captures the **recommended implementation approach** that unifies the four preceding intentions into a single coherent implementation plan. It should be read in conjunction with:
- `001-multi-port-or-multi-tenant-routing.md`
- `002-auto-cleanup-on-approve-deny-or-stale.md`
- `003-concurrent-isolated-multi-agent-sessions.md`
- `004-serve-on-0-0-0-0-or-tailscale.md`

## Summary of the Four Intentions

| # | Intention | Key Change |
|---|---|---|
| 001 | Multi-session routing | Single-port, path-routed session registry |
| 002 | Auto-cleanup | In-handler stop + idle/absolute timers |
| 003 | Session isolation | `sessionId` as scope key for all storage + decisions |
| 004 | Network binding | `hostname` param + Tailscale IP detection |

## Unified Architecture

### The Session Registry Pattern

The central data structure for all four intentions is a **module-level session registry**:

```typescript
// packages/server/registry.ts (new file)

export interface SessionContext {
  sessionId: string;
  scope?: string;
  plan: string;
  origin: string;
  htmlContent: string;
  permissionMode?: string;
  sharingEnabled: boolean;
  slug: string;
  createdAt: number;
  lastActivityAt: number;
  resolveDecision: (result: DecisionResult) => void;
  stopTimer?: ReturnType<typeof setTimeout>;
  stopIdleTimer?: ReturnType<typeof setTimeout>;
}

export type DecisionResult = {
  approved: boolean;
  feedback?: string;
  savedPath?: string;
  agentSwitch?: string;
  permissionMode?: string;
};

const registry = new Map<string, SessionContext>();
const MAX_SESSIONS = parseInt(process.env.PLANNOTATOR_MAX_SESSIONS ?? "10");

export function getSession(id: string): SessionContext | undefined {
  return registry.get(id);
}

export function registerSession(ctx: SessionContext): void {
  if (registry.size >= MAX_SESSIONS) {
    throw new Error(
      `Max sessions (${MAX_SESSIONS}) reached. ` +
      `Active: ${[...registry.keys()].join(", ")}`
    );
  }
  registry.set(ctx.sessionId, ctx);
}

export function removeSession(id: string): void {
  const ctx = registry.get(id);
  if (ctx?.stopTimer) clearTimeout(ctx.stopTimer);
  if (ctx?.stopIdleTimer) clearTimeout(ctx.stopIdleTimer);
  // Cleanup temp dir: /tmp/plannotator/<id>/
  registry.delete(id);
}
```

### Single Server, Multi-Session Routing

One `Bun.serve()` instance handles all sessions. The fetch handler routes by path prefix:

```
/s/<sessionId>/api/plan        → GET  → return plan for that session
/s/<sessionId>/api/approve     → POST → approve + self-cleanup
/s/<sessionId>/api/deny        → POST → deny + self-cleanup
/s/<sessionId>/api/image       → GET  → serve image (session-scoped path)
/s/<sessionId>/api/upload      → POST → upload to /tmp/plannotator/<sessionId>/
/api/sessions                 → GET  → list active sessions (for observability)
DELETE /s/<sessionId>/api/session → delete session early
/                              → SPA catch-all (serves HTML, no session needed for initial load)
```

### Cleanup Strategy (Unified)

1. **In-handler cleanup** (primary): `/api/approve` and `/api/deny` call `removeSession(sessionId)` synchronously before returning the HTTP response. No plugin-side `stop()` call needed.
2. **Idle timer** (secondary): If `cleanupOnIdleMs` is set, the timer is reset on every HTTP request. Fires if the user abandons the tab.
3. **Absolute timer** (tertiark): If `cleanupAfterMs` is set, fires regardless of activity.
4. **Temp dir**: All uploads go to `/tmp/plannotator/<sessionId>/`. Cleaned up by `removeSession()`.

### Backwards Compatibility Layer

```typescript
// If no sessionId provided, create a single-use "legacy" session
// that operates exactly like the current implementation (no registry,
// no routing, no concurrency). This keeps existing consumers working.
```

### File Change Order (Implementation Sequence)

**Phase 1 — Registry and Routing (Foundation)**
1. Create `packages/server/registry.ts` — the session map + helpers.
2. Update `packages/server/remote.ts` — add `getServerHostname()` + Tailscale detection.
3. Update `packages/server/index.ts` — adopt registry, add path routing, pass `hostname` to Bun.serve, in-handler cleanup.

**Phase 2 — Isolation and Storage (Session Safety)**
4. Update `packages/server/storage.ts` — add `sessionId` parameter to all functions.
5. Update `packages/server/review.ts` — same registry + routing changes as plan server.

**Phase 3 — Plugin Integration (Wire It Up)**
6. Update `apps/opencode-plugin/index.ts` — pass `context.sessionID`, remove `Bun.sleep` + manual `stop()`.
7. Update `apps/hook/` (Claude Code plugin) — same sessionId wiring if applicable.

**Phase 4 — Observability and Hardening**
8. Add `GET /api/sessions` endpoint for debugging.
9. Document all new env vars in `CLAUDE.md`.
10. Add concurrency limit test cases.

## Environment Variables Summary

| Variable | Purpose | Default |
|---|---|---|
| `PLANNOTATOR_HOST` | Bind hostname (`0.0.0.0`, Tailscale IP, etc.) | `127.0.0.1` (local) / `0.0.0.0` (remote) |
| `PLANNOTATOR_PORT` | Fixed port | random (local) / `19432` (remote) |
| `PLANNOTATOR_TAILSCALE` | Enable Tailscale IP detection | `0` |
| `PLANNOTATOR_TAILSCALE_URL_BASE` | Explicit Tailscale Funnel base URL | auto-detected |
| `PLANNOTATOR_MAX_SESSIONS` | Concurrent session limit | `10` |
| `PLANNOTATOR_CLEANUP_AFTER_MS` | Absolute session timeout (ms) | none |
| `PLANNOTATOR_CLEANUP_IDLE_MS` | Idle timeout (ms, resets on activity) | none |
| `PLANNOTATOR_REMOTE` | Force remote mode | auto-detected |

## Non-Functional Requirements

- **Zero breaking changes** for existing single-session users.
- All new API fields are **optional** — existing `ServerOptions` consumers work without modification.
- Every new env var has a **sensible fallback** — no config required to retain current behaviour.
- The registry is **synchronous** (Bun single-threaded) — no locking primitives needed.
- Session state is **in-memory only** — no DB, no Redis, keeps deployment simple.

---

<immutable_block>
This document describes the INTENDED final state. All implementation MUST match this description verbatim. Any deviation requires a new intention document and explicit approval before merging.
</immutable_block>
