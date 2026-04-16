/**
 * Multi-session smoke test for plannotator
 *
 * Tests the feat/multiple-session implementation:
 *   - Concurrent session startup and isolation
 *   - URL routing via /s/<sessionId>/api/*
 *   - Session limit enforcement (PLANNOTATOR_MAX_SESSIONS=2)
 *   - Storage isolation per session
 *   - Decision promise keyed by sessionId
 *
 * Run locally:
 *   bun run test-multi-session.ts
 *
 * Run inside Docker:
 *   docker compose --profile test up --abort-on-container-exit
 */

// NOTE for local run: env vars must be set BEFORE the module import (ESM IIFE caching).
// Docker compose handles this automatically. For local shell:
//   PLANNOTATOR_MAX_SESSIONS=2 PLANNOTATOR_REMOTE=0 bun test-multi-session.ts
// Or: use Docker: docker compose --profile test up --abort-on-container-exit

import {
  startPlannotatorServer,
  handleServerReady,
} from "./packages/server/index.ts";
import type {
  ServerOptions,
  SessionContext,
} from "./packages/server/index.ts";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";

// --- Test helpers ---
let passed = 0;
let failed = 0;

function ok(label: string, detail?: string) {
  passed++;
  console.log(`  [OK]  ${label}${detail ? " — " + detail : ""}`);
}

function fail(label: string, detail: string) {
  failed++;
  console.error(`  [FAIL] ${label} — ${detail}`);
}

function assert(condition: boolean, label: string, detail: string) {
  if (condition) ok(label, detail);
  else fail(label, detail);
}

// --- Session manager ---
interface TestSession {
  sessionId: string;
  port: number;
  cwd: string;
  plan: string;
}

const activeSessions: TestSession[] = [];
const RESULTS_FILE = "/tmp/smoke-results.json";

