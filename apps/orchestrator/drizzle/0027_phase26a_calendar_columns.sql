-- Phase 26A — calendar view + advanced recurrence on scheduled_tasks.
--
-- Three additive columns to support the FullCalendar-based /scheduled
-- page redesign:
--
--   rrule              RFC 5545 recurrence rule (e.g. 'FREQ=WEEKLY;BYDAY=MO,WE,FR'),
--                      parsed by `rrule` npm pkg. When set, the runner
--                      uses it to compute next_run_at and the calendar
--                      renders recurring events natively via @fullcalendar/rrule.
--                      NULL = use the legacy `repeat_type` column instead
--                      (back-compat with rows created before Phase 26A).
--
--   duration_minutes   How long the event "occupies" the calendar in week/day
--                      time-grid views. Doesn't affect dispatch timing —
--                      a task fires at next_run_at regardless. Defaults to
--                      30 minutes so the visual block is non-trivial; users
--                      can drag the bottom edge in TimeGrid to resize.
--
--   timezone           IANA tz name (e.g. 'Asia/Shanghai', 'America/New_York').
--                      Used for rrule expansion in the user's local time
--                      across DST transitions. NULL = treat as UTC, which
--                      is also the legacy behaviour. Default 'Asia/Shanghai'
--                      since the China route is the primary user base.
--
-- All three are NULL-tolerant defaults so existing rows keep working
-- without backfill. Runner code prefers `rrule` when set; otherwise
-- falls through to the existing repeat_type-driven logic.

ALTER TABLE `scheduled_tasks` ADD COLUMN `rrule` VARCHAR(255) NULL;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD COLUMN `duration_minutes` INT UNSIGNED NOT NULL DEFAULT 30;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD COLUMN `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai';
