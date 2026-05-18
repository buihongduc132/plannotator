import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface PiPlanSessionOptions {
  sessionId: string;
  cwd: string;
  name?: string;
}

export function buildPiPlanSessionOptions(ctx: ExtensionContext): PiPlanSessionOptions {
  const sessionId = ctx.sessionManager.getSessionId();
  const name = ctx.sessionManager.getSessionName();

  return {
    sessionId,
    cwd: ctx.cwd,
    ...(name ? { name } : {}),
  };
}
