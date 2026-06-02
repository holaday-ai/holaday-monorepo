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

  it('clips oversized task fields before rendering side panel snapshots', () => {
    const [task] = normalizeTaskSnapshot([
      {
        taskId: `tsk_${'x'.repeat(300)}`,
        status: 'executing',
        steps: [
          {
            id: `step_${'i'.repeat(120)}`,
            kind: `browser_${'k'.repeat(120)}`,
            status: `running_${'s'.repeat(120)}`,
          },
        ],
        visionProgress: {
          phase: 'acting',
          actionKind: `click_${'a'.repeat(120)}`,
          detail: 'd'.repeat(2_000),
        },
      },
    ]);

    expect(task?.taskId).toHaveLength(128);
    expect(task?.steps[0]?.id).toHaveLength(80);
    expect(task?.steps[0]?.kind).toHaveLength(80);
    expect(task?.steps[0]?.status).toHaveLength(80);
    expect(task?.visionProgress?.actionKind).toHaveLength(80);
    expect(task?.visionProgress?.detail).toHaveLength(1_000);
  });

  it('falls back to an empty list for non-array snapshots', () => {
    expect(normalizeTaskSnapshot({ tasks: [] })).toEqual([]);
    expect(normalizeTaskSnapshot(undefined)).toEqual([]);
  });
});
