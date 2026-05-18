/**
 * Sessions Hook
 *
 * Manages state and handlers for the session browser — listing and switching
 * between active sessions on the current server.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { getApiUrl } from "../utils/apiUrl";

export interface SessionEntry {
  sessionId: string;
  mode: "plan" | "review" | "annotate" | "archive";
  origin: string;
  project: string;
  slug: string;
  name: string | null;
  cwd: string;
  url: string;
}

export interface UseSessionsReturn {
  /** List of active sessions */
  sessions: SessionEntry[];
  /** Whether the session list is loading */
  isLoading: boolean;
  /** Fetch the list of active sessions */
  fetchSessions: () => Promise<void>;
  /** ID of the currently active session */
  currentSessionId: string | null;
}

export function useSessions(currentSessionId: string | null = null, enabled = true): UseSessionsReturn {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const isLoadingRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const hasFetched = useRef(false);

  const fetchSessions = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl("/api/sessions"));
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: SessionEntry[] };
      setSessions(data.sessions);
      hasFetched.current = true;
    } catch {
      /* ignore */
    } finally {
      isLoadingRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Initial fetch
    fetchSessions();

    // Poll for updates every 10 seconds
    const intervalId = setInterval(fetchSessions, 10000);
    return () => clearInterval(intervalId);
  }, [fetchSessions, enabled]);

  return {
    sessions,
    isLoading,
    fetchSessions,
    currentSessionId,
  };
}
