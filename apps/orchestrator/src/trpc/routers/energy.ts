import { z } from 'zod';
import { buildEnergyHome } from '../../energy/catalog.js';
import { protectedProcedure, router } from '../trpc.js';

const energyEventInput = z
  .object({
    type: z.enum(['started', 'completed', 'replayed', 'failed']),
    experienceId: z.enum(['recharge', 'tarot', 'light-test', 'horoscope', 'games']),
    energyNeed: z.enum(['focus', 'relax', 'confidence', 'uplift']).nullable(),
    durationBucket: z.enum(['under-60s', 'one-to-three-minutes', 'over-three-minutes']).nullable(),
    outcome: z.enum(['success', 'abandoned', 'error']).nullable(),
  })
  .strict();

export const energyRouter = router({
  home: protectedProcedure.query(() => buildEnergyHome()),
  reportEvent: protectedProcedure.input(energyEventInput).mutation(({ ctx, input }) => {
    ctx.logger.info(
      {
        event: 'energy_experience_event',
        type: input.type,
        experienceId: input.experienceId,
        energyNeed: input.energyNeed,
        durationBucket: input.durationBucket,
        outcome: input.outcome,
      },
      'energy experience event',
    );

    return { ok: true as const };
  }),
});
