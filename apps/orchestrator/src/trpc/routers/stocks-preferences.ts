import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../../db/schema/users.js';
import type { ManualStockPreferences } from '../../stocks/stock-preference-profile.js';
import {
  clearStockPreferenceProfile,
  loadStockPreferenceProfile,
  manualStockPreferencesSchema,
  updateStockPreferenceControls,
} from '../../stocks/stock-preference-repository.js';
import { protectedProcedure } from '../trpc.js';

type Db = typeof import('../../db/client.js').db;

interface PreferenceLogger {
  info?(obj: Record<string, unknown>, message: string): void;
  warn(obj: Record<string, unknown>, message: string): void;
}

async function requireUserId(db: Db, externalId: string): Promise<number> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, externalId))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  return row.id;
}

export const updateStockPreferenceProfileInputSchema = z.object({
  enabled: z.boolean(),
  manualPreferences: manualStockPreferencesSchema,
}).strict();

type LoadProfile = typeof loadStockPreferenceProfile;
type UpdateProfile = typeof updateStockPreferenceControls;
type ClearProfile = typeof clearStockPreferenceProfile;

export async function getPreferenceProfileForUser(args: {
  db: Db;
  userExternalId: string;
  load?: LoadProfile;
  now?: Date;
}) {
  const userId = await requireUserId(args.db, args.userExternalId);
  return (args.load ?? loadStockPreferenceProfile)({ db: args.db, userId, now: args.now });
}

export async function updatePreferenceProfileForUser(args: {
  db: Db;
  userExternalId: string;
  input: { enabled: boolean; manualPreferences: ManualStockPreferences };
  update?: UpdateProfile;
  load?: LoadProfile;
  logger?: PreferenceLogger;
  now?: Date;
}) {
  const input = updateStockPreferenceProfileInputSchema.parse(args.input);
  const userId = await requireUserId(args.db, args.userExternalId);
  await (args.update ?? updateStockPreferenceControls)({
    db: args.db,
    userId,
    enabled: input.enabled,
    manualPreferences: input.manualPreferences,
  });
  args.logger?.info?.({
    userId,
    enabled: input.enabled,
    manualDimensionCount: Object.values(input.manualPreferences).filter((values) => values.length > 0).length,
  }, 'stocks-preferences: controls updated');
  return (args.load ?? loadStockPreferenceProfile)({ db: args.db, userId, now: args.now });
}

export async function clearPreferenceProfileForUser(args: {
  db: Db;
  userExternalId: string;
  clear?: ClearProfile;
  load?: LoadProfile;
  logger?: PreferenceLogger;
  now?: Date;
}) {
  const userId = await requireUserId(args.db, args.userExternalId);
  await (args.clear ?? clearStockPreferenceProfile)({ db: args.db, userId, now: args.now });
  args.logger?.info?.({ userId }, 'stocks-preferences: profile cleared');
  return (args.load ?? loadStockPreferenceProfile)({ db: args.db, userId, now: args.now });
}

export async function withStockScreeningPreferenceRecording<T>(args: {
  run: () => Promise<T>;
  record: () => Promise<unknown>;
  logger: PreferenceLogger;
  logContext: { userId: number; snapshotId: string; criterionCount: number };
}): Promise<T> {
  const result = await args.run();
  try {
    await args.record();
  } catch {
    args.logger.warn(args.logContext, 'stocks-preferences: screening evidence recording failed');
  }
  return result;
}

export const stockPreferenceProcedures = {
  preferenceProfile: protectedProcedure.query(({ ctx }) => getPreferenceProfileForUser({
    db: ctx.db,
    userExternalId: ctx.userId,
  })),
  updatePreferenceProfile: protectedProcedure
    .input(updateStockPreferenceProfileInputSchema)
    .mutation(({ ctx, input }) => updatePreferenceProfileForUser({
      db: ctx.db,
      userExternalId: ctx.userId,
      input,
      logger: ctx.logger,
    })),
  clearPreferenceProfile: protectedProcedure.mutation(({ ctx }) => clearPreferenceProfileForUser({
    db: ctx.db,
    userExternalId: ctx.userId,
    logger: ctx.logger,
  })),
};
