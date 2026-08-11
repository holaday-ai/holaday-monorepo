import { describe, expect, it } from 'vitest';
import {
  DivineApiContractError,
  assertDivineApiSuccess,
  readConfiguredCapabilities,
} from './divine-api-contract.js';

describe('DivineAPI response contract', () => {
  it('rejects an HTTP-200 business denial as not authorized', () => {
    expect(() =>
      assertDivineApiSuccess(
        { success: 2, msg: 'You are not authorized to access this API' },
        [['data']],
      ),
    ).toThrowError(new DivineApiContractError('not-authorized'));
  });

  it('rejects a success envelope with a missing required field', () => {
    expect(() => assertDivineApiSuccess({ success: 1, data: {} }, [['data', 'sign']])).toThrowError(
      new DivineApiContractError('invalid-response'),
    );
  });

  it('returns data from a complete success envelope', () => {
    expect(
      assertDivineApiSuccess(
        { success: 1, data: { sign: 'Aries' } },
        [['data', 'sign']],
      ),
    ).toEqual({ sign: 'Aries' });
  });

  it('keeps only known configured capabilities', () => {
    expect(
      readConfiguredCapabilities({
        DIVINE_API_CAPABILITIES: 'daily-horoscope, monthly-horoscope,unknown',
      } as NodeJS.ProcessEnv),
    ).toEqual(new Set(['daily-horoscope', 'monthly-horoscope']));
  });
});
