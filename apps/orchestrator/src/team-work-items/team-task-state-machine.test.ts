import { describe, expect, it } from 'vitest';
import {
  TEAM_TASK_COMMAND_TYPES,
  TEAM_TASK_STATES,
  type TeamTaskCommand,
  type TeamTaskState,
  transitionTeamTask,
} from './team-task-state-machine.js';

const NOW = '2026-08-31T00:00:00.000Z';
const DUE_AT = '2026-09-01T00:00:00.000Z';

function current(state: TeamTaskState, appealOpen = false) {
  return { state, appealOpen } as const;
}

const validCommands = {
  publish: { type: 'publish' },
  assign: { type: 'assign' },
  make_claimable: { type: 'make_claimable' },
  accept_assignment: { type: 'accept_assignment' },
  claim: { type: 'claim' },
  start: { type: 'start' },
  block: {
    type: 'block',
    responsibleParty: 'manager-1',
    nextAction: 'Provide the missing source file',
    reviewAt: '2026-08-31T01:00:00.000Z',
    affectsDueDate: false,
    now: NOW,
  },
  unblock: { type: 'unblock' },
  submit: { type: 'submit', submittedAt: NOW, dueAt: DUE_AT },
  start_review: { type: 'start_review' },
  request_revision: {
    type: 'request_revision',
    failedCriterionIds: ['criterion-1'],
    evidenceReferences: [{ kind: 'evidence', reference: 'artifact-1' }],
    revisionInstructions: ['Correct the total in row 4'],
    newDeadline: '2026-09-02T00:00:00.000Z',
    reviewAt: NOW,
  },
  resubmit: { type: 'resubmit', submittedAt: NOW, dueAt: DUE_AT },
  accept: { type: 'accept' },
  complete: { type: 'complete' },
  cancel: { type: 'cancel' },
  reject_final: { type: 'reject_final', finalDecisionAuthorized: true },
  archive: { type: 'archive' },
} as const satisfies Record<(typeof TEAM_TASK_COMMAND_TYPES)[number], TeamTaskCommand>;

const legalTransitions = [
  ['draft', 'publish', 'ready'],
  ['ready', 'assign', 'assigned'],
  ['ready', 'make_claimable', 'claimable'],
  ['assigned', 'accept_assignment', 'accepted_by_member'],
  ['claimable', 'claim', 'accepted_by_member'],
  ['accepted_by_member', 'start', 'in_progress'],
  ['in_progress', 'block', 'blocked'],
  ['blocked', 'unblock', 'in_progress'],
  ['in_progress', 'submit', 'submitted'],
  ['submitted', 'start_review', 'in_review'],
  ['in_review', 'request_revision', 'revision_requested'],
  ['revision_requested', 'resubmit', 'resubmitted'],
  ['resubmitted', 'start_review', 'in_review'],
  ['in_review', 'accept', 'accepted'],
  ['accepted', 'complete', 'completed'],
  ['draft', 'cancel', 'cancelled'],
  ['ready', 'cancel', 'cancelled'],
  ['assigned', 'cancel', 'cancelled'],
  ['claimable', 'cancel', 'cancelled'],
  ['accepted_by_member', 'cancel', 'cancelled'],
  ['in_progress', 'cancel', 'cancelled'],
  ['blocked', 'cancel', 'cancelled'],
  ['in_review', 'reject_final', 'rejected_final'],
  ['completed', 'archive', 'archived'],
  ['cancelled', 'archive', 'archived'],
  ['rejected_final', 'archive', 'archived'],
] as const satisfies readonly (readonly [
  TeamTaskState,
  keyof typeof validCommands,
  TeamTaskState,
])[];

