/**
 * Tests for tour types and data structures.
 * Run: bun test packages/shared/tour.test.ts
 *
 * tour.ts is primarily type definitions. This test validates the type contracts
 * and ensures the interfaces can be correctly instantiated.
 */

import { describe, expect, test } from "bun:test";
import type {
  TourDiffAnchor,
  TourKeyTakeaway,
  TourStop,
  TourQAItem,
  CodeTourOutput,
  CodeTourData,
} from "./tour";

describe("TourDiffAnchor", () => {
  test("can construct a valid anchor", () => {
    const anchor: TourDiffAnchor = {
      file: "src/auth.ts",
      line: 10,
      end_line: 15,
      hunk: "@@ -10,5 +10,6 @@\n context\n-old line\n+new line\n",
      label: "Add auth check",
    };
    expect(anchor.file).toBe("src/auth.ts");
    expect(anchor.line).toBe(10);
    expect(anchor.end_line).toBe(15);
    expect(anchor.hunk).toBeTruthy();
    expect(anchor.label).toBe("Add auth check");
  });
});

describe("TourKeyTakeaway", () => {
  test("info severity", () => {
    const takeaway: TourKeyTakeaway = {
      text: "This is informational",
      severity: "info",
    };
    expect(takeaway.severity).toBe("info");
  });

  test("important severity", () => {
    const takeaway: TourKeyTakeaway = {
      text: "This is important",
      severity: "important",
    };
    expect(takeaway.severity).toBe("important");
  });

  test("warning severity", () => {
    const takeaway: TourKeyTakeaway = {
      text: "This is a warning",
      severity: "warning",
    };
    expect(takeaway.severity).toBe("warning");
  });
});

describe("TourStop", () => {
  test("can construct a valid stop", () => {
    const stop: TourStop = {
      title: "Authentication changes",
      gist: "Added JWT validation middleware",
      detail: "The middleware checks for valid JWT tokens in the Authorization header.",
      transition: "Building on that...",
      anchors: [
        {
          file: "src/middleware.ts",
          line: 5,
          end_line: 10,
          hunk: "@@ ...\n",
          label: "Add middleware",
        },
      ],
    };
    expect(stop.title).toBe("Authentication changes");
    expect(stop.anchors).toHaveLength(1);
    expect(stop.transition).toBe("Building on that...");
  });

  test("stop can have empty anchors array", () => {
    const stop: TourStop = {
      title: "Overview",
      gist: "High level summary",
      detail: "No specific code changes.",
      transition: "",
      anchors: [],
    };
    expect(stop.anchors).toHaveLength(0);
    expect(stop.transition).toBe("");
  });
});

describe("TourQAItem", () => {
  test("can construct a QA item", () => {
    const qa: TourQAItem = {
      question: "Does the login flow handle expired tokens?",
      stop_indices: [2, 3],
    };
    expect(qa.question).toBeTruthy();
    expect(qa.stop_indices).toEqual([2, 3]);
  });

  test("QA item can have empty stop indices", () => {
    const qa: TourQAItem = {
      question: "General question",
      stop_indices: [],
    };
    expect(qa.stop_indices).toHaveLength(0);
  });
});

describe("CodeTourOutput", () => {
  test("can construct a full tour output", () => {
    const tour: CodeTourOutput = {
      title: "Auth refactor tour",
      greeting: "Welcome! Here's a walkthrough of the auth changes.",
      intent: "This changeset improves the authentication flow.",
      before: "Authentication was cookie-based with no expiry.",
      after: "Authentication uses JWT tokens with refresh rotation.",
      key_takeaways: [
        { text: "JWT tokens replace cookies", severity: "important" },
        { text: "Refresh token rotation added", severity: "info" },
      ],
      stops: [
        {
          title: "JWT middleware",
          gist: "New JWT validation middleware",
          detail: "Checks Authorization header for valid tokens.",
          transition: "Next...",
          anchors: [],
        },
      ],
      qa_checklist: [
        { question: "Does logout invalidate tokens?", stop_indices: [0] },
      ],
    };
    expect(tour.title).toBe("Auth refactor tour");
    expect(tour.key_takeaways).toHaveLength(2);
    expect(tour.stops).toHaveLength(1);
    expect(tour.qa_checklist).toHaveLength(1);
  });
});

describe("CodeTourData", () => {
  test("extends CodeTourOutput with checklist state", () => {
    const data: CodeTourData = {
      title: "Test tour",
      greeting: "Hi!",
      intent: "Testing",
      before: "Old",
      after: "New",
      key_takeaways: [],
      stops: [],
      qa_checklist: [],
      checklist: [false, true, false],
    };
    expect(data.checklist).toEqual([false, true, false]);
  });

  test("checklist defaults to all false for N items", () => {
    const n = 5;
    const checklist: boolean[] = new Array(n).fill(false);
    const data: CodeTourData = {
      title: "Test",
      greeting: "Hi",
      intent: "Test",
      before: "Before",
      after: "After",
      key_takeaways: [],
      stops: [],
      qa_checklist: [],
      checklist,
    };
    expect(data.checklist.every((v) => v === false)).toBe(true);
  });
});
