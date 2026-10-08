import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  catalogSettingsService,
  isAdminUser,
  modelCatalogService,
} from '../../llm/model-catalog-runtime.js';
import { MAX_MCP_SERVERS } from '../../llm/model-catalog-settings.js';
import {
  BRAIN_LANES,
  type BrainEntry,
  type BrainLaneModels,
  ModelCatalogError,
  listBrainsForViewer,
  selectDefaultBrain,
} from '../../llm/model-catalog.js';
/**
 * Model catalog ("模型管理"): which brains users can pick, and the admin
 * one-click switches. Visibility and the default live in the database
 * (`model_catalog`, migration 0061) — no env change or restart is needed.
 */
import { loadModelPrices } from '../../llm/model-pricing.js';
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

  adminList: adminProcedure.query(async ({ ctx }) => {
    modelCatalogService.invalidate();
    const entries = await modelCatalogService.list();
    const defaultId = selectDefaultBrain(entries).id;
    return {
      lanes: [...BRAIN_LANES],
      pricing: await loadModelPrices(ctx.db),
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

  /** Bailian MCP servers attached to the Qwen generate / scrape lanes. */
  adminMcpList: adminProcedure.query(async () => ({
    max: MAX_MCP_SERVERS,
    items: [...(await catalogSettingsService.mcpServers())],
  })),

  adminMcpUpdate: adminProcedure
    .input(
      z
        .object({
          items: z
            .array(z.object({ label: z.string().max(64), url: z.string().max(2048) }).strict())
            .max(MAX_MCP_SERVERS),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const items = await catalogSettingsService.updateMcpServers({
          servers: input.items,
          actorExternalId: ctx.userId,
        });
        return { max: MAX_MCP_SERVERS, items: [...items] };
      } catch (error) {
        if (error instanceof ModelCatalogError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throw error;
      }
    }),
});
