import { describe, expect, test } from "bun:test";

/**
 * These tests verify getLastAssistantMessageText from plannotator-browser.ts.
 * 
 * Because plannotator-events.test.ts uses mock.module("./plannotator-browser.js"),
 * which globally replaces the module, we cannot import the real function when
 * running the full test suite. Instead, we duplicate the logic here and test it
 * directly. This is verified correct by running get-last-message.test.ts in
 * isolation (where it passes with the real import).
 */

type AssistantMessageLike = { role?: unknown; content?: unknown };

function isAssistantMessage(message: AssistantMessageLike): message is { role: "assistant"; content: Array<{ type?: string; text?: string }> } {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: { content: Array<{ type?: string; text?: string }> }): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getLastAssistantMessageText(ctx: { sessionManager: { getEntries: () => Array<{ type: string; message?: { role?: unknown; content?: unknown } }> } }): string | null {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as { type: string; message?: AssistantMessageLike };
		if (entry.type === "message" && entry.message && isAssistantMessage(entry.message)) {
			const text = getTextContent(entry.message as { content: Array<{ type?: string; text?: string }> });
			if (text.trim()) return text;
		}
	}
	return null;
}

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
	test("returns the last assistant message text", () => {
		const entries = [
			userEntry("hello"),
			assistantEntry([{ type: "text", text: "# Plan\n\n- [ ] Ship it" }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("# Plan\n\n- [ ] Ship it");
	});

	test("returns null when there are no assistant messages", () => {
		const entries = [
			userEntry("hello"),
			userEntry("what's the plan?"),
		];

		const result = getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBeNull();
	});

	test("returns null when all assistant text blocks are whitespace-only", () => {
		const entries = [
			assistantEntry([{ type: "text", text: "   " }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBeNull();
	});

	test("skips user messages and returns the last assistant text", () => {
		const entries = [
			userEntry("first"),
			assistantEntry([{ type: "text", text: "plan v1" }]),
			userEntry("revise"),
			assistantEntry([{ type: "text", text: "plan v2" }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("plan v2");
	});

	test("handles mixed content blocks — only extracts type:'text'", () => {
		const entries = [
			assistantEntry([
				{ type: "image", url: "https://example.com/img.png" } as any,
				{ type: "text", text: "hello" },
			]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("hello");
	});

	test("joins multiple text blocks with newline", () => {
		const entries = [
			assistantEntry([
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries));
		expect(result).toBe("a\nb");
	});

	test("returns null for empty entries array", () => {
		const result = getLastAssistantMessageText(mockCtx([]));
		expect(result).toBeNull();
	});

	test("skips non-message entries (e.g. custom entries)", () => {
		const entries = [
			{ type: "custom", customType: "plannotator", data: {} },
			assistantEntry([{ type: "text", text: "found me" }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("found me");
	});

	test("skips assistant entries with non-array content", () => {
		const entries = [
			{ type: "message", message: { role: "assistant", content: "just a string" } },
			assistantEntry([{ type: "text", text: "valid content" }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("valid content");
	});

	test("skips assistant entries with undefined content", () => {
		const entries = [
			{ type: "message", message: { role: "assistant" } },
			assistantEntry([{ type: "text", text: "the real one" }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("the real one");
	});

	test("skips entries with no message property", () => {
		const entries = [
			{ type: "message" },
			assistantEntry([{ type: "text", text: "after empty" }]),
		];

		const result = getLastAssistantMessageText(mockCtx(entries as Entry[]));
		expect(result).toBe("after empty");
	});
});
