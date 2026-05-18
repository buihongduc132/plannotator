/**
 * Tests for agent job types, state machine, and SSE helpers.
 * Run: bun test packages/shared/agent-jobs.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  isTerminalStatus,
  jobSource,
  serializeAgentSSEEvent,
  AGENT_HEARTBEAT_COMMENT,
  AGENT_HEARTBEAT_INTERVAL_MS,
  type AgentJobStatus,
  type AgentJobEvent,
} from "./agent-jobs";

describe("isTerminalStatus", () => {
  test("done is terminal", () => {
    expect(isTerminalStatus("done")).toBe(true);
  });

  test("failed is terminal", () => {
    expect(isTerminalStatus("failed")).toBe(true);
  });

  test("killed is terminal", () => {
    expect(isTerminalStatus("killed")).toBe(true);
  });

  test("starting is not terminal", () => {
    expect(isTerminalStatus("starting")).toBe(false);
  });

  test("running is not terminal", () => {
    expect(isTerminalStatus("running")).toBe(false);
  });
});

describe("jobSource", () => {
  test("generates source from full UUID", () => {
    const id = "abcdef01-2345-6789-abcd-ef0123456789";
    expect(jobSource(id)).toBe("agent-abcdef01");
  });

  test("generates source from short ID", () => {
    expect(jobSource("12345678")).toBe("agent-12345678");
  });

  test("handles ID shorter than 8 chars", () => {
    expect(jobSource("abc")).toBe("agent-abc");
  });

  test("handles empty string", () => {
    expect(jobSource("")).toBe("agent-");
  });

  test("handles exactly 8 char ID", () => {
    expect(jobSource("12345678")).toBe("agent-12345678");
  });

  test("handles 9 char ID (only first 8 used)", () => {
    expect(jobSource("123456789")).toBe("agent-12345678");
  });
});

describe("serializeAgentSSEEvent", () => {
  test("serializes snapshot event", () => {
    const event: AgentJobEvent = {
      type: "snapshot",
      jobs: [],
    };
    const result = serializeAgentSSEEvent(event);
    expect(result).toMatch(/^data: /);
    expect(result).toMatch(/\n\n$/);
    const parsed = JSON.parse(result.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(parsed.type).toBe("snapshot");
    expect(parsed.jobs).toEqual([]);
  });

  test("serializes job:started event", () => {
    const event: AgentJobEvent = {
      type: "job:started",
      job: {
        id: "test-id",
        source: "agent-test-id",
        provider: "claude",
        label: "Review job",
        status: "starting",
        startedAt: Date.now(),
        command: ["claude", "--print"],
      },
    };
    const result = serializeAgentSSEEvent(event);
    expect(result).toMatch(/^data: /);
    const parsed = JSON.parse(result.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(parsed.type).toBe("job:started");
    expect(parsed.job.id).toBe("test-id");
  });

  test("serializes job:completed event", () => {
    const event: AgentJobEvent = {
      type: "job:completed",
      job: {
        id: "done-id",
        source: "agent-done-id",
        provider: "codex",
        label: "Done job",
        status: "done",
        startedAt: 1000,
        endedAt: 2000,
        exitCode: 0,
        command: ["codex"],
      },
    };
    const result = serializeAgentSSEEvent(event);
    const parsed = JSON.parse(result.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(parsed.type).toBe("job:completed");
    expect(parsed.job.status).toBe("done");
  });

  test("serializes job:log event with delta", () => {
    const event: AgentJobEvent = {
      type: "job:log",
      jobId: "log-id",
      delta: "some output",
    };
    const result = serializeAgentSSEEvent(event);
    const parsed = JSON.parse(result.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(parsed.type).toBe("job:log");
    expect(parsed.jobId).toBe("log-id");
    expect(parsed.delta).toBe("some output");
  });

  test("serializes jobs:cleared event", () => {
    const event: AgentJobEvent = { type: "jobs:cleared" };
    const result = serializeAgentSSEEvent(event);
    const parsed = JSON.parse(result.replace(/^data: /, "").replace(/\n\n$/, ""));
    expect(parsed.type).toBe("jobs:cleared");
  });

  test("ends with double newline", () => {
    const event: AgentJobEvent = { type: "jobs:cleared" };
    const result = serializeAgentSSEEvent(event);
    expect(result.endsWith("\n\n")).toBe(true);
  });
});

describe("constants", () => {
  test("AGENT_HEARTBEAT_COMMENT is SSE comment format", () => {
    expect(AGENT_HEARTBEAT_COMMENT).toBe(":\n\n");
  });

  test("AGENT_HEARTBEAT_INTERVAL_MS is 30 seconds", () => {
    expect(AGENT_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });
});
