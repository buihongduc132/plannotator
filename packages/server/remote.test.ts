import { describe, test, expect, beforeEach, afterEach } from "bun:test";

describe("remote session detection", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // Clean relevant env vars
    delete process.env.PLANNOTATOR_REMOTE;
    delete process.env.PLANNOTATOR_PORT;
    delete process.env.PLANNOTATOR_SERVER_URL;
    delete process.env.PLANNOTATOR_HOST;
    delete process.env.PLANNOTATOR_CLIENT_MODE;
    delete process.env.SSH_TTY;
    delete process.env.SSH_CONNECTION;
  });

  afterEach(() => {
    // Restore
    process.env = { ...origEnv };
  });

  describe("isRemoteSession", () => {
    test("returns false by default", async () => {
      const { isRemoteSession } = await import("./remote");
      expect(isRemoteSession()).toBe(false);
    });

    test("returns true when PLANNOTATOR_REMOTE=1", async () => {
      process.env.PLANNOTATOR_REMOTE = "1";
      const { isRemoteSession } = await import("./remote");
      expect(isRemoteSession()).toBe(true);
    });

    test("returns true when PLANNOTATOR_REMOTE=true", async () => {
      process.env.PLANNOTATOR_REMOTE = "true";
      const { isRemoteSession } = await import("./remote");
      expect(isRemoteSession()).toBe(true);
    });

    test("returns false when PLANNOTATOR_REMOTE=0", async () => {
      process.env.PLANNOTATOR_REMOTE = "0";
      const { isRemoteSession } = await import("./remote");
      expect(isRemoteSession()).toBe(false);
    });

    test("detects SSH session via SSH_TTY", async () => {
      process.env.SSH_TTY = "/dev/pts/0";
      const { isRemoteSession } = await import("./remote");
      expect(isRemoteSession()).toBe(true);
    });

    test("detects SSH session via SSH_CONNECTION", async () => {
      process.env.SSH_CONNECTION = "10.0.0.1 12345 10.0.0.2 22";
      const { isRemoteSession } = await import("./remote");
      expect(isRemoteSession()).toBe(true);
    });
  });

  describe("getServerPort", () => {
    test("returns 0 (random) for local sessions", async () => {
      const { getServerPort } = await import("./remote");
      expect(getServerPort()).toBe(0);
    });

    test("returns 19432 for remote sessions", async () => {
      process.env.PLANNOTATOR_REMOTE = "1";
      const { getServerPort } = await import("./remote");
      expect(getServerPort()).toBe(19432);
    });

    test("respects PLANNOTATOR_PORT override", async () => {
      process.env.PLANNOTATOR_PORT = "8080";
      const { getServerPort } = await import("./remote");
      expect(getServerPort()).toBe(8080);
    });
  });

  describe("getServerHost", () => {
    test("returns 127.0.0.1 for local sessions", async () => {
      const { getServerHost } = await import("./remote");
      expect(getServerHost()).toBe("127.0.0.1");
    });

    test("returns 0.0.0.0 for remote sessions", async () => {
      process.env.PLANNOTATOR_REMOTE = "1";
      const { getServerHost } = await import("./remote");
      expect(getServerHost()).toBe("0.0.0.0");
    });

    test("respects PLANNOTATOR_HOST override", async () => {
      process.env.PLANNOTATOR_HOST = "100.114.135.99";
      const { getServerHost } = await import("./remote");
      expect(getServerHost()).toBe("100.114.135.99");
    });
  });

  describe("getServerBaseUrl", () => {
    test("returns localhost by default", async () => {
      const { getServerBaseUrl } = await import("./remote");
      expect(getServerBaseUrl()).toBe("http://localhost");
    });

    test("returns PLANNOTATOR_SERVER_URL when set", async () => {
      process.env.PLANNOTATOR_SERVER_URL = "http://100.114.135.99:19437";
      const { getServerBaseUrl } = await import("./remote");
      expect(getServerBaseUrl()).toBe("http://100.114.135.99:19437");
    });

    test("strips trailing slash", async () => {
      process.env.PLANNOTATOR_SERVER_URL = "http://example.com/";
      const { getServerBaseUrl } = await import("./remote");
      expect(getServerBaseUrl()).toBe("http://example.com");
    });
  });

  describe("getServerUrl", () => {
    test("composes localhost URL with port", async () => {
      const { getServerUrl } = await import("./remote");
      expect(getServerUrl(3000)).toBe("http://localhost:3000");
    });

    test("returns PLANNOTATOR_SERVER_URL when set", async () => {
      process.env.PLANNOTATOR_SERVER_URL = "http://192.168.1.1:8080";
      const { getServerUrl } = await import("./remote");
      expect(getServerUrl(3000)).toBe("http://192.168.1.1:8080");
    });
  });

  describe("isClientMode", () => {
    test("returns false by default", async () => {
      const { isClientMode } = await import("./remote");
      expect(isClientMode()).toBe(false);
    });

    test("returns true when PLANNOTATOR_CLIENT_MODE=1", async () => {
      process.env.PLANNOTATOR_CLIENT_MODE = "1";
      const { isClientMode } = await import("./remote");
      expect(isClientMode()).toBe(true);
    });

    test("returns true when SERVER_URL is set (auto-detect)", async () => {
      process.env.PLANNOTATOR_SERVER_URL = "http://example.com:8080";
      const { isClientMode } = await import("./remote");
      expect(isClientMode()).toBe(true);
    });

    test("returns false when PLANNOTATOR_CLIENT_MODE=0", async () => {
      process.env.PLANNOTATOR_CLIENT_MODE = "0";
      const { isClientMode } = await import("./remote");
      expect(isClientMode()).toBe(false);
    });
  });
});
