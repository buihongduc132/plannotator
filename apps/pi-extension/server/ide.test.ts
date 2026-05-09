import { describe, expect, test, mock, afterEach } from "bun:test";

// Use mock.module to intercept spawn
let mockSpawnImpl: ((...args: unknown[]) => any) | null = null;

mock.module("node:child_process", () => {
	const actual = require("node:child_process");
	return {
		...actual,
		spawn: (...args: unknown[]) => {
			if (mockSpawnImpl) return mockSpawnImpl(...args);
			return actual.spawn(...args as [any, ...any[]]);
		},
	};
});

const { openEditorDiff } = require("./ide");

afterEach(() => {
	mockSpawnImpl = null;
});

describe("ide — openEditorDiff", () => {
	test("returns ok:true when code --diff succeeds", async () => {
		mockSpawnImpl = () => ({
			stderr: { on: () => {} },
			on: (event: string, fn: Function) => {
				if (event === "close") queueMicrotask(() => fn(0));
			},
		});
		const result = await openEditorDiff("/tmp/old.md", "/tmp/new.md");
		expect(result).toEqual({ ok: true });
	});

	test("returns error for ENOENT (VS Code not found)", async () => {
		mockSpawnImpl = () => ({
			stderr: { on: () => {} },
			on: (event: string, fn: Function) => {
				if (event === "error") queueMicrotask(() => fn(new Error("spawn code ENOENT")));
			},
		});
		const result = await openEditorDiff("/tmp/old.md", "/tmp/new.md");
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toContain("VS Code CLI not found");
	});

	test("returns error for non-zero exit code", async () => {
		mockSpawnImpl = () => ({
			stderr: { on: () => {} },
			on: (event: string, fn: Function) => {
				if (event === "close") queueMicrotask(() => fn(1));
			},
		});
		const result = await openEditorDiff("/tmp/old.md", "/tmp/new.md");
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toContain("exited with");
	});

	test("returns error for generic spawn error", async () => {
		mockSpawnImpl = () => ({
			stderr: { on: () => {} },
			on: (event: string, fn: Function) => {
				if (event === "error") queueMicrotask(() => fn(new Error("permission denied")));
			},
		});
		const result = await openEditorDiff("/tmp/old.md", "/tmp/new.md");
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toContain("permission denied");
	});

	test("returns error for stderr containing 'not found'", async () => {
		mockSpawnImpl = () => ({
			stderr: {
				on: (_: string, fn: Function) => queueMicrotask(() => fn(Buffer.from("command not found"))),
			},
			on: (event: string, fn: Function) => {
				if (event === "close") queueMicrotask(() => fn(1));
			},
		});
		const result = await openEditorDiff("/tmp/old.md", "/tmp/new.md");
		expect("error" in result).toBe(true);
		if ("error" in result) expect(result.error).toContain("VS Code CLI not found");
	});
});
