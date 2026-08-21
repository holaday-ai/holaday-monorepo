import { describe, expect, it } from 'vitest';

import {
  buildEvalAcceptanceSnapshot,
  requiresEvalAcceptanceSnapshot,
  satisfiesEvalAcceptanceSnapshot,
} from './eval-acceptance-snapshot.js';

describe('buildEvalAcceptanceSnapshot', () => {
  it('reduces persisted records to counts without retaining raw facts or action values', () => {
    const snapshot = buildEvalAcceptanceSnapshot({
      evidenceJson: JSON.stringify({
        entries: [
          { sourceType: 'user_input', fact: 'private user text' },
          { sourceType: 'tool_result', fact: 'https://example.com/private-path' },
          { sourceType: 'tool_result', fact: 'another raw fact' },
        ],
      }),
      outputFileMimeTypes: ['application/pdf', 'image/jpeg', 'application/pdf'],
      actionCaptureTypes: ['navigate', 'click', 'click', 'type'],
    });

    expect(snapshot).toEqual({
      evidenceEntryCount: 3,
      evidenceSourceTypeCounts: { user_input: 1, tool_result: 2 },
      outputFileCount: 3,
      outputMimeTypeCounts: { 'application/pdf': 2, 'image/jpeg': 1 },
      actionCaptureTypeCounts: { navigate: 1, click: 2, type: 1 },
    });
    expect(JSON.stringify(snapshot)).not.toContain('private user text');
    expect(JSON.stringify(snapshot)).not.toContain('private-path');
  });

  it('treats malformed or absent persisted evidence as an empty ledger', () => {
    expect(
      buildEvalAcceptanceSnapshot({
        evidenceJson: '{not-json',
        outputFileMimeTypes: [],
        actionCaptureTypes: [],
      }),
    ).toEqual({
      evidenceEntryCount: 0,
      evidenceSourceTypeCounts: {},
      outputFileCount: 0,
      outputMimeTypeCounts: {},
      actionCaptureTypeCounts: {},
    });
  });
});

describe('requiresEvalAcceptanceSnapshot', () => {
  it('loads database aggregates only for cases that declare persisted acceptance gates', () => {
    expect(requiresEvalAcceptanceSnapshot({ mustComplete: true })).toBe(false);
    expect(
      requiresEvalAcceptanceSnapshot({
        mustComplete: true,
        requiredActionCaptureTypes: ['navigate'],
      }),
    ).toBe(true);
  });
});

describe('satisfiesEvalAcceptanceSnapshot', () => {
  it('waits for every declared persisted gate, not only action captures', () => {
    const expectations = {
      mustComplete: true,
      minEvidenceEntries: 2,
      requiredEvidenceSourceTypes: ['tool_result' as const],
      minOutputFiles: 1,
      requiredOutputMimeTypes: ['application/pdf'],
      requiredActionCaptureTypes: ['navigate' as const],
    };

    expect(
      satisfiesEvalAcceptanceSnapshot(
        {
          evidenceEntryCount: 0,
          evidenceSourceTypeCounts: {},
          outputFileCount: 1,
          outputMimeTypeCounts: { 'application/pdf': 1 },
          actionCaptureTypeCounts: { navigate: 1 },
        },
        expectations,
      ),
    ).toBe(false);
    expect(
      satisfiesEvalAcceptanceSnapshot(
        {
          evidenceEntryCount: 2,
          evidenceSourceTypeCounts: { user_input: 1, tool_result: 1 },
          outputFileCount: 1,
          outputMimeTypeCounts: { 'application/pdf': 1 },
          actionCaptureTypeCounts: { navigate: 1 },
        },
        expectations,
      ),
    ).toBe(true);
  });
});
