# 受控浏览器退出：前置修复与剩余证明

本轮修复了严格关闭链路的一个前置缺陷：会话收尾函数同步抛错时，会跳过后续原SDK断连与组清理。现在同步throw和异步reject都先保留失败，再执行原清理；重复release不重复调用收尾或断连，unknown和物理槽位继续保留。当前运行源码`1fccf1b46671b8bfbd68e6577b375f94a5830f83`。整组物理退出证明仍未通过。[机器记录](evidence/browser-controlled-exit-local-20261120.json)

## 实际验证

新增回归先准确失败：同步收尾错误后SDK的disconnect调用0次；异步reject对照已通过。该失败不证明所有socket都泄漏，旧veto也可能关闭底层连接。最小修复将hook调用放入Promise链，保证后面的原SDK及group清理必达，不吞掉失败。GREEN两场景均一次断连、原实际WS peer关闭、unknown>0、占用slot不释放；第二次release仍失败且无重复调用。

- 相关TypeScript：6文件215/215，175.47秒，heap1024MB、单fork、无文件并行。
- root侧Python：6模块78/78，6.49秒，真实临时文件和socket；Linux身份/内核边界为明确替身。
- 保留严格选项的定向类型、2文件Biome和后端生产构建通过；构建16.02秒、heap2048MB。
- 最终格式仅换行；格式前后TypeScript发射JS token一致，绑定同一逻辑测试输入，没有再重跑整批215项。

初始pnpm启动器未进入测试，已只终止自有客户端；第一次定向批次180秒超时、没有完整报告，不计通过也不归因产品失败。超时worker在清理信号前已自行退出；最终215项完整回执单独保留。没有启动新浏览器或容器，没有停止Docker服务或其他项目。

## 为什么还不能签发退出证明

| 层次 | 当前实际状态 | 尚缺证据 |
| --- | --- | --- |
| 旧受控spawn | leader/stdio结束后按设计返回UNPROVEN | 后代与整组退出 |
| Node严格group.close | 收口本组原始会话/SDK/传输并保留unknown | 原管理端物理终态 |
| root原组事务 | 原对象保留，create/ready已实现；close语法存在 | stop派发、原job完成、终态持久记录与退出生产者未实现 |
| 真实平台 | 当前Mac为Darwin/arm64；Docker只读查询未及时返回 | 独立Linux/systemd/cgroup v2及原sealed bundle实测 |

因此Linux环境准备和退出生产者开发都需要推进，不能把“换到Linux”描述成现有接口自动会签成功。源树native manifest保持unverified，也没有新增原生能力或修改任何UNPROVEN/unknown守卫。

StopUnit返回异步job，要在派发前订阅并按原job核对完成；v249已有这一契约。[systemd v249官方接口](https://raw.githubusercontent.com/systemd/systemd/v249/man/org.freedesktop.systemd1.xml) cgroup.events中的populated覆盖该组和后代的活进程，但一次空组观察不证明封闭后不会再填充或僵尸已回收。[Linux内核文档](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification)

现有实现没有覆盖原cgroup被移除、InvocationID进入终态表示时如何保持原对象证明，需先在独立自有测试单元测量，再接原管理端终态生产者，避免从not-found或JSON布尔值猜成功。具体工作见[实施计划](../superpowers/plans/2026-11-20-controlled-browser-exit-proof.md)与[Linux隔离验收准备](../operations/browser-controlled-exit-linux-lab.md)。已询问非生产测试主机信息，尚未据此新建资源、安装软件或改变系统管理权限。

## 候选与授权边界

当前1833项输入，相对f2ccd2cb仅browser-pool.ts一项运行输入变化；后端ZIP4213844B/1616文件，SHA`cb99fa3f94862f741cf5afad72cc5986b7f2f1fe72eabb08316be8df58a628a9`。工作台5e931b07和正式插件c8bfb324按不变输入复用，三ZIP的CRC及所有成员哈希通过。该候选不是独立安装包，也未验证实际Linux/生产启动或真实模型。此前手动UI证据仍属于f2ccd2cb、文件历史证据属于a5ed894a、真实GitHub失败属于4639，不迁移为新候选通过。

模型账本64/65、SHA逐字节不变；本轮模型/KMS/导出0，无旧任务重放。AWS轮询沿原计划独立运行；本项没有等待AWS。PR361保持草稿，不合并、不上线，整体Goal未完成。