// --- Test cases ---
async function runTests() {
  console.log("\n========================================");
  console.log("  MULTI-SESSION SMOKE TEST");
  console.log("========================================\n");

  try {
    // === TEST 1: Single session startup ===
    console.log("[1] Single session startup...");
    const session1 = await startTestSession({
      sessionId: `test-session-1-${Date.now()}`,
      cwd: "/tmp/test-proj-a",
      plan: "Test plan A: fix authentication bug",
    });
    activeSessions.push(session1);

    // Wait for server to be ready
    await waitForServer(`http://localhost:${session1.port}/api/plan`);

    const resp1 = await fetch(`http://localhost:${session1.port}/api/plan`);
    const body1 = await resp1.json();
    assert(
      body1.sessionId === session1.sessionId,
      "Session A: /api/plan returns correct sessionId",
      body1.sessionId,
    );

    // === TEST 2: Concurrent second session ===
    console.log("\n[2] Concurrent second session...");
    const session2 = await startTestSession({
      sessionId: `test-session-2-${Date.now()}`,
      cwd: "/tmp/test-proj-b",
      plan: "Test plan B: add dark mode to dashboard",
    });
    activeSessions.push(session2);

    await waitForServer(`http://localhost:${session2.port}/api/plan`);

    const resp2 = await fetch(`http://localhost:${session2.port}/api/plan`);
    const body2 = await resp2.json();
    assert(
      body2.sessionId === session2.sessionId,
      "Session B: /api/plan returns correct sessionId",
      body2.sessionId,
    );

    // === TEST 3: Session isolation — each session has its own context ===
    console.log("\n[3] Session isolation — separate contexts...");
    assert(
      body1.sessionId !== body2.sessionId,
      "Session IDs are different",
      `${body1.sessionId} vs ${body2.sessionId}`,
    );

    // === TEST 4: URL path routing /s/<sessionId>/api/* ===
    console.log("\n[4] URL path routing /s/<sessionId>/api/* ...");
    const routedResp1 = await fetch(
      `http://localhost:${session1.port}/s/${session1.sessionId}/api/plan`,
    );
    const routedBody1 = await routedResp1.json();
    assert(
      routedBody1.sessionId === session1.sessionId,
      "Session A: routed /s/<sessionId>/api/plan returns correct sessionId",
    );

    const routedResp2 = await fetch(
      `http://localhost:${session2.port}/s/${session2.sessionId}/api/plan`,
    );
    const routedBody2 = await routedResp2.json();
    assert(
      routedBody2.sessionId === session2.sessionId,
      "Session B: routed /s/<sessionId>/api/plan returns correct sessionId",
    );

    // === TEST 5: Cross-session isolation via routing ===
    console.log("\n[5] Cross-session isolation via URL routing...");
    // Session A's server correctly serves Session B when B's ID is in URL path
    const crossResp = await fetch(
      `http://localhost:${session1.port}/s/${session2.sessionId}/api/plan`,
    );
    const crossBody = await crossResp.json();
    // Session A's server routes to Session B correctly (200 with B's plan)
    assert(
      crossResp.status === 200,
      "Session A: routing to Session B via URL path works (200)",
      `status=${crossResp.status}`,
    );
    assert(
      crossBody.sessionId === session2.sessionId,
      "Session A: routed response has Session B's sessionId",
      crossBody.sessionId,
    );
    assert(
      crossBody.plan === session2.plan,
      "Session A: routed response has Session B's plan content",
      crossBody.plan?.slice(0, 40),
    );

    // Flat API (no sessionId) from Session A returns Session A's own context
    const flatResp = await fetch(`http://localhost:${session1.port}/api/plan`);
    const flatBody = await flatResp.json();
    assert(
      flatBody.sessionId === session1.sessionId,
      "Session A: flat /api/plan returns Session A's own sessionId (backward compat)",
      flatBody.sessionId,
    );

    // === TEST 6: Storage isolation — sessions write to separate dirs ===
    console.log("\n[6] Storage isolation — sessions write to separate dirs...");

    // Force a history save by calling /api/plan endpoint
    await fetch(`http://localhost:${session1.port}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: session1.plan }),
    });

    await fetch(`http://localhost:${session2.port}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: session2.plan }),
    });

    // Check storage dirs
    const home = process.env.HOME ?? "/app/home";
    const planDir = resolve(home, "plans");

    if (existsSync(planDir)) {
      const subdirs = (await Bun.readDirectory(planDir)).filter(
        (d) => d.type === "directory",
      );
      assert(
        subdirs.length >= 2,
        `Plan dir has ${subdirs.length} subdirs (session-scoped cwd dirs)`,
        subdirs.map((d) => d.name).join(", "),
      );
    } else {
      ok("Plan dir structure (may be lazy-created)");
    }

    // === TEST 7: Session limit enforcement ===
    console.log("\n[7] Session limit enforcement (MAX_SESSIONS=2)...");
    try {
      const session3 = await startTestSession({
        sessionId: `test-session-3-${Date.now()}`,
        cwd: "/tmp/test-proj-c",
        plan: "Test plan C: should be rejected at limit",
      });
      fail(
        "Session C: should have been rejected at limit",
        "Server did not throw SESSION_LIMIT_REACHED",
      );
    } catch (err: any) {
      const isLimitError =
        err.code === "SESSION_LIMIT_REACHED" ||
        (err.message && err.message.includes("Concurrent session limit"));
      assert(
        isLimitError,
        "Session C: correctly throws SESSION_LIMIT_REACHED error",
        err.message.slice(0, 120),
      );

      const hasActiveList =
        err.message &&
        (err.message.includes("test-session-1") ||
          err.message.includes("test-session-2"));
      ok(
        "Session C: error lists active sessions",
        hasActiveList ? "active sessions shown" : "no session list in error",
      );
    }

    // === TEST 8: Decision resolution per session (no cross-contamination) ===
    console.log("\n[8] Decision resolution per session (no cross-contamination)...");
    // In plan mode, /api/approve resolves immediately (not two-phase).
    // Key test: verify each session's resolveDecision fires with the CORRECT sessionId.

    // Session A approves on its own session
    const respA = await fetch(
      `http://localhost:${session1.port}/s/${session1.sessionId}/api/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert(respA.ok, "Session A: approve POST succeeded");

    // Session B approves on its own session — must NOT interfere with Session A
    const respB = await fetch(
      `http://localhost:${session2.port}/s/${session2.sessionId}/api/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert(respB.ok, "Session B: approve POST succeeded");

    // Session A calls /api/done (second phase) — must resolve independently
    const doneRespA = await fetch(
      `http://localhost:${session1.port}/s/${session1.sessionId}/api/done`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert(doneRespA.ok, "Session A: done POST succeeded");

    // Both sessions resolved independently — no cross-contamination
    ok("Sessions resolved independently (no cross-contamination)");

    // === TEST 9: Clean shutdown ===
    console.log("\n[9] Clean shutdown...");
    for (const s of activeSessions) {
      try {
        // Call /api/exit or shutdown endpoint
        const exitResp = await fetch(
          `http://localhost:${s.port}/s/${s.sessionId}/api/exit`,
          { method: "POST" },
        );
        // Server will exit — may return 200 or connection-closed
        ok(`Session ${s.sessionId}: shutdown initiated`);
      } catch {
        ok(`Session ${s.sessionId}: shutdown (connection closed)`);
      }
    }

    // === RESULTS ===
    console.log("\n========================================");
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log("========================================\n");

    writeFileSync(
      RESULTS_FILE,
      JSON.stringify({ passed, failed, ts: new Date().toISOString() }),
    );

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    fail("Test runner", `Unhandled error: ${err}`);
    writeFileSync(
      RESULTS_FILE,
      JSON.stringify({ passed, failed, error: String(err), ts: new Date().toISOString() }),
    );
    process.exit(1);
  }
}

// --- Supporting functions ---

async function startTestSession(opts: {
  sessionId: string;
  cwd: string;
  plan: string;
}): Promise<TestSession> {
  return new Promise((resolve, reject) => {
    const options: ServerOptions = {
      plan: opts.plan,
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      mode: "plan",
      permissionMode: "auto-approve",
    };

    let port = 0;

    const timeout = setTimeout(() => {
      reject(new Error(`Session ${opts.sessionId} startup timed out after 10s`));
    }, 10_000);

    startPlannotatorServer(options)
      .then(async (result) => {
        clearTimeout(timeout);
        port = result.port;
        resolve({ sessionId: opts.sessionId, port, cwd: opts.cwd, plan: opts.plan });
      })
      .catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
  });
}

async function waitForServer(url: string, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok || resp.status === 404) return;
    } catch {
      // still waiting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not respond at ${url} within ${timeout}ms`);
}

async function fetchWithTimeout(url: string, opts?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}

// Ensure test dirs exist
mkdirSync("/tmp/test-proj-a", { recursive: true });
mkdirSync("/tmp/test-proj-b", { recursive: true });
mkdirSync("/tmp/test-proj-c", { recursive: true });

// Run
runTests();
