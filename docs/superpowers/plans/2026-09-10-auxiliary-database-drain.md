# 阶段 3C-2：辅助计划与建议数据库生命周期

沿用已批准的安全排空设计，仅本地实现；不接生产、不发布部分组件。

## 实施与验证

1. 在真实 createDirect/reply 路由测试中持有计划保存、计划 head、建议保存/head 的原始 Promise。证明计划超时后的物理活动不消失，建议不延迟主结果，辅助 catch 不能清掉未知。
2. 增加当前服务端 owned scope 的数据库边界包装：实际派发前登记/guard，原始 Promise 结束才释放，拒绝保留未知。不缓存请求 owner，无上下文时保持原有兼容行为。
3. 计划外层 work 同步预留独立 owner；15 秒只结束逻辑等待，同时 seal 禁止迟到新派发。已派发原始工作继续跟踪，未确认结果保留未知；禁止迟到计划发布或启动主生成。
4. 接线建议 readHead/persistSuggestions 和计划 persistAdvisoryPlan/readHead，不改任务结果、额度、模型配置或现有业务 CAS。
5. 单线程 RED→GREEN，补同步拒绝、正常关闭后的已接纳链、永久 guard 拒绝等反例；复用唯一只读 reviewer，审查和重任务串行。
6. 完整相关测试（每批不超过 20 文件）、后端类型检查、改动文件格式检查、diff 检查；本地提交并记录检查点。全进程入口、业务对账、首次维护与新发布窗口仍属后续门禁。

资源约束：Node heap 2048MiB，Vitest maxThreads=1/minThreads=1/no-file-parallelism；不安装、不启 Docker 或浏览器，内存空闲低于40%或磁盘不足10GiB不跑重任务。

## 2026-09-10 16:51 JST 验证检查点

- 上述本地实施单元已完成。4条真实路由 DB 漏记反例、2条真实 Drizzle 驱动失败反例和1条定时器前跨期反例均观察 RED 后修复；额外验证真实可选 fetch 无视 Abort 时仍被占用，主终态不被建议拖延。
- 独立审查发现两项 Important：原始 work 释放到外层期限决定之间的空隙，以及畸形 UPDATE 回执被当作确定 CAS 拒绝。新增4条失败测试后修复：独立逻辑 owner 覆盖最终决定；协调器最终拒绝也留未知；严格 affectedRows 0/1 以外均留未知且维持 boolean 返回。复审无 Critical、Important 或必修 Minor。
- 最终16:50执行20文件429/429，18.25秒；随后完整后端 tsc --noEmit 通过。9个改动 TS 文件 Biome 通过，diff 检查通过。只保留原有 localstorage-file 警告，不宣称全仓 lint 或真实 MySQL/千问/生产已验证。
- 未推送、创建PR、合并或部署。未知票据的业务对账关联、boot与全进程入口覆盖、首次维护/回滚、Linux/PM2/真实千问及新发布窗口仍未完成。局部计数为零不能放行生产。
