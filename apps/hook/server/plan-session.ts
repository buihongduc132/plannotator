export interface HookPlanSessionInput {
  detectedOrigin: string;
  isGemini: boolean;
  eventSessionId?: string | null;
  cwd?: string | null;
  planFilename?: string | null;
}

export interface HookPlanSessionOptions {
  origin: string;
  sessionId?: string;
  cwd?: string;
  name?: string;
}

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function planFilenameToName(planFilename: string | null | undefined): string | undefined {
  const value = normalize(planFilename);
  if (!value) return undefined;

  const basename = value.split(/[\\/]/).pop() ?? value;
  return basename.replace(/\.[^.]+$/, "") || undefined;
}

export function buildHookPlanSessionOptions(input: HookPlanSessionInput): HookPlanSessionOptions {
  const origin = input.isGemini ? "gemini-cli" : input.detectedOrigin;
  const sessionId = normalize(input.eventSessionId);
  const cwd = normalize(input.cwd);
  const name = input.isGemini ? planFilenameToName(input.planFilename) : undefined;

  return {
    origin,
    ...(sessionId ? { sessionId } : {}),
    ...(cwd ? { cwd } : {}),
    ...(name ? { name } : {}),
  };
}
