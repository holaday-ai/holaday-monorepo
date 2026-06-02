export interface HistorySyncSummary {
  ingested: number;
  topDomains: string[];
  at: number;
}

const MAX_HISTORY_SUMMARY_TOP_DOMAINS = 6;
const MAX_HISTORY_SUMMARY_DOMAIN_CHARS = 253;

export function normalizeHistorySummary(value: unknown): HistorySyncSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as {
    ingested?: unknown;
    topDomains?: unknown;
    at?: unknown;
  };
  if (
    typeof raw.ingested !== 'number' ||
    !Number.isFinite(raw.ingested) ||
    raw.ingested < 0
  ) {
    return null;
  }
  const topDomains = Array.isArray(raw.topDomains)
    ? uniqueStrings(
        raw.topDomains
          .filter((domain): domain is string => typeof domain === 'string')
          .map((domain) => domain.trim().slice(0, MAX_HISTORY_SUMMARY_DOMAIN_CHARS))
          .filter(Boolean),
      ).slice(0, MAX_HISTORY_SUMMARY_TOP_DOMAINS)
    : [];
  const at =
    typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0
      ? raw.at
      : Date.now();
  return {
    ingested: Math.floor(raw.ingested),
    topDomains,
    at,
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
