import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReviewStatusStore, type PlannotatorReviewStatusResult } from "./review-status-store";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("review-status-store", () => {
	test("get returns missing for unknown reviewId", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		expect(store.get("unknown-id")).toEqual({ status: "missing" });
	});

	test("set then get returns the stored status", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		store.set("rev-1", { status: "pending" });

		expect(store.get("rev-1")).toEqual({ status: "pending" });
	});

	test("set persists to disk as JSON", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		store.set("rev-1", { status: "pending" });

		expect(existsSync(path)).toBe(true);
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		expect(raw["rev-1"]).toEqual({ status: "pending" });
	});

	test("read returns empty when file does not exist", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "nonexistent.json");
		const store = createReviewStatusStore(path);

		expect(store.read()).toEqual({});
	});

	test("read returns empty for corrupted JSON", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		// Write invalid JSON directly
		const { writeFileSync } = require("node:fs");
		writeFileSync(path, "{{invalid}");

		expect(store.read()).toEqual({});
	});

	test("set updates existing entry without losing others", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		store.set("rev-1", { status: "pending" });
		store.set("rev-2", { status: "pending" });
		store.set("rev-1", {
			status: "completed",
			reviewId: "rev-1",
			approved: true,
			feedback: "LGTM",
		} satisfies PlannotatorReviewStatusResult);

		expect(store.get("rev-1")).toEqual({
			status: "completed",
			reviewId: "rev-1",
			approved: true,
			feedback: "LGTM",
		});
		expect(store.get("rev-2")).toEqual({ status: "pending" });
	});

	test("completed status round-trips all fields", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		const completed: PlannotatorReviewStatusResult = {
			status: "completed",
			reviewId: "rev-42",
			approved: false,
			feedback: "Add rollback steps",
			savedPath: "/home/user/.plannotator/plans/plan-001.md",
			agentSwitch: "opencode",
			permissionMode: "restricted",
		};

		store.set("rev-42", completed);

		// Re-create store from same path to verify disk persistence
		const store2 = createReviewStatusStore(path);
		expect(store2.get("rev-42")).toEqual(completed);
	});

	test("multiple sets are idempotent", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		store.set("rev-1", { status: "pending" });
		store.set("rev-1", { status: "pending" });
		store.set("rev-1", { status: "pending" });

		expect(store.get("rev-1")).toEqual({ status: "pending" });

		// File should have exactly one entry
		const raw = JSON.parse(readFileSync(path, "utf-8"));
		expect(Object.keys(raw)).toEqual(["rev-1"]);
	});

	test("write overwrites the entire store", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		store.set("rev-1", { status: "pending" });
		store.set("rev-2", { status: "pending" });

		// Direct write replaces everything
		store.write({ "rev-3": { status: "pending" } });

		expect(store.get("rev-1")).toEqual({ status: "missing" });
		expect(store.get("rev-2")).toEqual({ status: "missing" });
		expect(store.get("rev-3")).toEqual({ status: "pending" });
	});

	test("path property exposes the storage file path", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "custom.json");
		const store = createReviewStatusStore(path);

		expect(store.path).toBe(path);
	});

	test("creates parent directories when they do not exist", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "deep", "nested", "status.json");
		const store = createReviewStatusStore(path);

		store.set("rev-1", { status: "pending" });

		expect(existsSync(path)).toBe(true);
		expect(store.get("rev-1")).toEqual({ status: "pending" });
	});

	test("handles concurrent store instances on the same path", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const storeA = createReviewStatusStore(path);
		const storeB = createReviewStatusStore(path);

		storeA.set("rev-a", { status: "pending" });
		storeB.set("rev-b", { status: "pending" });

		// Each store reads fresh from disk
		expect(storeA.get("rev-a")).toEqual({ status: "pending" });
		expect(storeA.get("rev-b")).toEqual({ status: "pending" });
		expect(storeB.get("rev-a")).toEqual({ status: "pending" });
		expect(storeB.get("rev-b")).toEqual({ status: "pending" });
	});

	test("full plan-review lifecycle: pending → completed", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		// 1. Plan submitted, browser opened
		const reviewId = "review-abc123";
		store.set(reviewId, { status: "pending" });
		expect(store.get(reviewId)).toEqual({ status: "pending" });

		// 2. User approves with feedback
		store.set(reviewId, {
			status: "completed",
			reviewId,
			approved: true,
			feedback: "Consider edge case X",
			savedPath: "~/.plannotator/plans/feature-plan.md",
		});

		const final = store.get(reviewId);
		expect(final.status).toBe("completed");
		if (final.status === "completed") {
			expect(final.approved).toBe(true);
			expect(final.feedback).toBe("Consider edge case X");
			expect(final.savedPath).toBe("~/.plannotator/plans/feature-plan.md");
		}
	});

	test("full plan-review lifecycle: pending → denied", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		const reviewId = "review-deny456";
		store.set(reviewId, { status: "pending" });

		// User denies with revision feedback
		store.set(reviewId, {
			status: "completed",
			reviewId,
			approved: false,
			feedback: "Need rollback steps before proceeding",
		});

		const final = store.get(reviewId);
		expect(final.status).toBe("completed");
		if (final.status === "completed") {
			expect(final.approved).toBe(false);
			expect(final.feedback).toBe("Need rollback steps before proceeding");
		}
	});

	test("does not pollute real home directory", () => {
		const dir = makeTempDir("review-status-");
		const path = join(dir, "status.json");
		const store = createReviewStatusStore(path);

		store.set("test", { status: "pending" });

		// Verify the file was written to the temp path, not home
		expect(existsSync(path)).toBe(true);
		expect(store.path).not.toContain(".pi/plannotator-review-status.json");
	});
});
