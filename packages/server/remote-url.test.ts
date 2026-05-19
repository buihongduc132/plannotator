/**
 * Remote URL & Hostname Tests
 *
 * Tests for getServerUrl(), getServerHostname(), isRemoteSession(), and
 * getServerPort() from remote.ts.
 *
 * Run: bun test packages/server/remote-url.test.ts --run
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  getServerUrl,
  getServerHostname,
  isRemoteSession,
  getServerPort,
} from "./remote";

// ---------------------------------------------------------------------------
// Env helpers — save before each test, restore after
// ---------------------------------------------------------------------------
const envKeys = [
  "PLANNOTATOR_SERVER_URL",
  "PLANNOTATOR_HOST",
  "PLANNOTATOR_REMOTE",
  "PLNOTATOR_HOST", // typo variant used in task description
  "PLANNOTATOR_PORT",
  "SSH_TTY",
  "SSH_CONNECTION",
];

const stash = new Map<string, string | undefined>();

function saveEnv() {
  stash.clear();
  for (const key of envKeys) {
    stash.set(key, process.env[key]);
    delete process.env[key];
  }
}

function restoreEnv() {
  for (const key of envKeys) {
    const saved = stash.get(key);
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  stash.clear();
}

afterEach(restoreEnv);

// ===========================================================================
// getServerUrl
// ===========================================================================
describe("getServerUrl", () => {
  test("returns PLANNOTATOR_SERVER_URL when set", () => {
    saveEnv();
    process.env.PLANNOTATOR_SERVER_URL = "https://myhost.example.com";
    expect(getServerUrl(8080)).toBe("https://myhost.example.com");
  });

  test("falls back to http://127.0.0.1:{port} when no env vars", () => {
    saveEnv();
    // Local sessions bind to 127.0.0.1; only 0.0.0.0 (remote) gets remapped to localhost
    expect(getServerUrl(12345)).toBe("http://127.0.0.1:12345");
  });

  test("uses PLANNOTATOR_HOST hostname when set (no SERVER_URL)", () => {
    saveEnv();
    // Note: the env var is PLANNOTATOR_HOST (with two A's), not PLNOTATOR_HOST
    process.env.PLANNOTATOR_HOST = "100.64.0.1";
    expect(getServerUrl(9999)).toBe("http://100.64.0.1:9999");
  });

  test("SERVER_URL takes precedence over HOST", () => {
    saveEnv();
    process.env.PLANNOTATOR_SERVER_URL = "https://override.example.com";
    process.env.PLANNOTATOR_HOST = "100.64.0.1";
    expect(getServerUrl(9999)).toBe("https://override.example.com");
  });

  test("remote session (0.0.0.0 hostname) displays as localhost", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "1";
    // getServerHostname() returns 0.0.0.0, but getServerUrl maps it to localhost
    expect(getServerUrl(19432)).toBe("http://localhost:19432");
  });

  test("HOST override on remote session uses the host name", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "1";
    process.env.PLANNOTATOR_HOST = "100.64.0.2";
    expect(getServerUrl(19432)).toBe("http://100.64.0.2:19432");
  });
});

// ===========================================================================
// getServerHostname
// ===========================================================================
describe("getServerHostname", () => {
  test("returns 0.0.0.0 for remote sessions", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "1";
    expect(getServerHostname()).toBe("0.0.0.0");
  });

  test("returns PLANNOTATOR_HOST when set", () => {
    saveEnv();
    process.env.PLANNOTATOR_HOST = "192.168.1.100";
    expect(getServerHostname()).toBe("192.168.1.100");
  });

  test("returns 127.0.0.1 for local sessions", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "0";
    expect(getServerHostname()).toBe("127.0.0.1");
  });

  test("HOST takes precedence over remote 0.0.0.0 default", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "1";
    process.env.PLANNOTATOR_HOST = "tailscale-host";
    expect(getServerHostname()).toBe("tailscale-host");
  });
});

// ===========================================================================
// isRemoteSession
// ===========================================================================
describe("isRemoteSession", () => {
  test("respects PLANNOTATOR_REMOTE=true", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "true";
    expect(isRemoteSession()).toBe(true);
  });

  test("respects PLANNOTATOR_REMOTE=false", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "false";
    expect(isRemoteSession()).toBe(false);
  });

  test("respects PLANNOTATOR_REMOTE=1", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "1";
    expect(isRemoteSession()).toBe(true);
  });

  test("respects PLANNOTATOR_REMOTE=0", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "0";
    expect(isRemoteSession()).toBe(false);
  });

  test("defaults to false when unset", () => {
    saveEnv();
    expect(isRemoteSession()).toBe(false);
  });

  test("falls through to SSH_TTY when REMOTE is unset", () => {
    saveEnv();
    process.env.SSH_TTY = "/dev/pts/0";
    expect(isRemoteSession()).toBe(true);
  });

  test("REMOTE=false overrides SSH_TTY", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "false";
    process.env.SSH_TTY = "/dev/pts/0";
    expect(isRemoteSession()).toBe(false);
  });
});

// ===========================================================================
// getServerPort
// ===========================================================================
describe("getServerPort", () => {
  test("returns 19432 for remote sessions", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "1";
    expect(getServerPort()).toBe(19432);
  });

  test("returns 0 (random) for local sessions", () => {
    saveEnv();
    process.env.PLANNOTATOR_REMOTE = "0";
    expect(getServerPort()).toBe(0);
  });

  test("PLANNOTATOR_PORT overrides default", () => {
    saveEnv();
    process.env.PLANNOTATOR_PORT = "8080";
    expect(getServerPort()).toBe(8080);
  });
});
