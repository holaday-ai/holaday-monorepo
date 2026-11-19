# Task File Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有文件工具及统一循环中完成受限纯附件任务，复用已保存原件而不重放网站导出。

**Architecture:** 服务端用原用户请求和本任务已验证附件创建不可伪造契约。循环仅开放四个文件工具并根据真实文件证明完成，普通网页任务维持原校验。执行入口复用计费、取消、进度和文件交付组件，不借浏览器获取无关证据。

**Tech Stack:** TypeScript、Vitest、现有BrowserTaskFiles/Reader/Table/Outputs、MySQL8.0.46隔离验证。

**Spec:** `docs/superpowers/specs/2026-11-19-task-file-materials-design.md`

## Global Constraints

完整原release-readiness范围保留；低内存单路、不派代理、不新增模型请求、不重复导出原件、不合并PR361、不上线。测试单fork/文件串行1024–1536MB，类型/构建2048MB。

## Review Focus

文件正文要求联网不能扩权；正向网页请求和反转否定不能误入纯附件模式；伪造/跨任务契约拒绝；已读后换字节和失效账号拒绝；部分读取/缺指标/保存未知不得完成。

## Task 1: 服务端契约与证明

Files: 新建`apps/orchestrator/src/agent/browser-tools/task-file-contract.ts`及测试；修改Reader完整读取查询与Outputs已提供文件交付支持。

Interfaces: `createTaskFileContract`消费原用户请求和真实文件作用域/Reader/Table/Outputs；产出绑定该作用域的内部契约、工具白名单及异步完成缺口检查。附件交付独立于下载来源和新生成数量。

- [x] 写明确纯附件、混合任务、缺输入、伪造/跨任务、取消/失效/换字节、完整读取/统计/输出读回用例并观察RED。
- [x] 最小实现及相关文件回归GREEN，保留原普通网页行为和严格统计。

## Task 2: 统一循环与执行入口

Files: 修改`unified-browser-loop.ts`、`unified-supercar-runner.ts`，新增文件执行适配模块/测试；必要时接入已有路由。

Interfaces: 使用Task1契约限制工具并替代仅在该契约内的网页证明；文件执行适配消费原RunSupercarOptions，产出相同SupercarOutcome，复用原计费/进度/取消与文件卡片。

- [x] 先RED证明真实文件可以完成且完全不获取浏览器；非法工具/假契约/错统计/不完整读取仍拒绝。
- [ ] 实现、定向回归、严格类型/静态和必要构建；不放宽全局网页证据。

## Task 3: 原件接续与交接

Files: 扩展`tasks.saved-input-preflight.manual.test.ts`，报告及原计划账本。

- [x] 使用已保存1708B原件、真实HTTP/隔离SQL、脚本模型跑完整成功与拒绝路径，校验两份文件、SQL新连接与清理，账本和网站导出不变。
- [ ] 形成可复核真实模型续验范围后再请求新增限额；更新候选、草稿PR与私有交接，不宣称完整Goal通过。

验证记录：文件相关最终142/142；原浏览器四文件128/128另批，不合计为全平台覆盖。严格11根文件类型与静态exit0（1项原有警告）。最终真实HTTP/隔离SQL预检1/1，9.03秒，SQL completed、六项实际工具步骤、两份字节下载、新连接与schema不存在均核实；脚本模型，不是实际模型速度。真实模型账本41条逐字节不变，无新增网站导出。

收尾由作者自审，按用户低内存串行要求未派代理；独立审查未冒认完成。自审发现生成来源文案与直接指标请求的证明缺口，分别1项/3项RED后修复，包含在最终142项中。候选构建、冻结与持久交接尚待本轮收尾，完整Goal保持未完成。
