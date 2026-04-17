-- Manual migration: month-range partitioning for `task_events`.
-- Apply AFTER drizzle-kit generates the initial schema and before any row
-- is inserted into `task_events`. Re-partitioning a populated table on MySQL
-- 8.4 takes an exclusive metadata lock — do it before real traffic.
--
-- Run with: mysql < drizzle/manual/0001_partition_task_events.sql
--
-- Rollover policy: on the 25th of each month a scheduled event adds the
-- next two partitions. Phase 0 precreates 3 months of forward runway +
-- one MAXVALUE catch-all.

ALTER TABLE task_events
  PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p2026_04 VALUES LESS THAN (TO_DAYS('2026-05-01')),
    PARTITION p2026_05 VALUES LESS THAN (TO_DAYS('2026-06-01')),
    PARTITION p2026_06 VALUES LESS THAN (TO_DAYS('2026-07-01')),
    PARTITION p2026_07 VALUES LESS THAN (TO_DAYS('2026-08-01')),
    PARTITION pmax    VALUES LESS THAN MAXVALUE
  );
