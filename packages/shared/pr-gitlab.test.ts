import { describe, test, expect, mock, beforeEach } from "bun:test";

describe("pr-gitlab", () => {
  const mockRunCommand = mock<(cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>>(
    async () => ({ stdout: "", stderr: "", exitCode: 1 })
  );
  const mockRuntime = { runCommand: mockRunCommand };

  beforeEach(() => {
    mockRunCommand.mockClear();
  });

  describe("checkGlAuth", () => {
    test("throws when glab auth fails", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "not authenticated",
        exitCode: 1,
      });
      const { checkGlAuth } = await import("./pr-gitlab");
      await expect(checkGlAuth(mockRuntime, "gitlab.com")).rejects.toThrow(
        "GitLab CLI not authenticated",
      );
    });

    test("passes when glab auth succeeds", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "authenticated",
        stderr: "",
        exitCode: 0,
      });
      const { checkGlAuth } = await import("./pr-gitlab");
      await expect(checkGlAuth(mockRuntime, "gitlab.com")).resolves.toBeUndefined();
    });

    test("includes --hostname for self-hosted GitLab", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "authenticated",
        stderr: "",
        exitCode: 0,
      });
      const { checkGlAuth } = await import("./pr-gitlab");
      await checkGlAuth(mockRuntime, "gitlab.mycompany.com");
      expect(mockRunCommand).toHaveBeenCalledWith(
        "glab",
        expect.arrayContaining(["--hostname", "gitlab.mycompany.com"]),
      );
    });
  });

  describe("getGlUser", () => {
    test("returns username when successful", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: JSON.stringify({ username: "testuser" }),
        stderr: "",
        exitCode: 0,
      });
      const { getGlUser } = await import("./pr-gitlab");
      const user = await getGlUser(mockRuntime, "gitlab.com");
      expect(user).toBe("testuser");
    });

    test("returns null on failure", async () => {
      mockRunCommand.mockResolvedValueOnce({
        stdout: "",
        stderr: "error",
        exitCode: 1,
      });
      const { getGlUser } = await import("./pr-gitlab");
      const user = await getGlUser(mockRuntime, "gitlab.com");
      expect(user).toBeNull();
    });

    test("returns null on exception", async () => {
      mockRunCommand.mockRejectedValueOnce(new Error("boom"));
      const { getGlUser } = await import("./pr-gitlab");
      const user = await getGlUser(mockRuntime, "gitlab.com");
      expect(user).toBeNull();
    });
  });

  describe("fetchGlMR", () => {
    test("fetches MR diff and metadata", async () => {
      mockRunCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args[1]?.includes("diffs")) {
          return {
            stdout: JSON.stringify([{
              diff: "@@ -1 +1 @@\n-old\n+new",
              old_path: "file.ts",
              new_path: "file.ts",
              new_file: false,
              deleted_file: false,
              renamed_file: false,
            }]),
            stderr: "",
            exitCode: 0,
          };
        }
        return {
          stdout: JSON.stringify({
            title: "Test MR",
            author: { username: "user" },
            source_branch: "feature",
            target_branch: "main",
            diff_refs: { base_sha: "abc", head_sha: "def", start_sha: "ghi" },
            web_url: "https://gitlab.com/group/project/-/merge_requests/1",
          }),
          stderr: "",
          exitCode: 0,
        };
      });

      const { fetchGlMR } = await import("./pr-gitlab");
      const result = await fetchGlMR(mockRuntime, {
        platform: "gitlab",
        host: "gitlab.com",
        projectPath: "group/project",
        iid: 1,
      });

      expect(result.rawPatch).toContain("diff --git");
      expect(result.metadata.title).toBe("Test MR");
      expect(result.metadata.platform).toBe("gitlab");
    });

    test("throws when diff fetch fails", async () => {
      mockRunCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args[1]?.includes("diffs")) {
          return { stdout: "", stderr: "not found", exitCode: 1 };
        }
        return { stdout: "{}", stderr: "", exitCode: 0 };
      });

      const { fetchGlMR } = await import("./pr-gitlab");
      await expect(
        fetchGlMR(mockRuntime, {
          platform: "gitlab",
          host: "gitlab.com",
          projectPath: "group/project",
          iid: 1,
        }),
      ).rejects.toThrow("Failed to fetch MR diff");
    });

    test("throws when MR has no diff refs", async () => {
      mockRunCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args[1]?.includes("diffs")) {
          return { stdout: "[]", stderr: "", exitCode: 0 };
        }
        return {
          stdout: JSON.stringify({
            title: "Test MR",
            author: { username: "user" },
            source_branch: "feature",
            target_branch: "main",
            diff_refs: null,
            web_url: "https://gitlab.com/group/project/-/merge_requests/1",
          }),
          stderr: "",
          exitCode: 0,
        };
      });

      const { fetchGlMR } = await import("./pr-gitlab");
      await expect(
        fetchGlMR(mockRuntime, {
          platform: "gitlab",
          host: "gitlab.com",
          projectPath: "group/project",
          iid: 1,
        }),
      ).rejects.toThrow("no diff refs");
    });
  });
});
