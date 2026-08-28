import type { PlanId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ffprobeDurationMs } from '../../agent/video/ffmpeg-exec.js';
import { env } from '../../config/env.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { users } from '../../db/schema/users.js';
import { FileService } from '../../files/file-service.js';
import {
  type VideoEditingFeatureConfig,
  canAccessVideoEditing,
  videoEditingCapability,
} from '../../video-editing/feature-access.js';
import {
  type VideoEditPlanningResult,
  createOpenAIVideoEditPlannerClient,
  planVideoEditInstruction,
} from '../../video-editing/instruction-planner.js';
import {
  VideoEditPlanValidationError,
  validateVideoEditPlan,
  videoEditOperationSchema,
} from '../../video-editing/operation-schema.js';
import {
  type StoredVideoEditProject,
  VideoEditProjectRepository,
  VideoEditRepositoryError,
} from '../../video-editing/project-repository.js';
import {
  type VideoEditBillingPort,
  VideoEditQuoteService,
} from '../../video-editing/quote-service.js';
import {
  type ImportedVideoSource,
  type ScopedVideoPreview,
  VideoSourceImportError,
  createVideoSourceImportDependencies,
  importVideoSource,
} from '../../video-editing/source-import.js';
import type {
  VideoEditDocument,
  VideoEditOperation,
  VideoEditProjectRecord,
  VideoEditVersionRecord,
} from '../../video-editing/types.js';
import type { Context } from '../context.js';
import { protectedProcedure, router } from '../trpc.js';

const externalIdSchema = z.string().trim().min(1).max(32);
const operationsSchema = z.array(videoEditOperationSchema).min(1).max(20);

type AuthenticatedContext = Context & { userId: string };

export interface VideoEditingUser {
  id: number;
  externalId: string;
  plan: PlanId;
}

type OwnedProjectResult = {
  project: StoredVideoEditProject;
  currentVersion: VideoEditVersionRecord;
};

export interface VideoEditingRuntime {
  repository: {
    createFromSource(
      input: Parameters<VideoEditProjectRepository['createFromSource']>[0],
    ): ReturnType<VideoEditProjectRepository['createFromSource']>;
    getOwnedProject(projectId: string, userId: number): Promise<OwnedProjectResult>;
    listVersions(projectId: string, userId: number): Promise<VideoEditVersionRecord[]>;
    appendVersion(
      input: Parameters<VideoEditProjectRepository['appendVersion']>[0],
    ): ReturnType<VideoEditProjectRepository['appendVersion']>;
    restoreVersion(
      input: Parameters<VideoEditProjectRepository['restoreVersion']>[0],
    ): ReturnType<VideoEditProjectRepository['restoreVersion']>;
  };
  importSource(input: {
    userId: number;
    sourceFileId: string;
    sourceTaskId?: string;
  }): Promise<ImportedVideoSource>;
  getProjectPreview(project: StoredVideoEditProject, userId: number): Promise<ScopedVideoPreview>;
  planInstruction(input: {
    instruction: string;
    document: VideoEditDocument;
    sourceKind: VideoEditProjectRecord['sourceKind'];
  }): Promise<VideoEditPlanningResult>;
  quoteService: Pick<VideoEditQuoteService, 'createQuote' | 'consumeAndExecute'>;
  billing: VideoEditBillingPort;
  executePaidOperation(input: {
    user: VideoEditingUser;
    project: StoredVideoEditProject;
    baseVersion: VideoEditVersionRecord;
    quoteId: string;
    costUnits: number;
    operations: VideoEditOperation[];
  }): Promise<{ taskId: string }>;
}

export interface VideoEditingRouterDependencies {
  featureConfig: VideoEditingFeatureConfig;
  resolveUser(ctx: AuthenticatedContext): Promise<VideoEditingUser>;
  createRuntime(ctx: AuthenticatedContext, user: VideoEditingUser): VideoEditingRuntime;
}

