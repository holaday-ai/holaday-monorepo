import { describe, expect, it } from 'vitest';
import { type AcceptanceContractInput, validateAcceptanceContract } from './acceptance-contract.js';

const NOW = '2026-08-31T00:00:00.000Z';

function validContract(overrides: Partial<AcceptanceContractInput> = {}): AcceptanceContractInput {
  return {
    objective: 'Deliver a verified weekly operations report',
    deliverables: ['A PDF report', 'A source spreadsheet'],
    criteria: [
      { id: 'accuracy', description: 'Every reported total matches the source spreadsheet' },
    ],
    requiredEvidenceTypes: [
      { type: 'source_document', description: 'Original source spreadsheet reference' },
    ],
    approverId: 'approver-1',
    arbitratorId: 'arbitrator-1',
    responsiblePersonId: 'member-1',
    dueAt: '2026-09-01T00:00:00.000Z',
    maxRevisionRounds: 2,
    ...overrides,
  };
}

describe('acceptance contract validator', () => {
  it.each([
    [null, { now: NOW }, 'INVALID_INPUT'],
    [undefined, { now: NOW }, 'INVALID_INPUT'],
    [[], { now: NOW }, 'INVALID_INPUT'],
    [validContract(), null, 'INVALID_CONTEXT'],
    [validContract(), undefined, 'INVALID_CONTEXT'],
    [validContract(), [], 'INVALID_CONTEXT'],
  ] as const)('fails closed for malformed root input/context %#', (input, context, code) => {
    expect(
      validateAcceptanceContract(
        input as unknown as AcceptanceContractInput,
        context as unknown as Parameters<typeof validateAcceptanceContract>[1],
      ),
    ).toEqual({ ok: false, code });
  });

  it('returns normalized contract facts and preserves criterion IDs without database IDs', () => {
    expect(
      validateAcceptanceContract(
        validContract({
          objective: '  Deliver the report  ',
          deliverables: [' PDF report ', ' Source spreadsheet '],
          criteria: [
            { id: ' accuracy ', description: ' Totals match sources ' },
            { id: 'format', description: ' Uses the approved template ' },
          ],
          requiredEvidenceTypes: [{ type: ' source_document ', description: ' Spreadsheet link ' }],
        }),
        { now: NOW },
      ),
    ).toEqual({
      ok: true,
      contract: {
        objective: 'Deliver the report',
        deliverables: ['PDF report', 'Source spreadsheet'],
        criteria: [
          { id: 'accuracy', description: 'Totals match sources' },
          { id: 'format', description: 'Uses the approved template' },
        ],
        requiredEvidenceTypes: [{ type: 'source_document', description: 'Spreadsheet link' }],
        approverId: 'approver-1',
        arbitratorId: 'arbitrator-1',
        responsiblePersonId: 'member-1',
        dueAt: '2026-09-01T00:00:00.000Z',
        maxRevisionRounds: 2,
      },
    });
  });

  it.each([
    ['objective', '', 'OBJECTIVE_REQUIRED'],
    ['objective', '   ', 'OBJECTIVE_REQUIRED'],
    ['objective', 'x'.repeat(2001), 'OBJECTIVE_TOO_LONG'],
    ['deliverables', [], 'DELIVERABLE_REQUIRED'],
    ['deliverables', ['   '], 'DELIVERABLE_REQUIRED'],
    ['deliverables', ['x'.repeat(501)], 'DELIVERABLE_TOO_LONG'],
    ['criteria', [], 'CRITERION_REQUIRED'],
    ['criteria', [{ id: '   ', description: 'Verifiable' }], 'CRITERION_ID_REQUIRED'],
    ['criteria', [{ id: 'x'.repeat(101), description: 'Verifiable' }], 'CRITERION_ID_TOO_LONG'],
    ['criteria', [{ id: 'criterion-1', description: '   ' }], 'CRITERION_DESCRIPTION_REQUIRED'],
    [
      'criteria',
      [{ id: 'criterion-1', description: 'x'.repeat(1001) }],
      'CRITERION_DESCRIPTION_TOO_LONG',
    ],
    ['requiredEvidenceTypes', [], 'EVIDENCE_TYPE_REQUIRED'],
    [
      'requiredEvidenceTypes',
      [{ type: '   ', description: 'Source file' }],
      'EVIDENCE_TYPE_REQUIRED',
    ],
    [
      'requiredEvidenceTypes',
      [{ type: 'x'.repeat(101), description: 'Source file' }],
      'EVIDENCE_TYPE_TOO_LONG',
    ],
    ['approverId', '   ', 'APPROVER_ID_REQUIRED'],
    ['arbitratorId', '', 'ARBITRATOR_ID_REQUIRED'],
    ['dueAt', 'not-a-date', 'DUE_AT_INVALID'],
  ] as const)('rejects independently invalid %s', (field, value, code) => {
    expect(validateAcceptanceContract(validContract({ [field]: value }), { now: NOW })).toEqual({
      ok: false,
      code,
    });
  });

  it.each([
    [['PDF report', 42], 'DELIVERABLE_INVALID'],
    [['PDF report', null], 'DELIVERABLE_INVALID'],
  ] as const)('rejects all mixed malformed deliverables', (deliverables, code) => {
    expect(
      validateAcceptanceContract(
        validContract({
          deliverables: deliverables as unknown as AcceptanceContractInput['deliverables'],
        }),
        { now: NOW },
      ),
    ).toEqual({ ok: false, code });
  });

  it.each([
    [[{ id: 'accuracy', description: 'Totals match' }, null], 'CRITERION_INVALID'],
    [[{ id: 'accuracy', description: 'Totals match' }, 42], 'CRITERION_INVALID'],
  ] as const)('rejects all mixed malformed criteria', (criteria, code) => {
    expect(
      validateAcceptanceContract(
        validContract({ criteria: criteria as unknown as AcceptanceContractInput['criteria'] }),
        { now: NOW },
      ),
    ).toEqual({ ok: false, code });
  });

  it('rejects a mixed malformed required-evidence array instead of dropping entries', () => {
    expect(
      validateAcceptanceContract(
        validContract({
          requiredEvidenceTypes: [
            { type: 'source_document', description: 'Spreadsheet' },
            null,
          ] as unknown as AcceptanceContractInput['requiredEvidenceTypes'],
        }),
        { now: NOW },
      ),
    ).toEqual({ ok: false, code: 'EVIDENCE_TYPE_REQUIRED' });
  });

  it('rejects a non-string responsible person without throwing', () => {
    expect(
      validateAcceptanceContract(validContract({ responsiblePersonId: 7 as unknown as string }), {
        now: NOW,
      }),
    ).toEqual({ ok: false, code: 'RESPONSIBLE_PERSON_ID_INVALID' });
  });

  it('enforces the deliverable collection limit at 50 items', () => {
    expect(
      validateAcceptanceContract(
        validContract({
          deliverables: Array.from({ length: 50 }, (_, index) => `Deliverable ${index}`),
        }),
        { now: NOW },
      ),
    ).toMatchObject({ ok: true });
    expect(
      validateAcceptanceContract(
        validContract({
          deliverables: Array.from({ length: 51 }, (_, index) => `Deliverable ${index}`),
        }),
        { now: NOW },
      ),
    ).toEqual({ ok: false, code: 'DELIVERABLE_COUNT_EXCEEDED' });
  });

  it('enforces the criterion collection limit at 100 items', () => {
    const criteria = Array.from({ length: 101 }, (_, index) => ({
      id: `criterion-${index}`,
      description: `Verify criterion ${index}`,
    }));
    expect(
      validateAcceptanceContract(validContract({ criteria: criteria.slice(0, 100) }), { now: NOW }),
    ).toMatchObject({ ok: true });
    expect(validateAcceptanceContract(validContract({ criteria }), { now: NOW })).toEqual({
      ok: false,
      code: 'CRITERION_COUNT_EXCEEDED',
    });
  });

  it.each([
    ['objective', 'OBJECTIVE_REQUIRED'],
    ['deliverables', 'DELIVERABLE_REQUIRED'],
    ['criteria', 'CRITERION_REQUIRED'],
    ['requiredEvidenceTypes', 'EVIDENCE_TYPE_REQUIRED'],
    ['approverId', 'APPROVER_ID_REQUIRED'],
    ['arbitratorId', 'ARBITRATOR_ID_REQUIRED'],
    ['dueAt', 'DUE_AT_INVALID'],
    ['maxRevisionRounds', 'MAX_REVISION_ROUNDS_INVALID'],
  ] as const)('returns a stable code when %s is truly missing', (field, code) => {
    const malformed = { ...validContract() } as Record<string, unknown>;
    delete malformed[field];

    expect(
      validateAcceptanceContract(malformed as unknown as AcceptanceContractInput, { now: NOW }),
    ).toEqual({ ok: false, code });
  });

  it('rejects duplicate criterion IDs after trim and case normalization', () => {
    expect(
      validateAcceptanceContract(
        validContract({
          criteria: [
            { id: 'Accuracy', description: 'Totals match' },
            { id: ' accuracy ', description: 'No arithmetic errors' },
          ],
        }),
        { now: NOW },
      ),
    ).toEqual({ ok: false, code: 'DUPLICATE_CRITERION_ID' });
  });

  it.each([
    { objective: '做到满意为止' },
    { objective: '做 到 满 意 为 止' },
    { deliverables: ['PDF', '做到 满意 为止'] },
    { criteria: [{ id: 'quality', description: '做到满意为止' }] },
    { criteria: [{ id: '做到 满意 为止', description: 'Check the source' }] },
    {
      requiredEvidenceTypes: [{ type: 'source_document', description: '资料做到满意为止' }],
    },
  ])('rejects unlimited-obligation language in contract content', (overrides) => {
    expect(validateAcceptanceContract(validContract(overrides), { now: NOW })).toEqual({
      ok: false,
      code: 'UNLIMITED_OBLIGATION',
    });
  });

  it('does not scan subject identifiers as unlimited-obligation prose', () => {
    expect(
      validateAcceptanceContract(
        validContract({ approverId: '做到满意为止', arbitratorId: 'arbitrator-1' }),
        { now: NOW },
      ),
    ).toMatchObject({ ok: true });
  });

  it.each([
    ['approverId', 'member-1', 'APPROVER_RESPONSIBLE_CONFLICT'],
    ['arbitratorId', 'member-1', 'ARBITRATOR_RESPONSIBLE_CONFLICT'],
  ] as const)('rejects %s when it equals the supplied responsible person', (field, value, code) => {
    expect(validateAcceptanceContract(validContract({ [field]: value }), { now: NOW })).toEqual({
      ok: false,
      code,
    });
  });

  it('requires the approver and alternative arbitrator to be different people', () => {
    expect(
      validateAcceptanceContract(validContract({ arbitratorId: 'approver-1' }), { now: NOW }),
    ).toEqual({ ok: false, code: 'APPROVER_ARBITRATOR_CONFLICT' });
  });

  it.each([
    [[{ type: 'source_document', description: '   ' }], 'EVIDENCE_DESCRIPTION_REQUIRED'],
    [[{ type: 'source_document', description: 'x'.repeat(501) }], 'EVIDENCE_DESCRIPTION_TOO_LONG'],
    [
      [
        { type: 'Source_Document', description: 'Spreadsheet' },
        { type: ' source_document ', description: 'Original file' },
      ],
      'DUPLICATE_EVIDENCE_TYPE',
    ],
    [
      Array.from({ length: 51 }, (_, index) => ({ type: `evidence-${index}` })),
      'EVIDENCE_TYPE_COUNT_EXCEEDED',
    ],
  ] as const)(
    'rejects malformed or unbounded evidence type definitions',
    (requiredEvidenceTypes, code) => {
      expect(
        validateAcceptanceContract(
          validContract({
            requiredEvidenceTypes:
              requiredEvidenceTypes as AcceptanceContractInput['requiredEvidenceTypes'],
          }),
          { now: NOW },
        ),
      ).toEqual({ ok: false, code });
    },
  );

  it.each([
    ['2026-08-30T23:59:59.999Z', 'DUE_AT_NOT_FUTURE'],
    [NOW, 'DUE_AT_NOT_FUTURE'],
  ] as const)('rejects a past or equal deadline', (dueAt, code) => {
    expect(validateAcceptanceContract(validContract({ dueAt }), { now: NOW })).toEqual({
      ok: false,
      code,
    });
  });

  it.each([
    ['2026-09-31T00:00:00.000Z', 'DUE_AT_INVALID'],
    ['2026-09-01T00:00:00', 'DUE_AT_INVALID'],
    ['2026-09-01T00:00:00.0000Z', 'DUE_AT_INVALID'],
  ] as const)('rejects non-strict contract deadline %s', (dueAt, code) => {
    expect(validateAcceptanceContract(validContract({ dueAt }), { now: NOW })).toEqual({
      ok: false,
      code,
    });
  });

  it('rejects an impossible explicit reference date', () => {
    expect(
      validateAcceptanceContract(validContract(), { now: '2026-09-31T00:00:00.000Z' }),
    ).toEqual({ ok: false, code: 'REFERENCE_TIME_INVALID' });
  });

  it('accepts whole-second ISO UTC and returns a canonical deadline', () => {
    expect(
      validateAcceptanceContract(validContract({ dueAt: '2026-09-01T00:00:00Z' }), {
        now: '2026-08-31T00:00:00Z',
      }),
    ).toMatchObject({
      ok: true,
      contract: { dueAt: '2026-09-01T00:00:00.000Z' },
    });
  });

  it.each([
    [-1, 'MAX_REVISION_ROUNDS_INVALID'],
    [3, 'MAX_REVISION_ROUNDS_INVALID'],
    [1.5, 'MAX_REVISION_ROUNDS_INVALID'],
  ] as const)('rejects maxRevisionRounds=%s', (maxRevisionRounds, code) => {
    expect(validateAcceptanceContract(validContract({ maxRevisionRounds }), { now: NOW })).toEqual({
      ok: false,
      code,
    });
  });

  it.each([0, 1, 2])('accepts maxRevisionRounds=%s', (maxRevisionRounds) => {
    expect(
      validateAcceptanceContract(validContract({ maxRevisionRounds }), { now: NOW }),
    ).toMatchObject({ ok: true, contract: { maxRevisionRounds } });
  });

  it('rejects malformed explicit reference time instead of consulting the clock', () => {
    expect(validateAcceptanceContract(validContract(), { now: 'not-a-date' })).toEqual({
      ok: false,
      code: 'REFERENCE_TIME_INVALID',
    });
  });
});
