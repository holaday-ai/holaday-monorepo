import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ObservedEvidence, assessCompletionFacts } from './completion-fields.js';

/**
 * BROWSER-AUTOPILOT-1 — every real model finish seen in local evaluations
 * (accepted or rejected) is kept here so a gate change cannot silently
 * start rejecting correct answers again, or start accepting reports of pages
 * that never loaded.
 */
interface CorpusEntry {
  id: string;
  intent: string;
  summary: string;
  evidence?: string;
  fields?: Array<{ name: string; value: string; tabId?: string; sourceURL?: string }>;
  pages: ObservedEvidence[];
  toolTexts?: string;
  expect: 'deliver' | 'contradiction';
  /** A known misjudgement still open after BROWSER-AUTOPILOT-1 (kept visible as todo). */
  open?: boolean;
}
const corpus = JSON.parse(
  readFileSync(
    new URL('../../../scripts/browser-eval/finish-corpus.json', import.meta.url),
    'utf8',
  ),
) as { entries: CorpusEntry[] };

describe('real model finish corpus', () => {
  it('holds every recorded real finish', () => {
    expect(corpus.entries.length).toBeGreaterThanOrEqual(14);
  });
  for (const entry of corpus.entries.filter((e) => e.open)) it.todo(`OPEN: ${entry.id}`);
  it.each(corpus.entries.filter((e) => !e.open).map((entry) => [entry.id, entry] as const))(
    '%s',
    (_id, entry) => {
      const result = assessCompletionFacts({
        summary: entry.summary,
        fields: entry.fields,
        pages: entry.pages,
        intent: entry.intent,
        ...(entry.toolTexts ? { toolTexts: entry.toolTexts } : {}),
      });
      if (entry.expect === 'deliver') expect(result.contradictions).toEqual([]);
      else expect(result.contradictions.length).toBeGreaterThan(0);
    },
  );
});
