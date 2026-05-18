import { describe, expect, mock, test } from "bun:test";
import { handleLastMessagePlanReview } from "./last-message-plan-review";

describe("handleLastMessagePlanReview", () => {
  test("opens plan review for the latest assistant message and sends approval notes back to the agent", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});
    const getLastAssistantMessageText = mock(async () => "# Plan\n\n- [ ] Ship it");
    const openPlanReviewBrowser = mock(async () => ({
      approved: true,
      feedback: "Also add smoke tests.",
    }));

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText,
        openPlanReviewBrowser,
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(openPlanReviewBrowser).toHaveBeenCalledWith(expect.anything(), "# Plan\n\n- [ ] Ship it");
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("approved");
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("Also add smoke tests.");
  });

  test("sends revision feedback back to the agent when the review is denied", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Draft Plan",
        openPlanReviewBrowser: async () => ({
          approved: false,
          feedback: "The plan needs rollback steps.",
        }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("rollback steps");
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("revise");
  });

  test("notifies when there is no assistant message to review", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => null,
        openPlanReviewBrowser: async () => ({ approved: true }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No assistant message found in session.", "error");
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  test("notifies error when plan review UI is unavailable", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => false,
        getLastAssistantMessageText: async () => "unused",
        openPlanReviewBrowser: async () => ({ approved: true }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Plan review UI not available. Run 'bun run build' in the pi-extension directory.",
      "error",
    );
  });

  test("notifies error when plan review browser throws on startup", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});
    const startupErr = new Error("port bind failed");

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => { throw startupErr; },
        getStartupErrorMessage: (err) => err instanceof Error ? err.message : String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Failed to start plan review UI: port bind failed",
      "error",
    );
  });

  test("notifies approval when approved without feedback", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => ({ approved: true }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Last message approved.", "info");
  });

  test("notifies closed without feedback when denied with no feedback", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => ({ approved: false }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Plan review closed (no feedback).", "info");
  });

  test("queues followUp when agent is busy (isIdle=false)", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => false,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => ({
          approved: true,
          feedback: "Consider edge cases.",
        }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage.mock.calls[0]?.[1]).toEqual({ deliverAs: "followUp" });
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("Consider edge cases.");
  });

  test("sends immediate message when agent is idle (isIdle=true)", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => ({
          approved: false,
          feedback: "Missing tests.",
        }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    // 2nd arg should be undefined (no options) when idle
    expect(sendUserMessage.mock.calls[0]?.[1]).toBeUndefined();
    expect(sendUserMessage.mock.calls[0]?.[0]).toContain("Missing tests.");
  });

  test("notifies approval when approved with whitespace-only feedback", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => ({ approved: true, feedback: "   " }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Last message approved.", "info");
  });

  test("notifies closed without feedback when denied with whitespace-only feedback", async () => {
    const notify = mock((_message: string, _type?: string) => {});
    const sendUserMessage = mock((_message: string, _options?: unknown) => {});

    await handleLastMessagePlanReview(
      { sendUserMessage } as any,
      {
        ui: { notify },
        isIdle: () => true,
      } as any,
      {
        hasPlanBrowserHtml: () => true,
        getLastAssistantMessageText: async () => "# Plan",
        openPlanReviewBrowser: async () => ({ approved: false, feedback: "  " }),
        getStartupErrorMessage: (err) => String(err),
      },
    );

    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Plan review closed (no feedback).", "info");
  });
});
