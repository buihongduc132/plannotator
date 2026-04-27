/**
 * RED tests for "name" field in plan session flow
 *
 * TDD Cycle: RED (these tests) → GREEN (implement) → REFACTOR
 *
 * Feature under test:
 *   1. POST /api/sessions accepts optional `name` field
 *   2. SessionContext stores `name` (user-friendly display name)
 *   3. GET /api/sessions returns `name` in each session object
 *   4. GET /api/sessions/:sessionId returns `name`
 *   5. POST response includes slug-based URL when name is provided
 *   6. Slug-based routing: /s/<slug>/api/* resolves to the correct session
 *   7. Name is sanitized for URL usage (spaces → hyphens, special chars stripped)
 *   8. Name is optional — when omitted, behavior is unchanged
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
    cwd: "/tmp/test-session-name-field-host",
    sessionId: "host-session-001",
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
// 1. POST /api/sessions with `name` → stored & returned
// ---------------------------------------------------------------------------

describe("POST /api/sessions with name field", () => {
  test("accepts optional `name` and returns it in response", async () => {
    const res = await createSession({
      plan: "# My REST API\n\nBuild a REST API",
      mode: "plan",
      cwd: "/tmp/test-name-create",
      name: "Simple REST API",
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("name");
    expect(body.name).toBe("Simple REST API");
  });

  test("stores name on the session context so GET /api/sessions/:id returns it", async () => {
    const createRes = await createSession({
      plan: "# Named Session\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-store",
      name: "Named Session Alpha",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    const detailRes = await fetch(`${host.url}/api/sessions/${created.sessionId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();

    expect(detail).toHaveProperty("name");
    expect(detail.name).toBe("Named Session Alpha");
  });

  test("returns slug-based URL in POST response when name is provided", async () => {
    const res = await createSession({
      plan: "# Some Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-url",
      name: "My Feature Plan",
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("url");
    expect(body.url).toMatch(/\/s\/my-feature-plan$/);
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/sessions → each session includes `name` field
// ---------------------------------------------------------------------------

describe("GET /api/sessions — name field in listing", () => {
  test("each session in the list includes a `name` field when created with one", async () => {
    await createSession({
      plan: "# Listed Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-listing",
      name: "Listed Feature",
    });

    const res = await fetch(`${host.url}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions.length).toBeGreaterThanOrEqual(1);

    const sessionsWithName = body.sessions.filter(
      (s: any) => s.name === "Listed Feature",
    );
    expect(sessionsWithName.length).toBe(1);

    const session = sessionsWithName[0];
    expect(session).toHaveProperty("name");
    expect(session.name).toBe("Listed Feature");
  });

  test("sessions created without name have name as null or undefined", async () => {
    await createSession({
      plan: "# Unnamed Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-optional",
    });

    const res = await fetch(`${host.url}/api/sessions`);
    const body = await res.json();

    const created = body.sessions.find(
      (s: any) => s.cwd === "/tmp/test-name-optional",
    );

    expect(created).toBeDefined();
    expect(created.name == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. GET /api/sessions/:sessionId → includes `name` field
// ---------------------------------------------------------------------------

describe("GET /api/sessions/:sessionId — name in session details", () => {
  test("returns the `name` field for a named session", async () => {
    const createRes = await createSession({
      plan: "# Detail Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-detail",
      name: "Detailed Feature X",
    });
    const created = await createRes.json();

    const res = await fetch(`${host.url}/api/sessions/${created.sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty("name");
    expect(body.name).toBe("Detailed Feature X");
  });

  test("returns null/undefined for name when session was created without one", async () => {
    const createRes = await createSession({
      plan: "# No Name Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-no-name",
    });
    const created = await createRes.json();

    const res = await fetch(`${host.url}/api/sessions/${created.sessionId}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.name == null).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Slug-based URL routing: /s/<slug>/api/* resolves correctly
// ---------------------------------------------------------------------------

describe("Slug-based URL routing via name field", () => {
  test("/s/<slug>/api/plan returns the correct plan for a named session", async () => {
    const createRes = await createSession({
      plan: "# Routed Plan\n\nThis is the routed plan content",
      mode: "plan",
      cwd: "/tmp/test-name-routing",
      name: "Routed Feature",
    });
    expect(createRes.status).toBe(200);

    const slugRes = await fetch(`${host.url}/s/routed-feature/api/plan`);
    expect(slugRes.status).toBe(200);

    const body = await slugRes.json();
    expect(body.plan).toContain("Routed Plan");
    expect(body.plan).toContain("This is the routed plan content");
  });

  test("/s/<slug>/api/sessions resolves to the correct session context", async () => {
    const createRes = await createSession({
      plan: "# Slug Route Test\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-slug-route",
      name: "Slug Route Test",
    });
    expect(createRes.status).toBe(200);

    const res = await fetch(`${host.url}/s/slug-route-test/api/sessions`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  test("slug routing with special characters in name is sanitized", async () => {
    const createRes = await createSession({
      plan: "# Special & Chars! Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-sanitize",
      name: "My Feature & Fix: Phase #2!",
    });
    expect(createRes.status).toBe(200);
    const created = await createRes.json();

    expect(created).toHaveProperty("slug");
    expect(created.slug).toMatch(/^[a-z0-9-]+$/);

    const planRes = await fetch(`${host.url}/s/${created.slug}/api/plan`);
    expect(planRes.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 5. Name is optional — existing behavior unchanged when omitted
// ---------------------------------------------------------------------------

describe("Backward compatibility — name is optional", () => {
  test("POST /api/sessions without name still works (existing flow)", async () => {
    const res = await createSession({
      plan: "# Legacy Plan\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-legacy",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("sessionId");
    expect(body).toHaveProperty("slug");
    expect(body.slug).toMatch(/legacy-plan/);
  });

  test("UUID-based routing still works when no name is provided", async () => {
    const createRes = await createSession({
      plan: "# UUID Route\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-name-uuid-route",
    });
    const created = await createRes.json();

    const planRes = await fetch(`${host.url}/s/${created.sessionId}/api/plan`);
    expect(planRes.status).toBe(200);
  });
});
