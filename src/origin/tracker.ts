/**
 * Origin Tracker — captures enriched origin metadata for every email.
 *
 * Tracks: cwd, CLI agent, session ID, session title, session cwd,
 * git project name, custom metadata.
 */

import { basename } from "node:path";
import type { EmailOrigin } from "../types.js";

export interface OriginTrackerOptions {
  /** Default CLI agent name (default: "pi") */
  defaultAgent?: string;
  /** Custom fields to merge into every origin */
  defaultCustomFields?: Record<string, unknown>;
  /** Session title (from pi env or manual override) */
  sessionTitle?: string;
  /** Session cwd override */
  sessionCwd?: string;
}

export class OriginTracker {
  private readonly defaultAgent: string;
  private readonly defaultCustomFields: Record<string, unknown>;
  private readonly sessionTitle: string | undefined;
  private readonly sessionCwd: string | undefined;

  constructor(options: OriginTrackerOptions = {}) {
    this.defaultAgent = options.defaultAgent ?? "pi";
    this.defaultCustomFields = options.defaultCustomFields ?? {};
    this.sessionTitle = options.sessionTitle;
    this.sessionCwd = options.sessionCwd;
  }

  /**
   * Capture current origin context.
   * Call this at the point where the email is created/received.
   */
  capture(overrides?: Partial<EmailOrigin>): EmailOrigin {
    const cwd = overrides?.cwd ?? process.cwd();
    return {
      cwd,
      cliAgent: overrides?.cliAgent ?? this.defaultAgent,
      sessionId: overrides?.sessionId ?? process.env.PI_SESSION_ID ?? undefined,
      sessionTitle: overrides?.sessionTitle ?? this.sessionTitle ?? process.env.PI_SESSION_TITLE ?? undefined,
      sessionCwd: overrides?.sessionCwd ?? this.sessionCwd ?? process.env.PI_SESSION_CWD ?? cwd,
      gitProject: overrides?.gitProject ?? this.extractGitProject(cwd),
      custom: {
        ...this.defaultCustomFields,
        ...(overrides?.custom ?? {}),
      },
      timestamp: overrides?.timestamp ?? new Date(),
    };
  }

  /**
   * Extract git project name from cwd.
   * Heuristic: last directory component of the path.
   */
  private extractGitProject(cwd: string): string {
    return basename(cwd);
  }
}
