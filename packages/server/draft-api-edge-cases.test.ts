/**
 * RED tests for draft API edge cases
 *
 * Root cause being tested:
 *   When a user visits /s/<slug>, the SPA loads and JS calls fetch('/api/draft').
 *   If no draft exists, the server returns 404 { found: false }.
 *   The client-side useAnnotationDraft hook handles this via `if (!res.ok) return null;`
 *   BUT: the 404 should return a well-formed JSON response that the client can parse.
 *
 *   Additionally, when using session-scoped paths (/s/<id>/api/draft), the draft
 *   must be properly scoped to the correct session — not leak between sessions.
 *
 * TDD Cycle: RED (these tests) → GREEN (implement) → REFACTOR
 *
 * Run: bun test packages/server/draft-api-edge-cases.test.ts
 */

import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import {
  startPlannotatorServer,
  unregisterSessionContext,
} from "./index";
import type { ServerResult } from "./index";
import { saveDraft, deleteDraft, contentHash } from "./draft";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let server: ServerResult & { url: string };
const testCwd = join(tmpdir(), `plannotator-draft-test-${Date.now()}`);

beforeAll(async () => {
  const result = await startPlannotatorServer({
    plan: "# Test Plan\n\nThis is a test plan for draft edge cases.",
    origin: "http-api",
    mode: "plan",
    sharingEnabled: false,
    cwd: testCwd,
    sessionId: "draft-test-session-001",
    onReady: () => {},
  });
  server = { ...result, url: `http://localhost:${result.port}` };
});

afterAll(() => {
  server.stop();
  // Cleanup test cwd
  try {
    if (existsSync(testCwd)) rmSync(testCwd, { recursive: true, force: true });
  } catch {}
});

const childSessionIds: string[] = [];

afterEach(() => {
  for (const sid of childSessionIds) {
    unregisterSessionContext(sid);
  }
  childSessionIds.length = 0;
});

// ---------------------------------------------------------------------------
// 1. GET /api/draft returns valid JSON 404 when no draft exists
//    This is the ROOT CASE: client should not crash on this response
// ---------------------------------------------------------------------------

