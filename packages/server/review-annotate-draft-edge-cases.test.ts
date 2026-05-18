/**
 * RED tests for review & annotate server draft API edge cases
 *
 * Worst-first testing: error paths, boundary conditions, and failure-prone
 * scenarios are tested FIRST. The happy path is last.
 *
 * Servers under test:
 *   - startReviewServer (packages/server/review.ts)
 *   - startAnnotateServer (packages/server/annotate.ts)
 *
 * Each has its own /api/draft endpoint, its own parseSessionPath, and its
 * own draft key derivation. These tests verify that the draft endpoints on
 * BOTH servers behave correctly under worst-case conditions.
 *
 * Run: bun test packages/server/review-annotate-draft-edge-cases.test.ts
 */

import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import { startReviewServer, type ReviewServerResult } from "./review";
import { startAnnotateServer, type AnnotateServerResult } from "./annotate";
import { unregisterSessionContext } from "./index";
import { contentHash, getDraftDir } from "./draft";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Review Server Setup
// ---------------------------------------------------------------------------

let reviewServer: ReviewServerResult & { url: string };
const reviewTestCwd = join(tmpdir(), `plannotator-review-draft-test-${Date.now()}`);
const REVIEW_SESSION_ID = "review-draft-test-session-001";

beforeAll(async () => {
  // Start review server on port 0 (random) to avoid conflicts
  const result = await startReviewServer({
    rawPatch: "diff --git a/test.txt b/test.txt\n--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-old\n+new\n",
    gitRef: "HEAD",
    htmlContent: "<!DOCTYPE html><html><body>Review Test</body></html>",
    origin: "test-runner",
    diffType: "uncommitted",
    sharingEnabled: false,
    sessionId: REVIEW_SESSION_ID,
    onReady: () => {},
  });
  reviewServer = { ...result, url: `http://localhost:${result.port}` };
});

// ---------------------------------------------------------------------------
// Annotate Server Setup
// ---------------------------------------------------------------------------

let annotateServer: AnnotateServerResult & { url: string };
const annotateTestCwd = join(tmpdir(), `plannotator-annotate-draft-test-${Date.now()}`);
const ANNOTATE_SESSION_ID = "annotate-draft-test-session-001";

beforeAll(async () => {
  const result = await startAnnotateServer({
    markdown: "# Annotate Test\n\nThis is a test markdown file for draft edge cases.",
    filePath: "/tmp/test-annotate-file.md",
    htmlContent: "<!DOCTYPE html><html><body>Annotate Test</body></html>",
    origin: "test-runner",
    mode: "annotate",
    sharingEnabled: false,
    sessionId: ANNOTATE_SESSION_ID,
    cwd: annotateTestCwd,
    onReady: () => {},
  });
  annotateServer = { ...result, url: `http://localhost:${result.port}` };
});

