/**
 * Tests for packages/server/claude-review.ts
 *
 * Tests the pure functions: buildClaudeCommand, parseClaudeStreamOutput,
 * transformClaudeFindings, formatClaudeLogEvent.
 *
 * Run: bun test packages/server/claude-review.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  CLAUDE_REVIEW_SCHEMA_JSON,
  CLAUDE_REVIEW_PROMPT,
  buildClaudeCommand,
  parseClaudeStreamOutput,
  transformClaudeFindings,
  formatClaudeLogEvent,
  type ClaudeFinding,
  type ClaudeReviewOutput,
} from "./claude-review";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("CLAUDE_REVIEW_SCHEMA_JSON", () => {
  test("is valid JSON", () => {
    expect(() => JSON.parse(CLAUDE_REVIEW_SCHEMA_JSON)).not.toThrow();
  });

  test("requires findings and summary", () => {
    const schema = JSON.parse(CLAUDE_REVIEW_SCHEMA_JSON);
    expect(schema.required).toContain("findings");
    expect(schema.required).toContain("summary");
  });

  test("findings have severity enum", () => {
    const schema = JSON.parse(CLAUDE_REVIEW_SCHEMA_JSON);
    const severityProp = schema.properties.findings.items.properties.severity;
    expect(severityProp.enum).toEqual(["important", "nit", "pre_existing"]);
  });
});

describe("CLAUDE_REVIEW_PROMPT", () => {
  test("is a non-empty string", () => {
    expect(CLAUDE_REVIEW_PROMPT.length).toBeGreaterThan(100);
  });

  test("mentions structured JSON output", () => {
    expect(CLAUDE_REVIEW_PROMPT).toContain("structured JSON");
  });
});

// ---------------------------------------------------------------------------
// buildClaudeCommand
// ---------------------------------------------------------------------------

describe("buildClaudeCommand", () => {
  test("returns command array with claude -p", () => {
    const result = buildClaudeCommand("review the code");
    expect(result.command[0]).toBe("claude");
    expect(result.command[1]).toBe("-p");
    expect(result.command).toContain("--permission-mode");
    expect(result.command).toContain("dontAsk");
    expect(result.command).toContain("--output-format");
    expect(result.command).toContain("stream-json");
  });

  test("passes prompt as stdinPrompt", () => {
    const result = buildClaudeCommand("my review prompt");
    expect(result.stdinPrompt).toBe("my review prompt");
  });

  test("defaults to claude-opus-4-7 model", () => {
    const result = buildClaudeCommand("prompt");
    const modelIdx = result.command.indexOf("--model");
    expect(modelIdx).toBeGreaterThan(-1);
    expect(result.command[modelIdx + 1]).toBe("claude-opus-4-7");
  });

  test("uses custom model when provided", () => {
    const result = buildClaudeCommand("prompt", "claude-sonnet-4");
    const modelIdx = result.command.indexOf("--model");
    expect(result.command[modelIdx + 1]).toBe("claude-sonnet-4");
  });

  test("includes effort flag when provided", () => {
    const result = buildClaudeCommand("prompt", "claude-opus-4-7", "high");
    expect(result.command).toContain("--effort");
    const effortIdx = result.command.indexOf("--effort");
    expect(result.command[effortIdx + 1]).toBe("high");
  });

  test("omits effort flag when not provided", () => {
    const result = buildClaudeCommand("prompt");
    expect(result.command).not.toContain("--effort");
  });

  test("includes json-schema with valid JSON", () => {
    const result = buildClaudeCommand("prompt");
    const schemaIdx = result.command.indexOf("--json-schema");
    expect(schemaIdx).toBeGreaterThan(-1);
    const schemaStr = result.command[schemaIdx + 1];
    expect(() => JSON.parse(schemaStr)).not.toThrow();
  });

  test("includes allowed tools", () => {
    const result = buildClaudeCommand("prompt");
    const allowedIdx = result.command.indexOf("--allowedTools");
    expect(allowedIdx).toBeGreaterThan(-1);
    const tools = result.command[allowedIdx + 1];
    expect(tools).toContain("Agent");
    expect(tools).toContain("Read");
    expect(tools).toContain("Bash(gh pr diff:*)");
  });

  test("includes disallowed tools", () => {
    const result = buildClaudeCommand("prompt");
    const disallowedIdx = result.command.indexOf("--disallowedTools");
    expect(disallowedIdx).toBeGreaterThan(-1);
    const tools = result.command[disallowedIdx + 1];
    expect(tools).toContain("Edit");
    expect(tools).toContain("Write");
    expect(tools).toContain("Bash(curl:*)");
  });

  test("includes no-session-persistence", () => {
    const result = buildClaudeCommand("prompt");
    expect(result.command).toContain("--no-session-persistence");
  });
});

// ---------------------------------------------------------------------------
// parseClaudeStreamOutput
// ---------------------------------------------------------------------------

describe("parseClaudeStreamOutput", () => {
  test("returns null for empty string", () => {
    expect(parseClaudeStreamOutput("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(parseClaudeStreamOutput("   \n  ")).toBeNull();
  });

  test("returns null when no result event found", () => {
    const input = JSON.stringify({ type: "assistant", message: "hello" });
    expect(parseClaudeStreamOutput(input)).toBeNull();
  });

  test("returns null for error result", () => {
    const input = JSON.stringify({ type: "result", is_error: true });
    expect(parseClaudeStreamOutput(input)).toBeNull();
  });

  test("returns null when structured_output missing", () => {
    const input = JSON.stringify({ type: "result", is_error: false });
    expect(parseClaudeStreamOutput(input)).toBeNull();
  });

  test("returns null when findings is not an array", () => {
    const input = JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: { findings: "not-array" },
    });
    expect(parseClaudeStreamOutput(input)).toBeNull();
  });

  test("parses valid result event", () => {
    const output: ClaudeReviewOutput = {
      findings: [
        {
          severity: "important",
          file: "src/main.ts",
          line: 10,
          end_line: 15,
          description: "Bug found",
          reasoning: "Trace shows null pointer",
        },
      ],
      summary: { important: 1, nit: 0, pre_existing: 0 },
    };
    const input = JSON.stringify({ type: "result", is_error: false, structured_output: output });
    const result = parseClaudeStreamOutput(input);

    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(1);
    expect(result!.findings[0].severity).toBe("important");
    expect(result!.findings[0].file).toBe("src/main.ts");
    expect(result!.summary.important).toBe(1);
  });

  test("finds result event among multiple JSONL lines", () => {
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: "thinking..." } }),
      JSON.stringify({ type: "tool_use", name: "Read" }),
      JSON.stringify({
        type: "result",
        is_error: false,
        structured_output: {
          findings: [],
          summary: { important: 0, nit: 0, pre_existing: 0 },
        },
      }),
    ];
    const result = parseClaudeStreamOutput(lines.join("\n"));
    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(0);
  });

  test("skips invalid JSON lines", () => {
    const lines = [
      "not valid json",
      JSON.stringify({
        type: "result",
        is_error: false,
        structured_output: {
          findings: [],
          summary: { important: 0, nit: 0, pre_existing: 0 },
        },
      }),
    ];
    const result = parseClaudeStreamOutput(lines.join("\n"));
    expect(result).not.toBeNull();
  });

  test("handles empty findings", () => {
    const input = JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: {
        findings: [],
        summary: { important: 0, nit: 0, pre_existing: 0 },
      },
    });
    const result = parseClaudeStreamOutput(input);
    expect(result!.findings).toEqual([]);
  });

  test("handles multiple findings with different severities", () => {
    const input = JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: {
        findings: [
          { severity: "important", file: "a.ts", line: 1, end_line: 2, description: "d1", reasoning: "r1" },
          { severity: "nit", file: "b.ts", line: 3, end_line: 4, description: "d2", reasoning: "r2" },
          { severity: "pre_existing", file: "c.ts", line: 5, end_line: 6, description: "d3", reasoning: "r3" },
        ],
        summary: { important: 1, nit: 1, pre_existing: 1 },
      },
    });
    const result = parseClaudeStreamOutput(input);
    expect(result!.findings).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// transformClaudeFindings
// ---------------------------------------------------------------------------

describe("transformClaudeFindings", () => {
  const findings: ClaudeFinding[] = [
    {
      severity: "important",
      file: "/home/user/project/src/main.ts",
      line: 10,
      end_line: 15,
      description: "Null pointer dereference",
      reasoning: "Variable can be null at this point",
    },
    {
      severity: "nit",
      file: "/home/user/project/src/util.ts",
      line: 5,
      end_line: 5,
      description: "Naming convention",
      reasoning: "Use camelCase",
    },
  ];

  test("transforms findings to annotation format", () => {
    const annotations = transformClaudeFindings(findings, "claude-code");
    expect(annotations).toHaveLength(2);

    expect(annotations[0].source).toBe("claude-code");
    expect(annotations[0].filePath).toContain("src/main.ts");
    expect(annotations[0].lineStart).toBe(10);
    expect(annotations[0].lineEnd).toBe(15);
    expect(annotations[0].type).toBe("comment");
    expect(annotations[0].side).toBe("new");
    expect(annotations[0].severity).toBe("important");
    expect(annotations[0].text).toContain("[important]");
    expect(annotations[0].text).toContain("Null pointer dereference");
    expect(annotations[0].reasoning).toBe("Variable can be null at this point");
    expect(annotations[0].author).toBe("Claude Code");
  });

  test("applies cwd relativization", () => {
    const annotations = transformClaudeFindings(
      findings,
      "claude-code",
      "/home/user/project",
    );
    expect(annotations[0].filePath).toBe("src/main.ts");
  });

  test("filters out findings without file path", () => {
    const noFileFindings: ClaudeFinding[] = [
      {
        severity: "important",
        file: "",
        line: 1,
        end_line: 2,
        description: "No file",
        reasoning: "test",
      },
    ];
    const annotations = transformClaudeFindings(noFileFindings, "claude-code");
    expect(annotations).toHaveLength(0);
  });

  test("uses end_line fallback to line when missing", () => {
    const finding: ClaudeFinding = {
      severity: "nit",
      file: "test.ts",
      line: 5,
      end_line: undefined as any,
      description: "test",
      reasoning: "test",
    };
    const annotations = transformClaudeFindings([finding], "src");
    // end_line is undefined so the ?? f.line kicks in
    expect(annotations[0].lineEnd).toBe(5);
  });

  test("returns empty array for empty findings", () => {
    const annotations = transformClaudeFindings([], "claude-code");
    expect(annotations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// formatClaudeLogEvent
// ---------------------------------------------------------------------------

describe("formatClaudeLogEvent", () => {
  test("returns null for empty string", () => {
    expect(formatClaudeLogEvent("")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(formatClaudeLogEvent("not json")).toBeNull();
  });

  test("returns null for result event", () => {
    const line = JSON.stringify({ type: "result" });
    expect(formatClaudeLogEvent(line)).toBeNull();
  });

  test("extracts text from assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Analyzing the code..." }],
      },
    });
    expect(formatClaudeLogEvent(line)).toBe("Analyzing the code...");
  });

  test("joins multiple text parts", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: "Part 2" },
        ],
      },
    });
    expect(formatClaudeLogEvent(line)).toBe("Part 1\nPart 2");
  });

  test("shows tool use events when no text parts", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Read", input: "/path/to/file.ts" },
        ],
      },
    });
    const result = formatClaudeLogEvent(line);
    expect(result).toContain("[Read]");
    expect(result).toContain("/path/to/file.ts");
  });

  test("returns null for events with no useful content", () => {
    const line = JSON.stringify({ type: "system" });
    expect(formatClaudeLogEvent(line)).toBeNull();
  });

  test("handles tool_use with object input", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Grep", input: { pattern: "TODO" } },
        ],
      },
    });
    const result = formatClaudeLogEvent(line);
    expect(result).toContain("[Grep]");
    expect(result).toContain("TODO");
  });

  test("truncates long tool input to 100 chars", () => {
    const longInput = "x".repeat(200);
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: longInput },
        ],
      },
    });
    const result = formatClaudeLogEvent(line);
    expect(result!.length).toBeLessThan(200);
  });
});
