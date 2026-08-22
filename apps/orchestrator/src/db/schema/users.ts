import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

/**
 * `users` — account.
 * - `external_id` is the outward-facing id (NanoID 21 + prefix `usr_`).
 * - `plan` kept as VARCHAR(32) (not ENUM) so plans can evolve without DDL churn.
 * - `password_hash` is empty string for OAuth-only users — bcrypt(``) never
 *   matches anything, so they can't password-login by accident.
 * - Phase 0: no soft delete.
 */
export const users = mysqlTable(
  'users',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    /**
     * Phase 12 — email becomes nullable. SMS-first users have no
     * email until they add one via /profile. MySQL UNIQUE treats
     * multiple NULLs as distinct, so the uk_users_email index stays
     * correct.
     */
    email: varchar('email', { length: 255 }),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    plan: varchar('plan', { length: 32 }).notNull().default('free'),
    /**
     * Phase 27 — admin role gate. Currently two values: 'user' (the
     * default) and 'admin' (gates the /admin tRPC routes). VARCHAR
     * (not ENUM) so adding 'support' / 'ops' later doesn't require
     * an ALTER TABLE.
     */
    role: varchar('role', { length: 16 }).notNull().default('user'),
    planExpiresAt: datetime('plan_expires_at', { mode: 'date', fsp: 3 }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    /**
     * Incremented whenever all existing access tokens must be revoked
     * (currently password reset). Tokens carry the issuing version and
     * HTTP authentication accepts only the current value.
     */
    authVersion: int('auth_version').notNull().default(0),
    /** Authenticator-app MFA. Secret is an AES-GCM envelope, never plaintext. */
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretEncrypted: varchar('mfa_secret_encrypted', { length: 512 }),
    mfaSetupCreatedAt: datetime('mfa_setup_created_at', { mode: 'date', fsp: 3 }),
    /** Last accepted RFC 6238 time step, preventing same-code replay. */
    mfaLastUsedStep: bigint('mfa_last_used_step', { mode: 'number' }),
    mfaFailedAttempts: int('mfa_failed_attempts').notNull().default(0),
    mfaLockedUntil: datetime('mfa_locked_until', { mode: 'date', fsp: 3 }),
    displayName: varchar('display_name', { length: 128 }),
    googleId: varchar('google_id', { length: 64 }),
    avatarUrl: varchar('avatar_url', { length: 512 }),
    emailVerified: boolean('email_verified').notNull().default(false),
    /** Phase 12 — canonical 11-digit Chinese mobile, no +86 prefix. */
    phone: varchar('phone', { length: 20 }),
    phoneVerified: boolean('phone_verified').notNull().default(false),
    /**
     * Phase 1 (video) — onboarding assets. Both NULL until the user
     * completes video onboarding.
     * - `qwenVoiceId`: voice_id from Qwen3-TTS-VC enrollment
     *   (DashScope-intl), reused on every synthesis call.
     * - `baseVideoFileId`: task_files.external_id of the user's base
     *   on-camera video (kind='input') — the IP lip-sync base.
     *   Soft reference (no FK) so it stays nullable and decoupled from
     *   task_files retention.
     */
    qwenVoiceId: varchar('qwen_voice_id', { length: 128 }),
    baseVideoFileId: varchar('base_video_file_id', { length: 32 }),
    /**
     * Phase 2 第三期 — when the user signed the「本人授权声明（仅用本人
     * 声音/肖像）」consent. NULL = not signed / revoked. The IP-person
     * lip-sync lane (video-lane.ts) hard-refuses unless this is set.
     */
    videoSelfUseAuthorizedAt: datetime('video_self_use_authorized_at', { mode: 'date', fsp: 3 }),
    /**
     * Open-pool role ids the Basic-plan user has actively chosen
     * (max 5). Pro plan ignores this — they get all 33 by default.
     * Stored as JSON so future schemas can carry per-pick metadata
     * (last-used, popularity rank) without a migration.
     *
     * Phase 24 follow-up — strictly role ids now. Earlier the
     * /skills page also wrote skill toggles into this column, which
     * blew up the Basic 5-pick gate; skill toggles moved to
     * `selected_skills` below.
     */
    selectedRoles: json('selected_roles').$type<string[] | null>(),
    /**
     * Skill ids the user has explicitly toggled on in /skills. No
     * pick limit here — skills are a free-form preference layer
     * (which playbooks / system-prompt addons to load), not a
     * paywalled role slot. Migrated out of `selected_roles` in
     * `0017_users_split_skills`.
     */
    selectedSkills: json('selected_skills').$type<string[] | null>(),
    /**
     * Number of role-set changes the user has made in the current
     * `roleChangesPeriodStart` month. Resets via app code when
     * `roleChangesPeriodStart` rolls into a new month.
     */
    roleChangesThisMonth: int('role_changes_this_month').notNull().default(0),
    roleChangesPeriodStart: datetime('role_changes_period_start', { mode: 'date', fsp: 3 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_users_external_id').on(t.externalId),
    uniqueIndex('uk_users_email').on(t.email),
    uniqueIndex('uk_users_google_id').on(t.googleId),
    uniqueIndex('uk_users_phone').on(t.phone),
    index('ix_users_plan').on(t.plan),
    index('ix_users_plan_expires_at').on(t.planExpiresAt),
    index('ix_users_role').on(t.role),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
