import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { organizationMembers } from '../db/schema/organization-members.js';
import { organizations } from '../db/schema/organizations.js';
import { users } from '../db/schema/users.js';
import type { ModelDataRegion } from './model-data-region.js';

export type ModelDataRegionAssignmentErrorCode =
  | 'UNKNOWN_ACTOR'
  | 'ORGANIZATION_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'REGION_ALREADY_ASSIGNED';

export class ModelDataRegionAssignmentError extends Error {
  constructor(public readonly code: ModelDataRegionAssignmentErrorCode) {
    super(code);
    this.name = 'ModelDataRegionAssignmentError';
  }
}

export interface AssignPersonalModelDataRegionInput {
  db: DB;
  actorExternalId: string;
  region: ModelDataRegion;
}

export interface AssignOrganizationModelDataRegionInput extends AssignPersonalModelDataRegionInput {
  organizationExternalId: string;
}

export async function assignPersonalModelDataRegion(
  input: AssignPersonalModelDataRegionInput,
): Promise<{ region: ModelDataRegion; changed: boolean }> {
  return await input.db.transaction(async (tx) => {
    const updateResult = await buildPersonalRegionUpdate(tx, input.actorExternalId, input.region);
    if (readAffectedRows(updateResult) === 1) {
      return { region: input.region, changed: true };
    }

    const [current] = await tx
      .select({ modelDataRegion: users.modelDataRegion })
      .from(users)
      .where(and(eq(users.externalId, input.actorExternalId), eq(users.status, 'active')))
      .limit(1);
    if (!current) throw new ModelDataRegionAssignmentError('UNKNOWN_ACTOR');
    return resolveExistingAssignment(current.modelDataRegion, input.region);
  });
}

export async function assignOrganizationModelDataRegion(
  input: AssignOrganizationModelDataRegionInput,
): Promise<{ region: ModelDataRegion; changed: boolean }> {
  return await input.db.transaction(async (tx) => {
    const [membership] = await buildActiveOrganizationMembershipQuery(
      tx,
      input.actorExternalId,
      input.organizationExternalId,
    );
    if (!membership) {
      throw new ModelDataRegionAssignmentError('ORGANIZATION_NOT_FOUND');
    }
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      throw new ModelDataRegionAssignmentError('PERMISSION_DENIED');
    }

    const updateResult = await buildOrganizationRegionUpdate(
      tx,
      membership.organizationId,
      input.region,
    );
    if (readAffectedRows(updateResult) === 1) {
      return { region: input.region, changed: true };
    }

    const [current] = await tx
      .select({ modelDataRegion: organizations.modelDataRegion })
      .from(organizations)
      .where(
        and(eq(organizations.id, membership.organizationId), eq(organizations.status, 'active')),
      )
      .limit(1);
    if (!current) {
      throw new ModelDataRegionAssignmentError('ORGANIZATION_NOT_FOUND');
    }
    return resolveExistingAssignment(current.modelDataRegion, input.region);
  });
}

function resolveExistingAssignment(
  current: ModelDataRegion | null,
  requested: ModelDataRegion,
): { region: ModelDataRegion; changed: false } {
  if (current === requested) return { region: requested, changed: false };
  throw new ModelDataRegionAssignmentError('REGION_ALREADY_ASSIGNED');
}

function buildPersonalRegionUpdate(
  db: Pick<DB, 'update'>,
  actorExternalId: string,
  region: ModelDataRegion,
) {
  return db
    .update(users)
    .set({ modelDataRegion: region })
    .where(
      and(
        eq(users.externalId, actorExternalId),
        eq(users.status, 'active'),
        isNull(users.modelDataRegion),
      ),
    );
}

function buildActiveOrganizationMembershipQuery(
  db: Pick<DB, 'select'>,
  actorExternalId: string,
  organizationExternalId: string,
) {
  return db
    .select({
      organizationId: organizations.id,
      role: organizationMembers.role,
      modelDataRegion: organizations.modelDataRegion,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(
      and(
        eq(users.externalId, actorExternalId),
        eq(users.status, 'active'),
        eq(organizations.externalId, organizationExternalId),
        eq(organizations.status, 'active'),
        eq(organizationMembers.status, 'active'),
      ),
    )
    .for('update')
    .limit(1);
}

function buildOrganizationRegionUpdate(
  db: Pick<DB, 'update'>,
  organizationId: number,
  region: ModelDataRegion,
) {
  return db
    .update(organizations)
    .set({ modelDataRegion: region })
    .where(
      and(
        eq(organizations.id, organizationId),
        eq(organizations.status, 'active'),
        isNull(organizations.modelDataRegion),
      ),
    );
}

export const __modelDataRegionAssignmentInternals = {
  buildPersonalRegionUpdate,
  buildActiveOrganizationMembershipQuery,
  buildOrganizationRegionUpdate,
};