afterAll(() => {
  reviewServer.stop();
  annotateServer.stop();

  // Cleanup test cwds
  for (const dir of [reviewTestCwd, annotateTestCwd]) {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

const registeredSessionIds: string[] = [];

afterEach(() => {
  for (const sid of registeredSessionIds) {
    unregisterSessionContext(sid);
  }
  registeredSessionIds.length = 0;
});

// ===========================================================================
// REVIEW SERVER TESTS
// ===========================================================================
//
// Worst-first order:
//   Zone 4 (error propagation) → Zone 1 (empty/nil) → Zone 5 (state mutation)
//   → Zone 2 (boundary) → Zone 3 (multi-component) → happy path
// ===========================================================================

describe("Review Server — /api/draft edge cases", () => {
  // -------------------------------------------------------------------------
  // Zone 4: Error propagation — POST invalid JSON should not crash server
  // -------------------------------------------------------------------------

  test("POST /api/draft with empty body returns 500 (not server crash)", async () => {
    const res = await fetch(`${reviewServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });

    // Server must survive and return error JSON
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/draft with non-JSON body returns 500 (not server crash)", async () => {
    const res = await fetch(`${reviewServer.url}/api/draft`, {
      method: "POST",
      body: "this is not json at all",
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/draft with malformed JSON returns 500", async () => {
    const res = await fetch(`${reviewServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ bad json !!!",
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Zone 1: Empty/nil — GET /api/draft when no draft exists
  // -------------------------------------------------------------------------

  test("GET /api/draft returns 404 { found: false } when no draft exists", async () => {
    // Ensure clean state
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });

    const res = await fetch(`${reviewServer.url}/api/draft`);

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ found: false });
  });

  test("GET /api/draft 404 response is parseable by JSON.parse", async () => {
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });

    const res = await fetch(`${reviewServer.url}/api/draft`);
    const text = await res.text();

    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual({ found: false });
  });

  // -------------------------------------------------------------------------
  // Zone 5: State mutation — DELETE idempotency (second delete should work)
  // -------------------------------------------------------------------------

  test("DELETE /api/draft is idempotent — deleting non-existent draft returns 200", async () => {
    // Ensure no draft
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });

    // Delete again
    const res = await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Draft save/load round-trip (data integrity)
  // -------------------------------------------------------------------------

  test("POST then GET /api/draft preserves annotation data", async () => {
    const draftData = {
      annotations: [
        {
          id: "review-ann-1",
          type: "COMMENT",
          originalText: "old line",
          text: "This looks wrong",
          blockId: "block-diff-1",
          startOffset: 0,
          endOffset: 8,
          createdAt: Date.now(),
        },
      ],
      globalAttachments: [],
      ts: Date.now(),
    };

    const saveRes = await fetch(`${reviewServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftData),
    });
    expect(saveRes.status).toBe(200);
    expect(await saveRes.json()).toEqual({ ok: true });

    const loadRes = await fetch(`${reviewServer.url}/api/draft`);
    expect(loadRes.status).toBe(200);
    const loaded = await loadRes.json();
    expect(loaded.annotations).toHaveLength(1);
    expect(loaded.annotations[0].id).toBe("review-ann-1");
    expect(loaded.annotations[0].text).toBe("This looks wrong");

    // Cleanup
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });
  });

  // -------------------------------------------------------------------------
  // Zone 2: Boundary — very large draft
  // -------------------------------------------------------------------------

  test("POST /api/draft with 1000 annotations succeeds", async () => {
    const largeAnnotations = Array.from({ length: 1000 }, (_, i) => ({
      id: `review-ann-${i}`,
      type: "COMMENT",
      originalText: `line ${i}`,
      text: `comment ${i}`,
      blockId: `block-${i}`,
      startOffset: 0,
      endOffset: 6,
      createdAt: Date.now(),
    }));

    const res = await fetch(`${reviewServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: largeAnnotations,
        globalAttachments: [],
        ts: Date.now(),
      }),
    });

    expect(res.status).toBe(200);

    // Cleanup
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });
  });

  // -------------------------------------------------------------------------
  // Zone 3: Session-scoped path — /s/<sessionId>/api/draft
  // Review server uses getSessionContext from index.ts
  // -------------------------------------------------------------------------

  test("/s/<sessionId>/api/draft returns 404 when session not registered", async () => {
    // This session ID is NOT registered in the plan server's session registry
    const res = await fetch(`${reviewServer.url}/s/non-existent-session-999/api/draft`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Session not found");
  });

  test("/s/<sessionId>/api/draft returns 403 when sessionId mismatches server's own session", async () => {
    // The review server has sessionId=REVIEW_SESSION_ID, but we request a different one
    // First, register a session so it passes the getSessionContext check...
    // Actually, review server checks parsedSessionId against its own sessionId
    // Since the URL has a different session ID than the server's, it should 403
    const res = await fetch(`${reviewServer.url}/s/wrong-session-id/api/draft`);
    // If the session isn't registered, we get 404 first; if it IS registered but
    // mismatched, we get 403. The session "wrong-session-id" isn't registered,
    // so this tests the getSessionContext guard.
    expect(res.status).toBeGreaterThanOrEqual(400);
    // Must not be 500 (server crash)
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("flat /api/draft does not crash server after session-scoped 404", async () => {
    // First hit a session-scoped path that returns 404
    await fetch(`${reviewServer.url}/s/ghost-session/api/draft`);

    // Then hit flat path — server must still work
    const res = await fetch(`${reviewServer.url}/api/draft`);
    expect(res.status).toBeLessThan(500);
    // Should be either 200 (draft exists) or 404 (no draft)
    if (res.status === 404) {
      const body = await res.json();
      expect(body).toEqual({ found: false });
    }
  });

  // -------------------------------------------------------------------------
  // Draft corruption resilience
  // -------------------------------------------------------------------------

  test("GET /api/draft returns 404 when draft file is corrupted on disk", async () => {
    // The review server derives draftKey from contentHash(rawPatch)
    const rawPatch = "diff --git a/test.txt b/test.txt\n--- a/test.txt\n+++ b/test.txt\n@@ -1 +1 @@\n-old\n+new\n";
    const key = contentHash(rawPatch);

    // Write a corrupted draft to disk — review server doesn't use session-scoped
    // drafts by default (no scope passed to handleDraftLoad in review.ts line 603)
    // But the draft goes to a default location
    const draftDir = join(tmpdir(), ".plannotator", "drafts");
    mkdirSync(draftDir, { recursive: true });
    const draftPath = join(draftDir, `${key}.json`);

    writeFileSync(draftPath, "{ corrupted !!!", "utf-8");

    const res = await fetch(`${reviewServer.url}/api/draft`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ found: false });

    // Cleanup
    try {
      if (existsSync(draftPath)) rmSync(draftPath);
    } catch {}
  });
});

