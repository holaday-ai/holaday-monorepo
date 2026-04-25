import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * `verification_codes` — durable record of email-verification codes.
 *
 * The hot-path service (`auth/email-code.ts`) keeps codes in memory for
 * latency, but we also persist a hashed copy here so:
 *   - a restart doesn't drop in-flight codes
 *   - we can audit how many codes were sent per email per day
 *
 * `code_hash` is bcrypt — never store the plaintext code. `purpose`
 * separates login codes from password-reset codes so a stolen reset
 * code can't be used to log in.
 */
export const verificationCodes = mysqlTable(
  'verification_codes',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    codeHash: varchar('code_hash', { length: 255 }).notNull(),
    purpose: varchar('purpose', { length: 32 }).notNull().default('login'),
    attempts: int('attempts').notNull().default(0),
    usedAt: datetime('used_at', { mode: 'date', fsp: 3 }),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (t) => [
    uniqueIndex('uk_verification_codes_external_id').on(t.externalId),
    index('ix_verification_codes_email_purpose').on(t.email, t.purpose),
    index('ix_verification_codes_expires_at').on(t.expiresAt),
  ],
);

export type VerificationCode = typeof verificationCodes.$inferSelect;
export type NewVerificationCode = typeof verificationCodes.$inferInsert;
