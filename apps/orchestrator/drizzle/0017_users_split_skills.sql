-- P1.2 — split skills out of users.selected_roles.
--
-- Background: /skills toggles were writing into users.selected_roles
-- (the same column /settings/roles uses for the Basic-plan 5-pick).
-- A Basic user who toggled 8 skills then opened /settings/roles saw
-- "已选 13 / 5" and the role gate stopped letting them save changes.
--
-- After: skill toggles land in users.selected_skills (this column);
-- /settings/roles continues to read+write selected_roles. The two
-- columns evolve independently. The split-pre-existing-data step is
-- the companion script `apps/orchestrator/scripts/split-skills.ts`,
-- which BOSS runs once after this migration. The schema change here
-- is non-destructive: existing selected_roles values are untouched
-- until the script partitions them.

ALTER TABLE `users` ADD COLUMN `selected_skills` json NULL;
