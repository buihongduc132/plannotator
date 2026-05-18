import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

describe("pr-github", () => {
  const mockRunCommand = mock<(cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>>(
    async () => ({ stdout: "", stderr: "", exitCode: 1 })
  );
  const mockRuntime = { runCommand: mockRunCommand };

  beforeEach(() => {
    mockRunCommand.mockClear();
  });

  describe("checkGhAuth", () => {
    test("throws when gh auth fails", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "not authenticated",
        exitCode: 1,
      });
      const { checkGhAuth } = await import("./pr-github");
      await expect(checkGhAuth(mockRuntime, "github.com")).rejects.toThrow(
        "GitHub CLI not authenticated",
      );
    });

    test("passes when gh auth succeeds", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "authenticated",
        stderr: "",
        exitCode: 0,
      });
      const { checkGhAuth } = await import("./pr-github");
      await expect(checkGhAuth(mockRuntime, "github.com")).resolves.toBeUndefined();
    });

    test("includes --hostname for GHE", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "authenticated",
        stderr: "",
        exitCode: 0,
      });
      const { checkGhAuth } = await import("./pr-github");
      await checkGhAuth(mockRuntime, "github.mycompany.com");
      expect(mockRunCommand).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining(["--hostname", "github.mycompany.com"]),
      );
    });
  });

  describe("getGhUser", () => {
    test("returns username when successful", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "testuser",
        stderr: "",
        exitCode: 0,
      });
      const { getGhUser } = await import("./pr-github");
      const user = await getGhUser(mockRuntime, "github.com");
      expect(user).toBe("testuser");
    });

    test("returns null on failure", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "error",
        exitCode: 1,
      });
      const { getGhUser } = await import("./pr-github");
      const user = await getGhUser(mockRuntime, "github.com");
      expect(user).toBeNull();
    });

    test("returns null on exception", async () => {
      mockRunCommand.mockRejectedValueOnce(new Error("boom"));
      const { getGhUser } = await import("./pr-github");
      const user = await getGhUser(mockRuntime, "github.com");
      expect(user).toBeNull();
    });
  });

  describe("fetchGhPR", () => {
    test("fetches diff and metadata in parallel", async () => {
      mockRunCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args.includes("diff")) {
          return { stdout: "diff content", stderr: "", exitCode: 0 };
        }
        if (args.includes("view")) {
          return {
            stdout: JSON.stringify({
              id: "node1",
              title: "Test PR",
              author: { login: "user" },
              baseRefName: "main",
              headRefName: "feature",
              baseRefOid: "abc",
              headRefOid: "def",
              url: "https://github.com/org/repo/pull/1",
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      });

      const { fetchGhPR } = await import("./pr-github");
      const result = await fetchGhPR(mockRuntime, {
        platform: "github",
        host: "github.com",
        owner: "org",
        repo: "repo",
        number: 1,
      });

      expect(result.rawPatch).toBe("diff content");
      expect(result.metadata.title).toBe("Test PR");
      expect(result.metadata.platform).toBe("github");
    });
  });
});
