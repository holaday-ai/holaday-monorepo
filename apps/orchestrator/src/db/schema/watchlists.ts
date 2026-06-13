import { sql } from 'drizzle-orm';
import {
  bigint,
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { users } from './users.js';

/**
 * `watchlists` — A股自选股 (Phase 1 指令 #2). One row per (user, symbol).
 *
 * 「收藏/stars」架构里没有可复用的表存股票代码：`tasks.starred` 是任务
 * 上的布尔旗标，`projects` 是任务分组，`user_profiles.fingerprint` 是
 * 职业指纹。自选股 = 一个用户 → N 个股票代码的清单，故独立成表。
 *
 * 加法式、FK ON DELETE CASCADE（账号注销即清理），照搬 `user_site_stats`
 * (0026) 的形：`uk_watchlists_user_symbol` 防同股重复添加，`external_id`
 * 给 SPA 路由。盘前/盘后简报 (③) 直接 `WHERE user_id=?` 取清单喂 6 个
 * AkShare MCP 工具。
 *
 * - `symbol`：裸代码（A股6位 e.g. 600519；为 HK/US 扩展留 16 位）。
 * - `market`：'A' | 'HK' | 'US'（默认 'A'）。
 * - `display_name`：添加时缓存的名称 e.g. 贵州茅台（可空，简报/问答按需回填）。
 * - `note`：用户备注（可空）。
 * - `sort_order`：手动排序（默认 0；list 以此为主序、created_at 为次序）。
 *
 * CRUD 路由本身不调 AkShare —— 取数全在简报/问答侧并带来源+时间戳+免责，
 * 保持 router 纯净。
 */
export const watchlists = mysqlTable(
  'watchlists',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).primaryKey().autoincrement(),
    externalId: varchar('external_id', { length: 32 }).notNull(),
    userId: bigint('user_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 16 }).notNull(),
    market: varchar('market', { length: 8 }).notNull().default('A'),
    displayName: varchar('display_name', { length: 64 }),
    note: varchar('note', { length: 255 }),
    sortOrder: int('sort_order').notNull().default(0),
    /**
     * 预留：未来「价格/涨跌幅提醒」阈值配置（如 {priceAbove, pctMove}）。
     * 本期 (③ 简报) 不实现、router 不暴露——加列只为避免日后再 migration。
     * NULL = 未设提醒。
     */
    alertConfigJson: json('alert_config_json'),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('uk_watchlists_external_id').on(t.externalId),
    uniqueIndex('uk_watchlists_user_symbol').on(t.userId, t.symbol),
    index('ix_watchlists_user').on(t.userId),
  ],
);

export type Watchlist = typeof watchlists.$inferSelect;
export type NewWatchlist = typeof watchlists.$inferInsert;
