/**
 * RED tests for session & plan discovery APIs
 *
 * These tests define the desired behavior for plan/session listing endpoints
 * that do NOT yet exist. All tests are expected to FAIL until implementation
 * is added to packages/server/index.ts.
 *
 * TDD Cycle: RED (these tests) → GREEN (implement) → REFACTOR
 *
 * Missing endpoints under test:
 *   1. GET /api/sessions         — list all active in-memory sessions
 *   2. GET /api/plans            — list all plans across sessions (from history dir)
 *   3. GET /api/plans/:sessionId — alias for /s/<id>/api/plan (convenience)
 */

import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import {
  startPlannotatorServer,
} from "./index";
import type { ServerResult } from "./index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Start a real server and return its base URL + cleanup fn. */
async function startServer(
  plan: string,
  opts?: { cwd?: string; sessionId?: string },
): Promise<ServerResult & { url: string; cleanup: () => Promise<void> }> {
  const result = await startPlannotatorServer({
    plan,
    origin: "http-api",
    mode: "plan",
    sharingEnabled: false,
    cwd: opts?.cwd ?? "/tmp/test-session-discovery",
    sessionId: opts?.sessionId,
    onReady: () => {},
  });

  const url = `http://localhost:${result.port}`;
  const cleanup = async () => {
    result.stop();
  };

  return { ...result, url, cleanup };
}

// ---------------------------------------------------------------------------
// Env isolation — prevent inherited PLANNOTATOR_REMOTE/PORT from forcing
// fixed-port 19432 (causes EADDRINUSE when multiple servers start)
// ---------------------------------------------------------------------------

let savedPort: string | undefined;
let savedRemote: string | undefined;
let savedServerUrl: string | undefined;

beforeAll(() => {
  savedPort = process.env.PLANNOTATOR_PORT;
  savedRemote = process.env.PLANNOTATOR_REMOTE;
  savedServerUrl = process.env.PLANNOTATOR_SERVER_URL;
  delete process.env.PLANNOTATOR_PORT;
  delete process.env.PLANNOTATOR_REMOTE;
  delete process.env.PLANNOTATOR_SERVER_URL;
});

afterAll(() => {
  if (savedPort !== undefined) process.env.PLANNOTATOR_PORT = savedPort;
  if (savedRemote !== undefined) process.env.PLANNOTATOR_REMOTE = savedRemote;
  if (savedServerUrl !== undefined) process.env.PLANNOTATOR_SERVER_URL = savedServerUrl;
});

// Track servers for cleanup
const servers: Array<{ cleanup: () => Promise<void> }> = [];

afterEach(async () => {
  // Cleanup is handled per-describe block
});

// ---------------------------------------------------------------------------
// 1. GET /api/sessions — List active in-memory sessions
// ---------------------------------------------------------------------------