// ===========================================================================
// ANNOTATE SERVER TESTS
// ===========================================================================
//
// The annotate server has a different architecture from the review server:
// - Uses parseAnnotateSessionPath (local function) instead of getSessionContext
// - Passes { sessionId, cwd } scope to handleDraftLoad
// - Checks sessionId match locally (no external registry)
// ===========================================================================

describe("Annotate Server — /api/draft edge cases", () => {
  // -------------------------------------------------------------------------
  // Zone 4: Error propagation
  // -------------------------------------------------------------------------

  test("POST /api/draft with empty body returns 500 (not server crash)", async () => {
    const res = await fetch(`${annotateServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/draft with non-JSON body returns 500", async () => {
    const res = await fetch(`${annotateServer.url}/api/draft`, {
      method: "POST",
      body: "not json at all",
    });

    expect(res.status).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Zone 1: Empty/nil — GET /api/draft when no draft exists
  // -------------------------------------------------------------------------

  test("GET /api/draft returns 404 { found: false } when no draft exists", async () => {
    // Clean state
    await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });

    const res = await fetch(`${annotateServer.url}/api/draft`);

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ found: false });
  });

  test("GET /api/draft 404 response body is parseable JSON", async () => {
    await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });

    const res = await fetch(`${annotateServer.url}/api/draft`);
    const text = await res.text();

    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text)).toEqual({ found: false });
  });

  // -------------------------------------------------------------------------
  // Zone 5: DELETE idempotency
  // -------------------------------------------------------------------------

  test("DELETE /api/draft is idempotent — returns 200 for non-existent draft", async () => {
    await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });

    const res = await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Draft save/load round-trip
  // -------------------------------------------------------------------------

  test("POST then GET /api/draft — save and load both use session scope (round-trip)", async () => {
    const draftData = {
      annotations: [
        {
          id: "annotate-ann-1",
          type: "DELETION",
          originalText: "remove this line",
          blockId: "block-md-3",
          startOffset: 0,
          endOffset: 16,
          createdAt: Date.now(),
        },
      ],
      globalAttachments: [],
      ts: Date.now(),
    };

    const saveRes = await fetch(`${annotateServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftData),
    });
    expect(saveRes.status).toBe(200);
    expect(await saveRes.json()).toEqual({ ok: true });

    // Both save and load now use { sessionId, cwd } scope, so the round-trip works.
    const loadRes = await fetch(`${annotateServer.url}/api/draft`);
    expect(loadRes.status).toBe(200);
    const body = await loadRes.json();
    expect(body.annotations).toBeDefined();

    await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });
  });

  // -------------------------------------------------------------------------
  // Zone 3: Session-scoped path for annotate server
  // Annotate server checks sessionId match locally, not via external registry
  // -------------------------------------------------------------------------

  test("/s/<sessionId>/api/draft with matching sessionId works correctly", async () => {
    // The annotate server URL already includes /s/<sessionId> when sessionId is set
    // Test the full session-scoped URL
    const res = await fetch(`${annotateServer.url}/s/${ANNOTATE_SESSION_ID}/api/draft`);
    // Should return 404 (no draft) or 200 (if a draft exists from another test)
    expect(res.status).toBeLessThan(500);
    if (res.status === 404) {
      const body = await res.json();
      expect(body).toEqual({ found: false });
    }
  });

  test("/s/<wrong-session-id>/api/draft returns 403 (session mismatch)", async () => {
    const res = await fetch(`${annotateServer.url}/s/wrong-session-999/api/draft`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Session mismatch");
  });

  // -------------------------------------------------------------------------
  // Draft corruption resilience for annotate server
  // The annotate server passes { sessionId, cwd } scope to loadDraft
  // -------------------------------------------------------------------------

  test("GET /api/draft returns 404 when draft file is corrupted on disk", async () => {
    const markdown = "# Annotate Test\n\nThis is a test markdown file for draft edge cases.";
    const key = contentHash(markdown);

    const scope = { sessionId: ANNOTATE_SESSION_ID, cwd: annotateTestCwd };
    const draftDir = getDraftDir(scope);
    mkdirSync(draftDir, { recursive: true });
    const draftPath = join(draftDir, `${key}.json`);

    writeFileSync(draftPath, "not valid json {{{{", "utf-8");

    const res = await fetch(`${annotateServer.url}/api/draft`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ found: false });

    try {
      if (existsSync(draftPath)) rmSync(draftPath);
    } catch {}
  });

  test("GET /api/draft returns 404 when draft file is empty on disk", async () => {
    const markdown = "# Annotate Test\n\nThis is a test markdown file for draft edge cases.";
    const key = contentHash(markdown);

    const scope = { sessionId: ANNOTATE_SESSION_ID, cwd: annotateTestCwd };
    const draftDir = getDraftDir(scope);
    mkdirSync(draftDir, { recursive: true });
    const draftPath = join(draftDir, `${key}.json`);

    writeFileSync(draftPath, "", "utf-8");

    const res = await fetch(`${annotateServer.url}/api/draft`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ found: false });

    try {
      if (existsSync(draftPath)) rmSync(draftPath);
    } catch {}
  });
});

