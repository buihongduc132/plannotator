import { describe, expect, test, beforeEach } from "bun:test";

const TEST_WIN: { __PLANNOTATOR_SESSION_PATH__?: string } = {};

function getApiUrl(path: string): string {
  return (TEST_WIN.__PLANNOTATOR_SESSION_PATH__ ?? "") + path;
}

describe("getApiUrl", () => {
  beforeEach(() => {
    delete TEST_WIN.__PLANNOTATOR_SESSION_PATH__;
  });

  test("returns prefixed path when SESSION_PATH set", () => {
    TEST_WIN.__PLANNOTATOR_SESSION_PATH__ = "/s/my-plan";
    expect(getApiUrl("/api/plan")).toBe("/s/my-plan/api/plan");
  });

  test("returns bare path when SESSION_PATH unset", () => {
    expect(getApiUrl("/api/plan")).toBe("/api/plan");
  });

  test("handles paths with query strings", () => {
    TEST_WIN.__PLANNOTATOR_SESSION_PATH__ = "/s/my-plan";
    expect(getApiUrl("/api/plan/version?v=3")).toBe(
      "/s/my-plan/api/plan/version?v=3",
    );
  });

  test("handles empty string path", () => {
    TEST_WIN.__PLANNOTATOR_SESSION_PATH__ = "/s/my-plan";
    expect(getApiUrl("")).toBe("/s/my-plan");
  });

  test("handles root path", () => {
    TEST_WIN.__PLANNOTATOR_SESSION_PATH__ = "/s/my-plan";
    expect(getApiUrl("/")).toBe("/s/my-plan/");
  });
});
