import { describe, expect, test, afterEach } from "bun:test";
import { startPlannotatorServer } from "./index";
import { startAnnotateServer } from "./annotate";
import { startReviewServer } from "./review";
import { randomUUID } from "crypto";

describe("CWD Exposure in Server API", () => {
  let servers: any[] = [];

  afterEach(() => {
    for (const server of servers) {
      if (server && typeof server.stop === "function") {
        server.stop();
      }
    }
    servers = [];
  });

  test("startPlannotatorServer returns cwd in /api/plan", async () => {
    const testCwd = "/tmp/test-plan-cwd-" + randomUUID();
    const server = await startPlannotatorServer({
      plan: "# Test Plan",
      origin: "http-api",
      htmlContent: "<html><head></head><body></body></html>",
      cwd: testCwd,
      onReady: () => {},
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/api/plan`);
    const data: any = await res.json();
    expect(data.cwd).toBe(testCwd);
  });

  test("startAnnotateServer returns cwd in /api/plan", async () => {
    const testCwd = "/tmp/test-annotate-cwd-" + randomUUID();
    const server = await startAnnotateServer({
      markdown: "# Test Annotate",
      filePath: "/tmp/test.md",
      htmlContent: "<html><head></head><body></body></html>",
      origin: "http-api",
      mode: "annotate",
      cwd: testCwd,
      onReady: () => {},
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/api/plan`);
    const data: any = await res.json();
    expect(data.cwd).toBe(testCwd);
  });

  test("startReviewServer returns cwd in /api/diff", async () => {
    const testCwd = "/tmp/test-review-cwd-" + randomUUID();
    const server = await startReviewServer({
      rawPatch: "diff --git a/a b/b\n--- a/a\n+++ b/b\n@@ -1 +1 @@\n-a\n+b",
      gitRef: "HEAD",
      htmlContent: "<html><head></head><body></body></html>",
      origin: "http-api",
      agentCwd: testCwd, // Review server uses agentCwd as preferred CWD
      onReady: () => {},
    });
    servers.push(server);

    const res = await fetch(`http://localhost:${server.port}/api/diff`);
    const data: any = await res.json();
    expect(data.cwd).toBe(testCwd);
  }, { timeout: 15000 });
});
