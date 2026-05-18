import { describe, test, expect } from "bun:test";
import { parseRemoteUrl, parseRemoteHost, getDirName } from "./repo";

describe("parseRemoteUrl", () => {
  test("parses HTTPS GitHub URL", () => {
    expect(parseRemoteUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  test("parses HTTPS URL without .git suffix", () => {
    expect(parseRemoteUrl("https://github.com/owner/repo")).toBe("owner/repo");
  });

  test("parses SSH GitHub URL", () => {
    expect(parseRemoteUrl("git@github.com:owner/repo.git")).toBe("owner/repo");
  });

  test("parses SSH URL without .git suffix", () => {
    expect(parseRemoteUrl("git@github.com:owner/repo")).toBe("owner/repo");
  });

  test("parses SSH with port", () => {
    expect(parseRemoteUrl("ssh://git@github.com:22/owner/repo.git")).toBe("owner/repo");
  });

  test("parses SSH with port without .git", () => {
    expect(parseRemoteUrl("ssh://git@github.com:22/owner/repo")).toBe("owner/repo");
  });

  test("parses GitLab subgroup URL", () => {
    expect(parseRemoteUrl("git@gitlab.com:group/subgroup/project.git")).toBe("group/subgroup/project");
  });

  test("parses HTTPS GitLab subgroup URL", () => {
    expect(parseRemoteUrl("https://gitlab.com/group/subgroup/project.git")).toBe("group/subgroup/project");
  });

  test("returns null for empty string", () => {
    expect(parseRemoteUrl("")).toBeNull();
  });

  test("returns null for unrecognized format", () => {
    expect(parseRemoteUrl("not-a-url")).toBeNull();
  });

  test("handles self-hosted GitLab SSH", () => {
    expect(parseRemoteUrl("git@gitlab.example.com:devops/team/service.git")).toBe("devops/team/service");
  });

  test("handles self-hosted GitLab HTTPS", () => {
    expect(parseRemoteUrl("https://gitlab.example.com/devops/team/service.git")).toBe("devops/team/service");
  });

  test("handles SSH with user prefix but no scheme", () => {
    expect(parseRemoteUrl("git@custom.host:org/repo")).toBe("org/repo");
  });

  test("handles deeply nested GitLab groups", () => {
    expect(parseRemoteUrl("git@gitlab.com:a/b/c/d/project.git")).toBe("a/b/c/d/project");
  });
});

describe("parseRemoteHost", () => {
  test("extracts host from SSH URL", () => {
    expect(parseRemoteHost("git@github.com:owner/repo.git")).toBe("github.com");
  });

  test("extracts host from HTTPS URL", () => {
    expect(parseRemoteHost("https://github.com/owner/repo.git")).toBe("github.com");
  });

  test("extracts host from SSH with scheme", () => {
    expect(parseRemoteHost("ssh://git@github.com:22/owner/repo.git")).toBe("github.com");
  });

  test("extracts host from SSH scheme without user", () => {
    expect(parseRemoteHost("ssh://github.com/owner/repo.git")).toBe("github.com");
  });

  test("extracts host from self-hosted GitLab", () => {
    expect(parseRemoteHost("git@gitlab.example.com:group/project.git")).toBe("gitlab.example.com");
  });

  test("extracts host from self-hosted HTTPS", () => {
    expect(parseRemoteHost("https://gitlab.example.com/group/project.git")).toBe("gitlab.example.com");
  });

  test("returns null for empty string", () => {
    expect(parseRemoteHost("")).toBeNull();
  });

  test("returns null for unrecognized format", () => {
    expect(parseRemoteHost("not-a-url")).toBeNull();
  });

  test("handles HTTP scheme", () => {
    expect(parseRemoteHost("http://localhost/owner/repo")).toBe("localhost");
  });

  test("handles HTTPS with port in URL path", () => {
    expect(parseRemoteHost("https://github.com:8443/owner/repo")).toBe("github.com");
  });
});

describe("getDirName", () => {
  test("extracts dir from path", () => {
    expect(getDirName("/home/user/project")).toBe("project");
  });

  test("handles trailing slashes", () => {
    expect(getDirName("/home/user/project/")).toBe("project");
  });

  test("handles single segment", () => {
    expect(getDirName("project")).toBe("project");
  });

  test("returns null for empty string", () => {
    expect(getDirName("")).toBeNull();
  });

  test("returns null for null input", () => {
    expect(getDirName(null as any)).toBeNull();
  });

  test("handles multiple trailing slashes", () => {
    expect(getDirName("/home/user/project///")).toBe("project");
  });

  test("handles root slash", () => {
    expect(getDirName("/")).toBeNull();
  });
});
