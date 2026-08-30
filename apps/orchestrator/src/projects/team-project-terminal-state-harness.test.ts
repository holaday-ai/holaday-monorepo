import { describe, expect, it } from 'vitest';
import {
  assertDisabledOrganizationRow,
  assertInvitationPendingRow,
  assertInvitationTerminalRow,
} from './team-project-terminal-state-harness.js';

const terminalAt = new Date('2026-08-30T12:00:00.000Z');

describe('team workspace terminal-state evidence', () => {
  it('accepts the exact persisted invitation terminal state for each race winner', () => {
    expect(() =>
      assertInvitationTerminalRow([{ acceptedAt: terminalAt, revokedAt: null }], 'accepted'),
    ).not.toThrow();
    expect(() =>
      assertInvitationTerminalRow([{ acceptedAt: null, revokedAt: terminalAt }], 'revoked'),
    ).not.toThrow();
  });

  it.each([
    ['wrong accepted terminal', [{ acceptedAt: null, revokedAt: terminalAt }], 'accepted'],
    ['wrong revoked terminal', [{ acceptedAt: terminalAt, revokedAt: null }], 'revoked'],
    ['neither terminal', [{ acceptedAt: null, revokedAt: null }], 'accepted'],
    ['both terminals', [{ acceptedAt: terminalAt, revokedAt: terminalAt }], 'accepted'],
    ['deleted row', [], 'accepted'],
    [
      'duplicate rows',
      [
        { acceptedAt: terminalAt, revokedAt: null },
        { acceptedAt: terminalAt, revokedAt: null },
      ],
      'accepted',
    ],
  ] as const)('rejects %s invitation evidence', (_caseName, rows, expected) => {
    expect(() => assertInvitationTerminalRow([...rows], expected)).toThrow();
  });

  it('accepts exactly one persisted disabled organization row', () => {
    expect(() => assertDisabledOrganizationRow([{ teamProjectsEnabled: 0 }])).not.toThrow();
  });

  it('requires exactly one untouched invitation row after a disabled-organization rejection', () => {
    expect(() => assertInvitationPendingRow([{ acceptedAt: null, revokedAt: null }])).not.toThrow();
    expect(() => assertInvitationPendingRow([])).toThrow();
    expect(() =>
      assertInvitationPendingRow([{ acceptedAt: terminalAt, revokedAt: null }]),
    ).toThrow();
  });

  it.each([
    ['deleted row', []],
    ['enabled row', [{ teamProjectsEnabled: 1 }]],
    ['boolean-coerced row', [{ teamProjectsEnabled: false }]],
    ['duplicate rows', [{ teamProjectsEnabled: 0 }, { teamProjectsEnabled: 0 }]],
  ] as const)('rejects %s organization evidence', (_caseName, rows) => {
    expect(() => assertDisabledOrganizationRow([...rows])).toThrow();
  });
});
