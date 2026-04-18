import { z } from 'zod';

/**
 * ResilientSelector — how the orchestrator tells the driver to find an element.
 *
 * The DOM on target sites (千牛, 生意参谋, 券商 Web 端, ...) changes often.
 * A single CSS selector is too brittle. ResilientSelector is a **prioritized
 * fallback chain** of candidate strategies. The driver tries them in order
 * and returns the first hit.
 *
 * Selected before execution by the Skill author; may be **regenerated at
 * runtime** by Claude when no strategy resolves (self-healing).
 */

/**
 * Permissive strategy schema: `kind` is required and constrained, everything
 * else is optional and best-effort. The driver layer (Playwright-CRX adapter,
 * W2) is responsible for per-kind validation — e.g. rejecting a 'css' strategy
 * without `value` at resolve time. Phase 0's commander (Claude Opus) doesn't
 * always fill every field correctly; being permissive here avoids blowing up
 * the whole plan on a single malformed fallback selector.
 */
export const selectorStrategySchema = z.object({
  kind: z.enum(['role', 'text', 'testid', 'css', 'xpath', 'label', 'placeholder']),
  value: z.string().optional(),
  role: z.string().optional(),
  name: z.string().optional(),
  attr: z.string().optional(),
  exact: z.boolean().optional(),
});

export type SelectorStrategy = z.infer<typeof selectorStrategySchema>;

export const resilientSelectorSchema = z.object({
  // Human-readable label so logs read "ResilientSelector(click '下一页')".
  description: z.string().min(1),

  // Ordered fallbacks. First match wins.
  strategies: z.array(selectorStrategySchema).min(1),

  // Optional hints for the driver.
  scope: z
    .object({
      // CSS selector scoping search (e.g. a specific iframe or panel).
      within: z.string().optional(),
      // Nth match when multiple nodes satisfy the strategy.
      nth: z.number().int().nonnegative().optional(),
      // Wait up to this many ms before giving up.
      timeoutMs: z.number().int().positive().default(5_000),
    })
    .default({ timeoutMs: 5_000 }),

  // Allow Claude to regenerate strategies at runtime when all fail.
  selfHeal: z.boolean().default(true),
});

export type ResilientSelector = z.infer<typeof resilientSelectorSchema>;

// ---------- Helpers ----------

/**
 * Build a ResilientSelector from the most common stable-first pattern:
 * role → text → testid → css. Pass any subset.
 */
export function buildResilientSelector(input: {
  description: string;
  role?: { role: string; name?: string };
  text?: string;
  testid?: string;
  css?: string;
  timeoutMs?: number;
}): ResilientSelector {
  const strategies: SelectorStrategy[] = [];
  if (input.role) {
    strategies.push({
      kind: 'role',
      role: input.role.role,
      name: input.role.name,
      exact: false,
    });
  }
  if (input.text) {
    strategies.push({ kind: 'text', value: input.text, exact: false });
  }
  if (input.testid) {
    strategies.push({ kind: 'testid', value: input.testid, attr: 'data-testid' });
  }
  if (input.css) {
    strategies.push({ kind: 'css', value: input.css });
  }

  return resilientSelectorSchema.parse({
    description: input.description,
    strategies,
    scope: { timeoutMs: input.timeoutMs ?? 5_000 },
    selfHeal: true,
  });
}
