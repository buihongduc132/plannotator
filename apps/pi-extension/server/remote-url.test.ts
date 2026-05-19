import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
	buildServerUrl,
	getServerUrl,
	getServerHost,
	getServerHostname,
} from "./network.js";

// Environment variable snapshot/restore helpers
let savedEnv: Record<string, string | undefined>;

function snapshotEnv() {
	savedEnv = {
		PLANNOTATOR_SERVER_URL: process.env.PLANNOTATOR_SERVER_URL,
		PLANNOTATOR_HOST: process.env.PLANNOTATOR_HOST,
		PLANNOTATOR_REMOTE: process.env.PLANNOTATOR_REMOTE,
		SSH_TTY: process.env.SSH_TTY,
		SSH_CONNECTION: process.env.SSH_CONNECTION,
	};
}

function restoreEnv() {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
}

function clearRelevantEnv() {
	delete process.env.PLANNOTATOR_SERVER_URL;
	delete process.env.PLANNOTATOR_HOST;
	delete process.env.PLANNOTATOR_REMOTE;
	delete process.env.SSH_TTY;
	delete process.env.SSH_CONNECTION;
}

describe("buildServerUrl", () => {
	beforeEach(() => snapshotEnv());
	afterEach(() => restoreEnv());

	test("returns PLANNOTATOR_SERVER_URL when set", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_SERVER_URL = "http://100.114.135.99:19432";
		expect(buildServerUrl("0.0.0.0", 19432)).toBe("http://100.114.135.99:19432");
	});

	test("falls back to http://localhost:PORT when hostname is 0.0.0.0 and no SERVER_URL", () => {
		clearRelevantEnv();
		expect(buildServerUrl("0.0.0.0", 19432)).toBe("http://localhost:19432");
	});

	test("returns http://<hostname>:<port> for non-loopback hostname", () => {
		clearRelevantEnv();
		expect(buildServerUrl("192.168.1.100", 19432)).toBe(
			"http://192.168.1.100:19432",
		);
	});

	test("SERVER_URL takes precedence over constructed URL", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_SERVER_URL = "https://custom.example.com:8080";
		expect(buildServerUrl("192.168.1.100", 9999)).toBe(
			"https://custom.example.com:8080",
		);
	});
});

describe("getServerUrl", () => {
	beforeEach(() => snapshotEnv());
	afterEach(() => restoreEnv());

	test("combines getServerHostname + buildServerUrl correctly for remote session", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "1";
		// getServerHostname() returns "0.0.0.0" for remote
		// buildServerUrl("0.0.0.0", port) returns "http://localhost:<port>"
		expect(getServerUrl(19432)).toBe("http://localhost:19432");
	});

	test("combines getServerHostname + buildServerUrl correctly for local session", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "0";
		// getServerHostname() returns "127.0.0.1" for local
		// buildServerUrl("127.0.0.1", port) returns "http://127.0.0.1:<port>"
		expect(getServerUrl(8080)).toBe("http://127.0.0.1:8080");
	});

	test("respects PLANNOTATOR_SERVER_URL override", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_SERVER_URL = "http://proxy.example.com:3000";
		expect(getServerUrl(19432)).toBe("http://proxy.example.com:3000");
	});
});

describe("getServerHost", () => {
	beforeEach(() => snapshotEnv());
	afterEach(() => restoreEnv());

	test("is an alias for getServerHostname", () => {
		clearRelevantEnv();
		// Both should return the same value for local
		expect(getServerHost()).toBe(getServerHostname());
	});

	test("alias holds for remote session", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "1";
		expect(getServerHost()).toBe(getServerHostname());
		expect(getServerHost()).toBe("0.0.0.0");
	});
});

describe("getServerHostname", () => {
	beforeEach(() => snapshotEnv());
	afterEach(() => restoreEnv());

	test("returns 0.0.0.0 when PLANNOTATOR_REMOTE=1", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "1";
		expect(getServerHostname()).toBe("0.0.0.0");
	});

	test("returns PLANNOTATOR_HOST value when set", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_HOST = "10.0.0.5";
		expect(getServerHostname()).toBe("10.0.0.5");
	});

	test("PLANNOTATOR_HOST takes precedence over REMOTE", () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "1";
		process.env.PLANNOTATOR_HOST = "192.168.0.1";
		expect(getServerHostname()).toBe("192.168.0.1");
	});

	test("returns 127.0.0.1 for local sessions (no REMOTE, no HOST)", () => {
		clearRelevantEnv();
		expect(getServerHostname()).toBe("127.0.0.1");
	});

	test("returns 0.0.0.0 when SSH_TTY is set (legacy detection)", () => {
		clearRelevantEnv();
		process.env.SSH_TTY = "/dev/pts/0";
		expect(getServerHostname()).toBe("0.0.0.0");
	});

	test("returns 0.0.0.0 when SSH_CONNECTION is set (legacy detection)", () => {
		clearRelevantEnv();
		process.env.SSH_CONNECTION = "10.0.0.1 12345 10.0.0.2 22";
		expect(getServerHostname()).toBe("0.0.0.0");
	});

	test('PLANNOTATOR_REMOTE="true" is treated as remote', () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "true";
		expect(getServerHostname()).toBe("0.0.0.0");
	});

	test('PLANNOTATOR_REMOTE="false" is treated as local', () => {
		clearRelevantEnv();
		process.env.PLANNOTATOR_REMOTE = "false";
		expect(getServerHostname()).toBe("127.0.0.1");
	});
});
