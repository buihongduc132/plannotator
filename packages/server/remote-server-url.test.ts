import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { startReviewServer } from "./review";
import { startAnnotateServer } from "./annotate";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Force local mode (random port, localhost) regardless of SSH or inherited env vars. */
function forceLocalMode(): { remote: string | undefined; port: string | undefined } {
  const remote = process.env.PLANNOTATOR_REMOTE;
  const port = process.env.PLANNOTATOR_PORT;
  process.env.PLANNOTATOR_REMOTE = "0";
  delete process.env.PLANNOTATOR_PORT;
  return { remote, port };
}

function restoreMode(saved: { remote: string | undefined; port: string | undefined }) {
  if (saved.remote === undefined) delete process.env.PLANNOTATOR_REMOTE;
  else process.env.PLANNOTATOR_REMOTE = saved.remote;
  if (saved.port === undefined) delete process.env.PLANNOTATOR_PORT;
  else process.env.PLANNOTATOR_PORT = saved.port;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let reviewServer: Awaited<ReturnType<typeof startReviewServer>> | null = null;
let annotateServer: Awaited<ReturnType<typeof startAnnotateServer>> | null = null;
let reviewTmpDir: string;
let annotateTmpDir: string;

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `plannotator-test-${prefix}-`));
}

/**
 * For BUG 3+4: POST a draft then GET it back.
 * Returns { saveStatus, loadStatus, loadBody }.
 */
