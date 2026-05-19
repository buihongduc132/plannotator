import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { startReviewServer } from "../review";

describe("Review Server Sessions", () => {
  let savedRemote: string | undefined;
  let savedPort: string | undefined;

  beforeAll(() => {
    savedRemote = process.env.PLANNOTATOR_REMOTE;
    savedPort = process.env.PLANNOTATOR_PORT;
    process.env.PLANNOTATOR_REMOTE = "0";
    delete process.env.PLANNOTATOR_PORT;
  });

  afterAll(() => {
    if (savedRemote === undefined) delete process.env.PLANNOTATOR_REMOTE;
    else process.env.PLANNOTATOR_REMOTE = savedRemote;
    if (savedPort === undefined) delete process.env.PLANNOTATOR_PORT;
    else process.env.PLANNOTATOR_PORT = savedPort;
  });
  test("GET /api/diff should include sessionId", async () => {
    const server = await startReviewServer({
      rawPatch: "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new",
      gitRef: "HEAD",
      htmlContent: "<html></html>",
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/api/diff`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("sessionId");
    } finally {
      server.stop();
    }
  }, 15000);

  test("GET /api/sessions should include the current session", async () => {
    const server = await startReviewServer({
      rawPatch: "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new",
      gitRef: "HEAD",
      htmlContent: "<html></html>",
    });

    try {
      const res = await fetch(`http://localhost:${server.port}/api/sessions`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sessions).toBeDefined();
      expect(data.sessions.length).toBeGreaterThan(0);
      expect(data.sessions[0].sessionId).toBeDefined();
    } finally {
      server.stop();
    }
  }, 15000);
});