function projectView(project: StoredVideoEditProject) {
  return {
    id: project.externalId,
    sourceKind: project.sourceKind,
    provider: project.provider,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function versionView(version: VideoEditVersionRecord) {
  return {
    id: version.externalId,
    revision: version.revision,
    document: structuredClone(version.documentJson),
    operations: version.operationJson === null ? null : structuredClone(version.operationJson),
    sdkDocument: version.sdkDocument,
    renderStatus: version.renderStatus,
    createdAt: version.createdAt,
  };
}

function mapVideoEditError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof VideoEditRepositoryError) {
    throw new TRPCError({
      code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT',
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof VideoSourceImportError) {
    throw new TRPCError({
      code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'PRECONDITION_FAILED',
      message: error.message,
      cause: error,
    });
  }
  if (error instanceof VideoEditPlanValidationError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
  }
  throw error;
}

function requireAccess(dependencies: VideoEditingRouterDependencies, userExternalId: string): void {
  if (!canAccessVideoEditing(dependencies.featureConfig, userExternalId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '继续剪辑暂未开放' });
  }
}

async function withRuntime<T>(
  dependencies: VideoEditingRouterDependencies,
  ctx: AuthenticatedContext,
  callback: (runtime: VideoEditingRuntime, user: VideoEditingUser) => Promise<T>,
): Promise<T> {
  requireAccess(dependencies, ctx.userId);
  const user = await dependencies.resolveUser(ctx);
  const runtime = dependencies.createRuntime(ctx, user);
  try {
    return await callback(runtime, user);
  } catch (error) {
    return mapVideoEditError(error);
  }
}

function sceneIndex(document: VideoEditDocument, sceneId: string): number {
  const index = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (index === -1) throw new Error('剪辑计划引用了不存在的场景');
  return index;
}

function removeSilence(
  document: VideoEditDocument,
  operation: Extract<VideoEditOperation, { kind: 'remove_silence' }>,
): void {
  const index = sceneIndex(document, operation.sceneId);
  const scene = document.scenes[index];
  if (!scene) throw new Error('剪辑计划引用了不存在的场景');
  const durationMs = scene.sourceEndMs - scene.sourceStartMs;
  const ranges = [...operation.ranges].sort((left, right) => left.startMs - right.startMs);
  const kept: Array<{ startMs: number; endMs: number }> = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.startMs > cursor) kept.push({ startMs: cursor, endMs: range.startMs });
    cursor = range.endMs;
  }
  if (cursor < durationMs) kept.push({ startMs: cursor, endMs: durationMs });
  if (kept.length === 0) throw new Error('不能移除整个场景');
  const slices = kept.map((range, sliceIndex) => ({
    ...scene,
    id: sliceIndex === 0 ? scene.id : `${scene.id}:cut:${sliceIndex + 1}`,
    sourceStartMs: scene.sourceStartMs + range.startMs,
    sourceEndMs: scene.sourceStartMs + range.endMs,
  }));
  document.scenes.splice(index, 1, ...slices);
}

export function applyVideoEditOperations(
  base: VideoEditDocument,
  operations: VideoEditOperation[],
): VideoEditDocument {
  const document = structuredClone(base);
  for (const operation of operations) {
    if (operation.kind === 'regenerate_scene') {
      throw new Error('重新生成场景必须使用报价接口');
    }
    if (operation.kind === 'aspect_ratio') {
      document.aspectRatio = operation.value;
      continue;
    }
    if (operation.kind === 'reorder') {
      const byId = new Map(document.scenes.map((scene) => [scene.id, scene]));
      document.scenes = operation.sceneIds.map((sceneId, order) => {
        const scene = byId.get(sceneId);
        if (!scene) throw new Error('剪辑计划引用了不存在的场景');
        return { ...scene, order };
      });
      continue;
    }
    if (operation.kind === 'remove_silence') {
      removeSilence(document, operation);
      continue;
    }
    const index = sceneIndex(document, operation.sceneId);
    const scene = document.scenes[index];
    if (!scene) throw new Error('剪辑计划引用了不存在的场景');
    if (operation.kind === 'caption') {
      document.scenes[index] = { ...scene, caption: operation.text };
    } else {
      document.scenes[index] = {
        ...scene,
        sourceStartMs: scene.sourceStartMs + operation.startMs,
        sourceEndMs: scene.sourceStartMs + operation.endMs,
      };
    }
  }
  document.scenes = document.scenes.map((scene, order) => ({ ...scene, order }));
  return document;
}

