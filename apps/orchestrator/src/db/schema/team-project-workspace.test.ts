import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, type MySqlTable } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';
import { organizationInvitations } from './organization-invitations.js';
import { organizationMembers } from './organization-members.js';
import { organizations } from './organizations.js';
import { projectMembers } from './project-members.js';
import { projects } from './projects.js';

function indexConfig(table: MySqlTable, name: string) {
  return getTableConfig(table).indexes.find((index) => index.config.name === name)?.config;
}

describe('team project workspace schema', () => {
  it('exports organization and project membership tables with their access boundaries', () => {
    expect(schema.organizations).toBe(organizations);
    expect(schema.organizationMembers).toBe(organizationMembers);
    expect(schema.organizationInvitations).toBe(organizationInvitations);
    expect(schema.projectMembers).toBe(projectMembers);
    expect(schema.projects).toBe(projects);

    expect(Object.keys(getTableColumns(organizations))).toEqual([
      'id',
      'externalId',
      'name',
      'ownerUserId',
      'status',
      'teamProjectsEnabled',
      'createdAt',
      'updatedAt',
    ]);
    expect(Object.keys(getTableColumns(organizationMembers))).toEqual([
      'id',
      'externalId',
      'organizationId',
      'userId',
      'role',
      'managerUserId',
      'status',
      'joinedAt',
      'createdAt',
      'updatedAt',
    ]);
    expect(Object.keys(getTableColumns(organizationInvitations))).toEqual([
      'id',
      'externalId',
      'organizationId',
      'tokenHash',
      'role',
      'managerUserId',
      'invitedByUserId',
      'expiresAt',
      'acceptedAt',
      'revokedAt',
      'createdAt',
      'updatedAt',
    ]);
    expect(Object.keys(getTableColumns(projectMembers))).toEqual([
      'id',
      'externalId',
      'projectId',
      'userId',
      'role',
      'status',
      'createdAt',
      'updatedAt',
    ]);

    expect(getTableColumns(organizations).teamProjectsEnabled.default).toBe(false);
    expect(getTableColumns(organizationMembers).managerUserId.notNull).toBe(false);
    expect(organizationInvitations.tokenHash.getSQLType()).toBe('char(64)');
    expect(getTableColumns(organizationInvitations).managerUserId.notNull).toBe(false);
    expect(getTableColumns(organizationInvitations).acceptedAt.notNull).toBe(false);
    expect(getTableColumns(organizationInvitations).revokedAt.notNull).toBe(false);
    expect(getTableColumns(projects).organizationId.notNull).toBe(false);
    expect(getTableColumns(projects).userId.notNull).toBe(true);

    expect(getTableConfig(organizations).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'uk_organizations_external_id',
        'ix_organizations_owner',
        'ix_organizations_status',
      ]),
    );
    expect(getTableConfig(organizationMembers).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'uk_organization_members_external_id',
        'uk_organization_members_organization_user',
        'ix_organization_members_organization_status',
        'ix_organization_members_user_status',
        'ix_organization_members_manager_status',
      ]),
    );
    expect(getTableConfig(organizationInvitations).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'uk_organization_invitations_external_id',
        'uk_organization_invitations_token_hash',
        'ix_organization_invitations_active',
      ]),
    );
    expect(getTableConfig(projectMembers).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'uk_project_members_external_id',
        'uk_project_members_project_user',
        'ix_project_members_project_status',
        'ix_project_members_user_status',
      ]),
    );
    expect(indexConfig(organizations, 'uk_organizations_external_id')?.unique).toBe(true);
    expect(indexConfig(organizationMembers, 'uk_organization_members_organization_user')?.unique).toBe(true);
    expect(indexConfig(organizationInvitations, 'uk_organization_invitations_token_hash')?.unique).toBe(true);
    expect(indexConfig(projectMembers, 'uk_project_members_project_user')?.unique).toBe(true);
    expect(indexConfig(projects, 'ix_projects_organization_id')).toBeDefined();

    const projectOrganizationForeignKey = getTableConfig(projects).foreignKeys.find(
      (foreignKey) => foreignKey.reference().foreignTable === organizations,
    );
    expect(projectOrganizationForeignKey?.onDelete).toBe('restrict');
  });
});
