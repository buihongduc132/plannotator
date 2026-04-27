declare global {
  interface Window {
    __PLANNOTATOR_SESSION_PATH__?: string;
  }
}

const SESSION_BASE = (): string => window.__PLANNOTATOR_SESSION_PATH__ ?? "";

export function getApiUrl(path: string): string {
  return SESSION_BASE() + path;
}