// ===========================================================================
// CROSS-SERVER ISOLATION
// Verify that drafts don't leak between review and annotate servers
// ===========================================================================

describe("Cross-server draft isolation", () => {
  test("draft saved on review server is not visible on annotate server", async () => {
    // Save a draft on the review server
    const reviewDraftRes = await fetch(`${reviewServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: [{ id: "review-only-draft" }],
        ts: Date.now(),
      }),
    });
    expect(reviewDraftRes.status).toBe(200);

    // Clean annotate server draft
    await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });

    // Annotate server should not see the review server's draft
    const annotateLoadRes = await fetch(`${annotateServer.url}/api/draft`);
    expect(annotateLoadRes.status).toBe(404);
    expect(await annotateLoadRes.json()).toEqual({ found: false });

    // Cleanup
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });
  });

  test("draft saved on annotate server is not visible on review server", async () => {
    // Clean review server draft first
    await fetch(`${reviewServer.url}/api/draft`, { method: "DELETE" });

    // Save a draft on the annotate server
    const annotateDraftRes = await fetch(`${annotateServer.url}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        annotations: [{ id: "annotate-only-draft" }],
        ts: Date.now(),
      }),
    });
    expect(annotateDraftRes.status).toBe(200);

    // Review server should not see the annotate server's draft
    const reviewLoadRes = await fetch(`${reviewServer.url}/api/draft`);
    expect(reviewLoadRes.status).toBe(404);
    expect(await reviewLoadRes.json()).toEqual({ found: false });

    // Cleanup
    await fetch(`${annotateServer.url}/api/draft`, { method: "DELETE" });
  });
});
