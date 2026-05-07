import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Review status stored per reviewId so callers can poll
 * for plan-review completion after a session restart or race.
 */
export type StoredReviewStatus = Record<string, PlannotatorReviewStatusResult>;

export type PlannotatorReviewStatusResult =
	| { status: "pending" }
	| {
			status: "completed";
			reviewId: string;
			approved: boolean;
			feedback?: string;
			savedPath?: string;
			agentSwitch?: string;
			permissionMode?: string;
	  }
	| { status: "missing" };

const DEFAULT_PATH = join(homedir(), ".pi", "plannotator-review-status.json");

export function createReviewStatusStore(
	storagePath: string = DEFAULT_PATH,
) {
	function read(): StoredReviewStatus {
		try {
			if (!existsSync(storagePath)) return {};
			const raw = readFileSync(storagePath, "utf-8");
			const parsed = JSON.parse(raw) as StoredReviewStatus;
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}

	function write(statuses: StoredReviewStatus): void {
		mkdirSync(dirname(storagePath), { recursive: true });
		writeFileSync(storagePath, JSON.stringify(statuses, null, 2));
	}

	function set(reviewId: string, status: PlannotatorReviewStatusResult): void {
		const statuses = read();
		statuses[reviewId] = status;
		write(statuses);
	}

	function get(reviewId: string): PlannotatorReviewStatusResult {
		return read()[reviewId] ?? { status: "missing" };
	}

	return { read, write, set, get, path: storagePath };
}
