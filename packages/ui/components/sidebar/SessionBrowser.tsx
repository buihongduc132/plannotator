/**
 * SessionBrowser — Browsable list of active Plannotator sessions
 *
 * Allows users to discover and switch between concurrent sessions
 * on the same server.
 */

import React from "react";
import type { SessionEntry } from "../../hooks/useSessions";

interface SessionBrowserProps {
  sessions: SessionEntry[];
  isLoading: boolean;
  currentSessionId?: string | null;
}

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  sessions,
  isLoading,
  currentSessionId,
}) => {
  if (isLoading) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        Loading sessions...
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-xs text-muted-foreground text-center">
        No active sessions found.
      </div>
    );
  }

  // Group sessions by project
  const projects = Array.from(new Set(sessions.map(s => s.project)));

  return (
    <div className="p-2">
      <div className="space-y-4">
        {projects.map((project) => (
          <div key={project} className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1 flex items-center gap-2">
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              {project}
            </div>
            <div className="space-y-0.5">
              {sessions
                .filter((s) => s.project === project)
                .map((session) => (
                  <a
                    key={session.sessionId}
                    href={session.url}
                    className={`block w-full text-left px-2 py-2 rounded text-xs transition-colors border group ${
                      session.sessionId === currentSessionId
                        ? "bg-primary/10 border-primary/20 hover:bg-primary/15"
                        : "text-foreground hover:bg-muted/50 border-transparent hover:border-border/30"
                    }`}
                    onClick={(e) => {
                      if (session.sessionId === currentSessionId) {
                        e.preventDefault();
                        return;
                      }
                      if (!confirm("Switch to this session? Any unsaved annotations or drafts in the current session may be lost.")) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-medium truncate transition-colors ${
                          session.sessionId === currentSessionId ? "text-primary" : "group-hover:text-primary"
                        }`}>
                          {session.name || session.slug || session.sessionId.slice(0, 8)}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {session.sessionId === currentSessionId && (
                            <span className="text-[9px] px-1 rounded bg-primary text-primary-foreground font-bold uppercase">
                              Current
                            </span>
                          )}
                          <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground uppercase shrink-0">
                            {session.mode}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground truncate">
                        <span className="truncate">{session.cwd}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-muted-foreground/60 italic">
                          via {session.origin}
                        </span>
                      </div>
                    </div>
                  </a>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