async function draftRoundTrip(
  baseUrl: string,
  body: Record<string, unknown> = { text: "test-draft-content" },
) {
  const saveRes = await fetch(`${baseUrl}/api/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const loadRes = await fetch(`${baseUrl}/api/draft`);
  return {
    saveStatus: saveRes.status,
    loadStatus: loadRes.status,
    loadBody: await loadRes.json(),
  };
}

// ===========================================================================
// BUG 1: Review server hardcodes localhost (review.ts:765)
// ===========================================================================
describe("BUG 1: Review server URL respects PLANNOTATOR_SERVER_URL", () => {
  const serverUrlEnv = "http://100.114.135.99:19437";
  let savedRemote: string | undefined;
  let savedPort: string | undefined;

  beforeAll(async () => {
    // #given PLANNOTATOR_SERVER_URL is set to a remote address
    // Force local mode so getServerPort() returns 0 (random), not 19432
    savedRemote = process.env.PLANNOTATOR_REMOTE;
    process.env.PLANNOTATOR_REMOTE = "0";
    savedPort = process.env.PLANNOTATOR_PORT;
    delete process.env.PLANNOTATOR_PORT;
    process.env.PLANNOTATOR_SERVER_URL = serverUrlEnv;
    reviewTmpDir = makeTmpDir("review-url");

    reviewServer = await startReviewServer({
      rawPatch: "diff --git a/test.txt b/test.txt\n",
      gitRef: "HEAD",
      htmlContent: "<html><body>test</body></html>",
      origin: "http-api",
      gitContext: { type: "unstaged", cwd: reviewTmpDir },
      sharingEnabled: false,
      onReady: () => {},
    });
  }, 30000);

  afterAll(() => {
    reviewServer?.stop();
    reviewServer = null;
    delete process.env.PLANNOTATOR_SERVER_URL;
    if (savedRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
    else process.env.PLANNOTATOR_REMOTE = savedRemote;
    if (savedPort === undefined) delete process.env.PLANNOTATOR_PORT;
    else process.env.PLANNOTATOR_PORT = savedPort;
    try { rmSync(reviewTmpDir, { recursive: true, force: true }); } catch {}
  });

  test("server URL should contain the env var host, not localhost", () => {
    // #when the review server starts with PLANNOTATOR_SERVER_URL set
    const url = reviewServer!.url;

    // #then the URL must use the PLANNOTATOR_SERVER_URL host
    // BUG: currently hardcodes http://localhost:${port}
    expect(url).toContain("100.114.135.99");
    expect(url).not.toContain("localhost");
  });

  test("server URL should use the env var port, not the random port", () => {
    // #when the review server constructs its URL
    const url = reviewServer!.url;

    // #then the URL must include port 19437 from env var
    // BUG: currently uses the random port from server.port
    expect(url).toContain("19437");
  });
});

// ===========================================================================
// BUG 2: Annotate server hardcodes localhost (annotate.ts:347-349)
// ===========================================================================
describe("BUG 2: Annotate server URL respects PLANNOTATOR_SERVER_URL", () => {
  const serverUrlEnv = "http://100.114.135.99:19437";
  let savedRemote: string | undefined;
  let savedPort: string | undefined;

  beforeAll(async () => {
    // #given PLANNOTATOR_SERVER_URL is set to a remote address
    // Force local mode so getServerPort() returns 0 (random), not 19432
    savedRemote = process.env.PLANNOTATOR_REMOTE;
    process.env.PLANNOTATOR_REMOTE = "0";
    savedPort = process.env.PLANNOTATOR_PORT;
    delete process.env.PLANNOTATOR_PORT;
    process.env.PLANNOTATOR_SERVER_URL = serverUrlEnv;
    annotateTmpDir = makeTmpDir("annotate-url");

    annotateServer = await startAnnotateServer({
      markdown: "# Test\n\nAnnotate content for bug 2 test.",
      htmlContent: "<html><body>test</body></html>",
      filePath: join(annotateTmpDir, "test.md"),
      origin: "http-api",
      cwd: annotateTmpDir,
      sessionId: "sess-abc123",
      onReady: () => {},
    });
  }, 30000);

  afterAll(() => {
    annotateServer?.stop();
    annotateServer = null;
    delete process.env.PLANNOTATOR_SERVER_URL;
    if (savedRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
    else process.env.PLANNOTATOR_REMOTE = savedRemote;
    if (savedPort === undefined) delete process.env.PLANNOTATOR_PORT;
    else process.env.PLANNOTATOR_PORT = savedPort;
    try { rmSync(annotateTmpDir, { recursive: true, force: true }); } catch {}
  });

  test("server URL should contain the env var host, not localhost", () => {
    // #when the annotate server starts with PLANNOTATOR_SERVER_URL set
    const url = annotateServer!.url;

    // #then the URL must use the PLANNOTATOR_SERVER_URL host
    // BUG: currently hardcodes http://localhost:${port}/s/${sessionId}
    expect(url).toContain("100.114.135.99");
    expect(url).not.toContain("localhost");
  });

  test("server URL should embed sessionId when provided", () => {
    // #when the annotate server is started with sessionId
    const url = annotateServer!.url;

    // #then the URL path must include /s/<sessionId>
    // BUG: even if host is wrong, sessionId should still be in the path
    expect(url).toContain("/s/sess-abc123");
  });
});

// ===========================================================================
// BUG 3: Annotate server draft scope mismatch (annotate.ts:259 vs 261)
//   handleDraftSave(req, draftKey)       — NO scope
//   handleDraftLoad(draftKey, { sessionId, cwd })  — WITH scope
//   Save writes to /global/, Load reads from /scoped/ → 404
// ===========================================================================
describe("BUG 3: Annotate server draft save/load scope mismatch", () => {
  let tmpDir: string;
  let server: Awaited<ReturnType<typeof startAnnotateServer>>;
  let savedRemote: string | undefined;
  let savedPort: string | undefined;

  beforeAll(async () => {
    // Ensure no leftover env var from previous tests
    delete process.env.PLANNOTATOR_SERVER_URL;
    savedRemote = process.env.PLANNOTATOR_REMOTE;
    process.env.PLANNOTATOR_REMOTE = "0";
    savedPort = process.env.PLANNOTATOR_PORT;
    delete process.env.PLANNOTATOR_PORT;

    tmpDir = makeTmpDir("annotate-draft");

    server = await startAnnotateServer({
      markdown: "# Test\n\nAnnotate content for bug 3 test.",
      htmlContent: "<html><body>test</body></html>",
      filePath: join(tmpDir, "test.md"),
      origin: "http-api",
      cwd: tmpDir,
      sessionId: "sess-draft-scope",
      onReady: () => {},
    });
  }, 30000);

  afterAll(() => {
    server?.stop();
    if (savedRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
    else process.env.PLANNOTATOR_REMOTE = savedRemote;
    if (savedPort === undefined) delete process.env.PLANNOTATOR_PORT;
    else process.env.PLANNOTATOR_PORT = savedPort;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("POST draft then GET returns the draft (round-trip)", async () => {
    // #given an annotate server with sessionId and cwd
    // #when we POST a draft then GET it back
    const { saveStatus, loadStatus, loadBody } = await draftRoundTrip(
      `http://localhost:${server.port}`,
      { text: "annotate-draft-test" },
    );

    // #then both should succeed — save returns 200, load returns 200 with data
    // BUG: save writes without scope, load reads WITH scope → different paths → 404
    expect(saveStatus).toBe(200);
    expect(loadStatus).toBe(200);
    // handleDraftLoad returns the raw draft body when found (e.g. { text: "..." })
    expect(loadBody.text).toBe("annotate-draft-test");
  });

  test("GET draft after POST returns saved content", async () => {
    // #given an annotate server with sessionId
    const uniqueText = `unique-${Date.now()}`;

    // #when we save a draft with specific content
    const saveRes = await fetch(`http://localhost:${server.port}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: uniqueText }),
    });
    expect(saveRes.status).toBe(200);

    // #then loading it should return the same content
    // BUG: scope mismatch means load returns 404 instead of the saved draft
    const loadRes = await fetch(`http://localhost:${server.port}/api/draft`);
    const body = await loadRes.json();

    expect(loadRes.status).toBe(200);
    expect(body.text).toBe(uniqueText);
  });
});

