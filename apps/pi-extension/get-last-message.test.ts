import { describe, expect, test } from "bun:test";
import { getLastAssistantMessageText } from "./plannotator-browser.js";

/**
 * Helpers to build typed session entries for mocking ctx.sessionManager.getEntries().
 * Mirrors the internal shape the function casts to:
 *   { type: string; message?: { role?: unknown; content?: unknown } }
 */

type Entry = { type: string; message?: { role?: unknown; content?: unknown } };

function assistantEntry(content: Array<{ type?: string; text?: string }>): Entry {
	return { type: "message", message: { role: "assistant", content } };
}

function userEntry(text: string): Entry {
	return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}

function mockCtx(entries: Entry[]) {
	return { sessionManager: { getEntries: () => entries } } as any;
}

describe("getLastAssistantMessageText", () => {
	test("returns the last assistant message text", async () => {
		const entries = [
			userEntry("hello"),
			assistantEntry([{ type: "text", text: "# Plan\n\n- [ ] Ship it" }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("# Plan\n\n- [ ] Ship it");
	});

	test("returns null when there are no assistant messages", async () => {
		const entries = [
			userEntry("hello"),
			userEntry("what's the plan?"),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBeNull();
	});

	test("returns null when all assistant text blocks are whitespace-only", async () => {
		const entries = [
			assistantEntry([{ type: "text", text: "   " }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBeNull();
	});

	test("skips user messages and returns the last assistant text", async () => {
		const entries = [
			userEntry("first"),
			assistantEntry([{ type: "text", text: "plan v1" }]),
			userEntry("revise"),
			assistantEntry([{ type: "text", text: "plan v2" }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("plan v2");
	});

	test("handles mixed content blocks — only extracts type:'text'", async () => {
		const entries = [
			assistantEntry([
				{ type: "image", url: "https://example.com/img.png" } as any,
				{ type: "text", text: "hello" },
			]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("hello");
	});

	test("joins multiple text blocks with newline", async () => {
		const entries = [
			assistantEntry([
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("a\nb");
	});

	test("returns null for empty entries array", async () => {
		const result = await getLastAssistantMessageText(mockCtx([]));
		expect(result).toBeNull();
	});

	test("skips non-message entries (e.g. custom entries)", async () => {
		const entries = [
			{ type: "custom", customType: "plannotator", data: {} },
			assistantEntry([{ type: "text", text: "found me" }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("found me");
	});

	test("skips assistant entries with non-array content", async () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "just a string" } },
			assistantEntry([{ type: "text", text: "valid content" }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("valid content");
	});

	test("skips assistant entries with undefined content", async () => {
		const entries = [
			{ type: "message", message: { role: "assistant" } },
			assistantEntry([{ type: "text", text: "the real one" }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("the real one");
	});

	test("skips entries with no message property", async () => {
		const entries = [
			{ type: "message" },
			assistantEntry([{ type: "text", text: "after empty" }]),
		];

		const result = await getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("after empty");
	});
});
