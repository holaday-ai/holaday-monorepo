# HOLA DAY Qwen Data Region + Shadow Eval Implementation Plan

**Goal:** 建立持久化区域归属、严格解析器与默认关闭的合成样本影子评测适配层，不改变生产用户回答。

**Spec:** `docs/superpowers/specs/2026-09-03-qwen-data-region-shadow-eval-design.md`

## Task 1: Database contract

- [x] 先在 schema/release contract 测试中断言 `users.modelDataRegion`、`organizations.modelDataRegion`、`0058_model_data_regions.sql` 和生产 schema verifier。
- [x] 运行测试并观察缺字段/缺 migration 的红态。
- [x] 添加 nullable Drizzle 字段、值域 CHECK、纯加法 migration 和 verifier 列表。
- [x] 运行 schema、release contract 与 typecheck，确认绿态。
- [x] 提交数据库契约。

## Task 2: Region ownership resolver

- [x] 先写表驱动测试：组织优先、组织缺失失败、个人回退、个人缺失失败、未知值失败。
- [x] 观察模块不存在的红态。
- [x] 实现纯函数 `resolveModelDataRegionOwnership`，只返回区域与来源。
- [x] 运行单测、Biome 与 typecheck。
- [x] 提交解析器。

## Task 3: Synthetic-only shadow evaluator

- [x] 先写测试：默认关闭零调用、非合成拒绝、同区路由、失败隔离、安全元数据。
- [x] 观察模块不存在或配置字段缺失的红态。
- [x] 增加 `QWEN_SHADOW_EVAL_ENABLED=false` 和注入式适配器；不接入启动或任务 callsite。
- [x] 运行单测、环境测试、Biome 与 typecheck。
- [x] 提交影子适配器。

## Task 4: Verification and handoff

- [x] 运行 Phase 1 targeted tests 和完整 Orchestrator suite。
- [x] 确认没有生产 callsite、Key、环境文件、真实请求或部署变更。
- [x] 更新本 ledger 并提交文档。
- [x] 国际额度确认后，下一步仅运行固定合成样本基准；大陆 Key 仍延期到北京首次调用门禁。
