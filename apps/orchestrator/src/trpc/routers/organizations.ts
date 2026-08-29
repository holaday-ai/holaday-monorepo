import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { env as appEnv } from '../../config/env.js';
import type { DB } from '../../db/client.js';
import { organizations } from '../../db/schema/organizations.js';
import {
  InvitationServiceError,
  acceptInvitation,
  createInvitation,
  resolveInvitationOrganization,
  revokeInvitation,
} from '../../organizations/organization-invitation-service.js';
import { ORGANIZATION_ROLES } from '../../organizations/organization-permissions.js';
import {
  OrganizationServiceError,
  createOrganization,
  deactivateMember,
  listOrganizationMembers,
  listOrganizationsForUser,
  updateMemberRole,
  updateReportingLine,
} from '../../organizations/organization-service.js';
import { isTeamProjectsEnabledFor } from '../../organizations/team-project-access.js';
import { protectedProcedure, router } from '../trpc.js';

const organizationIdSchema = z.string().min(1);
const invitationRoles = ORGANIZATION_ROLES.filter((role) => role !== 'owner') as [
  'admin',
  'manager',
  'member',
];

/** Team workspace endpoints remain absent until the rollout accepts this actor. */
const teamProjectsProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isTeamProjectsEnabledFor(ctx.userId)) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'organization not found' });
  }
  return next({ ctx });
});

/**
 * The organization switch is an authoritative rollback boundary. This runs
 * before the domain operation, so a disabled organization cannot trigger a
 * membership or invitation lookup/mutation through this router.
 */
async function requireEnabledOrganization(
  db: Pick<DB, 'select'>,
  organizationId: string,
): Promise<void> {
  const [organization] = await db
    .select({ externalId: organizations.externalId })
    .from(organizations)
    .where(
      and(
        eq(organizations.externalId, organizationId),
        eq(organizations.status, 'active'),
        eq(organizations.teamProjectsEnabled, true),
      ),
    )
    .limit(1);
  if (!organization) throw new TRPCError({ code: 'NOT_FOUND', message: 'organization not found' });
}

function mapDomainError(error: unknown): never {
  if (error instanceof OrganizationServiceError || error instanceof InvitationServiceError) {
    if (error.code === 'PERMISSION_DENIED') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'organization permission denied' });
    }
    throw new TRPCError({ code: 'NOT_FOUND', message: 'organization not found' });
  }
  throw error;
}

async function callDomain<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return mapDomainError(error);
  }
}

function invitationUrl(token: string): string {
  const baseUrl = appEnv.HOLADAY_PUBLIC_BASE_URL.replace(/\/+$/, '');
  return `${baseUrl}/organizations/invitations/accept?token=${encodeURIComponent(token)}`;
}

export const organizationsRouter = router({
  list: teamProjectsProcedure.query(async ({ ctx }) => {
    const organizationsForUser = await callDomain(() =>
      listOrganizationsForUser({ db: ctx.db, actorExternalId: ctx.userId }),
    );
    return organizationsForUser
      .filter((organization) => organization.teamProjectsEnabled)
      .map((organization) => ({
        organizationId: organization.organizationId,
        name: organization.name,
        role: organization.callerRole,
        managerDisplayName: organization.managerDisplayName,
        activeMemberCount: organization.activeMemberCount,
      }));
  }),

  create: teamProjectsProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const organization = await callDomain(() =>
        createOrganization({ db: ctx.db, actorExternalId: ctx.userId, name: input.name }),
      );
      return {
        organizationId: organization.organizationId,
        name: organization.name,
        role: organization.role,
      };
    }),

  members: teamProjectsProcedure
    .input(z.object({ organizationId: organizationIdSchema }))
    .query(async ({ ctx, input }) => {
      await requireEnabledOrganization(ctx.db, input.organizationId);
      const members = await callDomain(() =>
        listOrganizationMembers({
          db: ctx.db,
          actorExternalId: ctx.userId,
          organizationExternalId: input.organizationId,
        }),
      );
      return members.map((member) => ({
        memberId: member.memberId,
        userId: member.userId,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
        managerUserId: member.managerUserId,
        managerDisplayName: member.managerDisplayName,
        status: member.status,
      }));
    }),

  createInvitation: teamProjectsProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        role: z.enum(invitationRoles),
        managerMemberId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEnabledOrganization(ctx.db, input.organizationId);
      const { invitationId, token, expiresAt } = await callDomain(() =>
        createInvitation({
          db: ctx.db,
          actorExternalId: ctx.userId,
          organizationExternalId: input.organizationId,
          role: input.role,
          managerMemberExternalId: input.managerMemberId,
        }),
      );
      return { invitationId, inviteUrl: invitationUrl(token), expiresAt };
    }),

  acceptInvitation: teamProjectsProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await callDomain(() =>
        resolveInvitationOrganization({ db: ctx.db, token: input.token }),
      );
      await requireEnabledOrganization(ctx.db, invitation.organizationId);
      const accepted = await callDomain(() =>
        acceptInvitation({ db: ctx.db, actorExternalId: ctx.userId, token: input.token }),
      );
      return { membershipId: accepted.membershipId, status: accepted.status };
    }),

  revokeInvitation: teamProjectsProcedure
    .input(z.object({ organizationId: organizationIdSchema, invitationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireEnabledOrganization(ctx.db, input.organizationId);
      return callDomain(() =>
        revokeInvitation({
          db: ctx.db,
          actorExternalId: ctx.userId,
          organizationExternalId: input.organizationId,
          invitationExternalId: input.invitationId,
        }),
      );
    }),

  updateReportingLine: teamProjectsProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        memberId: z.string().min(1),
        managerMemberId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEnabledOrganization(ctx.db, input.organizationId);
      return callDomain(() =>
        updateReportingLine({
          db: ctx.db,
          actorExternalId: ctx.userId,
          organizationExternalId: input.organizationId,
          targetMemberExternalId: input.memberId,
          managerMemberExternalId: input.managerMemberId,
        }),
      );
    }),

  updateMemberRole: teamProjectsProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        memberId: z.string().min(1),
        role: z.enum(ORGANIZATION_ROLES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEnabledOrganization(ctx.db, input.organizationId);
      return callDomain(() =>
        updateMemberRole({
          db: ctx.db,
          actorExternalId: ctx.userId,
          organizationExternalId: input.organizationId,
          targetMemberExternalId: input.memberId,
          nextRole: input.role,
        }),
      );
    }),

  deactivateMember: teamProjectsProcedure
    .input(z.object({ organizationId: organizationIdSchema, memberId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireEnabledOrganization(ctx.db, input.organizationId);
      return callDomain(() =>
        deactivateMember({
          db: ctx.db,
          actorExternalId: ctx.userId,
          organizationExternalId: input.organizationId,
          targetMemberExternalId: input.memberId,
        }),
      );
    }),
});

export const __organizationsRouterInternals = { invitationUrl, requireEnabledOrganization };
