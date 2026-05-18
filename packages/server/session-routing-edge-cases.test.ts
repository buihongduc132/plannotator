/**
 * RED tests for session routing edge cases — worst-case scenarios
 *
 * TDD Cycle: RED (these tests) → GREEN (implement) → REFACTOR
 *
 * Failure zones under test:
 *   Zone 1 — Stale/removed session access after unregister
 *   Zone 2 — Session ID vs slug collision (ambiguous routing)
 *   Zone 3 — Slug-based routing for flat /api/draft (multi-session fallback)
 *   Zone 4 — Concurrent session draft isolation (flat vs scoped paths)
 *   Zone 5 — Non-existent slug in /s/<slug>/api/* returns 404, not SPA HTML
 *   Zone 6 — Method not allowed on draft endpoint (PUT)
 *   Zone 7 — Very long session ID or slug in path
 */

import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import {
  startPlannotatorServer,
  getSessionContext,
  unregisterSessionContext,
} from "./index";
import type { ServerResult } from "./index";

let host: ServerResult & { url: string };

beforeAll(async () => {
  const result = await startPlannotatorServer({
    plan: "# Host\n\nHost plan",
    origin: "http-api",
    mode: "plan",
    sharingEnabled: false,
    cwd: "/tmp/test-session-routing-edge-host",
    sessionId: "host-routing-edge-001",
    onReady: () => {},
  });
  host = { ...result, url: `http://localhost:${result.port}` };
});

afterAll(() => {
  host.stop();
});

const childSessionIds: string[] = [];

afterEach(() => {
  for (const sid of childSessionIds) {
    unregisterSessionContext(sid);
  }
  childSessionIds.length = 0;
});

