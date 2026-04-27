import { expect, test, describe } from "bun:test";
import { startReviewServer } from "../review";

describe("Review Server Sessions", () => {
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
  });

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
  });
});
