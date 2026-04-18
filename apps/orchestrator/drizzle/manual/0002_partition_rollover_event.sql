-- Manual migration: monthly RANGE partition rollover for `task_events`.
-- Apply AFTER 0001_partition_task_events.sql.
--
-- Run with: mysql --user=root < drizzle/manual/0002_partition_rollover_event.sql
--
-- Behaviour, run on the 1st of every month at 02:00 UTC:
--   1. ADD next month's partition (named p<YYYY>_<MM>) before the MAXVALUE catch-all.
--   2. DROP partitions older than 13 months from now (rolling retention window).
--
-- Notes:
--   - Requires `event_scheduler=ON`. We turn it on at the bottom; it is a
--     dynamic system variable, no restart needed.
--   - The procedure is idempotent: re-adding an existing partition is a no-op
--     (we check via information_schema first), and dropping a non-existent
--     partition is also a no-op.
--   - DROP PARTITION is metadata-only on MySQL 8.4 and instant.

DELIMITER $$

DROP PROCEDURE IF EXISTS sp_task_events_rollover $$
CREATE PROCEDURE sp_task_events_rollover()
BEGIN
  DECLARE v_db        VARCHAR(64) DEFAULT DATABASE();
  DECLARE v_next_name VARCHAR(16);
  DECLARE v_next_less DATE;
  DECLARE v_drop_name VARCHAR(16);
  DECLARE v_exists    INT DEFAULT 0;
  DECLARE v_sql       TEXT;

  -- ---- 1. Add next month's partition (one ahead of the current month) ----
  SET v_next_less = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 2 MONTH), '%Y-%m-01');
  SET v_next_name = CONCAT(
    'p',
    DATE_FORMAT(DATE_SUB(v_next_less, INTERVAL 1 MONTH), '%Y_%m')
  );

  SELECT COUNT(*) INTO v_exists
    FROM information_schema.PARTITIONS
   WHERE TABLE_SCHEMA = v_db
     AND TABLE_NAME   = 'task_events'
     AND PARTITION_NAME = v_next_name;

  IF v_exists = 0 THEN
    SET v_sql = CONCAT(
      'ALTER TABLE task_events REORGANIZE PARTITION pmax INTO (',
        'PARTITION ', v_next_name,
          ' VALUES LESS THAN (TO_DAYS(''', v_next_less, ''')),',
        'PARTITION pmax VALUES LESS THAN MAXVALUE',
      ')'
    );
    SET @s = v_sql;
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;

  -- ---- 2. Drop the partition >= 13 months old ----
  SET v_drop_name = CONCAT(
    'p', DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 13 MONTH), '%Y_%m')
  );

  SELECT COUNT(*) INTO v_exists
    FROM information_schema.PARTITIONS
   WHERE TABLE_SCHEMA = v_db
     AND TABLE_NAME   = 'task_events'
     AND PARTITION_NAME = v_drop_name;

  IF v_exists > 0 THEN
    SET v_sql = CONCAT('ALTER TABLE task_events DROP PARTITION ', v_drop_name);
    SET @s = v_sql;
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END $$

DELIMITER ;

-- Schedule it.
DROP EVENT IF EXISTS ev_task_events_rollover;
CREATE EVENT ev_task_events_rollover
  ON SCHEDULE
    EVERY 1 MONTH
    STARTS DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01 02:00:00')
  ON COMPLETION PRESERVE
  DO
    CALL sp_task_events_rollover();

-- Make sure the scheduler is on (dynamic, no restart).
SET GLOBAL event_scheduler = ON;
