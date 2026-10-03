import type { BrowserSnapshot, SnapshotElement } from '../replay/browser-tools.js';
import type { Locator } from './path-template.js';

/**
 * Deterministic role + name (+ text feature) element resolution against a
 * snapshot. No model, no fuzzy scoring: a locator either resolves to exactly
 * the element it describes, or it fails and the executor escalates to a
 * local model repair. Matching is case/whitespace-normalised only.
 */

const ROLE_ALIASES: Readonly<Record<string, string>> = {
  searchbox: 'textbox',
  combobox: 'combobox',
  menuitem: 'menuitem',
};

export function normaliseRole(role: string): string {
  const r = role.trim().toLowerCase();
  return ROLE_ALIASES[r] ?? r;
}

export function normaliseText(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export type LocatorResolution =
  | { kind: 'found'; element: SnapshotElement; matchedBy: 'exact' | 'contains' }
  | { kind: 'not_found' }
  | { kind: 'out_of_range'; candidates: number };

function textFeaturesMatch(el: SnapshotElement, locator: Locator): boolean {
  if (!locator.textContains?.length) return true;
  const hay = normaliseText(`${el.name} ${el.text ?? ''}`);
  return locator.textContains.every((t) => hay.includes(normaliseText(t)));
}

export function resolveLocator(snapshot: BrowserSnapshot, locator: Locator): LocatorResolution {
  const role = normaliseRole(locator.role);
  const name = normaliseText(locator.name);
  const sameRole = snapshot.elements.filter(
    (el) => normaliseRole(el.role) === role && textFeaturesMatch(el, locator),
  );
  const nth = locator.nth ?? 0;
  const exact = sameRole.filter((el) => normaliseText(el.name) === name);
  if (exact.length > 0) {
    const element = exact[nth];
    return element
      ? { kind: 'found', element, matchedBy: 'exact' }
      : { kind: 'out_of_range', candidates: exact.length };
  }
  // A name-less locator (role/text only) never falls through to `contains`.
  if (!name) return { kind: 'not_found' };
  const contains = sameRole.filter((el) => normaliseText(el.name).includes(name));
  if (contains.length > 0) {
    const element = contains[nth];
    return element
      ? { kind: 'found', element, matchedBy: 'contains' }
      : { kind: 'out_of_range', candidates: contains.length };
  }
  return { kind: 'not_found' };
}

/** Build the stable locator that identifies `element` inside `snapshot` (inverse of resolve). */
export function locatorForElement(snapshot: BrowserSnapshot, element: SnapshotElement): Locator {
  const role = normaliseRole(element.role);
  const peers = snapshot.elements.filter(
    (el) =>
      normaliseRole(el.role) === role && normaliseText(el.name) === normaliseText(element.name),
  );
  const nth = peers.findIndex((el) => el.ref === element.ref);
  return {
    role,
    name: element.name,
    ...(nth > 0 ? { nth } : {}),
  };
}
