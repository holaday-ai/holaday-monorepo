import { sql } from 'drizzle-orm';
import { createNoAccountAssociationHandler, readQueryCount } from '../handler-contract.js';

export const energyAstrologyProfileClosureHandler = createNoAccountAssociationHandler(
  'energy_astrology_profile',
  async (context) =>
    readQueryCount(
      await context.db.execute(sql`
        SELECT COUNT(*) AS association_count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN ('astrology_profiles', 'energy_astrology_profiles')
      `),
    ),
);