describe('team task state machine', () => {
  it.each([
    [null, { type: 'publish' }, 'INVALID_CURRENT'],
    [undefined, { type: 'publish' }, 'INVALID_CURRENT'],
    [{ appealOpen: false }, { type: 'publish' }, 'INVALID_CURRENT'],
    [{ state: 'unknown', appealOpen: false }, { type: 'publish' }, 'INVALID_CURRENT'],
    [{ state: 'toString', appealOpen: false }, { type: 'publish' }, 'INVALID_CURRENT'],
    [{ state: 'draft' }, { type: 'publish' }, 'INVALID_CURRENT'],
    [{ state: 'draft', appealOpen: 'false' }, { type: 'publish' }, 'INVALID_CURRENT'],
  ] as const)('fails closed for malformed current %#', (malformedCurrent, command, code) => {
    expect(
      transitionTeamTask(
        malformedCurrent as unknown as Parameters<typeof transitionTeamTask>[0],
        command as TeamTaskCommand,
      ),
    ).toEqual({ ok: false, code });
  });

  it('requires state to be an own property of current', () => {
    const inheritedState = Object.assign(Object.create({ state: 'draft' }), {
      appealOpen: false,
    });
    expect(
      transitionTeamTask(
        inheritedState as Parameters<typeof transitionTeamTask>[0],
        validCommands.publish,
      ),
    ).toEqual({ ok: false, code: 'INVALID_CURRENT' });
  });

  it.each([
    [null, 'INVALID_COMMAND'],
    [undefined, 'INVALID_COMMAND'],
    [{}, 'INVALID_COMMAND'],
    [{ type: 'unknown' }, 'INVALID_COMMAND'],
    [{ type: 'toString' }, 'INVALID_COMMAND'],
  ] as const)('fails closed for malformed command %#', (malformedCommand, code) => {
    expect(
      transitionTeamTask(
        current('draft'),
        malformedCommand as unknown as Parameters<typeof transitionTeamTask>[1],
      ),
    ).toEqual({ ok: false, code });
  });

  it('requires type to be an own property of command', () => {
    const inheritedType = Object.create({ type: 'publish' });
    expect(
      transitionTeamTask(
        current('draft'),
        inheritedType as Parameters<typeof transitionTeamTask>[1],
      ),
    ).toEqual({ ok: false, code: 'INVALID_COMMAND' });
  });

  it.each(legalTransitions)('allows %s --%s--> %s', (from, commandType, to) => {
    expect(transitionTeamTask(current(from), validCommands[commandType])).toMatchObject({
      ok: true,
      state: to,
    });
  });

  it('rejects every state/command pair outside the closed legal matrix', () => {
    const allowed = new Set(legalTransitions.map(([from, command]) => `${from}:${command}`));

    for (const state of TEAM_TASK_STATES) {
      for (const commandType of TEAM_TASK_COMMAND_TYPES) {
        if (allowed.has(`${state}:${commandType}`)) continue;

        expect(
          transitionTeamTask(current(state), validCommands[commandType]),
          `${state} must reject ${commandType}`,
        ).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
      }
    }
  });

  it.each(['completed', 'cancelled', 'rejected_final'] as const)(
    'allows %s to mutate only through explicit archive',
    (state) => {
      expect(transitionTeamTask(current(state), { type: 'archive' })).toEqual({
        ok: true,
        state: 'archived',
      });
      expect(transitionTeamTask(current(state), { type: 'cancel' })).toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    },
  );

  it('gives archived no outgoing transition', () => {
    for (const commandType of TEAM_TASK_COMMAND_TYPES) {
      expect(transitionTeamTask(current('archived'), validCommands[commandType])).toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
  });

  it.each([
    ['responsibleParty', '', 'BLOCK_RESPONSIBLE_PARTY_REQUIRED'],
    ['nextAction', '   ', 'BLOCK_NEXT_ACTION_REQUIRED'],
    ['reviewAt', 'not-a-date', 'BLOCK_REVIEW_AT_INVALID'],
    ['reviewAt', NOW, 'BLOCK_REVIEW_AT_NOT_FUTURE'],
  ] as const)('rejects block when %s is independently invalid', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_progress'), {
        ...validCommands.block,
        [field]: value,
      }),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ['responsibleParty', 'BLOCK_RESPONSIBLE_PARTY_REQUIRED'],
    ['nextAction', 'BLOCK_NEXT_ACTION_REQUIRED'],
    ['reviewAt', 'BLOCK_REVIEW_AT_INVALID'],
    ['now', 'BLOCK_REFERENCE_TIME_INVALID'],
    ['affectsDueDate', 'BLOCK_AFFECTS_DUE_DATE_REQUIRED'],
  ] as const)('rejects block when %s is independently missing', (field, code) => {
    const malformed = { ...validCommands.block } as Record<string, unknown>;
    delete malformed[field];

    expect(
      transitionTeamTask(current('in_progress'), malformed as unknown as TeamTaskCommand),
    ).toEqual({ ok: false, code });
  });

  it('rejects block when affectsDueDate is missing without treating false as missing', () => {
    const { affectsDueDate: _omitted, ...missingFlag } = validCommands.block;
    expect(
      transitionTeamTask(current('in_progress'), missingFlag as unknown as TeamTaskCommand),
    ).toEqual({ ok: false, code: 'BLOCK_AFFECTS_DUE_DATE_REQUIRED' });

    expect(transitionTeamTask(current('in_progress'), validCommands.block)).toEqual({
      ok: true,
      state: 'blocked',
      blocker: {
        responsibleParty: 'manager-1',
        nextAction: 'Provide the missing source file',
        reviewAt: '2026-08-31T01:00:00.000Z',
        affectsDueDate: false,
      },
    });
  });

  it.each([
    ['responsibleParty', 'x'.repeat(129), 'BLOCK_RESPONSIBLE_PARTY_TOO_LONG'],
    ['nextAction', 'x'.repeat(1001), 'BLOCK_NEXT_ACTION_TOO_LONG'],
  ] as const)('rejects an unbounded block %s', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_progress'), {
        ...validCommands.block,
        [field]: value,
      }),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ['failedCriterionIds', [], 'REVISION_FAILED_CRITERIA_REQUIRED'],
    ['failedCriterionIds', ['  '], 'REVISION_FAILED_CRITERIA_REQUIRED'],
    ['evidenceReferences', [], 'REVISION_EVIDENCE_REQUIRED'],
    [
      'evidenceReferences',
      [{ kind: 'missing_evidence', reference: '   ' }],
      'REVISION_EVIDENCE_REQUIRED',
    ],
    ['revisionInstructions', [], 'REVISION_INSTRUCTIONS_REQUIRED'],
    ['revisionInstructions', ['  '], 'REVISION_INSTRUCTIONS_REQUIRED'],
    ['newDeadline', 'not-a-date', 'REVISION_DEADLINE_INVALID'],
    ['newDeadline', NOW, 'REVISION_DEADLINE_NOT_FUTURE'],
    ['reviewAt', 'not-a-date', 'REVISION_REFERENCE_TIME_INVALID'],
  ] as const)('rejects revision request when %s is independently invalid', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        [field]: value,
      } as TeamTaskCommand),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ['failedCriterionIds', 'REVISION_FAILED_CRITERIA_REQUIRED'],
    ['evidenceReferences', 'REVISION_EVIDENCE_REQUIRED'],
    ['revisionInstructions', 'REVISION_INSTRUCTIONS_REQUIRED'],
    ['newDeadline', 'REVISION_DEADLINE_INVALID'],
    ['reviewAt', 'REVISION_REFERENCE_TIME_INVALID'],
  ] as const)('rejects revision request when %s is independently missing', (field, code) => {
    const malformed = { ...validCommands.request_revision } as Record<string, unknown>;
    delete malformed[field];

    expect(
      transitionTeamTask(current('in_review'), malformed as unknown as TeamTaskCommand),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ['failedCriterionIds', ['x'.repeat(101)], 'REVISION_FAILED_CRITERIA_TOO_LONG'],
    [
      'evidenceReferences',
      [{ kind: 'evidence', reference: 'x'.repeat(501) }],
      'REVISION_EVIDENCE_TOO_LONG',
    ],
    ['revisionInstructions', ['x'.repeat(1001)], 'REVISION_INSTRUCTIONS_TOO_LONG'],
    [
      'failedCriterionIds',
      Array.from({ length: 101 }, (_, index) => `criterion-${index}`),
      'REVISION_FAILED_CRITERIA_COUNT_EXCEEDED',
    ],
    [
      'evidenceReferences',
      Array.from({ length: 101 }, (_, index) => ({
        kind: 'evidence' as const,
        reference: `artifact-${index}`,
      })),
      'REVISION_EVIDENCE_COUNT_EXCEEDED',
    ],
    [
      'revisionInstructions',
      Array.from({ length: 51 }, (_, index) => `Correct item ${index}`),
      'REVISION_INSTRUCTIONS_COUNT_EXCEEDED',
    ],
  ] as const)('rejects bounded revision field %s when over limit', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        [field]: value,
      } as TeamTaskCommand),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ['failedCriterionIds', ['criterion-1', 42], 'REVISION_FAILED_CRITERIA_INVALID'],
    [
      'evidenceReferences',
      [{ kind: 'evidence', reference: 'artifact-1' }, null],
      'REVISION_EVIDENCE_INVALID',
    ],
    [
      'evidenceReferences',
      [
        { kind: 'evidence', reference: 'artifact-1' },
        { kind: 'evidence', reference: 42 },
      ],
      'REVISION_EVIDENCE_INVALID',
    ],
    ['revisionInstructions', ['Correct row 4', {}], 'REVISION_INSTRUCTIONS_INVALID'],
  ] as const)('rejects the whole revision request for mixed malformed %s', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        [field]: value,
      } as unknown as TeamTaskCommand),
    ).toEqual({ ok: false, code });
  });

  it('rejects sparse failed criterion IDs without throwing', () => {
    const failedCriterionIds = ['criterion-1'];
    failedCriterionIds.length = 2;

    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        failedCriterionIds,
      }),
    ).toEqual({ ok: false, code: 'REVISION_FAILED_CRITERIA_INVALID' });
  });

  it('rejects sparse revision instructions without throwing', () => {
    const revisionInstructions = ['Correct row 4'];
    revisionInstructions.length = 2;

    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        revisionInstructions,
      }),
    ).toEqual({ ok: false, code: 'REVISION_INSTRUCTIONS_INVALID' });
  });

  it('rejects sparse evidence references with a stable evidence code', () => {
    const evidenceReferences = [{ kind: 'evidence' as const, reference: 'artifact-1' }];
    evidenceReferences.length = 2;

    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        evidenceReferences,
      }),
    ).toEqual({ ok: false, code: 'REVISION_EVIDENCE_INVALID' });
  });

  it('normalizes revision fields while preserving missing-evidence semantics', () => {
    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        failedCriterionIds: [' criterion-1 ', 'criterion-1', 'criterion-2'],
        evidenceReferences: [
          { kind: 'evidence', reference: ' artifact-1 ' },
          { kind: 'missing_evidence', reference: 'source spreadsheet' },
          { kind: 'missing_evidence', reference: ' source spreadsheet ' },
        ],
        revisionInstructions: [' Correct row 4 ', 'Correct row 4', 'Add the source link'],
      }),
    ).toEqual({
      ok: true,
      state: 'revision_requested',
      revision: {
        failedCriterionIds: ['criterion-1', 'criterion-2'],
        evidenceReferences: [
          { kind: 'evidence', reference: 'artifact-1' },
          { kind: 'missing_evidence', reference: 'source spreadsheet' },
        ],
        revisionInstructions: ['Correct row 4', 'Add the source link'],
        newDeadline: '2026-09-02T00:00:00.000Z',
      },
    });
  });

  it.each([
    ['submit', '2026-08-31T23:59:59.999Z', true],
    ['submit', DUE_AT, true],
    ['submit', '2026-09-01T00:00:00.001Z', false],
    ['resubmit', '2026-08-31T23:59:59.999Z', true],
    ['resubmit', DUE_AT, true],
    ['resubmit', '2026-09-01T00:00:00.001Z', false],
  ] as const)(
    'derives submittedOnTime for %s at the due boundary',
    (commandType, submittedAt, submittedOnTime) => {
      const state = commandType === 'submit' ? 'in_progress' : 'revision_requested';
      expect(
        transitionTeamTask(current(state), { type: commandType, submittedAt, dueAt: DUE_AT }),
      ).toMatchObject({
        ok: true,
        submission: { submittedAt, dueAt: DUE_AT, submittedOnTime },
      });
    },
  );

  it.each([
    ['submittedAt', 'not-a-date', 'SUBMITTED_AT_INVALID'],
    ['dueAt', 'not-a-date', 'DUE_AT_INVALID'],
  ] as const)('rejects malformed submission %s', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_progress'), {
        ...validCommands.submit,
        [field]: value,
      }),
    ).toEqual({ ok: false, code });
  });

  it.each([
    ['submittedAt', '2026-09-31T00:00:00.000Z', 'SUBMITTED_AT_INVALID'],
    ['submittedAt', '2026-09-01T00:00:00', 'SUBMITTED_AT_INVALID'],
    ['submittedAt', '2026-09-01T00:00:00.0000Z', 'SUBMITTED_AT_INVALID'],
    ['dueAt', '2026-09-31T00:00:00.000Z', 'DUE_AT_INVALID'],
  ] as const)('rejects non-strict submission timestamp %s', (field, value, code) => {
    expect(
      transitionTeamTask(current('in_progress'), {
        ...validCommands.submit,
        [field]: value,
      }),
    ).toEqual({ ok: false, code });
  });

  it.each([
    [
      'block',
      current('in_progress'),
      { ...validCommands.block, reviewAt: '2026-09-31T00:00:00.000Z' },
      'BLOCK_REVIEW_AT_INVALID',
    ],
    [
      'block reference',
      current('in_progress'),
      { ...validCommands.block, now: '2026-09-31T00:00:00.000Z' },
      'BLOCK_REFERENCE_TIME_INVALID',
    ],
    [
      'revision deadline',
      current('in_review'),
      { ...validCommands.request_revision, newDeadline: '2026-09-31T00:00:00.000Z' },
      'REVISION_DEADLINE_INVALID',
    ],
    [
      'revision reference',
      current('in_review'),
      { ...validCommands.request_revision, reviewAt: '2026-09-31T00:00:00.000Z' },
      'REVISION_REFERENCE_TIME_INVALID',
    ],
  ] as const)('rejects impossible ISO UTC calendar date for %s', (_label, task, command, code) => {
    expect(transitionTeamTask(task, command as TeamTaskCommand)).toEqual({ ok: false, code });
  });

  it('canonicalizes accepted ISO UTC instants in returned snapshots', () => {
    expect(
      transitionTeamTask(current('in_progress'), {
        ...validCommands.block,
        now: '2026-08-31T00:00:00Z',
        reviewAt: '2026-08-31T01:00:00Z',
      }),
    ).toMatchObject({ blocker: { reviewAt: '2026-08-31T01:00:00.000Z' } });
    expect(
      transitionTeamTask(current('in_progress'), {
        type: 'submit',
        submittedAt: '2026-08-31T00:00:00Z',
        dueAt: '2026-09-01T00:00:00Z',
      }),
    ).toMatchObject({
      submission: {
        submittedAt: '2026-08-31T00:00:00.000Z',
        dueAt: '2026-09-01T00:00:00.000Z',
      },
    });
    expect(
      transitionTeamTask(current('in_review'), {
        ...validCommands.request_revision,
        reviewAt: '2026-08-31T00:00:00Z',
        newDeadline: '2026-09-02T00:00:00Z',
      }),
    ).toMatchObject({ revision: { newDeadline: '2026-09-02T00:00:00.000Z' } });
  });

  it.each([
    ['submittedAt', 'SUBMITTED_AT_INVALID'],
    ['dueAt', 'DUE_AT_INVALID'],
  ] as const)('rejects submission when %s is independently missing', (field, code) => {
    const malformed = { ...validCommands.submit } as Record<string, unknown>;
    delete malformed[field];

    expect(
      transitionTeamTask(current('in_progress'), malformed as unknown as TeamTaskCommand),
    ).toEqual({ ok: false, code });
  });

  it('does not calculate or change submission timing from accepted or later states', () => {
    for (const state of [
      'accepted',
      'completed',
      'cancelled',
      'rejected_final',
      'archived',
    ] as const) {
      expect(transitionTeamTask(current(state), validCommands.submit)).toEqual({
        ok: false,
        code: 'INVALID_TRANSITION',
      });
    }
  });

  it('requires an authorized final decision and no open appeal for final rejection', () => {
    expect(
      transitionTeamTask(current('in_review'), {
        type: 'reject_final',
        finalDecisionAuthorized: false,
      }),
    ).toEqual({ ok: false, code: 'FINAL_DECISION_REQUIRED' });
    expect(
      transitionTeamTask(current('in_review', true), {
        type: 'reject_final',
        finalDecisionAuthorized: true,
      }),
    ).toEqual({ ok: false, code: 'APPEAL_OPEN' });
  });

  it.each(['completed', 'cancelled', 'rejected_final'] as const)(
    'blocks archiving %s while an appeal is open',
    (state) => {
      expect(transitionTeamTask(current(state, true), { type: 'archive' })).toEqual({
        ok: false,
        code: 'APPEAL_OPEN',
      });
    },
  );
});
