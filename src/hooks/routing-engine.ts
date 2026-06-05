/**
 * Hindsight Routing Engine — dynamically routes emails to Hindsight banks.
 *
 * Rules are evaluated in priority order (highest first).
 * First matching rule wins. If no rule matches, falls back to defaultBank.
 * If Hindsight is disabled, routing is skipped entirely.
 */

import type {
  EmailOrigin,
  HindsightHookConfig,
  RoutingRule,
} from "../types.js";

export interface RoutingDecision {
  /** Whether routing was performed */
  routed: boolean;
  /** Target bank (undefined if not routed) */
  bank?: string;
  /** Tags applied */
  tags: string[];
  /** Which rule matched (undefined if default or skipped) */
  matchedRuleId?: string;
}

export class RoutingEngine {
  private readonly config: HindsightHookConfig;
  private sortedRules: RoutingRule[];

  constructor(config: HindsightHookConfig) {
    this.config = config;
    // Sort rules by priority descending (highest first)
    this.sortedRules = [...config.rules].sort(
      (a, b) => b.priority - a.priority,
    );
  }

  /**
   * Whether Hindsight integration is enabled.
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Evaluate routing rules against an email origin.
   */
  route(origin: EmailOrigin): RoutingDecision {
    if (!this.config.enabled) {
      return { routed: false, tags: [] };
    }

    for (const rule of this.sortedRules) {
      try {
        if (rule.condition(origin)) {
          return {
            routed: true,
            bank: rule.targetBank,
            tags: rule.tags,
            matchedRuleId: rule.id,
          };
        }
      } catch {
        // Rule evaluation failed — skip this rule, try next
        continue;
      }
    }

    // No rule matched — use default bank if configured
    if (this.config.defaultBank) {
      return {
        routed: true,
        bank: this.config.defaultBank,
        tags: [],
      };
    }

    return { routed: false, tags: [] };
  }

  /**
   * Add or update a routing rule at runtime.
   */
  upsertRule(rule: RoutingRule): void {
    const idx = this.sortedRules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.sortedRules[idx] = rule;
    } else {
      this.sortedRules.push(rule);
    }
    this.sortedRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a routing rule by ID.
   */
  removeRule(ruleId: string): boolean {
    const len = this.sortedRules.length;
    this.sortedRules = this.sortedRules.filter((r) => r.id !== ruleId);
    return this.sortedRules.length < len;
  }

  /**
   * List all active rules (in priority order).
   */
  listRules(): ReadonlyArray<Readonly<RoutingRule>> {
    return this.sortedRules;
  }
}
