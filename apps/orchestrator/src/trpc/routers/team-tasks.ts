import { isExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import type { DB } from '../../db/client.js';
import {
  TeamTaskAppealServiceError,
  createTeamTaskAppealService,
} from '../../team-work-items/team-task-appeal-service.js';
import {
  TeamTaskEvidenceServiceError,
  createTeamTaskEvidenceService,
} from '../../team-work-items/team-task-evidence-service.js';
import { createTeamTaskPlanningService } from '../../team-work-items/team-task-planning-service.js';
import { createTeamTaskQueryService } from '../../team-work-items/team-task-query-service.js';
import {
  TeamTaskReviewServiceError,
  createTeamTaskReviewService,
} from '../../team-work-items/team-task-review-service.js';
import {
  TeamTaskServiceError,
  createTeamTaskService,
} from '../../team-work-items/team-task-service.js';
import { protectedProcedure, router } from '../trpc.js';

type DomainMethod<Input> = (input: Input) => Promise<unknown>;
type WorkMutation = {
  actorExternalId: string;
  workItemExternalId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
type ReviewMutation = {
  actorId: string;
  workItemId: string;
  expectedVersion: number;
  idempotencyKey: string;
};
type EvidenceMutation = {
  actorExternalId: string;
  workItemExternalId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export interface TeamTasksRouterServices {
  query: {
    list: DomainMethod<{ actorId: string; projectId: string }>;
    planningOptions: DomainMethod<{ actorId: string; projectId: string }>;
    get: DomainMethod<{ actorId: string; projectId: string; workItemId: string }>;
    archive: DomainMethod<{
      actorId: string;
      projectId: string;
      workItemId: string;
      expectedVersion: number;
      idempotencyKey: string;
    }>;
  };
  task: {
    createDraft: DomainMethod<{
      actorExternalId: string;
      projectExternalId: string;
      title: string;
      description: string | null;
      assignmentMode: 'direct' | 'first_come' | 'leader_select';
      expectedVersion: 0;
      idempotencyKey: string;
    }>;
    publish: DomainMethod<WorkMutation & { contract: unknown }>;
    offerAssignment: DomainMethod<
      WorkMutation & {
        targetMemberExternalId: string;
        role: 'responsible' | 'collaborator';
      }
    >;
    respondToAssignment: DomainMethod<
      WorkMutation & { assignmentExternalId: string; response: 'accept' }
    >;
    claim: DomainMethod<WorkMutation & { memberExternalId: string }>;
    selectClaim: DomainMethod<WorkMutation & { assignmentExternalId: string }>;
  };
  planning: {
    assignMilestone: DomainMethod<WorkMutation & { milestoneExternalId: string }>;
    addDependency: DomainMethod<WorkMutation & { dependsOnWorkItemExternalId: string }>;
    start: DomainMethod<WorkMutation & { overrideReason?: string }>;
    block: DomainMethod<
      WorkMutation & {
        responsibleParty: string;
        nextAction: string;
        reviewAt: string;
        affectsDueDate: boolean;
      }
    >;
    unblock: DomainMethod<WorkMutation>;
    createContractVersion: DomainMethod<WorkMutation & { contract: unknown; versionNote: string }>;
    confirmContractVersion: DomainMethod<WorkMutation & { contractVersionExternalId: string }>;
  };
  review: {
    submit: DomainMethod<ReviewMutation & { summary: string; deliverables: string[] }>;
    review: DomainMethod<
      ReviewMutation & {
        submissionId: string;
        decision: 'accepted' | 'request_revision' | 'escalate_arbitration';
        rationale?: string | null;
        failedCriterionIds?: string[];
        evidenceReferences?: Array<{ kind: 'evidence' | 'missing_evidence'; reference: string }>;
        revisionInstructions?: string[];
        newDeadline?: string;
      }
    >;
    close: DomainMethod<ReviewMutation>;
  };
  appeal: {
    appeal: DomainMethod<
      ReviewMutation & {
        submissionId: string;
        reviewId: string;
        disputeType: 'fact' | 'criterion_application' | 'process_rule';
        grounds: string;
      }
    >;
    decideAppeal: DomainMethod<
      ReviewMutation & {
        submissionId: string;
        reviewId: string;
        appealId: string;
        decision: 'uphold_review' | 'return_for_review' | 'accept_submission' | 'reject_final';
        criterionIds: string[];
        evidenceReferences: Array<{ kind: 'evidence' | 'missing_evidence'; reference: string }>;
        rationale: string;
      }
    >;
  };
  evidence: {
    bindEvidence: DomainMethod<
      EvidenceMutation & { source: unknown; target?: unknown; metadata?: unknown }
    >;
    recordAiContribution: DomainMethod<
      EvidenceMutation & { executionTaskId: string; requestedScope: string }
    >;
    confirmAiContribution: DomainMethod<
      EvidenceMutation & {
        aiContributionId: string;
        status: 'confirmed' | 'modified' | 'rejected';
        humanChangesSummary?: string | null;
      }
    >;
    getEvidencePackage: DomainMethod<{ actorExternalId: string; workItemExternalId: string }>;
    preflight: DomainMethod<{ actorExternalId: string; workItemExternalId: string }>;
  };
}

function productionServices(db: DB): TeamTasksRouterServices {
  return {
    query: createTeamTaskQueryService(db),
    task: createTeamTaskService(db),
    planning: createTeamTaskPlanningService(db),
    review: createTeamTaskReviewService(db),
    appeal: createTeamTaskAppealService(db),
    evidence: createTeamTaskEvidenceService(db),
  };
}

const id = <K extends Parameters<typeof isExternalId>[1]>(kind: K) =>
  z
    .string()
    .max(32)
    .refine((value) => isExternalId(value, kind), `invalid ${kind} id`);
const projectId = id('project');
const workItemId = id('teamWorkItem');
const expectedVersion = z.number().int().min(1);
const idempotencyKey = z
  .string()
  .min(26)
  .max(64)
  .refine(
    (value) =>
      /^[0-9A-HJKMNP-TV-Z]{26}$/iu.test(value) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value),
    'idempotencyKey must be a UUID or ULID',
  );
const instant = z.string().datetime({ offset: true });
const boundedText = (max: number) => z.string().trim().min(1).max(max);
const mutationBase = z.object({ projectId, workItemId, expectedVersion, idempotencyKey });

const contract = z.object({
  objective: boundedText(4_000),
  deliverables: z.array(boundedText(1_000)).min(1).max(100),
  criteria: z
    .array(z.object({ id: boundedText(100), description: boundedText(1_000) }))
    .min(1)
    .max(100),
  requiredEvidenceTypes: z
    .array(z.object({ type: boundedText(100), description: boundedText(1_000).optional() }))
    .min(1)
    .max(100),
  approverId: id('organizationMember'),
  arbitratorId: id('organizationMember'),
  dueAt: instant,
  maxRevisionRounds: z.number().int().min(0).max(2),
});

const evidenceReferences = z
  .array(
    z.object({
      kind: z.enum(['evidence', 'missing_evidence']),
      reference: boundedText(500),
    }),
  )
  .min(1)
  .max(100);

const evidenceSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('evidenceArtifact'), evidenceArtifactId: id('evidenceArtifact') }),
  z.object({ kind: z.literal('taskFile'), taskFileId: id('file') }),
  z.object({ kind: z.literal('controlledExternalRef'), url: z.string().url().max(512) }),
]);
const evidenceTarget = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('submission'), id: id('teamSubmission') }),
    z.object({ kind: z.literal('review'), id: id('teamReview') }),
    z.object({ kind: z.literal('appeal'), id: id('teamAppeal') }),
    z.object({ kind: z.literal('aiContribution'), id: id('teamAiContribution') }),
  ])
  .nullable()
  .optional();

