import { z } from 'zod';
import { env } from '../../config/env.js';
import type { DB } from '../../db/client.js';
import {
  type EnergyAnalyticsConfig,
  energyAnalyticsConfigFromEnv,
} from '../../energy/analytics-bucket.js';
import { energyEventInput } from '../../energy/analytics-contract.js';
import { queryEnergyMetrics } from '../../energy/analytics-metrics-service.js';
import {
  type EnergyAnalyticsDatabaseStore,
  createEnergyAnalyticsStore,
} from '../../energy/analytics-store.js';
import { recordEnergyEvent } from '../../energy/analytics-write-service.js';
import { buildEnergyHome } from '../../energy/catalog.js';
import { adminProcedure, protectedProcedure, router } from '../trpc.js';

interface EnergyRouterDeps {
  createStore(database: DB): EnergyAnalyticsDatabaseStore;
  config: EnergyAnalyticsConfig;
  now(): Date;
}

const defaultDeps: EnergyRouterDeps = {
  createStore: createEnergyAnalyticsStore,
  config: energyAnalyticsConfigFromEnv(env),
  now: () => new Date(),
};

export function createEnergyRouter(deps: EnergyRouterDeps = defaultDeps) {
  return router({
    home: protectedProcedure.query(() => buildEnergyHome()),
    reportEvent: protectedProcedure.input(energyEventInput).mutation(({ ctx, input }) =>
      recordEnergyEvent({
        store: deps.createStore(ctx.db),
        input,
        userId: ctx.userId,
        now: deps.now(),
        config: deps.config,
        logger: ctx.logger,
      }),
    ),
    metrics: adminProcedure
      .input(z.object({ window: z.union([z.literal(7), z.literal(30)]).default(7) }).strict())
      .query(({ ctx, input }) =>
        queryEnergyMetrics({
          store: deps.createStore(ctx.db),
          window: input.window,
          now: deps.now(),
        }),
      ),
  });
}

export const energyRouter = createEnergyRouter();
