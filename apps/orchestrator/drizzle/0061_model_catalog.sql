-- Model catalog: the admin-switchable "brain" list. Additive only.
-- Exactly one row is the default; the application enforces it inside one
-- transaction and the seed below establishes it. The catalog holds no user
-- data: who changed what lives in model_catalog_events (actor_user_id).
CREATE TABLE IF NOT EXISTS `model_catalog` (
  `id` varchar(32) NOT NULL,
  `provider` varchar(32) NOT NULL,
  `label` varchar(64) NOT NULL,
  `user_visible` boolean NOT NULL DEFAULT false,
  `is_default` boolean NOT NULL DEFAULT false,
  `admin_only` boolean NOT NULL DEFAULT true,
  `sort_order` int NOT NULL DEFAULT 0,
  `lane_models` json NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_model_catalog_provider`
    CHECK (`provider` IN ('alibaba-model-studio', 'anthropic', 'openai'))
);
--> statement-breakpoint
INSERT IGNORE INTO `model_catalog`
  (`id`, `provider`, `label`, `user_visible`, `is_default`, `admin_only`, `sort_order`, `lane_models`)
VALUES
  ('qwen', 'alibaba-model-studio', '千问', true, true, false, 10,
    JSON_OBJECT('browser', 'qwen3.8-max', 'generate', 'qwen3.7-plus', 'scrape', 'qwen3.7-plus',
      'plan', 'qwen3.8-flash', 'suggestions', 'qwen3.8-flash', 'verifier', 'qwen3.8-max',
      'vision', 'qwen3.8-max', 'video_edit_planner', 'qwen3.8-flash')),
  ('claude', 'anthropic', 'Claude', false, false, true, 20,
    JSON_OBJECT('browser', 'claude-sonnet-4-6', 'generate', 'claude-sonnet-4-6', 'scrape', 'claude-sonnet-4-6',
      'plan', 'claude-haiku-4-5', 'suggestions', 'claude-haiku-4-5', 'verifier', 'claude-sonnet-4-6',
      'vision', 'claude-sonnet-4-6', 'video_edit_planner', 'claude-haiku-4-5')),
  ('gpt', 'openai', 'GPT', false, false, true, 30,
    JSON_OBJECT('browser', 'gpt-4o', 'generate', 'gpt-4o', 'scrape', 'gpt-4o',
      'plan', 'gpt-4o-mini', 'suggestions', 'gpt-4o-mini', 'verifier', 'gpt-4o',
      'vision', 'gpt-4o', 'video_edit_planner', 'gpt-4o-mini'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `model_catalog_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `model_id` varchar(32) NOT NULL,
  `actor_user_id` bigint unsigned NOT NULL,
  `action` varchar(32) NOT NULL,
  `before_json` json NULL,
  `after_json` json NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_model_catalog_events_model_created` (`model_id`, `created_at`),
  KEY `ix_model_catalog_events_actor` (`actor_user_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `task_model_selections` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_external_id` varchar(32) NOT NULL,
  `brain_id` varchar(32) NOT NULL,
  `provider` varchar(32) NOT NULL,
  `requested_brain_id` varchar(32) NULL,
  `fallback_reason` varchar(32) NULL,
  `lane_models` json NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_model_selections_task` (`task_external_id`)
);
