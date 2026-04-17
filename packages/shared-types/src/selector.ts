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

export const selectorStrategySchema = z.discriminatedUnion('kind', [
  // ARIA role + accessible name — most stable when present.
  z.object({
    kind: z.literal('role'),
    role: z.string().min(1),
    name: z.string().optional(),
    exact: z.boolean().default(false),
  }),

  // Exact / substring text match.
  z.object({
    kind: z.literal('text'),
    value: z.string().min(1),
    exact: z.boolean().default(false),
  }),

  // data-* attribute — authors should prefer these when they control the DOM.
  z.object({
    kind: z.literal('testid'),
    value: z.string().min(1),
    attr: z.string().default('data-testid'),
  }),

  // CSS selector — brittle fallback.
  z.object({
    kind: z.literal('css'),
    value: z.string().min(1),
  }),

  // XPath — last resort for legacy pages.
  z.object({
    kind: z.literal('xpath'),
    value: z.string().min(1),
  }),

  // Label (for form controls) — "input labelled by <text>".
  z.object({
    kind: z.literal('label'),
    value: z.string().min(1),
    exact: z.boolean().default(false),
  }),

  // Visible-placeholder match — e.g. search boxes.
  z.object({
    kind: z.literal('placeholder'),
    value: z.string().min(1),
  }),
]);

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
