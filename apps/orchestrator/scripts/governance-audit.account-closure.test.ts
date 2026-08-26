import { describe, expect, it } from 'vitest';
import { ACCOUNT_CLOSURE_HANDLER_BINDINGS } from '../src/account-closure/handler-registry.js';
import { rightsCapabilities } from '../src/data-governance/rights-capabilities.js';
import {
  ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS,
  ACCOUNT_CLOSURE_PUBLIC_RECEIPT_FIELDS,
  auditAccountClosureGovernance,
} from './governance-audit.js';

function liveInput() {
  return {
    declarations: ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS,
    handlerBindings: ACCOUNT_CLOSURE_HANDLER_BINDINGS,
    receiptFields: ACCOUNT_CLOSURE_PUBLIC_RECEIPT_FIELDS,
    rightsCapabilities,
  };
}

function errorCodes(input: Parameters<typeof auditAccountClosureGovernance>[0]): string[] {
  return auditAccountClosureGovernance(input).map((issue) => issue.code);
}

describe('account closure governance release audit', () => {
  it('binds all 13 canonical categories to one real handler, retention rule, and test', () => {
    const issues = auditAccountClosureGovernance(liveInput());

    expect(issues).toEqual([]);
    expect(ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS).toHaveLength(13);
    expect(
      new Set(ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS.map((item) => item.categoryId)).size,
    ).toBe(13);
    for (const declaration of ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS) {
      expect(declaration.retentionModes.length).toBeGreaterThan(0);
      expect(declaration.testRef).toMatch(/\.test\.ts$/);
    }
  });

  it('fails category/handler mismatches, duplicate ids, and missing retention or test evidence', () => {
    const [first, second, ...rest] = ACCOUNT_CLOSURE_GOVERNANCE_DECLARATIONS;
    if (!first || !second) throw new Error('Expected closure governance fixtures');
    const malformed = [
      { ...first, handlerRef: second.handlerRef, retentionModes: [], testRef: '' },
      { ...first },
      ...rest,
    ];

    expect(
      errorCodes({
        ...liveInput(),
        declarations: malformed,
      }),
    ).toEqual(
      expect.arrayContaining([
        'closure_handler_category_mismatch',
        'duplicate_id',
        'closure_retention_missing',
        'closure_test_missing',
      ]),
    );
  });

  it('fails closed when a public receipt contract admits raw personal content', () => {
    expect(
      errorCodes({
        ...liveInput(),
        receiptFields: [...ACCOUNT_CLOSURE_PUBLIC_RECEIPT_FIELDS, 'email', 'taskText'],
      }),
    ).toEqual(expect.arrayContaining(['closure_receipt_raw_content']));
  });

  it('rejects public self-service claims that exceed the registered capability', () => {
    const account = rightsCapabilities.find((item) => item.id === 'account_manual_request');
    if (!account) throw new Error('Expected account rights capability');

    expect(
      errorCodes({
        ...liveInput(),
        rightsCapabilities: [
          ...rightsCapabilities.filter((item) => item.id !== account.id),
          {
            ...account,
            delete: {
              ...account.delete,
              status: 'manual',
              handlerRef: undefined,
              manualEntrypoint: 'privacy@holaday.ai',
            },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining(['closure_public_claim_exceeds_capability']));
  });
});
