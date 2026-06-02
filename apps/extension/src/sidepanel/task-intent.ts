export const MAX_SIDE_PANEL_INTENT_CHARS = 4_000;

export function normalizeSidePanelIntent(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed.length > MAX_SIDE_PANEL_INTENT_CHARS
    ? trimmed.slice(0, MAX_SIDE_PANEL_INTENT_CHARS)
    : trimmed;
}
