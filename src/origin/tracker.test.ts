import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OriginTracker } from "./tracker.js";

describe("OriginTracker", () => {
  // Preserve & restore env vars around each test
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      PI_SESSION_ID: process.env.PI_SESSION_ID,
      PI_SESSION_TITLE: process.env.PI_SESSION_TITLE,
      PI_SESSION_CWD: process.env.PI_SESSION_CWD,
    };
  });

  afterEach(() => {
    const env = process.env as Record<string, string | undefined>;
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete env[key];
      } else {
        env[key] = val;
      }
    }
  });

  // 1. Default agent is 'pi'
  it("defaults cliAgent to 'pi' when no options provided", () => {
    const tracker = new OriginTracker();
    const origin = tracker.capture();
    expect(origin.cliAgent).toBe("pi");
  });

  // 2. Custom agent name
  it("uses custom defaultAgent from options", () => {
    const tracker = new OriginTracker({ defaultAgent: "gemini" });
    const origin = tracker.capture();
    expect(origin.cliAgent).toBe("gemini");
  });

  // 3. Session ID from env
  it("captures sessionId from PI_SESSION_ID env", () => {
    process.env.PI_SESSION_ID = "ses_abc123";
    const tracker = new OriginTracker();
    const origin = tracker.capture();
    expect(origin.sessionId).toBe("ses_abc123");
  });

  // 4. Session title from env
  it("captures sessionTitle from PI_SESSION_TITLE env", () => {
    process.env.PI_SESSION_TITLE = "My Session Title";
    const tracker = new OriginTracker();
    const origin = tracker.capture();
    expect(origin.sessionTitle).toBe("My Session Title");
  });

  // 5. Session CWD from env
  it("captures sessionCwd from PI_SESSION_CWD env", () => {
    process.env.PI_SESSION_CWD = "/home/user/project";
    const tracker = new OriginTracker();
    const origin = tracker.capture();
    expect(origin.sessionCwd).toBe("/home/user/project");
  });

  // 6. Git project extracted from cwd
  it("extracts gitProject as basename of cwd", () => {
    const tracker = new OriginTracker();
    const origin = tracker.capture();
    const expected = process.cwd().split("/").pop();
    expect(origin.gitProject).toBe(expected);
  });

  // 7. Custom fields merged
  it("merges defaultCustomFields into origin.custom", () => {
    const tracker = new OriginTracker({
      defaultCustomFields: { priority: "high", source: "ci" },
    });
    const origin = tracker.capture();
    expect(origin.custom).toEqual({ priority: "high", source: "ci" });
  });

  // 8. Overrides work at capture time
  it("allows capture() overrides to win over defaults", () => {
    const tracker = new OriginTracker({ defaultAgent: "pi" });
    const origin = tracker.capture({ cliAgent: "override" });
    expect(origin.cliAgent).toBe("override");
  });

  // 9. Session title from constructor
  it("uses sessionTitle from constructor options", () => {
    const tracker = new OriginTracker({ sessionTitle: "my session" });
    const origin = tracker.capture();
    expect(origin.sessionTitle).toBe("my session");
  });

  // 10. Git project override
  it("allows capture() to override gitProject", () => {
    const tracker = new OriginTracker();
    const origin = tracker.capture({ gitProject: "manual-project" });
    expect(origin.gitProject).toBe("manual-project");
  });
});