export function createVideoEditingRouter(dependencies: VideoEditingRouterDependencies) {
  return router({
    capability: protectedProcedure.query(({ ctx }) =>
      videoEditingCapability(dependencies.featureConfig, ctx.userId),
    ),

    createProject: protectedProcedure
      .input(
        z.union([
          z
            .object({
              sourceFileId: externalIdSchema,
              sourceTaskId: externalIdSchema.optional(),
            })
            .strict(),
          z
            .object({
              sourceFileIds: z.array(externalIdSchema).min(1).max(8),
            })
            .strict()
            .refine((value) => new Set(value.sourceFileIds).size === value.sourceFileIds.length, {
              message: '不能重复选择同一段视频',
              path: ['sourceFileIds'],
            }),
        ]),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const sourceFileIds =
            'sourceFileIds' in input ? input.sourceFileIds : [input.sourceFileId];
          const importedSources: ImportedVideoSource[] = [];
          for (const sourceFileId of sourceFileIds) {
            importedSources.push(
              await runtime.importSource({
                userId: user.id,
                sourceFileId,
                ...('sourceTaskId' in input ? { sourceTaskId: input.sourceTaskId } : {}),
              }),
            );
          }
          const imported = importedSources[0];
          if (!imported) throw new Error('至少需要一段视频');
          const sourceKinds = new Set(importedSources.map((source) => source.sourceKind));
          const sourceTaskIds = new Set(importedSources.map((source) => source.sourceTaskId));
          const document: VideoEditDocument = {
            aspectRatio: imported.document.aspectRatio,
            scenes: importedSources.flatMap((source, sourceIndex) =>
              source.document.scenes.map((scene, sceneIndex) => ({
                ...scene,
                id:
                  importedSources.length === 1
                    ? scene.id
                    : `scene_${sourceIndex + 1}_${sceneIndex + 1}`,
                order: 0,
              })),
            ),
          };
          document.scenes = document.scenes.map((scene, order) => ({ ...scene, order }));
          const created = await runtime.repository.createFromSource({
            userId: user.id,
            sourceTaskId: sourceTaskIds.size === 1 ? imported.sourceTaskId : null,
            sourceFileId: imported.sourceFileId,
            sourceKind: sourceKinds.size === 1 ? imported.sourceKind : 'upload',
            document,
          });
          return {
            project: projectView(created.project),
            currentVersion: versionView(created.currentVersion),
            preview: imported.preview,
            capabilities: {
              sceneRegeneration: importedSources.every(
                (source) => source.capabilities.sceneRegeneration,
              ),
            },
          };
        }),
      ),

    getProject: protectedProcedure
      .input(z.object({ projectId: externalIdSchema }).strict())
      .query(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const loaded = await runtime.repository.getOwnedProject(input.projectId, user.id);
          const [preview, versions] = await Promise.all([
            runtime.getProjectPreview(loaded.project, user.id),
            runtime.repository.listVersions(input.projectId, user.id),
          ]);
          return {
            project: projectView(loaded.project),
            currentVersion: versionView(loaded.currentVersion),
            versions: versions.map(versionView),
            preview,
          };
        }),
      ),

    planInstruction: protectedProcedure
      .input(
        z
          .object({
            projectId: externalIdSchema,
            instruction: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const loaded = await runtime.repository.getOwnedProject(input.projectId, user.id);
          return runtime.planInstruction({
            instruction: input.instruction,
            document: loaded.currentVersion.documentJson,
            sourceKind: loaded.project.sourceKind,
          });
        }),
      ),

    applyFreeOperations: protectedProcedure
      .input(
        z
          .object({
            projectId: externalIdSchema,
            baseVersionId: externalIdSchema,
            summary: z.string().trim().min(1).max(300),
            operations: operationsSchema,
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          if (input.operations.some((operation) => operation.kind === 'regenerate_scene')) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: '重新生成场景需要先确认报价' });
          }
          const loaded = await runtime.repository.getOwnedProject(input.projectId, user.id);
          const validated = validateVideoEditPlan(
            { summary: input.summary, operations: input.operations },
            { document: loaded.currentVersion.documentJson, sourceKind: loaded.project.sourceKind },
          );
          const document = applyVideoEditOperations(
            loaded.currentVersion.documentJson,
            validated.operations,
          );
          const version = await runtime.repository.appendVersion({
            userId: user.id,
            projectId: input.projectId,
            baseVersionId: input.baseVersionId,
            document,
            operations: validated.operations,
          });
          return { version: versionView(version) };
        }),
      ),

    quotePaidOperation: protectedProcedure
      .input(
        z
          .object({
            projectId: externalIdSchema,
            baseVersionId: externalIdSchema,
            summary: z.string().trim().min(1).max(300),
            operations: operationsSchema,
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const loaded = await runtime.repository.getOwnedProject(input.projectId, user.id);
          const validated = validateVideoEditPlan(
            { summary: input.summary, operations: input.operations },
            { document: loaded.currentVersion.documentJson, sourceKind: loaded.project.sourceKind },
          );
          return runtime.quoteService.createQuote({
            userId: user.id,
            projectId: input.projectId,
            baseVersionId: input.baseVersionId,
            operations: validated.operations,
          });
        }),
      ),

    consumePaidOperation: protectedProcedure
      .input(
        z
          .object({
            projectId: externalIdSchema,
            baseVersionId: externalIdSchema,
            quoteId: externalIdSchema,
            operations: operationsSchema,
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const loaded = await runtime.repository.getOwnedProject(input.projectId, user.id);
          return runtime.quoteService.consumeAndExecute(
            { userId: user.id, ...input },
            {
              billing: runtime.billing,
              execute: ({ quoteId, costUnits, operations }) =>
                runtime.executePaidOperation({
                  user,
                  project: loaded.project,
                  baseVersion: loaded.currentVersion,
                  quoteId,
                  costUnits,
                  operations,
                }),
            },
          );
        }),
      ),

    saveSdkDocument: protectedProcedure
      .input(
        z
          .object({
            projectId: externalIdSchema,
            baseVersionId: externalIdSchema,
            sdkDocument: z.string().min(1).max(5_000_000),
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const loaded = await runtime.repository.getOwnedProject(input.projectId, user.id);
          const version = await runtime.repository.appendVersion({
            userId: user.id,
            projectId: input.projectId,
            baseVersionId: input.baseVersionId,
            document: loaded.currentVersion.documentJson,
            operations: null,
            sdkDocument: input.sdkDocument,
          });
          return { version: versionView(version) };
        }),
      ),

    restoreVersion: protectedProcedure
      .input(
        z
          .object({
            projectId: externalIdSchema,
            baseVersionId: externalIdSchema,
            targetVersionId: externalIdSchema,
          })
          .strict(),
      )
      .mutation(({ ctx, input }) =>
        withRuntime(dependencies, ctx, async (runtime, user) => {
          const version = await runtime.repository.restoreVersion({ userId: user.id, ...input });
          return { version: versionView(version) };
        }),
      ),
  });
}

