/**
 * RED tests for slug collision and duplicate name bugs
 *
 * TDD Cycle: RED (these tests) → GREEN (implement) → REFACTOR
 *
 * Bugs under test:
 *   1. Duplicate name silently overwrites slugToSessionId map
 *      - Two sessions with name "Auth System" both get slug "auth-system"
 *      - slugToSessionId["auth-system"] points to the SECOND session
 *      - First session's slug route returns the SECOND session's plan
 *
 *   2. Different names that sanitize to the same slug
 *      - "Auth System" and "Auth! System?" both → "auth-system"
 *      - Same overwriting behavior
 *
 * Expected behavior:
 *   - Second session should be rejected with 409 Conflict, OR
 *   - Second session should get a deduplicated slug (e.g. "auth-system-2")
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
    cwd: "/tmp/test-session-slug-collision-host",
    sessionId: "host-slug-collision-001",
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
// 1. Duplicate name — second session should NOT silently overwrite the first
// ---------------------------------------------------------------------------

describe("Duplicate session name collision", () => {
  test("second session with identical name should return 409 Conflict or deduplicated slug", async () => {
    // Create first session
    const first = await createSession({
      plan: "# First Auth Plan\n\nFirst plan content",
      mode: "plan",
      cwd: "/tmp/test-dup-name-1",
      name: "Auth System",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    // Create second session with same name — should either:
    // - Return 409 Conflict, OR
    // - Return a deduplicated slug (e.g. "auth-system-2")
    const second = await createSession({
      plan: "# Second Auth Plan\n\nSecond plan content",
      mode: "plan",
      cwd: "/tmp/test-dup-name-2",
      name: "Auth System",
    });

    // Acceptable: 409 Conflict (rejected)
    if (second.status === 409) {
      // Bug is fixed — server rejects the collision
      return;
    }

    // Acceptable: 200 with deduplicated slug
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.slug).not.toBe("auth-system");
    // The deduplicated slug should be something like "auth-system-2"
    expect(secondBody.slug).toMatch(/^auth-system-/);
  });

  test("first session's slug route returns first session's plan, not second", async () => {
    // Create first session
    const first = await createSession({
      plan: "# First Unique Plan\n\nFirst plan unique content XYZ123",
      mode: "plan",
      cwd: "/tmp/test-slug-hijack-1",
      name: "Unique Plan",
    });
    expect(first.status).toBe(200);

    // Create second session with same name (allowed for setup)
    const second = await createSession({
      plan: "# Second Unique Plan\n\nSecond plan different content ABC789",
      mode: "plan",
      cwd: "/tmp/test-slug-hijack-2",
      name: "Unique Plan",
    });
    expect(second.status).toBe(200);

    // The first session's slug route should return the FIRST session's plan
    const slugRes = await fetch(`${host.url}/s/unique-plan/api/plan`);
    expect(slugRes.status).toBe(200);
    const planBody = await slugRes.json();

    // BUG: Currently this returns the SECOND session's plan because
    // slugToSessionId was overwritten. It should return the FIRST.
    expect(planBody.plan).toContain("First Unique Plan");
    expect(planBody.plan).toContain("XYZ123");
  });
});

// ---------------------------------------------------------------------------
// 2. Different names that sanitize to the same slug
// ---------------------------------------------------------------------------

describe("Slug collision from different display names", () => {
  test('names "Auth System" and "Auth! System?" both sanitize to "auth-system" — should not collide', async () => {
    const first = await createSession({
      plan: "# Auth Alpha\n\nAlpha content",
      mode: "plan",
      cwd: "/tmp/test-sanitize-collision-1",
      name: "Auth System",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await createSession({
      plan: "# Auth Beta\n\nBeta content",
      mode: "plan",
      cwd: "/tmp/test-sanitize-collision-2",
      name: "Auth! System?",
    });

    // Same as duplicate name test — should reject or deduplicate
    if (second.status === 409) {
      return;
    }

    expect(second.status).toBe(200);
    const secondBody = await second.json();
    // The slug should NOT be the same as the first session's slug
    expect(secondBody.slug).not.toBe(firstBody.slug);
  });

  test("first session slug route is not hijacked by sanitization collision", async () => {
    const first = await createSession({
      plan: "# Auth Gamma\n\nGamma unique content GGG111",
      mode: "plan",
      cwd: "/tmp/test-sanitize-hijack-1",
      name: "Auth System",
    });
    expect(first.status).toBe(200);

    const second = await createSession({
      plan: "# Auth Delta\n\nDelta different content DDD222",
      mode: "plan",
      cwd: "/tmp/test-sanitize-hijack-2",
      name: "Auth! System?",
    });
    expect(second.status).toBe(200);

    // The first session's slug route should still return its own plan
    const slugRes = await fetch(`${host.url}/s/auth-system/api/plan`);
    expect(slugRes.status).toBe(200);
    const planBody = await slugRes.json();

    // BUG: Currently returns the second session's plan
    expect(planBody.plan).toContain("Auth Gamma");
    expect(planBody.plan).toContain("GGG111");
  });
});

// ---------------------------------------------------------------------------
// 3. First session's slug route stays valid after unrelated session creation
// ---------------------------------------------------------------------------

describe("Slug route stability across sessions", () => {
  test("creating a differently-named session does not affect first session's slug route", async () => {
    const first = await createSession({
      plan: "# Stable Plan\n\nStable content STB444",
      mode: "plan",
      cwd: "/tmp/test-stable-slug-1",
      name: "Stable Feature",
    });
    expect(first.status).toBe(200);

    // Create a completely different named session
    const second = await createSession({
      plan: "# Other Plan\n\nOther content OTH555",
      mode: "plan",
      cwd: "/tmp/test-stable-slug-2",
      name: "DB Migration",
    });
    expect(second.status).toBe(200);

    // First session's slug route should be unaffected
    const slugRes = await fetch(`${host.url}/s/stable-feature/api/plan`);
    expect(slugRes.status).toBe(200);
    const planBody = await slugRes.json();

    expect(planBody.plan).toContain("Stable Plan");
    expect(planBody.plan).toContain("STB444");
    expect(planBody.plan).not.toContain("Other Plan");
  });
});

// ---------------------------------------------------------------------------
// 4. Deduplicated slug works for routing (if deduplication is the fix)
// ---------------------------------------------------------------------------

describe("Deduplicated slug routing", () => {
  test("if deduplicated slug is returned, it resolves to the correct session", async () => {
    const first = await createSession({
      plan: "# Dedup First\n\nDedup first content DF111",
      mode: "plan",
      cwd: "/tmp/test-dedup-route-1",
      name: "Dedup Feature",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await createSession({
      plan: "# Dedup Second\n\nDedup second content DS222",
      mode: "plan",
      cwd: "/tmp/test-dedup-route-2",
      name: "Dedup Feature",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // If the server deduplicates, the second session should have a different slug
    // and that slug should route to the second session
    if (secondBody.slug !== firstBody.slug) {
      const secondSlugRes = await fetch(`${host.url}/s/${secondBody.slug}/api/plan`);
      expect(secondSlugRes.status).toBe(200);
      const planBody = await secondSlugRes.json();

      expect(planBody.plan).toContain("Dedup Second");
      expect(planBody.plan).toContain("DS222");
    } else {
      // If not deduplicating, this test is expected to fail (RED)
      // because the slugs are identical — the second session's slug route
      // would point to the wrong session
      expect(secondBody.slug).not.toBe(firstBody.slug);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. UUID routes still work even when slug collides
// ---------------------------------------------------------------------------

describe("UUID routes are unaffected by slug collision", () => {
  test("both sessions accessible via UUID even when slugs collide", async () => {
    const first = await createSession({
      plan: "# UUID Test A\n\nUUID content AAA",
      mode: "plan",
      cwd: "/tmp/test-uuid-collision-1",
      name: "UUID Feature",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await createSession({
      plan: "# UUID Test B\n\nUUID content BBB",
      mode: "plan",
      cwd: "/tmp/test-uuid-collision-2",
      name: "UUID Feature",
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    // Both sessions should be accessible via their UUID routes
    const firstPlanRes = await fetch(`${host.url}/s/${firstBody.sessionId}/api/plan`);
    expect(firstPlanRes.status).toBe(200);
    const firstPlan = await firstPlanRes.json();
    expect(firstPlan.plan).toContain("UUID Test A");
    expect(firstPlan.plan).toContain("AAA");

    const secondPlanRes = await fetch(`${host.url}/s/${secondBody.sessionId}/api/plan`);
    expect(secondPlanRes.status).toBe(200);
    const secondPlan = await secondPlanRes.json();
    expect(secondPlan.plan).toContain("UUID Test B");
    expect(secondPlan.plan).toContain("BBB");
  });
});
