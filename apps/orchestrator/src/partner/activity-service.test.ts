import { describe, expect, it } from 'vitest';
import { calculateActivityFactorBps } from './activity-service.js';

describe('partner activity service rules', () => {
  it('keeps inactive users at 1.00x', () => {
    expect(calculateActivityFactorBps({ loginDays: 0, completedTasks: 0, validInvites: 0 })).toBe(10_000);
  });

  it('caps activity boost at 1.10x', () => {
    expect(calculateActivityFactorBps({ loginDays: 7, completedTasks: 20, validInvites: 5 })).toBe(11_000);
  });

  it('uses activity as weight only, not direct credit issuance', () => {
    expect(calculateActivityFactorBps({ loginDays: 1, completedTasks: 1, validInvites: 0 })).toBe(10_200);
  });

  it('normalizes malformed activity inputs conservatively', () => {
    expect(calculateActivityFactorBps({ loginDays: -1, completedTasks: 1.5, validInvites: Number.NaN })).toBe(10_000);
  });
});