function mapDomainError(error: unknown): never {
  if (
    error instanceof TeamTaskServiceError ||
    error instanceof TeamTaskReviewServiceError ||
    error instanceof TeamTaskAppealServiceError ||
    error instanceof TeamTaskEvidenceServiceError
  ) {
    const code = error.code;
    if (code === 'NOT_FOUND') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Team task not found' });
    }
    if (code === 'FORBIDDEN') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Team task action forbidden' });
    }
    if (code === 'INVALID_INPUT') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid team task input' });
    }
    if (code === 'VERSION_CONFLICT' || code === 'CONFLICT') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Team task changed; refresh and retry' });
    }
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Team task requires independent review',
    });
  }
  throw error;
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return mapDomainError(error);
  }
}

async function scopedMutation(
  services: TeamTasksRouterServices,
  actorId: string,
  input: { projectId: string; workItemId: string },
  operation: () => Promise<unknown>,
) {
  await services.query.get({ actorId, projectId: input.projectId, workItemId: input.workItemId });
  return operation();
}

export function createTeamTasksRouter(
  resolveServices: (db: DB) => TeamTasksRouterServices = productionServices,
) {
  const services = (db: DB) => resolveServices(db);
  return router({
    list: protectedProcedure
      .input(z.object({ projectId }))
      .query(({ ctx, input }) =>
        call(() => services(ctx.db).query.list({ actorId: ctx.userId, ...input })),
      ),
    planningOptions: protectedProcedure
      .input(z.object({ projectId }))
      .query(({ ctx, input }) =>
        call(() => services(ctx.db).query.planningOptions({ actorId: ctx.userId, ...input })),
      ),
    get: protectedProcedure
      .input(z.object({ projectId, workItemId }))
      .query(({ ctx, input }) =>
        call(() => services(ctx.db).query.get({ actorId: ctx.userId, ...input })),
      ),
    createDraft: protectedProcedure
      .input(
        z.object({
          projectId,
          title: boundedText(255),
          description: z.string().trim().max(10_000).nullable(),
          assignmentMode: z.enum(['direct', 'first_come', 'leader_select']),
          expectedVersion: z.literal(0),
          idempotencyKey,
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          services(ctx.db).task.createDraft({
            actorExternalId: ctx.userId,
            projectExternalId: input.projectId,
            title: input.title,
            description: input.description,
            assignmentMode: input.assignmentMode,
            expectedVersion: input.expectedVersion,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      ),
    publish: protectedProcedure
      .input(mutationBase.extend({ contract }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).task.publish({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              contract: input.contract,
            }),
          ),
        ),
      ),
    assign: protectedProcedure
      .input(
        mutationBase.extend({
          targetMemberId: id('organizationMember'),
          role: z.enum(['responsible', 'collaborator']),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).task.offerAssignment({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              targetMemberExternalId: input.targetMemberId,
              role: input.role,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    acceptAssignment: protectedProcedure
      .input(mutationBase.extend({ assignmentId: id('teamWorkItemAssignment') }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).task.respondToAssignment({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              assignmentExternalId: input.assignmentId,
              response: 'accept',
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    claim: protectedProcedure
      .input(mutationBase.extend({ memberId: id('organizationMember') }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).task.claim({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              memberExternalId: input.memberId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    selectClaim: protectedProcedure
      .input(mutationBase.extend({ assignmentId: id('teamWorkItemAssignment') }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).task.selectClaim({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              assignmentExternalId: input.assignmentId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    start: protectedProcedure
      .input(mutationBase.extend({ overrideReason: boundedText(1_000).optional() }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).planning.start({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              overrideReason: input.overrideReason,
            }),
          ),
        ),
      ),
    block: protectedProcedure
      .input(
        mutationBase.extend({
          responsibleParty: boundedText(255),
          nextAction: boundedText(1_000),
          reviewAt: instant,
          affectsDueDate: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).planning.block({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              responsibleParty: input.responsibleParty,
              nextAction: input.nextAction,
              reviewAt: input.reviewAt,
              affectsDueDate: input.affectsDueDate,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    unblock: protectedProcedure.input(mutationBase).mutation(({ ctx, input }) =>
      call(() =>
        scopedMutation(services(ctx.db), ctx.userId, input, () =>
          services(ctx.db).planning.unblock({
            actorExternalId: ctx.userId,
            workItemExternalId: input.workItemId,
            expectedVersion: input.expectedVersion,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      ),
    ),
    assignMilestone: protectedProcedure
      .input(mutationBase.extend({ milestoneId: id('teamMilestone') }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).planning.assignMilestone({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              milestoneExternalId: input.milestoneId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    addDependency: protectedProcedure
      .input(mutationBase.extend({ dependsOnWorkItemId: id('teamWorkItem') }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).planning.addDependency({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              dependsOnWorkItemExternalId: input.dependsOnWorkItemId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    createContractVersion: protectedProcedure
      .input(mutationBase.extend({ contract, versionNote: boundedText(1_000) }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).planning.createContractVersion({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              contract: input.contract,
              versionNote: input.versionNote,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    confirmContractVersion: protectedProcedure
      .input(mutationBase.extend({ contractVersionId: id('acceptanceContractVersion') }))
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).planning.confirmContractVersion({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              contractVersionExternalId: input.contractVersionId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    submit: protectedProcedure
      .input(
        mutationBase.extend({
          summary: boundedText(4_000),
          deliverables: z.array(boundedText(1_000)).min(1).max(100),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).review.submit({
              actorId: ctx.userId,
              workItemId: input.workItemId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              summary: input.summary,
              deliverables: input.deliverables,
            }),
          ),
        ),
      ),
    review: protectedProcedure
      .input(
        mutationBase.extend({
          submissionId: id('teamSubmission'),
          decision: z.enum(['accepted', 'request_revision', 'escalate_arbitration']),
          rationale: z.string().trim().max(4_000).nullable().optional(),
          failedCriterionIds: z.array(boundedText(100)).min(1).max(100).optional(),
          evidenceReferences: evidenceReferences.optional(),
          revisionInstructions: z.array(boundedText(1_000)).min(1).max(50).optional(),
          newDeadline: instant.optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).review.review({
              actorId: ctx.userId,
              workItemId: input.workItemId,
              submissionId: input.submissionId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              decision: input.decision,
              rationale: input.rationale,
              failedCriterionIds: input.failedCriterionIds,
              evidenceReferences: input.evidenceReferences,
              revisionInstructions: input.revisionInstructions,
              newDeadline: input.newDeadline,
            }),
          ),
        ),
      ),
    appeal: protectedProcedure
      .input(
        mutationBase.extend({
          submissionId: id('teamSubmission'),
          reviewId: id('teamReview'),
          disputeType: z.enum(['fact', 'criterion_application', 'process_rule']),
          grounds: boundedText(4_000),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).appeal.appeal({
              actorId: ctx.userId,
              workItemId: input.workItemId,
              submissionId: input.submissionId,
              reviewId: input.reviewId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              disputeType: input.disputeType,
              grounds: input.grounds,
            }),
          ),
        ),
      ),
    decideAppeal: protectedProcedure
      .input(
        mutationBase.extend({
          submissionId: id('teamSubmission'),
          reviewId: id('teamReview'),
          appealId: id('teamAppeal'),
          decision: z.enum([
            'uphold_review',
            'return_for_review',
            'accept_submission',
            'reject_final',
          ]),
          criterionIds: z.array(boundedText(100)).min(1).max(100),
          evidenceReferences,
          rationale: boundedText(4_000),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).appeal.decideAppeal({
              actorId: ctx.userId,
              workItemId: input.workItemId,
              submissionId: input.submissionId,
              reviewId: input.reviewId,
              appealId: input.appealId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              decision: input.decision,
              criterionIds: input.criterionIds,
              evidenceReferences: input.evidenceReferences,
              rationale: input.rationale,
            }),
          ),
        ),
      ),
    close: protectedProcedure.input(mutationBase).mutation(({ ctx, input }) =>
      call(() =>
        scopedMutation(services(ctx.db), ctx.userId, input, () =>
          services(ctx.db).review.close({
            actorId: ctx.userId,
            workItemId: input.workItemId,
            expectedVersion: input.expectedVersion,
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      ),
    ),
    archive: protectedProcedure
      .input(mutationBase)
      .mutation(({ ctx, input }) =>
        call(() => services(ctx.db).query.archive({ actorId: ctx.userId, ...input })),
      ),
    bindEvidence: protectedProcedure
      .input(
        z.object({
          projectId,
          workItemId,
          expectedVersion,
          idempotencyKey,
          source: evidenceSource,
          target: evidenceTarget,
          metadata: z
            .object({
              evidenceType: boundedText(100).optional(),
              confidence: z.enum(['observed', 'verified', 'user_supplied']).optional(),
              relation: z.enum(['supports', 'contradicts', 'context']).optional(),
            })
            .nullable()
            .optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).evidence.bindEvidence({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
              source: input.source,
              target: input.target,
              metadata: input.metadata,
            }),
          ),
        ),
      ),
    recordAiContribution: protectedProcedure
      .input(
        z.object({
          projectId,
          workItemId,
          executionTaskId: id('task'),
          requestedScope: boundedText(2_000),
          expectedVersion,
          idempotencyKey,
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).evidence.recordAiContribution({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              executionTaskId: input.executionTaskId,
              requestedScope: input.requestedScope,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    confirmAiContribution: protectedProcedure
      .input(
        z.object({
          projectId,
          workItemId,
          aiContributionId: id('teamAiContribution'),
          status: z.enum(['confirmed', 'modified', 'rejected']),
          humanChangesSummary: z.string().trim().min(1).max(1_000).nullable().optional(),
          expectedVersion,
          idempotencyKey,
        }),
      )
      .mutation(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).evidence.confirmAiContribution({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
              aiContributionId: input.aiContributionId,
              status: input.status,
              humanChangesSummary: input.humanChangesSummary,
              expectedVersion: input.expectedVersion,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        ),
      ),
    getEvidencePackage: protectedProcedure
      .input(z.object({ projectId, workItemId }))
      .query(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).evidence.getEvidencePackage({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
            }),
          ),
        ),
      ),
    preflight: protectedProcedure
      .input(z.object({ projectId, workItemId }))
      .query(({ ctx, input }) =>
        call(() =>
          scopedMutation(services(ctx.db), ctx.userId, input, () =>
            services(ctx.db).evidence.preflight({
              actorExternalId: ctx.userId,
              workItemExternalId: input.workItemId,
            }),
          ),
        ),
      ),
  });
}

export const teamTasksRouter = createTeamTasksRouter();