describe("GET /api/draft — 404 when no draft exists", () => {
  test("returns 404 with { found: false } body when no draft saved", async () => {
    const res = await fetch(`${server.url}/api/draft`);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ found: false });
  });

  test("response is valid JSON (Content-Type header)", async () => {
    const res = await fetch(`${server.url}/api/draft`);

    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("response body is parseable by JSON.parse without throwing", async () => {
    const res = await fetch(`${server.url}/api/draft`);
    const text = await res.text();

    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// 2. GET /api/draft returns saved draft correctly
// ---------------------------------------------------------------------------

describe("GET /api/draft — with existing draft", () => {
  test("returns saved draft data after POST /api/draft", async () => {
    const draftData = {
      annotations: [
        {
          id: "test-ann-1",
          type: "COMMENT",
          originalText: "test text",
          text: "test comment",
          blockId: "block-1",
          startOffset: 0,
          endOffset: 9,
          createdAt: Date.now(),
        },
      ],
      globalAttachments: [],
      ts: Date.now(),
    };

    // Save a draft
    const saveRes = await fetch(`${server.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftData),
    });
    expect(saveRes.status).toBe(200);
    expect(await saveRes.json()).toEqual({ ok: true });

    // Load the draft
    const loadRes = await fetch(`${server.url}/api/draft`);
    expect(loadRes.status).toBe(200);
    const loaded = await loadRes.json();
    expect(loaded.annotations).toHaveLength(1);
    expect(loaded.annotations[0].id).toBe("test-ann-1");
  });

  test("DELETE /api/draft removes the draft, subsequent GET returns 404", async () => {
    // Save a draft
    await fetch(`${server.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations: [{ id: "x" }], ts: Date.now() }),
    });

    // Verify it exists
    const before = await fetch(`${server.url}/api/draft`);
    expect(before.status).toBe(200);

    // Delete it
    const delRes = await fetch(`${server.url}/api/draft`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    // Verify it's gone
    const after = await fetch(`${server.url}/api/draft`);
    expect(after.status).toBe(404);
    expect(await after.json()).toEqual({ found: false });
  });
});

// ---------------------------------------------------------------------------
// 3. Session-scoped draft: /s/<sessionId>/api/draft
//    Drafts must be isolated between sessions
// ---------------------------------------------------------------------------

describe("Session-scoped draft isolation", () => {
  test("draft saved in one session is not visible to another session", async () => {
    // Create first session
    const sess1Res = await fetch(`${server.url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Session 1\n\nFirst session plan",
        mode: "plan",
        cwd: join(tmpdir(), `draft-sess1-${Date.now()}`),
      }),
    });
    expect(sess1Res.status).toBe(200);
    const sess1 = await sess1Res.json();
    childSessionIds.push(sess1.sessionId);

    // Create second session
    const sess2Res = await fetch(`${server.url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Session 2\n\nSecond session plan",
        mode: "plan",
        cwd: join(tmpdir(), `draft-sess2-${Date.now()}`),
      }),
    });
    expect(sess2Res.status).toBe(200);
    const sess2 = await sess2Res.json();
    childSessionIds.push(sess2.sessionId);

    // Save a draft in session 1
    const draftSave = await fetch(`${server.url}/s/${sess1.sessionId}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: [{ id: "session1-only" }],
        ts: Date.now(),
      }),
    });
    expect(draftSave.status).toBe(200);

    // Session 1 should see the draft
    const sess1Draft = await fetch(`${server.url}/s/${sess1.sessionId}/api/draft`);
    expect(sess1Draft.status).toBe(200);
    const sess1Data = await sess1Draft.json();
    expect(sess1Data.annotations[0].id).toBe("session1-only");

    // Session 2 should NOT see session 1's draft
    const sess2Draft = await fetch(`${server.url}/s/${sess2.sessionId}/api/draft`);
    expect(sess2Draft.status).toBe(404);
    expect(await sess2Draft.json()).toEqual({ found: false });
  });

  test("flat /api/draft falls back to most recently registered session", async () => {
    // Create a session
    const sessRes = await fetch(`${server.url}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: "# Flat Path Session\n\nTesting flat path draft fallback",
        mode: "plan",
        cwd: join(tmpdir(), `draft-flat-${Date.now()}`),
      }),
    });
    expect(sessRes.status).toBe(200);
    const sess = await sessRes.json();
    childSessionIds.push(sess.sessionId);

    // Save a draft via session-scoped path
    await fetch(`${server.url}/s/${sess.sessionId}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: [{ id: "flat-path-draft" }],
        ts: Date.now(),
      }),
    });

    // Load via flat path — should resolve to most recent session's draft
    const flatRes = await fetch(`${server.url}/api/draft`);
    // NOTE: This might or might not find the draft depending on whether
    // the host session or child session is "most recently registered"
    // The key is: it should NOT crash (500)
    expect(flatRes.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 4. Draft file corruption handling (loadDraft returns null for bad JSON)
// ---------------------------------------------------------------------------

describe("Draft corruption resilience", () => {
  test("GET /api/draft returns 404 when draft file contains invalid JSON", async () => {
    // Write a corrupted draft file directly to disk
    // We need the draft key from the server's session context
    const plan = "# Test Plan\n\nThis is a test plan for draft edge cases.";
    const key = contentHash(plan);

    // Get the draft directory (scoped to the session)
    const draftDir = join(
      testCwd,
      ".plannotator",
      "drafts",
      "draft-test-session-001"
    );
    mkdirSync(draftDir, { recursive: true });
    const draftPath = join(draftDir, `${key}.json`);

    // Write corrupted JSON
    writeFileSync(draftPath, "{ invalid json !!!", "utf-8");

    // Server should handle this gracefully — not crash
    const res = await fetch(`${server.url}/api/draft`);
    // Should return 404 (draft file exists but can't be parsed)
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ found: false });

    // Cleanup
    try { if (existsSync(draftPath)) rmSync(draftPath); } catch {}
  });

  test("GET /api/draft returns 404 when draft file is empty", async () => {
    const plan = "# Test Plan\n\nThis is a test plan for draft edge cases.";
    const key = contentHash(plan);
    const draftDir = join(
      testCwd,
      ".plannotator",
      "drafts",
      "draft-test-session-001"
    );
    mkdirSync(draftDir, { recursive: true });
    const draftPath = join(draftDir, `${key}.json`);

    // Write empty file
    writeFileSync(draftPath, "", "utf-8");

    const res = await fetch(`${server.url}/api/draft`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ found: false });

    // Cleanup
    try { if (existsSync(draftPath)) rmSync(draftPath); } catch {}
  });
});

// ---------------------------------------------------------------------------
// 5. POST /api/draft handles edge cases
// ---------------------------------------------------------------------------

describe("POST /api/draft edge cases", () => {
  test("POST with empty body returns error (not crash)", async () => {
    const res = await fetch(`${server.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });

    // Should not crash the server — expect 500 with error message
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST with non-JSON content type still handles the body", async () => {
    const res = await fetch(`${server.url}/api/draft`, {
      method: "POST",
      body: "not json",
    });

    // Should not crash
    expect(res.status).toBe(500);
  });

  test("POST with very large draft succeeds", async () => {
    // Simulate a draft with many annotations
    const largeAnnotations = Array.from({ length: 1000 }, (_, i) => ({
      id: `ann-${i}`,
      type: "COMMENT",
      originalText: `text ${i}`,
      text: `comment ${i}`,
      blockId: `block-${i}`,
      startOffset: 0,
      endOffset: 10,
      createdAt: Date.now(),
    }));

    const res = await fetch(`${server.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: largeAnnotations,
        globalAttachments: [],
        ts: Date.now(),
      }),
    });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 6. DELETE /api/draft is idempotent
// ---------------------------------------------------------------------------

describe("DELETE /api/draft idempotency", () => {
  test("deleting a non-existent draft returns 200 (not 404)", async () => {
    // Ensure no draft exists by deleting first
    await fetch(`${server.url}/api/draft`, { method: "DELETE" });

    // Delete again — should still return 200
    const res = await fetch(`${server.url}/api/draft`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// 7. SPA fallback: /s/<slug> without /api/ suffix serves HTML
//    This tests that the URL the user visited actually serves the SPA
// ---------------------------------------------------------------------------

describe("SPA fallback for session URLs", () => {
  test("/s/<slug> without /api/ suffix serves HTML (SPA)", async () => {
    const res = await fetch(`${server.url}/s/draft-test-session-001`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("/s/<slug>/api/plan serves JSON plan data", async () => {
    const res = await fetch(`${server.url}/s/draft-test-session-001/api/plan`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toContain("# Test Plan");
  });

  test("/s/<slug>/api/draft returns correct draft for that session", async () => {
    // No draft saved for this session yet — should be 404
    const res = await fetch(`${server.url}/s/draft-test-session-001/api/draft`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ found: false });
  });

  test("/s/<non-existent-slug>/api/draft returns session-not-found (not draft 404)", async () => {
    // Accessing a non-existent session's draft endpoint
    const res = await fetch(`${server.url}/s/non-existent-session-999/api/draft`);
    // Should return 404 with session not found error, not draft not found
    expect(res.status).toBe(404);
    const body = await res.json();
    // The error should mention session, not draft
    expect(body.error).toContain("Session not found");
  });
});

// ---------------------------------------------------------------------------
// 8. Non-registered session path: /s/<anything>/api/draft without /s/ prefix
//    Tests that flat /api/draft works when accessed from a /s/<slug> page
// ---------------------------------------------------------------------------

describe("Flat /api/draft when page loaded from /s/<slug>", () => {
  test("flat /api/draft returns the host session's draft state", async () => {
    // This simulates the browser making fetch('/api/draft') from a page
    // served at /s/<slug>. The flat path should resolve to the host session.
    const res = await fetch(`${server.url}/api/draft`);

    // Should be either 200 (draft exists) or 404 (no draft) — never 500
    expect(res.status).toBeLessThan(500);

    if (res.status === 404) {
      const body = await res.json();
      expect(body).toEqual({ found: false });
    } else {
      const body = await res.json();
      // Should have draft data structure
      expect(body).toBeDefined();
    }
  });
});
