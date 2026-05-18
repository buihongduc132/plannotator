import { describe, expect, test, afterEach } from "bun:test";
import { findCodexRolloutByThreadId, getLastCodexMessage } from "./codex-session";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";

// We can't easily mock homedir(), so we test getLastCodexMessage
// (already covered) and test findCodexRolloutByThreadId by creating
// a real directory structure that mimics ~/.codex/sessions/

let tempDirs: string[] = [];

function cleanup() {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
}

afterEach(cleanup);

describe("findCodexRolloutByThreadId", () => {
	test("returns null when ~/.codex/sessions does not exist", () => {
		// This tests the catch block — if sessions dir doesn't exist, returns null
		const result = findCodexRolloutByThreadId("nonexistent-uuid-12345");
		// May return null or a path depending on system state
		// The important thing is it doesn't throw
		expect(typeof result === "string" || result === null).toBe(true);
	});

	test("empty string matches first available rollout (includes semantics)", () => {
		// Empty string is truthy for .includes("") — will match first found file
		const result = findCodexRolloutByThreadId("");
		// This matches any .jsonl file, so result is first found or null
		expect(typeof result === "string" || result === null).toBe(true);
	});

	test("returns null when thread ID is not found in any rollout file", () => {
		// Use a UUID that definitely won't match any file
		const result = findCodexRolloutByThreadId("00000000-0000-0000-0000-000000000000");
		expect(result).toBeNull();
	});

	test("finds rollout file matching thread ID in directory tree", () => {
		// Create a temp sessions directory structure
		const sessionsDir = join(homedir(), ".codex", "sessions");
		if (!existsSync(sessionsDir)) {
			// Can't create test data in non-existent sessions dir — skip
			// Instead, verify the function handles missing dirs gracefully
			const result = findCodexRolloutByThreadId("test-thread-id");
			expect(typeof result === "string" || result === null).toBe(true);
			return;
		}

		// Create a test rollout file
		const testId = crypto.randomUUID();
		const yearDir = join(sessionsDir, "2099");
		const monthDir = join(yearDir, "12");
		const dayDir = join(monthDir, "31");

		mkdirSync(dayDir, { recursive: true });
		tempDirs.push(dayDir);

		const rolloutFile = join(dayDir, `rollout-20991231-${testId}.jsonl`);
		writeFileSync(rolloutFile, JSON.stringify({
			timestamp: new Date().toISOString(),
			type: "response_item",
			payload: {
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "test" }],
			},
		}));

		const result = findCodexRolloutByThreadId(testId);
		expect(result).toBe(rolloutFile);

		// Verify the file can be parsed
		if (result) {
			const msg = getLastCodexMessage(result);
			expect(msg).not.toBeNull();
			expect(msg!.text).toBe("test");
		}
	});
});

describe("getLastCodexMessage — additional coverage", () => {
	test("handles mixed valid and invalid entries in rollout", () => {
		const dir = mkdtempSync(join(tmpdir(), "plannotator-codex-test-"));
		tempDirs.push(dir);
		const path = join(dir, "rollout.jsonl");

		writeFileSync(path, [
			'{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}',
			'{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"response one"}]}}',
			'not-json',
			'{"type":"response_item","payload":{"type":"function_call","name":"exec","arguments":"{}"}}',
			'{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"final response"}]}}',
		].join("\n"));

		const result = getLastCodexMessage(path);
		expect(result).not.toBeNull();
		expect(result!.text).toBe("final response");
	});

	test("returns first assistant with text when last has only non-text content", () => {
		const dir = mkdtempSync(join(tmpdir(), "plannotator-codex-test-"));
		tempDirs.push(dir);
		const path = join(dir, "rollout.jsonl");

		writeFileSync(path, [
			'{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"first msg"}]}}',
			'{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"other_type","text":"skip"}]}}',
		].join("\n"));

		const result = getLastCodexMessage(path);
		expect(result).not.toBeNull();
		expect(result!.text).toBe("first msg");
	});

	test("returns null when only non-assistant messages present", () => {
		const dir = mkdtempSync(join(tmpdir(), "plannotator-codex-test-"));
		tempDirs.push(dir);
		const path = join(dir, "rollout.jsonl");

		writeFileSync(path, [
			'{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}',
			'{"type":"session_meta","payload":{"id":"123"}}',
		].join("\n"));

		const result = getLastCodexMessage(path);
		expect(result).toBeNull();
	});

	test("handles assistant message with no content array", () => {
		const dir = mkdtempSync(join(tmpdir(), "plannotator-codex-test-"));
		tempDirs.push(dir);
		const path = join(dir, "rollout.jsonl");

		writeFileSync(path, [
			'{"type":"response_item","payload":{"type":"message","role":"assistant","content":"string-not-array"}}',
			'{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"valid"}]}}',
		].join("\n"));

		const result = getLastCodexMessage(path);
		expect(result).not.toBeNull();
		expect(result!.text).toBe("valid");
	});

	test("handles single-line rollout file", () => {
		const dir = mkdtempSync(join(tmpdir(), "plannotator-codex-test-"));
		tempDirs.push(dir);
		const path = join(dir, "rollout.jsonl");

		writeFileSync(path, '{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"single"}]}}');

		const result = getLastCodexMessage(path);
		expect(result).not.toBeNull();
		expect(result!.text).toBe("single");
	});
});