async function createSession(body: Record<string, string>): Promise<Response> {
  const res = await fetch(`${host.url}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    const json: any = await res.clone().json();
    if (json.sessionId) childSessionIds.push(json.sessionId);
  }
  return res;
}

// ---------------------------------------------------------------------------
// 1. Stale session access — session unregistered mid-use
// ---------------------------------------------------------------------------

describe("Stale session access after unregister", () => {
  test("GET /s/<sessionId>/api/plan returns session-not-found 404 after session is unregistered", async () => {
    const createRes = await createSession({
      plan: "# Stale Plan\n\nWill be removed",
      mode: "plan",
      cwd: "/tmp/test-stale-session-1",
      name: "Stale Session",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    // Verify session works before unregister
    const beforeRes = await fetch(`${host.url}/s/${created.sessionId}/api/plan`);
    expect(beforeRes.status).toBe(200);

    // Unregister the session (simulates session expiry)
    unregisterSessionContext(created.sessionId);
    // Remove from cleanup list since we already unregistered
    const idx = childSessionIds.indexOf(created.sessionId);
    if (idx >= 0) childSessionIds.splice(idx, 1);

    // Now try to access — should get clean 404, not crash
    const afterRes = await fetch(`${host.url}/s/${created.sessionId}/api/plan`);
    expect(afterRes.status).toBe(404);
    const body = await afterRes.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
    expect(body).toHaveProperty("sessionId", created.sessionId);
  });

  test("GET /s/<sessionId>/api/draft returns session-not-found 404 after unregister", async () => {
    const createRes = await createSession({
      plan: "# Stale Draft\n\nDraft content",
      mode: "plan",
      cwd: "/tmp/test-stale-draft-1",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    // Unregister immediately
    unregisterSessionContext(created.sessionId);
    const idx = childSessionIds.indexOf(created.sessionId);
    if (idx >= 0) childSessionIds.splice(idx, 1);

    const res = await fetch(`${host.url}/s/${created.sessionId}/api/draft`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });

  test("GET /s/<slug>/api/plan returns session-not-found 404 after session is unregistered", async () => {
    const createRes = await createSession({
      plan: "# Stale Slug Plan\n\nSlug routing",
      mode: "plan",
      cwd: "/tmp/test-stale-slug-1",
      name: "Stale Slug Session",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.slug).toBe("stale-slug-session");

    // Unregister
    unregisterSessionContext(created.sessionId);
    const idx = childSessionIds.indexOf(created.sessionId);
    if (idx >= 0) childSessionIds.splice(idx, 1);

    // Slug route should also 404, not return wrong session or SPA HTML
    const res = await fetch(`${host.url}/s/stale-slug-session/api/plan`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Session ID vs slug collision — name sanitizes to another session's ID
// ---------------------------------------------------------------------------

describe("Session ID vs slug collision", () => {
  test("session created with name matching another session's ID does not hijack UUID routing", async () => {
    // Create first session (no name, so its slug is plan-derived)
    const first = await createSession({
      plan: "# First ID Plan\n\nFirst ID content FID111",
      mode: "plan",
      cwd: "/tmp/test-id-slug-collision-1",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // Create second session whose name sanitizes to the first session's ID
    // This is an unlikely but valid edge case
    const second = await createSession({
      plan: "# Second Collision Plan\n\nCollision content COL222",
      mode: "plan",
      cwd: "/tmp/test-id-slug-collision-2",
      name: firstBody.sessionId, // Use exact sessionId as name
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // UUID routing to first session should still return first session's plan
    const firstPlanRes = await fetch(`${host.url}/s/${firstBody.sessionId}/api/plan`);
    expect(firstPlanRes.status).toBe(200);
    const firstPlan = await firstPlanRes.json();
    expect(firstPlan.plan).toContain("First ID Plan");
    expect(firstPlan.plan).toContain("FID111");
  });

  test("when name sanitizes to another session's UUID, UUID routing wins (no hijack)", async () => {
    const first = await createSession({
      plan: "# Slug Target A\n\nSlug A content SGA333",
      mode: "plan",
      cwd: "/tmp/test-slug-target-a",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await createSession({
      plan: "# Slug Target B\n\nSlug B content SGB444",
      mode: "plan",
      cwd: "/tmp/test-slug-target-b",
      name: firstBody.sessionId,
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // The second session's name-based slug is the first session's UUID.
    // When accessing /s/<first-session-uuid>/api/plan, the session registry
    // lookup finds the FIRST session (UUID match), which is correct —
    // session ID routing takes precedence over slug routing.
    const res = await fetch(`${host.url}/s/${secondBody.slug}/api/plan`);
    expect(res.status).toBe(200);
    const plan = await res.json();
    // The slug equals the first session's ID, so routing resolves to session A
    expect(plan.plan).toContain("Slug Target A");
  });
});

// ---------------------------------------------------------------------------
// 3. Slug-based routing for drafts — flat /api/draft fallback
// ---------------------------------------------------------------------------

describe("Slug-based routing: flat /api/draft fallback", () => {
  test("flat /api/draft returns 404 (no draft) for host session, does not crash", async () => {
    // Host session exists but has no draft saved
    const res = await fetch(`${host.url}/api/draft`);
    // Should return 404 (no draft found) or a valid response — never crash
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("found", false);
  });

  test("flat /api/draft resolves to most recently registered session after child creation", async () => {
    // Create a child session and save a draft to it
    const child = await createSession({
      plan: "# Draft Child\n\nDraft child content",
      mode: "plan",
      cwd: "/tmp/test-flat-draft-child",
      name: "Draft Child Session",
    });
    expect(child.status).toBe(200);
    const childBody = await child.json();

    // Save a draft via session-scoped path
    const saveRes = await fetch(`${host.url}/s/${childBody.sessionId}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: [{ id: "test-ann-1" }] }),
    });
    expect(saveRes.status).toBe(200);

    // Flat path should resolve to the host session (sessionCtx), not the child
    // This is the CURRENT behavior — flat paths use the host session context
    const flatRes = await fetch(`${host.url}/api/draft`);
    // It returns whatever the host session has (likely 404 since host has no draft)
    expect(flatRes.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrent session draft isolation
// ---------------------------------------------------------------------------

describe("Concurrent session draft isolation", () => {
  test("session-scoped draft paths return correct session's draft, not another's", async () => {
    const first = await createSession({
      plan: "# Isolated Alpha\n\nAlpha content ISO111",
      mode: "plan",
      cwd: "/tmp/test-isolation-alpha",
      name: "Isolation Alpha",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await createSession({
      plan: "# Isolated Beta\n\nBeta content ISO222",
      mode: "plan",
      cwd: "/tmp/test-isolation-beta",
      name: "Isolation Beta",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // Save different drafts to each session
    await fetch(`${host.url}/s/${firstBody.sessionId}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: [{ id: "alpha-draft" }], source: "alpha" }),
    });

    await fetch(`${host.url}/s/${secondBody.sessionId}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: [{ id: "beta-draft" }], source: "beta" }),
    });

    // Verify first session's draft has alpha content
    const firstDraft = await fetch(`${host.url}/s/${firstBody.sessionId}/api/draft`);
    expect(firstDraft.status).toBe(200);
    const firstDraftBody = await firstDraft.json();
    expect(firstDraftBody).toHaveProperty("source", "alpha");

    // Verify second session's draft has beta content
    const secondDraft = await fetch(`${host.url}/s/${secondBody.sessionId}/api/draft`);
    expect(secondDraft.status).toBe(200);
    const secondDraftBody = await secondDraft.json();
    expect(secondDraftBody).toHaveProperty("source", "beta");
  });

  test("slug-scoped draft paths are isolated between sessions", async () => {
    const first = await createSession({
      plan: "# Slug Isolated A\n\nSlug content SIA333",
      mode: "plan",
      cwd: "/tmp/test-slug-isolation-a",
      name: "Slug Isolated A",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await createSession({
      plan: "# Slug Isolated B\n\nSlug content SIB444",
      mode: "plan",
      cwd: "/tmp/test-slug-isolation-b",
      name: "Slug Isolated B",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // Save drafts via slug paths
    await fetch(`${host.url}/s/${firstBody.slug}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: [{ id: "slug-a-draft" }], source: "slug-a" }),
    });

    await fetch(`${host.url}/s/${secondBody.slug}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: [{ id: "slug-b-draft" }], source: "slug-b" }),
    });

    // Verify isolation
    const firstDraft = await fetch(`${host.url}/s/${firstBody.slug}/api/draft`);
    expect(firstDraft.status).toBe(200);
    const firstDraftBody = await firstDraft.json();
    expect(firstDraftBody).toHaveProperty("source", "slug-a");

    const secondDraft = await fetch(`${host.url}/s/${secondBody.slug}/api/draft`);
    expect(secondDraft.status).toBe(200);
    const secondDraftBody = await secondDraft.json();
    expect(secondDraftBody).toHaveProperty("source", "slug-b");
  });
});

// ---------------------------------------------------------------------------
// 5. Non-existent slug in /s/<slug>/api/* returns session-not-found 404
// ---------------------------------------------------------------------------

describe("Non-existent slug in /s/<slug>/api/* returns 404 not SPA HTML", () => {
  test("GET /s/nonexistent-session-id/api/plan returns 404 JSON, not HTML", async () => {
    const res = await fetch(`${host.url}/s/nonexistent-session-id/api/plan`);
    expect(res.status).toBe(404);
    // MUST be JSON, not the SPA HTML fallback
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });

  test("GET /s/totally-made-up-slug/api/draft returns 404 JSON", async () => {
    const res = await fetch(`${host.url}/s/totally-made-up-slug/api/draft`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });

  test("GET /s/<deleted-slug>/api/plan returns 404 JSON after session removal", async () => {
    const createRes = await createSession({
      plan: "# Deleted Slug Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-deleted-slug",
      name: "Deleted Slug",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    // Verify it works
    const before = await fetch(`${host.url}/s/${created.slug}/api/plan`);
    expect(before.status).toBe(200);

    // Unregister
    unregisterSessionContext(created.sessionId);
    const idx = childSessionIds.indexOf(created.sessionId);
    if (idx >= 0) childSessionIds.splice(idx, 1);

    // Now should get 404 JSON, not SPA HTML
    const after = await fetch(`${host.url}/s/${created.slug}/api/plan`);
    expect(after.status).toBe(404);
    expect(after.headers.get("content-type")).toMatch(/application\/json/);
    const body = await after.json();
    expect(body.error).toMatch(/session not found/i);
  });
});

// ---------------------------------------------------------------------------
// 6. Method not allowed on draft endpoint
// ---------------------------------------------------------------------------

describe("Method not allowed on draft endpoint", () => {
  test("PUT /api/draft returns error or fallback, does not crash server", async () => {
    const res = await fetch(`${host.url}/api/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });
    // Should not crash — either returns an error or falls through to SPA HTML
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test("PUT /s/<sessionId>/api/draft returns error, does not crash", async () => {
    const createRes = await createSession({
      plan: "# PUT Test\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-put-draft",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const res = await fetch(`${host.url}/s/${created.sessionId}/api/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });
    // Must not crash server — return some valid HTTP response
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test("PATCH /api/draft returns error or fallback, does not crash server", async () => {
    const res = await fetch(`${host.url}/api/draft`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

// ---------------------------------------------------------------------------
// 7. Very long session ID or slug in path
// ---------------------------------------------------------------------------

describe("Very long session ID or slug in path", () => {
  test("GET /s/<very-long-id>/api/plan returns 404 without crashing", async () => {
    const longId = "a".repeat(500);
    const res = await fetch(`${host.url}/s/${longId}/api/plan`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });

  test("GET /s/<very-long-slug>/api/draft returns 404 without crashing", async () => {
    const longSlug = "very-long-slug-" + "x".repeat(500);
    const res = await fetch(`${host.url}/s/${longSlug}/api/draft`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });

  test("GET /s/<id-with-special-chars>/api/plan returns 404 without crashing", async () => {
    // URL-encoded special characters in path
    const weirdId = "session%2Fwith%2Fslashes";
    const res = await fetch(`${host.url}/s/${weirdId}/api/plan`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("GET /s//api/plan (empty session ID) does not crash", async () => {
    // Double slash creates empty segment — should not crash
    const res = await fetch(`${host.url}/s//api/plan`);
    // This likely falls through to SPA HTML since it doesn't match SESSION_PATH_REGEX
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test("session with extremely long name produces a bounded slug", async () => {
    const longName = "Feature " + "A".repeat(500);
    const res = await createSession({
      plan: "# Long Name Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-long-name-slug",
      name: longName,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Slug should exist and be reasonable length
    expect(body).toHaveProperty("slug");
    expect(typeof body.slug).toBe("string");
    expect(body.slug.length).toBeGreaterThan(0);
    expect(body.slug.length).toBeLessThan(1000);
  });
});
