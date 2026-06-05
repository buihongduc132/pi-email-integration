import { describe, it, expect } from "vitest";
import { RoutingEngine } from "./routing-engine.js";
import type { HindsightHookConfig, RoutingRule, EmailOrigin } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────

function makeOrigin(overrides?: Partial<EmailOrigin>): EmailOrigin {
  return {
    cwd: "/project/work",
    cliAgent: "pi",
    sessionId: "sess-001",
    custom: {},
    timestamp: new Date("2025-01-15T10:00:00Z"),
    ...overrides,
  };
}

function makeConfig(
  overrides?: Partial<HindsightHookConfig>,
): HindsightHookConfig {
  return {
    enabled: true,
    rules: [],
    ...overrides,
  };
}

/** Convenience: a rule that matches when origin.cwd contains `matchCwd`. */
function cwdRule(
  id: string,
  targetBank: string,
  priority: number,
  matchCwd: string,
  tags: string[] = [],
): RoutingRule {
  return {
    id,
    description: `Match cwd containing "${matchCwd}"`,
    condition: (origin) => origin.cwd.includes(matchCwd),
    targetBank,
    tags,
    priority,
  };
}

// ─── isEnabled ─────────────────────────────────────────────────────

describe("RoutingEngine", () => {
  describe("isEnabled", () => {
    it("returns true when config.enabled = true", () => {
      const engine = new RoutingEngine(makeConfig({ enabled: true }));
      expect(engine.isEnabled).toBe(true);
    });

    it("returns false when config.enabled = false", () => {
      const engine = new RoutingEngine(makeConfig({ enabled: false }));
      expect(engine.isEnabled).toBe(false);
    });
  });

  // ─── route() ────────────────────────────────────────────────────

  describe("route()", () => {
    it("returns matched rule's bank and tags when condition matches", () => {
      const rules = [
        cwdRule("r1", "bank-project", 10, "/project", ["project", "work"]),
      ];
      const engine = new RoutingEngine(makeConfig({ enabled: true, rules }));

      const decision = engine.route(makeOrigin({ cwd: "/project/work" }));

      expect(decision.routed).toBe(true);
      expect(decision.bank).toBe("bank-project");
      expect(decision.tags).toEqual(["project", "work"]);
      expect(decision.matchedRuleId).toBe("r1");
    });

    it("evaluates rules in priority order (highest first)", () => {
      const rules = [
        cwdRule("low", "bank-low", 1, "/project"), // priority 1 — evaluated last
        cwdRule("high", "bank-high", 100, "/project"), // priority 100 — evaluated first
      ];
      const engine = new RoutingEngine(makeConfig({ enabled: true, rules }));

      const decision = engine.route(makeOrigin({ cwd: "/project/work" }));

      // The highest-priority rule should win
      expect(decision.matchedRuleId).toBe("high");
      expect(decision.bank).toBe("bank-high");
    });

    it("falls back to defaultBank when no rule matches", () => {
      const rules = [cwdRule("r1", "bank-unrelated", 10, "/nowhere")];
      const engine = new RoutingEngine(
        makeConfig({
          enabled: true,
          rules,
          defaultBank: "bank-default",
        }),
      );

      const decision = engine.route(makeOrigin({ cwd: "/project/work" }));

      expect(decision.routed).toBe(true);
      expect(decision.bank).toBe("bank-default");
      expect(decision.tags).toEqual([]);
      expect(decision.matchedRuleId).toBeUndefined();
    });

    it("returns {routed: false, tags: []} when disabled", () => {
      const rules = [cwdRule("r1", "bank-project", 10, "/project")];
      const engine = new RoutingEngine(
        makeConfig({ enabled: false, rules, defaultBank: "bank-default" }),
      );

      const decision = engine.route(makeOrigin({ cwd: "/project/work" }));

      expect(decision.routed).toBe(false);
      expect(decision.tags).toEqual([]);
      expect(decision.bank).toBeUndefined();
    });

    it("returns {routed: false, tags: []} when enabled but no rules match and no defaultBank", () => {
      const rules = [cwdRule("r1", "bank-unrelated", 10, "/nowhere")];
      const engine = new RoutingEngine(
        makeConfig({ enabled: true, rules /* no defaultBank */ }),
      );

      const decision = engine.route(makeOrigin({ cwd: "/project/work" }));

      expect(decision.routed).toBe(false);
      expect(decision.tags).toEqual([]);
      expect(decision.bank).toBeUndefined();
    });

    it("skips rules that throw errors and continues to next rule", () => {
      const throwingRule: RoutingRule = {
        id: "thrower",
        description: "Always throws",
        condition: () => {
          throw new Error("Boom!");
        },
        targetBank: "bank-thrower",
        tags: ["error"],
        priority: 100,
      };
      const fallbackRule = cwdRule("fallback", "bank-fallback", 50, "/project");

      const engine = new RoutingEngine(
        makeConfig({ enabled: true, rules: [throwingRule, fallbackRule] }),
      );

      const decision = engine.route(makeOrigin({ cwd: "/project/work" }));

      // Should skip the throwing rule and match the fallback
      expect(decision.routed).toBe(true);
      expect(decision.matchedRuleId).toBe("fallback");
      expect(decision.bank).toBe("bank-fallback");
    });
  });

  // ─── upsertRule() ───────────────────────────────────────────────

  describe("upsertRule()", () => {
    it("adds a new rule and re-sorts by priority", () => {
      const engine = new RoutingEngine(
        makeConfig({
          enabled: true,
          rules: [cwdRule("r1", "bank-a", 10, "/alpha")],
        }),
      );

      engine.upsertRule(cwdRule("r2", "bank-b", 50, "/beta"));

      const rules = engine.listRules();
      expect(rules).toHaveLength(2);
      // Higher priority (50) should come first
      expect(rules[0].id).toBe("r2");
      expect(rules[1].id).toBe("r1");
    });

    it("updates an existing rule by id", () => {
      const engine = new RoutingEngine(
        makeConfig({
          enabled: true,
          rules: [cwdRule("r1", "bank-old", 10, "/alpha", ["old-tag"])],
        }),
      );

      engine.upsertRule(cwdRule("r1", "bank-new", 20, "/alpha", ["new-tag"]));

      const rules = engine.listRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].targetBank).toBe("bank-new");
      expect(rules[0].tags).toEqual(["new-tag"]);
      expect(rules[0].priority).toBe(20);
    });
  });

  // ─── removeRule() ───────────────────────────────────────────────

  describe("removeRule()", () => {
    it("removes a rule by id and returns true", () => {
      const engine = new RoutingEngine(
        makeConfig({
          enabled: true,
          rules: [
            cwdRule("r1", "bank-a", 10, "/alpha"),
            cwdRule("r2", "bank-b", 20, "/beta"),
          ],
        }),
      );

      const result = engine.removeRule("r1");

      expect(result).toBe(true);
      expect(engine.listRules()).toHaveLength(1);
      expect(engine.listRules()[0].id).toBe("r2");
    });

    it("returns false for non-existent rule", () => {
      const engine = new RoutingEngine(
        makeConfig({
          enabled: true,
          rules: [cwdRule("r1", "bank-a", 10, "/alpha")],
        }),
      );

      const result = engine.removeRule("nonexistent");

      expect(result).toBe(false);
      expect(engine.listRules()).toHaveLength(1);
    });
  });

  // ─── listRules() ────────────────────────────────────────────────

  describe("listRules()", () => {
    it("returns rules in priority order", () => {
      const rules = [
        cwdRule("low", "bank-low", 1, "/low"),
        cwdRule("mid", "bank-mid", 50, "/mid"),
        cwdRule("high", "bank-high", 100, "/high"),
      ];
      const engine = new RoutingEngine(makeConfig({ enabled: true, rules }));

      const listed = engine.listRules();

      expect(listed.map((r) => r.id)).toEqual(["high", "mid", "low"]);
    });
  });
});
