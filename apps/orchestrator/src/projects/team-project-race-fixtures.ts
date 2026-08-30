import { createHash } from 'node:crypto';

export const TASK14_EXTERNAL_ID_MAX_LENGTH = 32;
const TASK14_EXTERNAL_ID_HASH_LENGTH = 12;

export type Task14FixtureTable =
  | 'users'
  | 'organizations'
  | 'organization_members'
  | 'organization_invitations'
  | 'projects'
  | 'project_members';

export type Task14RaceCaseName =
  | 'invitation-replay'
  | 'accept-first'
  | 'revoke-first'
  | 'organization-disable-accept'
  | 'organization-disable-create-invitation'
  | 'organization-disable-revoke-invitation'
  | 'report-first-demotion'
  | 'demotion-first-report'
  | 'report-first-deactivation'
  | 'deactivation-first-report'
  | 'owner-demotion-first'
  | 'owner-deactivation-first'
  | 'owner-zero-row-rollback'
  | 'local-target-foreign-manager'
  | 'foreign-target-local-manager'
  | 'project-list-versus-create'
  | 'project-get-versus-deactivation'
  | 'project-roster-versus-deactivation'
  | 'deactivation-first-project-removal'
  | 'project-removal-first-deactivation';

export type Task14RaceFixturePlan = {
  caseName: Task14RaceCaseName;
  fixtures: Partial<Record<Task14FixtureTable, readonly string[]>>;
};

const invitationFixtures = {
  users: ['owner', 'invitee'],
  organizations: ['primary'],
  organization_members: ['owner'],
  organization_invitations: ['primary'],
} as const;

const reportingFixtures = {
  users: ['owner', 'manager', 'subordinate'],
  organizations: ['primary'],
  organization_members: ['owner', 'manager', 'subordinate'],
  projects: ['primary'],
  project_members: ['owner-lead', 'manager-member'],
} as const;

const ownerFixtures = {
  users: ['owner-a', 'owner-b'],
  organizations: ['primary'],
  organization_members: ['owner-a', 'owner-b'],
} as const;

const foreignFixtures = {
  users: ['actor', 'local-target', 'local-manager', 'foreign-owner', 'foreign-manager'],
  organizations: ['requested', 'foreign'],
  organization_members: [
    'actor',
    'local-target',
    'local-manager',
    'foreign-owner',
    'foreign-manager',
  ],
} as const;

const projectReadFixtures = {
  users: ['owner', 'reader'],
  organizations: ['primary'],
  organization_members: ['owner', 'reader'],
  projects: ['primary'],
  project_members: ['owner-lead', 'reader-viewer'],
} as const;

const projectWriteFixtures = {
  users: ['actor', 'lead-a', 'lead-b'],
  organizations: ['primary'],
  organization_members: ['actor', 'lead-a', 'lead-b'],
  projects: ['primary'],
  project_members: ['actor-member', 'lead-a', 'lead-b'],
} as const;

export const TASK14_RACE_FIXTURE_PLANS: readonly Task14RaceFixturePlan[] = [
  { caseName: 'invitation-replay', fixtures: invitationFixtures },
  { caseName: 'accept-first', fixtures: invitationFixtures },
  { caseName: 'revoke-first', fixtures: invitationFixtures },
  { caseName: 'organization-disable-accept', fixtures: invitationFixtures },
  { caseName: 'organization-disable-create-invitation', fixtures: invitationFixtures },
  { caseName: 'organization-disable-revoke-invitation', fixtures: invitationFixtures },
  { caseName: 'report-first-demotion', fixtures: reportingFixtures },
  { caseName: 'demotion-first-report', fixtures: reportingFixtures },
  { caseName: 'report-first-deactivation', fixtures: reportingFixtures },
  { caseName: 'deactivation-first-report', fixtures: reportingFixtures },
  { caseName: 'owner-demotion-first', fixtures: ownerFixtures },
  { caseName: 'owner-deactivation-first', fixtures: ownerFixtures },
  { caseName: 'owner-zero-row-rollback', fixtures: ownerFixtures },
  { caseName: 'local-target-foreign-manager', fixtures: foreignFixtures },
  { caseName: 'foreign-target-local-manager', fixtures: foreignFixtures },
  {
    caseName: 'project-list-versus-create',
    fixtures: {
      users: ['owner'],
      organizations: ['primary'],
      organization_members: ['owner'],
    },
  },
  { caseName: 'project-get-versus-deactivation', fixtures: projectReadFixtures },
  { caseName: 'project-roster-versus-deactivation', fixtures: projectReadFixtures },
  { caseName: 'deactivation-first-project-removal', fixtures: projectWriteFixtures },
  { caseName: 'project-removal-first-deactivation', fixtures: projectWriteFixtures },
];

const tablePrefixes: Record<Task14FixtureTable, string> = {
  users: 'usr',
  organizations: 'org',
  organization_members: 'omem',
  organization_invitations: 'oinv',
  projects: 'prj',
  project_members: 'pmem',
};

function readableFixturePart(caseName: string, key: string): string {
  return `${caseName}_${key}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildIntegrationFixtureExternalId(
  caseName: string,
  table: Task14FixtureTable,
  key: string,
): string {
  const prefix = tablePrefixes[table];
  const digest = createHash('sha256')
    .update(`${caseName}\0${table}\0${key}`)
    .digest('hex')
    .slice(0, TASK14_EXTERNAL_ID_HASH_LENGTH);
  const readableBudget =
    TASK14_EXTERNAL_ID_MAX_LENGTH - prefix.length - TASK14_EXTERNAL_ID_HASH_LENGTH - 2;
  const readable = (readableFixturePart(caseName, key) || 'fixture')
    .slice(0, readableBudget)
    .replace(/_+$/g, '');
  return `${prefix}_${readable}_${digest}`;
}

export function task14FixtureExternalId(
  caseName: Task14RaceCaseName,
  table: Task14FixtureTable,
  key: string,
): string {
  const plan = TASK14_RACE_FIXTURE_PLANS.find((candidate) => candidate.caseName === caseName);
  const declared = plan?.fixtures[table]?.includes(key);
  if (!declared) {
    throw new Error(`undeclared Task14 fixture id: ${caseName}/${table}/${key}`);
  }
  return buildIntegrationFixtureExternalId(caseName, table, key);
}

export function enumerateTask14FixtureExternalIds(): Array<{
  caseName: Task14RaceCaseName;
  table: Task14FixtureTable;
  key: string;
  externalId: string;
}> {
  return TASK14_RACE_FIXTURE_PLANS.flatMap((plan) =>
    (Object.entries(plan.fixtures) as Array<[Task14FixtureTable, readonly string[]]>).flatMap(
      ([table, keys]) =>
        keys.map((key) => ({
          caseName: plan.caseName,
          table,
          key,
          externalId: buildIntegrationFixtureExternalId(plan.caseName, table, key),
        })),
    ),
  );
}
