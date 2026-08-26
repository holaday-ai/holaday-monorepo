import { describe, expect, it } from 'vitest';
import { DATA_CATEGORY_IDS } from '../data-governance/types.js';
import {
  ACCOUNT_CLOSURE_HANDLERS,
  assertAccountClosureHandlerContract,
  getAccountClosureHandler,
} from './handler-registry.js';

describe('account closure handler registry', () => {
  it('registers exactly one version 1 handler for every canonical category', () => {
    expect(ACCOUNT_CLOSURE_HANDLERS).toHaveLength(13);
    expect(
      ACCOUNT_CLOSURE_HANDLERS.map((handler) => [handler.categoryId, handler.version]),
    ).toEqual(DATA_CATEGORY_IDS.map((categoryId) => [categoryId, 1]));
    expect(new Set(ACCOUNT_CLOSURE_HANDLERS.map((handler) => handler.categoryId)).size).toBe(13);
    expect(() =>
      assertAccountClosureHandlerContract(DATA_CATEGORY_IDS, ACCOUNT_CLOSURE_HANDLERS),
    ).not.toThrow();
  });

  it('fails the release contract when governance adds an unhandled fourteenth category', () => {
    expect(() =>
      assertAccountClosureHandlerContract(
        [...DATA_CATEGORY_IDS, 'invented_fourteenth_category'],
        ACCOUNT_CLOSURE_HANDLERS,
      ),
    ).toThrow('Account closure handler contract mismatch');
    expect(() => getAccountClosureHandler('invented_fourteenth_category')).toThrow(
      'Account closure handler missing',
    );
  });

  it('keeps Task 7 and Task 8 categories fail-closed until their governed handlers land', async () => {
    for (const categoryId of ['media_assets', 'payments_entitlements', 'partner_kyc_ledger']) {
      const handler = getAccountClosureHandler(categoryId);
      await expect(handler.run({} as never)).rejects.toMatchObject({ code: 'HANDLER_DEFERRED' });
    }
  });
});
