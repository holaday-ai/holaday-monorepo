/**
 * Model catalog ("模型管理"): which brains users can pick, and the admin
 * one-click switches. Visibility and the default live in the database
 * (`model_catalog`, migration 0061) — no env change or restart is needed.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { isAdminUser, modelCatalogService } from '../../llm/model-catalog-runtime.js';
import {
  BRAIN_LANES,
  type BrainEntry,
  type BrainLaneModels,
  ModelCatalogError,
  listBrainsForViewer,
  selectDefaultBrain,
} from '../../llm/model-catalog.js';
import { adminProcedure, protectedProcedure, router } from '../trpc.js';

const laneModelsInput = z
  .object(
    Object.fromEntries(
      BRAIN_LANES.map((lane) => [lane, z.string().trim().min(1).max(80).optional()]),
    ) as Record<(typeof BRAIN_LANES)[number], z.ZodOptional<z.ZodString>>,
  )
  .strict();

function adminView(entry: BrainEntry, defaultId: string) {
  return {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    userVisible: entry.userVisible,
    adminOnly: entry.adminOnly,
    isDefault: entry.id === defaultId,
    configured: modelCatalogService.isProviderConfigured(entry.provider),
    laneModels: entry.laneModels,
    updatedAt: entry.updatedAt ? entry.updatedAt.toISOString() : null,
  };
}

export const modelsRouter = router({
  /** Brains this viewer can choose. Ordinary users see only visible ones (today: 千问). */
  list: protectedProcedure.query(async ({ ctx }) => {
    const isAdmin = await isAdminUser(ctx.db, ctx.userId);
    const entries = await modelCatalogService.list();
    return {
      items: listBrainsForViewer(entries, { isAdmin }, modelCatalogService.isProviderConfigured),
    };
  }),

  adminList: adminProcedure.query(async () => {
    modelCatalogService.invalidate();
    const entries = await modelCatalogService.list();
    const defaultId = selectDefaultBrain(entries).id;
    return {
      lanes: [...BRAIN_LANES],
      items: entries.map((entry) => adminView(entry, defaultId)),
    };
  }),

  adminUpdate: adminProcedure
    .input(
      z
        .object({
          id: z.string().trim().min(1).max(32),
          userVisible: z.boolean().optional(),
          adminOnly: z.boolean().optional(),
          isDefault: z.literal(true).optional(),
          laneModels: laneModelsInput.optional(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, laneModels, ...rest } = input;
      try {
        const entries = await modelCatalogService.update({
          id,
          patch: {
            ...rest,
            ...(laneModels ? { laneModels: laneModels as BrainLaneModels } : {}),
          },
          actorExternalId: ctx.userId,
        });
        const defaultId = selectDefaultBrain(entries).id;
        return { items: entries.map((entry) => adminView(entry, defaultId)) };
      } catch (error) {
        if (error instanceof ModelCatalogError) {
          throw new TRPCError({
            code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
            message: error.message,
          });
        }
        throw error;
      }
    }),
});
