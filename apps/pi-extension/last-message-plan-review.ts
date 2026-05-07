import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  getLastAssistantMessageText,
  getStartupErrorMessage,
  hasPlanBrowserHtml,
  openPlanReviewBrowser,
} from "./plannotator-events.js";

type BrowserDeps = {
  hasPlanBrowserHtml: () => boolean;
  getLastAssistantMessageText: typeof getLastAssistantMessageText;
  openPlanReviewBrowser: typeof openPlanReviewBrowser;
  getStartupErrorMessage: typeof getStartupErrorMessage;
};

const defaultDeps: BrowserDeps = {
  hasPlanBrowserHtml,
  getLastAssistantMessageText,
  openPlanReviewBrowser,
  getStartupErrorMessage,
};

export async function handleLastMessagePlanReview(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  ctx: ExtensionCommandContext,
  deps: BrowserDeps = defaultDeps,
): Promise<void> {
  if (!deps.hasPlanBrowserHtml()) {
    ctx.ui.notify(
      "Plan review UI not available. Run 'bun run build' in the pi-extension directory.",
      "error",
    );
    return;
  }

  const lastText = await deps.getLastAssistantMessageText(ctx);
  if (!lastText) {
    ctx.ui.notify("No assistant message found in session.", "error");
    return;
  }

  ctx.ui.notify("Opening plan review UI for last message...", "info");

  try {
    const result = await deps.openPlanReviewBrowser(ctx, lastText);
    if (result.approved) {
      if (result.feedback?.trim()) {
        pi.sendUserMessage(
          `# Last Message Plan Review\n\nThe latest assistant message was approved as the plan baseline.\n\nImplementation notes:\n${result.feedback.trim()}`,
          ctx.isIdle() ? undefined : { deliverAs: "followUp" },
        );
      } else {
        ctx.ui.notify("Last message approved.", "info");
      }
      return;
    }

    if (result.feedback?.trim()) {
      pi.sendUserMessage(
        `# Last Message Plan Review\n\nPlease revise the latest assistant message as a plan.\n\nFeedback:\n${result.feedback.trim()}`,
        ctx.isIdle() ? undefined : { deliverAs: "followUp" },
      );
      return;
    }

    ctx.ui.notify("Plan review closed (no feedback).", "info");
  } catch (err) {
    ctx.ui.notify(
      `Failed to start plan review UI: ${deps.getStartupErrorMessage(err)}`,
      "error",
    );
  }
}
