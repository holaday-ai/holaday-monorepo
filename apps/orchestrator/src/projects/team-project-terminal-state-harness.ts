type InvitationTerminalRow = {
  acceptedAt: unknown;
  revokedAt: unknown;
};

type OrganizationSwitchRow = {
  teamProjectsEnabled: unknown;
};

function isPersistedTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function assertInvitationTerminalRow(
  rows: readonly InvitationTerminalRow[],
  expected: 'accepted' | 'revoked',
): void {
  if (rows.length !== 1) {
    throw new Error(`invitation terminal query returned ${rows.length} rows; expected exactly 1`);
  }
  const [row] = rows;
  const matches =
    expected === 'accepted'
      ? isPersistedTimestamp(row?.acceptedAt) && row.revokedAt === null
      : row?.acceptedAt === null && isPersistedTimestamp(row.revokedAt);
  if (!matches) {
    throw new Error(`invitation row did not persist the exact ${expected} terminal state`);
  }
}

export function assertInvitationPendingRow(rows: readonly InvitationTerminalRow[]): void {
  if (rows.length !== 1) {
    throw new Error(`invitation pending query returned ${rows.length} rows; expected exactly 1`);
  }
  const [row] = rows;
  if (row?.acceptedAt !== null || row.revokedAt !== null) {
    throw new Error('invitation row did not remain pending');
  }
}

export function assertDisabledOrganizationRow(rows: readonly OrganizationSwitchRow[]): void {
  if (rows.length !== 1) {
    throw new Error(`organization switch query returned ${rows.length} rows; expected exactly 1`);
  }
  if (rows[0]?.teamProjectsEnabled !== 0) {
    throw new Error('organization row did not persist team_projects_enabled = 0');
  }
}