const productionDependencies: VideoEditingRouterDependencies = {
  featureConfig: {
    enabled: env.VIDEO_EDITING_ENABLED,
    allowlist: env.VIDEO_EDITING_ALLOWLIST,
    licenseConfigured: Boolean(env.CESDK_LICENSE),
  },
  async resolveUser(ctx) {
    const [row] = await ctx.db
      .select({
        id: users.id,
        externalId: users.externalId,
        plan: users.plan,
        status: users.status,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!row || row.status !== 'active') {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    const plan: PlanId = row.plan === 'basic' || row.plan === 'pro' ? row.plan : 'free';
    return { id: row.id, externalId: row.externalId, plan };
  },
  createRuntime(ctx) {
    const repository = VideoEditProjectRepository.fromDb(ctx.db);
    const fileService = new FileService(ctx.db, ctx.logger);
    const plannerClient = createOpenAIVideoEditPlannerClient({
      enabled: env.VIDEO_EDITING_ENABLED,
      apiKey: process.env.OPENAI_API_KEY ?? '',
    });
    const sourceDependencies = createVideoSourceImportDependencies({
      db: ctx.db,
      fileService,
      probeDurationMs: async (source) => {
        const preview = await fileService.getScopedPreviewForUser(
          source.fileId,
          source.userId,
          300,
        );
        if (!preview || preview.delivery !== 'signed') {
          throw new Error('duration probe requires a short-lived signed source URL');
        }
        return ffprobeDurationMs(preview.url, { timeoutMs: 30_000 });
      },
    });
    return {
      repository,
      importSource: (input) => importVideoSource(input, sourceDependencies),
      async getProjectPreview(project, userId) {
        if (project.sourceFileId === null) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '视频文件已不可用' });
        }
        const [source] = await ctx.db
          .select({ externalId: taskFiles.externalId })
          .from(taskFiles)
          .where(eq(taskFiles.id, project.sourceFileId))
          .limit(1);
        if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: '视频文件已不可用' });
        const preview = await fileService.getScopedPreviewForUser(source.externalId, userId, 900);
        if (!preview) throw new TRPCError({ code: 'NOT_FOUND', message: '视频文件已不可用' });
        return preview;
      },
      planInstruction(input) {
        if (!plannerClient) return Promise.resolve({ status: 'planner_unavailable' as const });
        return planVideoEditInstruction({ ...input, client: plannerClient });
      },
      quoteService: new VideoEditQuoteService(repository),
      billing: {
        async consume() {
          return { ok: false as const, reason: 'insufficient_balance' as const };
        },
        async refund() {},
      },
      async executePaidOperation() {
        throw new Error('scene regeneration execution is not enabled');
      },
    };
  },
};

export const videoEditingRouter = createVideoEditingRouter(productionDependencies);
