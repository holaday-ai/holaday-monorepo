-- Phase 1 指令 #2 — A股自选股 (watchlist).
--
-- 「收藏/stars」架构里没有可复用的表存股票代码：tasks.starred 是任务上
-- 的布尔旗标，projects 是任务分组，user_profiles.fingerprint 是职业指纹。
-- 自选股 = 一个用户 → N 个股票代码的清单，需独立表。
--
-- 加法式、FK ON DELETE CASCADE（账号注销即清理），照搬 user_site_stats
-- (0026) 的形。两条唯一键：external_id 给 SPA 路由，(user_id, symbol)
-- 防同股重复添加。盘前/盘后简报 (③) 直接 WHERE user_id=? 取清单喂 6 个
-- AkShare MCP 工具。
--
-- 合规：这是用户私人清单，不涉荐股；CRUD 路由不调 AkShare，取数全在
-- 简报/问答侧并带来源+时间戳+免责。

CREATE TABLE `watchlists` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `external_id` VARCHAR(32) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `symbol` VARCHAR(16) NOT NULL,
  `market` VARCHAR(8) NOT NULL DEFAULT 'A',
  `display_name` VARCHAR(64) NULL,
  `note` VARCHAR(255) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  -- 预留：未来提醒阈值配置（本期不实现，router 不暴露）。NULL = 未设提醒。
  `alert_config_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_watchlists_external_id` (`external_id`),
  UNIQUE KEY `uk_watchlists_user_symbol` (`user_id`, `symbol`),
  KEY `ix_watchlists_user` (`user_id`),
  CONSTRAINT `fk_watchlists_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