// ===========================================================================
// BUG 4: Review server draft scope mismatch (review.ts:600-603)
//   handleDraftSave(req, draftKey) — no scope
//   handleDraftLoad(draftKey) — no scope
//   When sessionId is provided, scope { sessionId, cwd } should be passed.
//   Both are unscoped → same path → round-trip works by accident but
//   sessions aren't isolated from each other.
// ===========================================================================
describe("BUG 4: Review server draft with sessionId lacks scope isolation", () => {
  let tmpDir: string;
  let serverA: Awaited<ReturnType<typeof startReviewServer>>;
  let serverB: Awaited<ReturnType<typeof startReviewServer>>;
  let savedRemote: string | undefined;
  let savedPort: string | undefined;

  beforeAll(async () => {
    delete process.env.PLANNOTATOR_SERVER_URL;
    savedRemote = process.env.PLANNOTATOR_REMOTE;
    process.env.PLANNOTATOR_REMOTE = "0";
    savedPort = process.env.PLANNOTATOR_PORT;
    delete process.env.PLANNOTATOR_PORT;

    tmpDir = makeTmpDir("review-draft-scope");

    const sharedPatch = "diff --git a/shared.txt b/shared.txt\n";
    serverA = await startReviewServer({
      rawPatch: sharedPatch,
      gitRef: "HEAD",
      htmlContent: "<html><body>test</body></html>",
      origin: "http-api",
      gitContext: { type: "unstaged", cwd: tmpDir },
      sharingEnabled: false,
      sessionId: "sess-a",
      onReady: () => {},
    });

    serverB = await startReviewServer({
      rawPatch: sharedPatch,
      gitRef: "HEAD",
      htmlContent: "<html><body>test</body></html>",
      origin: "http-api",
      gitContext: { type: "unstaged", cwd: tmpDir },
      sharingEnabled: false,
      sessionId: "sess-b",
      onReady: () => {},
    });
  }, 30000);

  afterAll(() => {
    serverA?.stop();
    serverB?.stop();
    if (savedRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
    else process.env.PLANNOTATOR_REMOTE = savedRemote;
    if (savedPort === undefined) delete process.env.PLANNOTATOR_PORT;
    else process.env.PLANNOTATOR_PORT = savedPort;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("session A draft should NOT be readable by session B", async () => {
    // #given two servers with same draftKey but different sessionIds
    const textA = `session-a-${Date.now()}`;

    // #when we save a draft on server A
    const saveRes = await fetch(`http://localhost:${serverA.port}/api/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: textA }),
    });
    expect(saveRes.status).toBe(200);

    // #then server B should NOT find that draft
    // BUG: no scope → both write/read to the same global path → server B sees A's draft
    const loadRes = await fetch(`http://localhost:${serverB.port}/api/draft`);
    const body = await loadRes.json();

    expect(body.found).toBe(false);
  });
});