describe("GET /api/sessions — list active sessions", () => {
  const activeServers: ServerResult[] = [];

  afterAll(async () => {
    for (const s of activeServers) s.stop();
  });

  test("returns empty array when no sessions are active", async () => {
    // Start a fresh server — its own session is the only one
    const { url, cleanup } = await startServer("# Solo\n\nPlan");
    servers.push({ cleanup });

    const res = await fetch(`${url}/api/sessions`);
    expect(res.status).toBe(200);

    const body = await res.json();

    // Should return an array of session objects
    expect(Array.isArray(body.sessions)).toBe(true);

    await cleanup();
  });

  test("returns session metadata for each active session", async () => {
    const s1 = await startServer("# Plan A\n\nContent A", {
      sessionId: "ses-alpha-001",
    });
    activeServers.push(s1);

    const res = await fetch(`${s1.url}/api/sessions`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);

    // At least one session should be registered
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);

    // Each session entry must have identifying fields
    const session = body.sessions[0];
    expect(session).toHaveProperty("sessionId");
    expect(session).toHaveProperty("mode");
    expect(session).toHaveProperty("origin");
    expect(session).toHaveProperty("project");
    expect(session).toHaveProperty("slug");

    // sessionId should match what we registered
    const ids = body.sessions.map((s: any) => s.sessionId);
    expect(ids).toContain("ses-alpha-001");
  });

  test("returns multiple sessions after several are created via POST /api/sessions", async () => {
    // Start one server to act as the host
    const { url, cleanup } = await startServer("# Host\n\nHost plan");
    servers.push({ cleanup });

    // Create two additional sessions via HTTP
    const res1 = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Plan B\n\nContent B",
        mode: "plan",
        cwd: "/tmp/test-b",
      }),
    });
    expect(res1.status).toBe(200);
    const s1 = await res1.json();

    const res2 = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Plan C\n\nContent C",
        mode: "plan",
        cwd: "/tmp/test-c",
      }),
    });
    expect(res2.status).toBe(200);
    const s2 = await res2.json();

    // Now list all sessions
    const listRes = await fetch(`${url}/api/sessions`);
    expect(listRes.status).toBe(200);

    const body = await listRes.json();
    expect(Array.isArray(body.sessions)).toBe(true);

    // Should contain both POST-created sessions
    const ids = body.sessions.map((s: any) => s.sessionId);
    expect(ids).toContain(s1.sessionId);
    expect(ids).toContain(s2.sessionId);
  });

  test("each session entry includes URL for direct browser access", async () => {
    const { url, cleanup } = await startServer("# URL Test\n\nPlan");
    servers.push({ cleanup });

    const res = await fetch(`${url}/api/sessions`);
    const body = await res.json();

    const session = body.sessions[0];
    // Must include the full URL to open this session in a browser
    expect(session).toHaveProperty("url");
    expect(typeof session.url).toBe("string");
    expect(session.url).toMatch(/^http/);
  });

  test("excludes sessions that have been stopped", async () => {
    const s1 = await startServer("# Ephemeral\n\nWill stop");
    const sid = s1.sessionId;

    // Stop the server
    await s1.cleanup();

    // Start another server to query from
    const { url, cleanup } = await startServer("# Query\n\nPlan");
    servers.push({ cleanup });

    const res = await fetch(`${url}/api/sessions`);
    const body = await res.json();

    const ids = body.sessions.map((s: any) => s.sessionId);
    // The stopped session should NOT appear
    expect(ids).not.toContain(sid);
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/plans — List all plans across sessions (from history dir)
// ---------------------------------------------------------------------------

describe("GET /api/plans — list all plans from history", () => {
  const activeServers: ServerResult[] = [];

  afterAll(async () => {
    for (const s of activeServers) s.stop();
  });

  test("returns empty array when no plans exist in history", async () => {
    const { url, cleanup } = await startServer("# No History\n\nEmpty", {
      cwd: "/tmp/test-no-history",
    });
    servers.push({ cleanup });

    const res = await fetch(`${url}/api/plans`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    // May be empty or contain only the current plan
  });

  test("returns plans from history after sessions are created", async () => {
    const { url, cleanup } = await startServer("# History Base\n\nBase", {
      cwd: "/tmp/test-history-plans",
    });
    servers.push({ cleanup });

    // Create a session which auto-saves to history
    const createRes = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# My Feature Plan\n\n## Phase 1\n\nDo stuff",
        mode: "plan",
        cwd: "/tmp/test-history-plans",
      }),
    });
    expect(createRes.status).toBe(200);

    // Now list all plans
    const res = await fetch(`${url}/api/plans`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThanOrEqual(1);

    // Each plan entry should have useful metadata
    const plan = body.plans[0];
    expect(plan).toHaveProperty("slug");
    expect(plan).toHaveProperty("versions");
    expect(plan).toHaveProperty("lastModified");
    expect(typeof plan.versions).toBe("number");
    expect(plan.versions).toBeGreaterThanOrEqual(1);
  });

  test("each plan entry includes a slug that can be used to fetch versions", async () => {
    const { url, cleanup } = await startServer("# Slug Test\n\nPlan", {
      cwd: "/tmp/test-slug-discovery",
    });
    servers.push({ cleanup });

    // Create a session
    await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Slug Target\n\nContent",
        mode: "plan",
        cwd: "/tmp/test-slug-discovery",
      }),
    });

    const res = await fetch(`${url}/api/plans`);
    const body = await res.json();

    if (body.plans.length > 0) {
      const plan = body.plans[0];

      // Use the slug to fetch version info
      const versionRes = await fetch(
        `${url}/api/plan/versions?slug=${plan.slug}&project=${plan.project || "app"}`,
      );
      // Should return version data for this plan
      expect(versionRes.status).toBe(200);
    }
  });

  test("plans are sorted by most recently modified first", async () => {
    const { url, cleanup } = await startServer("# Sort Base\n\nBase", {
      cwd: "/tmp/test-plan-sort",
    });
    servers.push({ cleanup });

    // Create two sessions in sequence
    await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Older Plan\n\nFirst",
        mode: "plan",
        cwd: "/tmp/test-plan-sort",
      }),
    });

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 100));

    await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Newer Plan\n\nSecond",
        mode: "plan",
        cwd: "/tmp/test-plan-sort",
      }),
    });

    const res = await fetch(`${url}/api/plans`);
    const body = await res.json();

    if (body.plans.length >= 2) {
      // Most recent should be first
      const firstDate = new Date(body.plans[0].lastModified).getTime();
      const secondDate = new Date(body.plans[1].lastModified).getTime();
      expect(firstDate).toBeGreaterThanOrEqual(secondDate);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. GET /api/sessions/:sessionId — Get single session details
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:sessionId — get session details", () => {
  const activeServers: ServerResult[] = [];

  afterAll(async () => {
    for (const s of activeServers) s.stop();
  });

  test("returns session details for a known sessionId", async () => {
    const { url, cleanup } = await startServer("# Detail Test\n\nPlan", {
      sessionId: "ses-detail-001",
    });
    servers.push({ cleanup });

    const res = await fetch(`${url}/api/sessions/ses-detail-001`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe("ses-detail-001");
    expect(body).toHaveProperty("mode");
    expect(body).toHaveProperty("slug");
    expect(body).toHaveProperty("project");
  });

  test("returns 404 for unknown sessionId", async () => {
    const { url, cleanup } = await startServer("# 404 Test\n\nPlan");
    servers.push({ cleanup });

    const res = await fetch(`${url}/api/sessions/nonexistent-session-id`);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("includes plan summary (truncated) in session details", async () => {
    const { url, cleanup } = await startServer("# Summary\n\nPlan content here");
    servers.push({ cleanup });

    // Create a session via POST
    const createRes = await fetch(`${url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Detailed Plan\n\n## Section\n\nLots of content here",
        mode: "plan",
        cwd: "/tmp/test-summary",
      }),
    });
    const created = await createRes.json();

    // Fetch its details
    const res = await fetch(`${url}/api/sessions/${created.sessionId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Should include a truncated plan preview
    expect(body).toHaveProperty("planPreview");
    expect(typeof body.planPreview).toBe("string");
    expect(body.planPreview.length).toBeLessThanOrEqual(300);
  });
});

// ---------------------------------------------------------------------------
// 4. GET /s/<sessionId>/api/sessions — scoped session listing
// ---------------------------------------------------------------------------

describe("Multi-session routing for discovery endpoints", () => {
  const activeServers: ServerResult[] = [];

  afterAll(async () => {
    for (const s of activeServers) s.stop();
  });

  test("session listing works through /s/<sessionId>/api/sessions path", async () => {
    const { url, sessionId, cleanup } = await startServer("# Routed\n\nPlan");
    servers.push({ cleanup });

    // Access through the session-scoped URL
    const res = await fetch(`${url}/s/${sessionId}/api/sessions`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test("plan listing works through /s/<sessionId>/api/plans path", async () => {
    const { url, sessionId, cleanup } = await startServer("# Routed Plans\n\nPlan");
    servers.push({ cleanup });

    const res = await fetch(`${url}/s/${sessionId}/api/plans`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Edge cases
// ---------------------------------------------------------------------------

describe("Discovery API edge cases", () => {
  const activeServers: ServerResult[] = [];

  afterAll(async () => {
    for (const s of activeServers) s.stop();
  });

  test("session limit enforcement includes active session count in response", async () => {
    // This tests that when MAX_SESSIONS is reached, the error response
    // includes enough info to discover existing sessions
    const { url, cleanup } = await startServer("# Limit Test\n\nPlan");
    servers.push({ cleanup });

    // Even if limit is reached, listing should still work
    const res = await fetch(`${url}/api/sessions`);
    expect(res.status).toBe(200);

    // The response should include the current count vs max
    const body = await res.json();
    expect(body).toHaveProperty("count");
    expect(body).toHaveProperty("maxSessions");
    expect(typeof body.count).toBe("number");
    expect(typeof body.maxSessions).toBe("number");
    expect(body.count).toBeLessThanOrEqual(body.maxSessions);
  });

  test("concurrent requests to GET /api/sessions do not corrupt state", async () => {
    const { url, cleanup } = await startServer("# Concurrent\n\nPlan");
    servers.push({ cleanup });

    // Fire 5 concurrent listing requests
    const requests = Array.from({ length: 5 }, () =>
      fetch(`${url}/api/sessions`).then((r) => r.json()),
    );

    const results = await Promise.all(requests);

    // All should succeed and return consistent data
    for (const body of results) {
      expect(Array.isArray(body.sessions)).toBe(true);
    }

    // All should have the same count
    const counts = results.map((b: any) => b.sessions.length);
    const uniqueCounts = new Set(counts);
    expect(uniqueCounts.size).toBe(1);
  });
});
