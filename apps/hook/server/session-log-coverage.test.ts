import { describe, expect, test, afterEach } from "bun:test";
import {
	findSessionLogs,
	findSessionLogsForCwd,
	getLastRenderedMessage,
	resolveSessionLogByAncestorPids,
	resolveSessionLogByCwdScan,
} from "./session-log";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempDirs: string[] = [];

function cleanup() {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}

afterEach(cleanup);

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "plannotator-sessionlog-test-"));
	tempDirs.push(dir);
	return dir;
}

// Helper: write a fake JSONL session log
function writeSessionLog(dir: string, filename: string, entries: object[]): string {
	const path = join(dir, filename);
	const content = entries.map((e) => JSON.stringify(e)).join("\n");
	writeFileSync(path, content);
	return path;
}

describe("findSessionLogs", () => {
	test("returns empty array for non-existent directory", () => {
		expect(findSessionLogs("/nonexistent/dir/abc123")).toEqual([]);
	});

	test("returns empty array for directory with no jsonl files", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "readme.txt"), "hello");
		expect(findSessionLogs(dir)).toEqual([]);
	});

	test("returns jsonl files sorted by mtime (most recent first)", async () => {
		const dir = makeTempDir();
		const file1 = join(dir, "session-aaa.jsonl");
		const file2 = join(dir, "session-bbb.jsonl");

		writeFileSync(file1, '{"type":"user"}');
		// Small delay to ensure different mtime
		await Bun.sleep(50);
		writeFileSync(file2, '{"type":"assistant"}');

		const logs = findSessionLogs(dir);
		expect(logs.length).toBe(2);
		expect(logs[0]).toContain("session-bbb");
		expect(logs[1]).toContain("session-aaa");
	});
});

describe("findSessionLogsForCwd", () => {
	test("returns empty for non-existent project directory", () => {
		const projectsDir = makeTempDir();
		expect(findSessionLogsForCwd("/some/path", projectsDir)).toEqual([]);
	});

	test("finds session logs matching cwd slug", () => {
		const projectsDir = makeTempDir();
		const slug = "-some-path";
		const projectDir = join(projectsDir, slug);
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, "session-1.jsonl"), '{"type":"user"}');

		const logs = findSessionLogsForCwd("/some/path", projectsDir);
		expect(logs.length).toBe(1);
		expect(logs[0]).toContain("session-1.jsonl");
	});

	test("falls back to case-insensitive match", () => {
		const projectsDir = makeTempDir();
		// Create a directory with different casing
		const projectDir = join(projectsDir, "-SOME-PATH");
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, "session-2.jsonl"), '{"type":"user"}');

		const logs = findSessionLogsForCwd("/some/path", projectsDir);
		expect(logs.length).toBe(1);
		expect(logs[0]).toContain("session-2.jsonl");
	});

	test("returns empty when no case-insensitive match found", () => {
		const projectsDir = makeTempDir();
		// Create a directory with unrelated name
		mkdirSync(join(projectsDir, "other-project"), { recursive: true });

		const logs = findSessionLogsForCwd("/some/path", projectsDir);
		expect(logs).toEqual([]);
	});
});

describe("getLastRenderedMessage", () => {
	test("returns null for non-existent file", () => {
		const result = getLastRenderedMessage("/nonexistent/file.jsonl");
		expect(result).toBeNull();
	});

	test("extracts last assistant message from JSONL file", () => {
		const dir = makeTempDir();
		const logPath = writeSessionLog(dir, "test.jsonl", [
			{ type: "user", message: { id: "msg-1", role: "user", content: "hello" } },
			{ type: "assistant", message: { id: "msg-2", role: "assistant", content: [{ type: "text", text: "response" }] } },
		]);

		const result = getLastRenderedMessage(logPath);
		expect(result).not.toBeNull();
		expect(result!.text).toBe("response");
		expect(result!.messageId).toBe("msg-2");
	});

	test("returns null when only user messages exist", () => {
		const dir = makeTempDir();
		const logPath = writeSessionLog(dir, "nousers.jsonl", [
			{ type: "user", message: { id: "msg-1", role: "user", content: "hello" } },
		]);

		const result = getLastRenderedMessage(logPath);
		expect(result).toBeNull();
	});

	test("returns null for empty JSONL", () => {
		const dir = makeTempDir();
		const logPath = join(dir, "empty.jsonl");
		writeFileSync(logPath, "");
		const result = getLastRenderedMessage(logPath);
		expect(result).toBeNull();
	});

	test("handles multi-line streamed assistant message", () => {
		const dir = makeTempDir();
		const logPath = writeSessionLog(dir, "streamed.jsonl", [
			{ type: "user", message: { id: "msg-1", role: "user", content: "go" } },
			{ type: "assistant", message: { id: "msg-2", role: "assistant", content: [{ type: "text", text: "part 1" }] } },
			{ type: "assistant", message: { id: "msg-2", role: "assistant", content: [{ type: "text", text: "part 2" }] } },
		]);

		const result = getLastRenderedMessage(logPath);
		expect(result).not.toBeNull();
		expect(result!.text).toBe("part 1\npart 2");
		expect(result!.messageId).toBe("msg-2");
	});
});

describe("resolveSessionLogByAncestorPids", () => {
	test("returns null when no metadata matches", () => {
		const sessionsDir = makeTempDir();
		const result = resolveSessionLogByAncestorPids({
			startPid: 99999999,
			sessionsDir,
			getParentPid: () => null,
			maxHops: 3,
		});
		expect(result).toBeNull();
	});

	test("returns null when startPid is 0", () => {
		const result = resolveSessionLogByAncestorPids({
			startPid: 0,
			getParentPid: () => null,
		});
		expect(result).toBeNull();
	});
});

describe("resolveSessionLogByCwdScan", () => {
	test("returns null when sessionsDir is empty", () => {
		const sessionsDir = makeTempDir();
		const result = resolveSessionLogByCwdScan({
			cwd: "/test/path",
			sessionsDir,
		});
		expect(result).toBeNull();
	});

	test("returns null when sessionsDir does not exist", () => {
		const result = resolveSessionLogByCwdScan({
			cwd: "/test/path",
			sessionsDir: "/nonexistent/sessions",
		});
		expect(result).toBeNull();
	});

	test("finds session matching cwd", () => {
		const sessionsDir = makeTempDir();
		const projectsDir = makeTempDir();

		// Write session metadata
		const sessionId = "test-session-" + Date.now();
		writeFileSync(join(sessionsDir, "12345.json"), JSON.stringify({
			pid: 12345,
			sessionId,
			cwd: "/test/path",
			startedAt: Date.now(),
		}));

		// Write corresponding JSONL in project dir
		const slug = "-test-path";
		const projectDir = join(projectsDir, slug);
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, `${sessionId}.jsonl`), '{"type":"user"}');

		const result = resolveSessionLogByCwdScan({
			cwd: "/test/path",
			sessionsDir,
			projectsDir,
		});

		expect(result).not.toBeNull();
		expect(result).toContain(sessionId);
	});

	test("skips malformed metadata files", () => {
		const sessionsDir = makeTempDir();
		writeFileSync(join(sessionsDir, "bad.json"), "not-json");

		const result = resolveSessionLogByCwdScan({
			cwd: "/test/path",
			sessionsDir,
		});
		expect(result).toBeNull();
	});
});
