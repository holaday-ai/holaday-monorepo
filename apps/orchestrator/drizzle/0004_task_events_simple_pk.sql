-- P1.1 follow-up: simplify task_events primary key from composite
-- (id, created_at) to plain (id). Original composite was there to
-- satisfy MySQL's partitioning-key-must-be-in-unique-key rule, but
-- partitioning is a manual ops step (drizzle/manual/0001_partition_task_events.sql)
-- and the composite PK tripped drizzle-kit 0.31.x's push diff with a
-- spurious "primary key removed" warning that blocked operators on
-- their first db:push.
--
-- The manual partition migration can drop and re-add the PK as
-- composite when it runs; no other callers of this table assume
-- the PK shape.
--
-- Safe on empty / small tables. Rewrites the whole clustered index
-- so don't run on a multi-GB table without scheduling.

-- MySQL/MariaDB rejects `DROP PRIMARY KEY` on an AUTO_INCREMENT column
-- unless the drop and the new PK happen in the SAME ALTER — otherwise
-- the intermediate state has an auto column with no key, which is
-- "Incorrect table definition; there can be only one auto column and
-- it must be defined as a key". Combine both into one statement.
ALTER TABLE `task_events` DROP PRIMARY KEY, ADD PRIMARY KEY (`id`);--> statement-breakpoint
CREATE INDEX `ix_task_events_created_at` ON `task_events` (`created_at`);
