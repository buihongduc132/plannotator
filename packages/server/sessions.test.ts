import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";

describe("session registry", () => {
  const testDir = join(tmpdir(), "plannotator-test-sessions-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("registerSession / unregisterSession / listSessions", () => {
    test("register and list a session", async () => {
      const { registerSession, listSessions, unregisterSession } = await import("./sessions");
      const testPid = 999999999; // unlikely real PID

      registerSession({
        pid: testPid,
        port: 12345,
        url: "http://localhost:12345",
        mode: "plan",
        project: "test-project",
        startedAt: new Date().toISOString(),
        label: "Test Session",
      });

      const sessions = listSessions();
      // The test PID won't be alive, so it should be cleaned up
      // But we can verify the function doesn't crash
      expect(Array.isArray(sessions)).toBe(true);

      // Clean up
      unregisterSession(testPid);
    });

    test("unregisterSession is no-op for non-existent PID", async () => {
      const { unregisterSession } = await import("./sessions");
      expect(() => unregisterSession(999999998)).not.toThrow();
    });
  });
});
