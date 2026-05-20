/**
 * Command Parity Test
 *
 * Ensures every user-facing command/feature is available on all three
 * platforms: Pi extension, Claude CLI (hook server), and OpenCode plugin.
 *
 * Extracts commands from source files, maps to canonical feature names,
 * takes the UNION, and fails if any platform is missing a feature that
 * the other two have.
 *
 * Platform-specific commands (e.g. copilot-plan, sessions, plannotator-status)
 * are excluded — only features that SHOULD exist on all three are checked.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "../..");

const PI_INDEX = join(ROOT, "apps/pi-extension/index.ts");
const CLAUDE_CLI = join(ROOT, "apps/hook/server/index.ts");
const CLAUDE_CLI_HELP = join(ROOT, "apps/hook/server/cli.ts");
const OPENCODE_INDEX = join(ROOT, "apps/opencode-plugin/index.ts");
const OPENCODE_COMMANDS = join(ROOT, "apps/opencode-plugin/commands.ts");

// ── Canonical features ──────────────────────────────────────────────────
//
// Each entry maps a canonical feature name to the name it uses on each
// platform. This is the source of truth: if a feature exists on ANY
// platform, it must be listed here and present on ALL platforms.

type PlatformNames = {
  pi: string;
  claude: string;
  opencode: string;
};

const SHARED_FEATURES: Record<string, PlatformNames> = {
  review: {
    pi: "plannotator-review",
    claude: "review",
    opencode: "plannotator-review",
  },
  annotate: {
    pi: "plannotator-annotate",
    claude: "annotate",
    opencode: "plannotator-annotate",
  },
  "annotate-last": {
    pi: "plannotator-last",
    claude: "last",
    opencode: "plannotator-last",
  },
  "plan-review-last-message": {
    pi: "plannotator-last-message",
    claude: "last-message",
    opencode: "plannotator-last-message",
  },
  archive: {
    pi: "plannotator-archive",
    claude: "archive",
    opencode: "plannotator-archive",
  },
};

// ── Source extraction ────────────────────────────────────────────────────

function extractPiCommands(filePath: string): Set<string> {
  const src = readFileSync(filePath, "utf-8");
  const commands = new Set<string>();
  const re = /pi\.registerCommand\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    commands.add(m[1]);
  }
  return commands;
}

function extractPiTools(filePath: string): Set<string> {
  const src = readFileSync(filePath, "utf-8");
  const tools = new Set<string>();
  const re = /pi\.registerTool\(\s*\{[^}]*?name:\s*["']?(\w+)["']?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    tools.add(m[1]);
  }
  // Also check for named constant references: name: PLAN_SUBMIT_TOOL
  const constRe = /pi\.registerTool\(\s*\{[^}]*?name:\s*(\w+)/g;
  while ((m = constRe.exec(src)) !== null) {
    if (m[1] !== "name") tools.add(m[1]);
  }
  return tools;
}

function extractClaudeSubcommands(filePath: string): Set<string> {
  const src = readFileSync(filePath, "utf-8");
  const subcommands = new Set<string>();
  // Match: args[0] === "subcommand"
  const re = /args\[0\]\s*===\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    subcommands.add(m[1]);
  }
  return subcommands;
}

function extractClaudeHelpSubcommands(filePath: string): Set<string> {
  const src = readFileSync(filePath, "utf-8");
  const subcommands = new Set<string>();
  // Match: "  plannotator <subcommand>" lines in help text
  const re = /plannotator\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // Strip trailing punctuation and quotes from template literal captures
    const cmd = m[1].replace(/[[\]<>"',\\]+$/g, "").replace(/^[[\]<>"',]+/g, "");
    if (cmd && !cmd.startsWith("-") && !cmd.startsWith("(") && cmd !== "|" && !cmd.includes("$")) {
      subcommands.add(cmd);
    }
  }
  return subcommands;
}

function extractOpenCodeCommands(indexPath: string): Set<string> {
  const src = readFileSync(indexPath, "utf-8");
  const commands = new Set<string>();
  // Match: cmd !== "plannotator-xxx" (in command.execute.before)
  const re = /cmd\s*!==\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    commands.add(m[1]);
  }
  // Also match: cmd === "plannotator-xxx"
  const re2 = /cmd\s*===\s*["']([^"']+)["']/g;
  while ((m = re2.exec(src)) !== null) {
    commands.add(m[1]);
  }
  return commands;
}

function extractOpenCodeCommandHandlers(commandsPath: string): Set<string> {
  const src = readFileSync(commandsPath, "utf-8");
  const handlers = new Set<string>();
  // Match exported async function names: handleReviewCommand, handleAnnotateCommand, etc.
  const re = /export\s+async\s+function\s+(handle\w+Command)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    handlers.add(m[1]);
  }
  return handlers;
}

function extractOpenCodeTools(indexPath: string): Set<string> {
  const src = readFileSync(indexPath, "utf-8");
  const tools = new Set<string>();
  // Match: submit_plan: tool({ in plugin.tool block
  const re = /(\w+):\s*tool\(\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    tools.add(m[1]);
  }
  return tools;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("command parity: Pi ↔ Claude CLI ↔ OpenCode", () => {
  const piCommands = extractPiCommands(PI_INDEX);
  const claudeSubcommands = extractClaudeSubcommands(CLAUDE_CLI);
  const claudeHelpSubcommands = extractClaudeHelpSubcommands(CLAUDE_CLI_HELP);
  const openCodeCommands = extractOpenCodeCommands(OPENCODE_INDEX);

  test("Pi has all shared features", () => {
    const missing: string[] = [];
    for (const [feature, names] of Object.entries(SHARED_FEATURES)) {
      if (!piCommands.has(names.pi)) {
        missing.push(`${feature} (expected: pi.registerCommand("${names.pi}"))`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("Claude CLI has all shared features", () => {
    const missing: string[] = [];
    for (const [feature, names] of Object.entries(SHARED_FEATURES)) {
      if (!claudeSubcommands.has(names.claude)) {
        missing.push(`${feature} (expected: args[0] === "${names.claude}" in hook/server/index.ts)`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("Claude CLI help text lists all shared features", () => {
    const missing: string[] = [];
    for (const [feature, names] of Object.entries(SHARED_FEATURES)) {
      if (!claudeHelpSubcommands.has(names.claude)) {
        missing.push(`${feature} (expected "plannotator ${names.claude}" in help text)`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("OpenCode has all shared features", () => {
    const missing: string[] = [];
    for (const [feature, names] of Object.entries(SHARED_FEATURES)) {
      if (!openCodeCommands.has(names.opencode)) {
        missing.push(`${feature} (expected: cmd === "${names.opencode}" in opencode-plugin/index.ts)`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("no platform introduces a command without the others catching up", () => {
    const piCanonical = new Map<string, string>();
    const claudeCanonical = new Map<string, string>();
    const openCodeCanonical = new Map<string, string>();

    for (const [feature, names] of Object.entries(SHARED_FEATURES)) {
      piCanonical.set(names.pi, feature);
      claudeCanonical.set(names.claude, feature);
      openCodeCanonical.set(names.opencode, feature);
    }

    const coveredPi = new Set(piCanonical.keys());
    const coveredClaude = new Set(claudeCanonical.keys());
    const coveredOpenCode = new Set(openCodeCanonical.keys());

    const piOnly = [...piCommands].filter(c => !coveredPi.has(c));
    const claudeOnly = [...claudeSubcommands].filter(c => !coveredClaude.has(c));
    const ocOnly = [...openCodeCommands].filter(c => !coveredOpenCode.has(c));

    // Platform-specific commands that are intentionally NOT shared.
    // Add to these sets when a command truly only makes sense on one platform.
    const PI_ONLY_ALLOWED = new Set([
      "plannotator",        // Toggle plan mode (TUI state machine)
      "plannotator-status", // TUI status display
    ]);
    const CLAUDE_ONLY_ALLOWED = new Set([
      "sessions",        // CLI session listing
      "setup-goal",      // Goal setup wizard
      "copilot-plan",    // Copilot CLI interception
      "copilot-last",    // Copilot CLI last message
      "improve-context", // Hook context injection
      "annotate-last",   // Alias for "last" (both handled by same branch)
    ]);
    const OPENCODE_ONLY_ALLOWED = new Set<string>([
      // None currently — all OpenCode commands should be shared
    ]);

    const unexpectedPi = piOnly.filter(c => !PI_ONLY_ALLOWED.has(c));
    const unexpectedClaude = claudeOnly.filter(c => !CLAUDE_ONLY_ALLOWED.has(c));
    const unexpectedOC = ocOnly.filter(c => !OPENCODE_ONLY_ALLOWED.has(c));

    const errors: string[] = [];
    if (unexpectedPi.length > 0) {
      errors.push(
        `Pi has commands not in SHARED_FEATURES or PI_ONLY_ALLOWED: ${unexpectedPi.join(", ")}. ` +
        `Either add them to SHARED_FEATURES (if they should exist on all platforms) or PI_ONLY_ALLOWED.`
      );
    }
    if (unexpectedClaude.length > 0) {
      errors.push(
        `Claude CLI has subcommands not in SHARED_FEATURES or CLAUDE_ONLY_ALLOWED: ${unexpectedClaude.join(", ")}. ` +
        `Either add them to SHARED_FEATURES (if they should exist on all platforms) or CLAUDE_ONLY_ALLOWED.`
      );
    }
    if (unexpectedOC.length > 0) {
      errors.push(
        `OpenCode has commands not in SHARED_FEATURES or OPENCODE_ONLY_ALLOWED: ${unexpectedOC.join(", ")}. ` +
        `Either add them to SHARED_FEATURES (if they should exist on all platforms) or OPENCODE_ONLY_ALLOWED.`
      );
    }

    if (errors.length > 0) {
      throw new Error(`Unaccounted commands detected:\n\n${errors.join("\n\n")}`);
    }
  });
});

describe("tool parity: Pi ↔ OpenCode", () => {
  // Pi and OpenCode both register "submit plan" as a tool.
  // Claude CLI gets plan submission via the default stdin hook handler.
  // We verify the tool exists on both Pi and OpenCode.

  const piTools = extractPiTools(PI_INDEX);
  const openCodeTools = extractOpenCodeTools(OPENCODE_INDEX);

  test("Pi registers a plan submission tool", () => {
    // Pi uses a constant PLAN_SUBMIT_TOOL — check the tool block exists
    const src = readFileSync(PI_INDEX, "utf-8");
    expect(src).toContain("pi.registerTool(");
    expect(src).toContain("PLAN_SUBMIT_TOOL");
  });

  test("OpenCode registers submit_plan tool", () => {
    expect(openCodeTools.has("submit_plan")).toBe(true);
  });
});

describe("handler coverage: OpenCode commands.ts exports match command.execute.before", () => {
  const handlers = extractOpenCodeCommandHandlers(OPENCODE_COMMANDS);
  const commands = extractOpenCodeCommands(OPENCODE_INDEX);

  // Map handler names to command names
  const HANDLER_TO_COMMAND: Record<string, string> = {
    handleReviewCommand: "plannotator-review",
    handleAnnotateCommand: "plannotator-annotate",
    handleAnnotateLastCommand: "plannotator-last",
    handleLastMessagePlanReviewCommand: "plannotator-last-message",
    handleArchiveCommand: "plannotator-archive",
  };

  test("every OpenCode command.execute.before branch has a handler in commands.ts", () => {
    const missing: string[] = [];
    for (const cmd of commands) {
      const expectedHandler = Object.entries(HANDLER_TO_COMMAND).find(
        ([, c]) => c === cmd
      );
      if (!expectedHandler) {
        missing.push(`${cmd} has no mapped handler in commands.ts`);
      } else if (!handlers.has(expectedHandler[0])) {
        missing.push(`${cmd} maps to ${expectedHandler[0]} but that function is not exported from commands.ts`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("every exported handler in commands.ts is wired into command.execute.before", () => {
    const unwired: string[] = [];
    for (const handler of handlers) {
      const cmd = HANDLER_TO_COMMAND[handler];
      if (!cmd) {
        unwired.push(`${handler} has no mapping in HANDLER_TO_COMMAND`);
      } else if (!commands.has(cmd)) {
        unwired.push(`${handler} → ${cmd} is not intercepted in command.execute.before`);
      }
    }
    expect(unwired).toEqual([]);
  });
});
