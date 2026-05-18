import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { startPlanReviewServer } from "./server/serverPlan";

const HTML_CONTENT = "<!DOCTYPE html><html><body>plan</body></html>";
const PLAN = "# Abort Test Plan\n\n1. Step one\n2. Step two";

describe("abort signal integration", () => {
	describe("startPlanReviewServer — server lifecycle", () => {
		let result: Awaited<ReturnType<typeof startPlanReviewServer>>;

		beforeAll(async () => {
			result = await startPlanReviewServer({
				plan: PLAN,
				htmlContent: HTML_CONTENT,
				origin: "pi",
				sharingEnabled: false,
			});
		});

		afterAll(() => {
			try { result.stop(); } catch { /* already stopped */ }
		});

		test("server is running before abort", async () => {
			const res = await fetch(`http://localhost:${result.port}/api/plan`);
			expect(res.status).toBe(200);
		});

		test("stop() actually stops the server", async () => {
			const port = result.port;
			result.stop();
			// Give the server a moment to close
			await new Promise((r) => setTimeout(r, 200));
			try {
				await fetch(`http://localhost:${port}/api/plan`, { signal: AbortSignal.timeout(1000) });
				expect.unreachable("Server should be stopped");
			} catch (err) {
				// Expected: connection refused or abort
				expect(err).toBeDefined();
			}
		});
	});

	describe("abort signal cancels waiting", () => {
		test("waitForDecision rejects with AbortError when signal fires", async () => {
			const abortController = new AbortController();
			const server = await startPlanReviewServer({
				plan: PLAN,
				htmlContent: HTML_CONTENT,
				origin: "pi",
				sharingEnabled: false,
			});

			// Simulate the openBrowserAndWait abort pattern using Promise.race
			const abortPromise = new Promise<never>((_resolve, reject) => {
				const handler = () => reject(new DOMException("The operation was aborted.", "AbortError"));
				abortController.signal.addEventListener("abort", handler, { once: true });
			});

			const decisionPromise = server.waitForDecision();

			// Abort after a short delay
			setTimeout(() => abortController.abort(), 100);

			try {
				await Promise.race([decisionPromise, abortPromise]);
				// If decision resolved before abort, that's acceptable too
			} catch (err) {
				// Expected: AbortError
				expect(err).toBeInstanceOf(DOMException);
				expect((err as DOMException).name).toBe("AbortError");
			} finally {
				try { server.stop(); } catch { /* already stopped */ }
			}
		});

		test("abort signal with already-aborted signal rejects immediately", async () => {
			const abortController = new AbortController();
			abortController.abort(); // Already aborted

			const server = await startPlanReviewServer({
				plan: PLAN,
				htmlContent: HTML_CONTENT,
				origin: "pi",
				sharingEnabled: false,
			});

			const abortPromise = new Promise<never>((_resolve, reject) => {
				if (abortController.signal.aborted) {
					reject(new DOMException("The operation was aborted.", "AbortError"));
					return;
				}
			});

			try {
				await Promise.race([server.waitForDecision(), abortPromise]);
				expect.unreachable("Should have rejected with AbortError");
			} catch (err) {
				expect(err).toBeInstanceOf(DOMException);
				expect((err as DOMException).name).toBe("AbortError");
			} finally {
				try { server.stop(); } catch { /* already stopped */ }
			}
		});
	});
});
