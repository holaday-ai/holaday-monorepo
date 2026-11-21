# Windows WSL 只读核验与退出证明下一步

通过已连接的 TeamViewer 操作 Windows `YALEI-GPU5070TI`，在本次新开的普通 PowerShell 中逐条核对并执行查询。运行源码仍为 `1fccf1b46671b8bfbd68e6577b375f94a5830f83`；本轮没有修改运行代码，也没有签发物理退出证明。

## 已观察结果

| 项目 | 实际输出 | 结论 |
| --- | --- | --- |
| WSL | 2.6.3.0 | 已安装；不需要先重启 Mac 或等待 AWS 才能准备实验环境 |
| Windows | 10.0.26200.9974 | 版本查询回执 |
| 发行版 | Ubuntu，WSL 2，查询前 Stopped | 只对这个现有发行版执行固定只读查询；查询会启动它 |
| Linux | 6.6.87.2-microsoft-standard-WSL2 | 内核查询回执，不等于 pidfd/退出实验通过 |
| Ubuntu | 22.04.1 LTS，jammy | 已有环境，未改配置 |
| PID 1 | init(Ubuntu) | systemd 尚未作为 PID 1 运行 |
| systemd | 249 (249.11-0ubuntu3.6)；is-system-running: offline | 安装版本满足研究 v249 接口的条件，但当前不是可用的原系统管理器 |
| 配置 | /etc/wsl.conf: No such file or directory | 未创建或写入该文件 |
| cgroup | cgroup2fs；rw,nosuid,nodev,noexec,relatime,nsdelegate | 可见 cgroup v2；未证明管理权限、不可迁出、封闭后不能重新填充 |
| controllers | cpuset cpu io memory hugetlb pids rdma | 只读可见性 |
| 默认 Linux 用户 | uid/gid 1000 | 不是产品 B2 固定身份 998；未创建或改动用户 |
| PATH 工具查询 | 只解析出 /usr/bin/python3；gcc、make、busctl、node 未解析出路径 | 不宣称文件系统中完全不存在；固定 /opt/node22/bin/node 未验证 |
| free -m | Mem total 7798、used 373、available 7279 MiB；swap 2048、used 0 | 一次快照；不是新设置的内存上限 |

未执行本进程 pidfd 探针：远程标点输入在核对时失真，已在回车前清除，不能计为失败或通过。readlink /proc/1/exe 没有得到可用输出，不据此推断身份。

## 执行范围与证据

查询包括 `wsl --version`、`wsl --list --verbose`，以及明确指向 Ubuntu 的 uname、/proc/1/comm、systemctl 版本/状态、os-release、wsl.conf、cgroup、id、command -v、findmnt、free 查询。错误的输入均在执行前清除；没有执行它们来试错。没有安装软件、改配置、sudo/root 操作、Windows 重启、WSL shutdown/terminate、unit 创建或停止、业务目录扫描。

工作树本地原始截图与逐字查询记录位于 `.superpowers/sdd/2026-11-18-browser-assistant-release-readiness/controlled-exit-windows-wsl-20261121/`；交接补充单独保存这些文件及 SHA256，不覆盖先前冻结的 checkpoint。

## 继续退出证明前需要的环境准备

建议新建独立的 `Holaday-ExitLab` WSL 2 测试发行版，使用官方 Ubuntu 22.04 镜像；现有 Ubuntu 的业务归属尚未确认，不直接修改它。创建前核对官方镜像、哈希和磁盘余量；不足即停，不自动扩容。该步骤尚未授权或执行。

1. 仅在新测试实例内准备 systemd/systemd-sysv，并按微软文档设置 `[boot] systemd=true`。只定向重启该测试实例，不执行全局 `wsl --shutdown`，不改全局 `.wslconfig`。
2. 先核验 PID 1、原管理器连接、cgroup v2 和本进程 pidfd，再从官方源补齐经清单确认缺少的最小工具。Node 必须核对固定 22.23.3、路径和候选哈希；不能借用系统任意 node。
3. 单路运行唯一 nonce 绑定的合成单元实验，记录原 StopUnit job、cgroup/事件 FD、InvocationID 在停止前后的生命周期及再填充条件。只管理实验自己创建并持有原引用的对象，不扫描或接管其他资源。
4. 用实际平台契约细化既有实施计划 Task2 的 root stop/终态生产者，再做 Task3 的五单元、后代和两组隔离验收。当前 unknown、原资源 pin、unverified manifest 均保留。

安装将占用本地磁盘并运行系统服务，超出本轮“先只读检查”的范围，因此需要单独确认。确认范围应包含独立实例、官方最小工具、仅该实例的配置和重启、合成退出实验；不导入真实 cookie、账号、密钥、旧任务或业务数据库，不开放公网端口。

微软文档说明 WSL 2 可启用 systemd，并区分安装包存在和实际 PID 1；导入发行版可使用单独名称与安装路径。[systemd on WSL](https://learn.microsoft.com/en-us/windows/wsl/systemd)、[独立发行版导入](https://learn.microsoft.com/en-us/windows/wsl/use-custom-distro)。这些机制支持上述准备路线，不证明本项目退出验收通过。

模型账本仍为 64/65，SHA256 `006f7ed9eee490a34075aa7775e49ac9180daf580451fdd66ebd0803b848106f`；本轮模型/KMS 调用、网站原件导出、旧任务重放、合并、上线均为 0。AWS 不构成本地实验环境准备的前置条件。原 root stop/终态生产者和整体 Goal 均未完成。
