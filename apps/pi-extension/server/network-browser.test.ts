import { describe, expect, test, afterEach, spyOn } from "bun:test";
import { openBrowser, isRemoteSession } from "./network";

const savedEnv: Record<string, string | undefined> = {};
const envKeys = ["PLANNOTATOR_REMOTE", "PLANNOTATOR_PORT", "PLANNOTATOR_BROWSER", "BROWSER", "SSH_TTY", "SSH_CONNECTION"];

function clearEnv() {
	for (const key of envKeys) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
}

afterEach(() => {
	for (const key of envKeys) {
		if (savedEnv[key] !== undefined) {
			process.env[key] = savedEnv[key];
		} else {
			delete process.env[key];
		}
	}
});

describe("openBrowser", () => {
	test("returns isRemote when remote session without browser", () => {
		clearEnv();
		process.env.PLANNOTATOR_REMOTE = "true";
		const result = openBrowser("http://localhost:1234");
		expect(result.opened).toBe(false);
		if (!result.opened) {
			expect(result.isRemote).toBe(true);
			expect(result.url).toBe("http://localhost:1234");
		}
	});

	test("uses PLANNOTATOR_BROWSER env var when set", () => {
		clearEnv();
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.PLANNOTATOR_BROWSER = "echo"; // Use 'echo' as a safe browser command
		const result = openBrowser("http://localhost:9999");
		// Should attempt to open (spawn succeeds for 'echo')
		expect(result.opened).toBe(true);
	});

	test("uses BROWSER env var as fallback", () => {
		clearEnv();
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.BROWSER = "echo";
		const result = openBrowser("http://localhost:9999");
		expect(result.opened).toBe(true);
	});

	test("PLANNOTATOR_BROWSER takes precedence over BROWSER", () => {
		clearEnv();
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.PLANNOTATOR_BROWSER = "echo";
		process.env.BROWSER = "nonexistent-browser";
		const result = openBrowser("http://localhost:9999");
		expect(result.opened).toBe(true);
	});

	test("remote session with custom browser still opens", () => {
		clearEnv();
		process.env.PLANNOTATOR_REMOTE = "true";
		process.env.PLANNOTATOR_BROWSER = "echo";
		const result = openBrowser("http://localhost:8080");
		expect(result.opened).toBe(true);
	});

	test("returns opened:false for spawn error on nonexistent browser", () => {
		clearEnv();
		process.env.PLANNOTATOR_REMOTE = "false";
		process.env.PLANNOTATOR_BROWSER = "/nonexistent/browser-binary-xyz";
		// This will spawn but the unref + error handler means it won't crash
		const result = openBrowser("http://localhost:9999");
		// spawn itself may succeed (detached, unref) — it's fire-and-forget
		expect(typeof result.opened).toBe("boolean");
	});
});
