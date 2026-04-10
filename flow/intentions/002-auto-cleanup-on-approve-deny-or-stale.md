# INTENTION: Auto-Cleanup on Approve, Deny, or Stale Timeout

## User Intent

After a plan is approved or denied, the server should shut down cleanly and immediately — releasing the port, clearing memory, and removing any temporary files. Similarly, if a submitted plan is never acted upon (the agent abandons it, the session dies, the user closes the tab), the server must not linger indefinitely; it should self-destruct after a configurable idle timeout.

## Current Behaviour

- `server.stop()` is called explicitly by the plugin AFTER `waitForDecision()` resolves, with a hardcoded `Bun.sleep(1500)` delay.
- If the plugin's tool execution is interrupted (agent crash, session death, Ctrl+C), `stop()` is never called.
- There is no idle timeout mechanism.
- Temporary files in `/tmp/plannotator/` accumulate indefinitely.
- There is no cleanup of state in `SessionRegistry` (once multi-session routing is implemented).

## Intended Behaviour

### Immediate Cleanup on Decision

- Both `/api/approve` and `/api/deny` handlers call `stop()` **synchronously** (or as part of the handler, before returning the HTTP response) within the server itself.
- The 1.5s `Bun.sleep` in the plugin becomes unnecessary and should be removed.
- The plugin's `stop()` call becomes a no-op or is removed entirely.
- This eliminates the race condition where a new `submit_plan` call arrives during the 1.5s sleep window.

### Stale / Idle Timeout

- `ServerOptions` gains two new optional fields:
  ```typescript
  cleanupAfterMs?: number;    // Absolute timeout from server start (default: none)
  cleanupOnIdleMs?: number;  // Reset on any HTTP request; fire if no request received (default: none)
  ```
- When either timeout fires, the session is torn down:
  - `server.stop()` is called.
  - The session entry is removed from the registry.
  - If `cleanupOnIdleMs` was used, the timer is reset on every incoming HTTP request.
- A default sensible timeout should be documented (e.g. `cleanupAfterMs: 30 * 60 * 1000` = 30 minutes) but defaults to none (legacy behaviour).

### Temp File Cleanup

- On server stop, optionally clean up `/tmp/plannotator/*.png` and other uploaded assets for that session.
- Session-scoped temp files should be stored in a session-keyed subdirectory: `/tmp/plannotator/<sessionId>/`.
- On stop, recursively delete that directory.

### Cleanup API Endpoint

- Add `DELETE /api/session` (or `/s/<sessionId>/api/session`) to allow the calling plugin to explicitly trigger cleanup before the tool returns — useful as a belt-and-suspenders alongside the in-handler cleanup.

## Required Changes

1. **`packages/server/index.ts`**:
   - Add `cleanupAfterMs`, `cleanupOnIdleMs` to `ServerOptions`.
   - Register cleanup timers on server start.
   - In `/api/approve` and `/api/deny` handlers: call `stopSession()` (internal) before resolving.
   - Use session-scoped temp dir: `/tmp/plannotator/<sessionId>/`.
   - Add `DELETE /api/session` endpoint.

2. **`packages/server/review.ts`** — Same changes as above.

3. **`apps/opencode-plugin/index.ts`** — Remove `Bun.sleep(1500)` and `server.stop()` calls. The server cleans itself up.

4. **`packages/server/storage.ts`** — Update temp file path generation to include `sessionId`.

## Non-Functional Requirements

- Cleanup must be idempotent — calling `stop()` multiple times must not throw.
- Cleanup timers must be cleared if the session ends normally (avoid double-cleanup).
- Timeout values must be configurable via environment variables as well as programmatic API: `PLANNOTATOR_CLEANUP_AFTER_MS`, `PLANNOTATOR_CLEANUP_IDLE_MS`.
- Backwards compatible: without timeout env vars or options, behaviour matches current (no auto-cleanup unless plugin calls `stop()`).

---

> **Immutability Clause**
> This document describes the INTENDED final state. All implementation MUST match this description verbatim. Any deviation requires a new intention document and explicit approval before merging.
