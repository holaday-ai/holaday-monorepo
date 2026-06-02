import { describe, expect, it } from 'vitest';
import { normalizeTaskSnapshot } from './task-snapshot.js';

describe('normalizeTaskSnapshot', () => {
  it('keeps valid task rows and normalizes optional progress details', () => {
    expect(
      normalizeTaskSnapshot([
        {
          taskId: ' task-1 ',
          status: 'executing',
          lastUpdated: 123,
          steps: [
            { id: 'step-1', kind: 'browser', status: 'running' },
            { id: '', kind: 'browser', status: 'running' },
          ],
          visionProgress: {
            phase: 'acting',
            tickIndex: 2.8,
            actionKind: 'click',
            detail: 'Clicking submit',
          },
        },
      ]),
    ).toEqual([
      {
        taskId: 'task-1',
        status: 'executing',
        lastUpdated: 123,
        steps: [{ id: 'step-1', kind: 'browser', status: 'running' }],
        visionProgress: {
          phase: 'acting',
          tickIndex: 2,
          actionKind: 'click',
          detail: 'Clicking submit',
        },
      },
    ]);
  });

  it('drops malformed tasks instead of letting the side panel render invalid state', () => {
    expect(
      normalizeTaskSnapshot([
        null,
        { taskId: 'ok', status: 'planning', steps: [], lastUpdated: Number.NaN },
        { taskId: 'bad-status', status: 'unknown', steps: [] },
        { taskId: '', status: 'completed', steps: [] },
      ]),
    ).toEqual([{ taskId: 'ok', status: 'planning', steps: [], lastUpdated: 0 }]);
  });

  it('falls back to an empty list for non-array snapshots', () => {
    expect(normalizeTaskSnapshot({ tasks: [] })).toEqual([]);
    expect(normalizeTaskSnapshot(undefined)).toEqual([]);
  });
});
