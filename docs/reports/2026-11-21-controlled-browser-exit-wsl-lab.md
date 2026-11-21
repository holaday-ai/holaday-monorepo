# 独立 WSL 实验环境与原始退出契约实测

已在用户单独批准的 `Holaday-ExitLab` 中完成平台预检和五类最小合成场景：六个 systemd 单元、九个原始进程引用。六对原启动/停止 job 均匹配且完成；九个原 pidfd 均可读，原通信端均收到 EOF；停止 A 时 B 的原引用和 InvocationID 保持。产品原五单元退出生产者仍未实现，物理 slot 复用仍不放行。

运行源码保持 `1fccf1b46671b8bfbd68e6577b375f94a5830f83`，本轮为实验、证据及文档，没有修改产品运行代码。[来源和哈希](evidence/controlled-exit-wsl-20261121/provenance.json) · [完整合成回执](evidence/controlled-exit-wsl-20261121/contract-v2.json) · [测量摘要](evidence/controlled-exit-wsl-20261121/measurement-summary.json)

## 环境与授权执行

WSL 2.6.3.0，Ubuntu 22.04，x86_64，Linux `6.6.87.2-microsoft-standard-WSL2`。systemd `249.11-0ubuntu3.12` 是 PID 1；同一原 D-Bus owner 的进程号为 1，自有 pidfd 与 cgroup v2 controllers 已实测。[平台回执](evidence/controlled-exit-wsl-20261121/capability.json)

使用官方 Ubuntu WSL 根文件系统，341130963 字节；Mac 下载与 Windows 重组/导入前均核对 SHA256 `1483cc5c1dce13064f774834cbffdff226559fd522a67a381a8ea77d63fb4109`。镜像本身包含 `[boot] systemd=true`，所需 Python/D-Bus/GLib/systemd 工具已可用，没有为本轮合成实验额外安装编译工具或浏览器。[官方镜像及校验清单](https://cloud-images.ubuntu.com/wsl/jammy/current/)

Windows 下载曾 DNS 解析失败，未据此改 DNS/代理；一次整包传输中断后，改成 41 个最多 8 MiB 分块，逐块及整包校验后才导入。输入错位均先核对、清除；最终直接查看 Windows 托盘并点击为“英”，不再发送会改变远端状态的输入法快捷键。固定入口包含目录归属、架构、磁盘、脚本/镜像哈希及重复导入守卫。

用户批准范围只适用于这个新发行版及其合成实验。现有 Ubuntu 的文件、账号、默认发行版和全局 WSL 配置未修改。最终只读 `wsl --list --verbose` 实际显示 Ubuntu 仍为默认，Ubuntu 与 Holaday-ExitLab 均为 Stopped；没有执行 Windows 重启、全局 shutdown 或发行版 terminate。WSL 是本次非生产测量目标，尚未验证产品在该环境的完整隔离或生产适用性。

## 原始引用与实际结果

[验收源代码](evidence/controlled-exit-wsl-20261121/contract-probe-v2.py)先固定原 bus/manager、boot、订阅 JobRemoved，再派发唯一 nonce 的 transient unit。每个工作进程建立自己的原 AF_UNIX 连接，从内核 SO_PEERCRED 获取身份，持原 pidfd/proc 引用并核对本单元 cgroup；确认前不放行工作。测试使用系统 nobody/nogroup（65534），实测 NoNewPrivs=1、有效能力为 0、网络 namespace 与控制器不同。

请求的每单元限额为 64 MiB、25% CPU、16 tasks、最长 20 秒，单路执行。未做资源控制器压力测试。停止计时范围是 StopUnit 派发至原 job 完成、已持 pidfd 退出及终态快照，不包含系统启动、文件传输、模型或 App 业务任务耗时。

| 场景 | 原进程引用 | 停止秒数 | 实测要点 |
| --- | --- | --- | --- |
| 普通停止 | 1 | 0.0124 | 原 job done，原 pidfd 退出与 EOF |
| double-fork + setsid，leader 先退 | 3 | 2.2137 | 停止前 MainPID 已 0、active/exited，孙进程仍存活；显式停止后全部退出 |
| 忽略 TERM | 1 | 2.2484 | 2 秒策略升级后原引用退出，service 为 failed |
| 停止期间再 fork | 2 | 2.2504 | 捕获并持有 late-child 的原引用，完成前它也退出 |
| 两个最小组 A | 1 | 0.0127 | A 停止时 B 仍活跃，原 InvocationID 和 pidfd 未变 |
| 两个最小组 B | 1 | 0.0125 | 随后仅停止原 B，v2 未完成单元清单为空 |

首轮探针把 ProtectHome 写成 Boolean，StartTransientUnit 报 `System.Error.ENXIO`，没有取得任何启动 job；[失败回执](evidence/controlled-exit-wsl-20261121/contract-v1-failure.json)保留。v249 接口要求字符串，修正为 `yes` 后，以新 nonce 完成上述测量；没有重试、认领首轮未知对象，也没有重新导入。[systemd v249 官方接口](https://raw.githubusercontent.com/systemd/systemd/v249/man/org.freedesktop.systemd1.xml)

## 对产品退出接线的具体约束

六个单元均观察到：持有的原 cgroup 目录 inode 与 nlink（2）不变；原 events FD 在停止后返回 ENODEV，原路径查询为 ENOENT。不能把 nlink=0 写成终态前提，也不能拿 ENOENT/ENODEV 单独签发成功。需将原内核对象、原 manager/job、封闭派发及终态持久记录组合验证；尚未建立的 native 终态能力继续拒绝放行。

本轮持 RefUnit 时，停止后的原 InvocationID 保持原值。不能预设它必须清零；这一结果也不覆盖未持引用时的卸载、manager 换代或迟到 job。忽略 TERM 和停止期 fork 场景虽有 StopJob done、原进程退出，service 结果仍为 failed；物理退出与业务成功必须分别记账。

cgroup populated 只描述活进程子树，不能替代全部僵尸已回收的证明；本轮没有承诺全部后代 reap。[Linux cgroup v2 文档](https://docs.kernel.org/admin-guide/cgroup-v2.html#un-populated-notification)

## 尚未完成

原 root stop/终态生产者、持久 close intent、一次性终态消费和 Node 原组 IO 合流仍需实现。真实 B2 五单元/两组、固定 UID/GID 白名单、RootDirectory 文件视图、不可迁出、真实 Chromium sandbox、迟到/丢失 ACK 和 manager 漂移门禁未完成。本轮两个最小 service 组不代替两个产品五单元组；源树 native manifest 保持 unverified，unknown 与物理占位守卫不变。

模型账本仍 64/65，SHA256 `006f7ed9eee490a34075aa7775e49ac9180daf580451fdd66ebd0803b848106f`。本轮模型/KMS 调用、网站原件导出、旧业务任务重放、合并、上线均为 0。整体 Goal 未完成。下一步沿[原实施计划](../superpowers/plans/2026-11-20-controlled-browser-exit-proof.md)继续原组停止事务与终态生产者；不重复申请已经获得的实验环境授权。
