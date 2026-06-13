-- Phase 1 (video) step 1 — onboarding asset columns on `users`.
--
-- Adds two nullable columns so the video pipeline can remember a user's
-- cloned voice + their base "on-camera" video without a join table.
-- v1 holds a single cloned voice + a single base video; multi-base-video
-- support can graduate to a dedicated table later (the plan allows 1-3
-- base clips, but step 1 only needs the single-asset happy path).
--
--   - qwen_voice_id      : the voice_id returned by Qwen3-TTS-VC enrollment
--                          (DashScope-intl, Singapore region), reused on
--                          every synthesis call. NULL until onboarding.
--   - base_video_file_id : task_files.external_id (VARCHAR(32)) of the
--                          user's base on-camera video (kind='input') — the
--                          LatentSync lip-sync base. Soft reference (no FK)
--                          to keep it nullable and avoid a cascade coupling
--                          with task_files retention.
--
-- Both nullable, no default — a user without video onboarding simply has
-- NULLs. No index: these are read on the per-user pipeline path by user
-- primary key, never filtered across users.
--
-- Idempotent under scripts/apply-numbered-migrations.ts: a re-run hits
-- ER_DUP_FIELDNAME which the runner treats as already-applied.

ALTER TABLE users
  ADD COLUMN qwen_voice_id VARCHAR(128) NULL;
--> statement-breakpoint
ALTER TABLE users
  ADD COLUMN base_video_file_id VARCHAR(32) NULL;
