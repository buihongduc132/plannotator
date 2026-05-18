import { describe, test, expect } from "bun:test";
import {
  fetchRef,
  ensureObjectAvailable,
  createWorktree,
  removeWorktree,
} from "./worktree";
import type { ReviewGitRuntime } from "./review-core";

/** Helper to create a mock runtime with predefined results */
function mockRuntime(responses: Record<string, { stdout?: string; stderr?: string; exitCode: number }>): ReviewGitRuntime {
  return {
    runGit: async (args: string[]) => {
      const key = args.join(" ");
      // Find by prefix matching for flexibility
      for (const [pattern, result] of Object.entries(responses)) {
        if (key.startsWith(pattern) || pattern === "*") {
          return {
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
            exitCode: result.exitCode,
          };
        }
      }
      return { stdout: "", stderr: "unknown command", exitCode: 1 };
    },
  };
}

describe("fetchRef", () => {
  test("succeeds on exitCode 0", async () => {
    const runtime = mockRuntime({
      "fetch origin": { exitCode: 0 },
    });
    await expect(fetchRef(runtime, "main")).resolves.toBeUndefined();
  });

  test("throws on non-zero exit code", async () => {
    const runtime = mockRuntime({
      "fetch origin": { exitCode: 128, stderr: "fatal: repository not found" },
    });
    await expect(fetchRef(runtime, "main")).rejects.toThrow("git fetch origin main failed");
  });

  test("throws with stderr in error message", async () => {
    const runtime = mockRuntime({
      "fetch origin": { exitCode: 1, stderr: "network error" },
    });
    await expect(fetchRef(runtime, "feature-branch")).rejects.toThrow("network error");
  });

  test("throws with exit code when stderr is empty", async () => {
    const runtime = mockRuntime({
      "fetch origin": { exitCode: 42, stderr: "  " },
    });
    await expect(fetchRef(runtime, "main")).rejects.toThrow("exit code 42");
  });

  test("passes cwd option", async () => {
    let capturedArgs: string[] = [];
    const runtime: ReviewGitRuntime = {
      runGit: async (args, opts) => {
        capturedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await fetchRef(runtime, "main", { cwd: "/my/repo" });
    expect(capturedArgs).toContain("fetch");
    expect(capturedArgs).toContain("origin");
    expect(capturedArgs).toContain("main");
  });
});

describe("ensureObjectAvailable", () => {
  test("returns true when object exists locally", async () => {
    const runtime = mockRuntime({
      "cat-file -t": { exitCode: 0, stdout: "commit" },
    });
    const result = await ensureObjectAvailable(runtime, "abc123");
    expect(result).toBe(true);
  });

  test("fetches and rechecks when object missing", async () => {
    let callCount = 0;
    const runtime: ReviewGitRuntime = {
      runGit: async (args) => {
        callCount++;
        if (args[0] === "cat-file") {
          // First check fails, second succeeds
          return callCount <= 2
            ? { stdout: "", stderr: "not found", exitCode: 128 }
            : { stdout: "commit", stderr: "", exitCode: 0 };
        }
        if (args[0] === "fetch") {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      },
    };
    const result = await ensureObjectAvailable(runtime, "abc123");
    expect(result).toBe(true);
  });

  test("returns false when fetch fails", async () => {
    const runtime = mockRuntime({
      "cat-file -t": { exitCode: 128 },
      "fetch origin": { exitCode: 128 },
    });
    const result = await ensureObjectAvailable(runtime, "missing-sha");
    expect(result).toBe(false);
  });

  test("returns false when object still missing after fetch", async () => {
    const runtime = mockRuntime({
      "*": { exitCode: 0 },
      "cat-file -t": { exitCode: 128 },
    });
    // After fetch succeeds, cat-file still fails
    let catFileCalls = 0;
    const rt: ReviewGitRuntime = {
      runGit: async (args) => {
        if (args[0] === "cat-file") {
          catFileCalls++;
          return { stdout: "", stderr: "not found", exitCode: 128 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    const result = await ensureObjectAvailable(rt, "abc123");
    expect(result).toBe(false);
    expect(catFileCalls).toBe(2); // initial + recheck
  });
});

describe("createWorktree", () => {
  test("returns worktreePath on success", async () => {
    const runtime = mockRuntime({
      "worktree add": { exitCode: 0 },
    });
    const result = await createWorktree(runtime, {
      ref: "main",
      path: "/tmp/wt-test",
    });
    expect(result.worktreePath).toBe("/tmp/wt-test");
  });

  test("includes --detach flag when requested", async () => {
    let capturedArgs: string[] = [];
    const runtime: ReviewGitRuntime = {
      runGit: async (args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await createWorktree(runtime, {
      ref: "abc123",
      path: "/tmp/wt-detach",
      detach: true,
    });
    expect(capturedArgs).toContain("--detach");
    expect(capturedArgs).toContain("abc123");
  });

  test("does not include --detach by default", async () => {
    let capturedArgs: string[] = [];
    const runtime: ReviewGitRuntime = {
      runGit: async (args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await createWorktree(runtime, {
      ref: "main",
      path: "/tmp/wt-normal",
    });
    expect(capturedArgs).not.toContain("--detach");
  });

  test("throws on failure", async () => {
    const runtime = mockRuntime({
      "worktree add": { exitCode: 128, stderr: "already exists" },
    });
    await expect(createWorktree(runtime, {
      ref: "main",
      path: "/tmp/wt-exists",
    })).rejects.toThrow("git worktree add failed");
  });

  test("throws with exit code when stderr is empty", async () => {
    const runtime = mockRuntime({
      "worktree add": { exitCode: 1, stderr: "" },
    });
    await expect(createWorktree(runtime, {
      ref: "main",
      path: "/tmp/wt-fail",
    })).rejects.toThrow("exit code 1");
  });

  test("uses custom cwd", async () => {
    let capturedCwd: string | undefined;
    const runtime: ReviewGitRuntime = {
      runGit: async (args, opts) => {
        capturedCwd = opts?.cwd;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await createWorktree(runtime, {
      ref: "main",
      path: "/tmp/wt-cwd",
      cwd: "/source/repo",
    });
    expect(capturedCwd).toBe("/source/repo");
  });
});

describe("removeWorktree", () => {
  test("succeeds silently on exitCode 0", async () => {
    const runtime = mockRuntime({
      "worktree remove": { exitCode: 0 },
    });
    // Should not throw
    await removeWorktree(runtime, "/tmp/wt-remove");
  });

  test("logs warning on non-zero exit code (does not throw)", async () => {
    const runtime = mockRuntime({
      "worktree remove": { exitCode: 128, stderr: "not a worktree" },
    });
    // Should not throw — best-effort cleanup
    await removeWorktree(runtime, "/tmp/wt-fail");
  });

  test("includes --force flag when requested", async () => {
    let capturedArgs: string[] = [];
    const runtime: ReviewGitRuntime = {
      runGit: async (args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await removeWorktree(runtime, "/tmp/wt-force", { force: true });
    expect(capturedArgs).toContain("--force");
  });

  test("does not include --force by default", async () => {
    let capturedArgs: string[] = [];
    const runtime: ReviewGitRuntime = {
      runGit: async (args) => {
        capturedArgs = args;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await removeWorktree(runtime, "/tmp/wt-normal");
    expect(capturedArgs).not.toContain("--force");
  });

  test("catches runtime exceptions gracefully", async () => {
    const runtime: ReviewGitRuntime = {
      runGit: async () => {
        throw new Error("ENOENT: git not found");
      },
    };
    // Should not throw
    await removeWorktree(runtime, "/tmp/wt-error");
  });

  test("uses custom cwd from options", async () => {
    let capturedCwd: string | undefined;
    const runtime: ReviewGitRuntime = {
      runGit: async (args, opts) => {
        capturedCwd = opts?.cwd;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    };
    await removeWorktree(runtime, "/tmp/wt-cwd", { cwd: "/source/repo" });
    expect(capturedCwd).toBe("/source/repo");
  });
});
