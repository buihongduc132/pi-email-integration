/**
 * Hook Manager — manages email lifecycle hooks.
 *
 * Supports registering handlers for email events:
 *   email:received, email:sent, email:read, email:deleted, email:routed
 *
 * Handlers are called in registration order. Errors are caught and logged
 * but do NOT block the email pipeline.
 */

import type { EmailHookContext, EmailHookEvent, EmailHookHandler } from "../types.js";

export class HookManager {
  private readonly handlers = new Map<EmailHookEvent, EmailHookHandler[]>();

  /**
   * Register a handler for a specific email event.
   */
  on(event: EmailHookEvent, handler: EmailHookHandler): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  /**
   * Remove a handler for a specific email event.
   */
  off(event: EmailHookEvent, handler: EmailHookHandler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    this.handlers.set(
      event,
      existing.filter((h) => h !== handler),
    );
  }

  /**
   * Fire an event — calls all registered handlers.
   * Errors are caught and logged but do NOT block execution.
   */
  async fire(ctx: EmailHookContext): Promise<void> {
    const handlers = this.handlers.get(ctx.event) ?? [];
    for (const handler of handlers) {
      try {
        await handler(ctx);
      } catch (err) {
        console.error(
          `[pi-email-integration] Hook handler error on ${ctx.event}:`,
          err,
        );
      }
    }
  }

  /**
   * List registered handlers for debugging.
   */
  listHandlers(event?: EmailHookEvent): Record<string, number> {
    if (event) {
      return { [event]: this.handlers.get(event)?.length ?? 0 };
    }
    const result: Record<string, number> = {};
    for (const [evt, handlers] of this.handlers) {
      result[evt] = handlers.length;
    }
    return result;
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
  }
}
