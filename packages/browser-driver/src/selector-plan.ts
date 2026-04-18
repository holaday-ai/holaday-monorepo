import type { ResilientSelector } from '@holaday/shared-types';

/**
 * A single attempt in a ResilientSelector's fallback chain, rendered in a
 * Playwright-agnostic form. The Playwright-CRX adapter turns each of these
 * into `page.getByRole(...)`, `page.getByText(...)`, `page.locator(css)`,
 * etc. Keeping this translation data-only (no Playwright imports) lets us
 * unit-test the resolver in Node without a browser.
 */
export type LocatorSpec =
  | { how: 'role'; role: string; name?: string; exact: boolean }
  | { how: 'text'; value: string; exact: boolean }
  | { how: 'testid'; value: string; attr: string }
  | { how: 'css'; value: string }
  | { how: 'xpath'; value: string }
  | { how: 'label'; value: string; exact: boolean }
  | { how: 'placeholder'; value: string };

/** A scoped, prioritized plan produced from a ResilientSelector. */
export interface SelectorPlan {
  description: string;
  scopeCss?: string;
  nth?: number;
  timeoutMs: number;
  selfHeal: boolean;
  attempts: LocatorSpec[];
}

/**
 * Convert a ResilientSelector into a flat list of LocatorSpec attempts.
 * The adapter tries attempts in order; first one that resolves wins.
 * Malformed strategies (missing required fields for a given kind) are
 * skipped silently — the Anthropic commander sometimes emits those
 * (see W1 bug #3) and we never want the whole step to blow up on one
 * bad fallback.
 */
export function buildSelectorPlan(selector: ResilientSelector): SelectorPlan {
  const attempts: LocatorSpec[] = [];
  for (const s of selector.strategies) {
    const spec = toLocatorSpec(s);
    if (spec) attempts.push(spec);
  }
  return {
    description: selector.description,
    ...(selector.scope?.within ? { scopeCss: selector.scope.within } : {}),
    ...(selector.scope?.nth !== undefined ? { nth: selector.scope.nth } : {}),
    timeoutMs: selector.scope?.timeoutMs ?? 5_000,
    selfHeal: selector.selfHeal ?? true,
    attempts,
  };
}

function toLocatorSpec(s: ResilientSelector['strategies'][number]): LocatorSpec | null {
  switch (s.kind) {
    case 'role':
      if (!s.role) return null;
      return {
        how: 'role',
        role: s.role,
        ...(s.name ? { name: s.name } : {}),
        exact: s.exact ?? false,
      };
    case 'text':
      if (!s.value) return null;
      return { how: 'text', value: s.value, exact: s.exact ?? false };
    case 'testid':
      if (!s.value) return null;
      return { how: 'testid', value: s.value, attr: s.attr ?? 'data-testid' };
    case 'css':
      if (!s.value) return null;
      return { how: 'css', value: s.value };
    case 'xpath':
      if (!s.value) return null;
      return { how: 'xpath', value: s.value };
    case 'label':
      if (!s.value) return null;
      return { how: 'label', value: s.value, exact: s.exact ?? false };
    case 'placeholder':
      if (!s.value) return null;
      return { how: 'placeholder', value: s.value };
    default:
      return null;
  }
}
