-- Phase 2 第三期 (IP人物 真人换口型) 阶段0 — 本人授权声明时间戳 on `users`.
--
-- Adds ONE nullable column recording WHEN the user signed the "本人授权声明
-- （仅用本人声音/肖像）" consent. The IP-person lip-sync lane
-- (video-lane.ts runVideoCreation) hard-refuses generation unless this is
-- set (ctx.authorizedSelfUse) — a compliance gate, not just UI.
--
--   - video_self_use_authorized_at : DATETIME(3) NULL. NULL = not yet signed
--       (or revoked via the onboarding delete flow). Set to now() when the
--       user ticks the authorization checkbox in the onboarding wizard.
--
-- Nullable, no default, no index (read per-user by primary key, never
-- filtered across users — same shape as the 0034 onboarding columns).
-- Does NOT touch existing columns/data.
--
-- Idempotent under scripts/apply-numbered-migrations.ts: a re-run hits
-- ER_DUP_FIELDNAME which the runner treats as already-applied.
--
-- DOWN (manual rollback, not auto-run):
--   ALTER TABLE users DROP COLUMN video_self_use_authorized_at;

ALTER TABLE users
  ADD COLUMN video_self_use_authorized_at DATETIME(3) NULL;
