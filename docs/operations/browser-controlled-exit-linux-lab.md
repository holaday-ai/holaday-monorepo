# 受控浏览器退出的独立Linux验收准备

当前只准备，不创建云主机/VM/账号、不安装软件、不调整IAM、不操作生产。用户已要求先处理退出证明，非生产Linux目标信息正在补充；下列资源为工程建议，未代表用户批准购买或开通。

## 建议资源与边界

使用独立可销毁Linux VM或已明确归属的非生产Linux主机。初始上限建议1vCPU、2GiB RAM、12GiB磁盘；重任务逐项串行。先单组最小内核实验，再按实测内存安排两组隔离场景。当前Mac工具未找到独立VM运行器，Docker元数据查询未及时返回，未据此诊断Docker故障，也没有重启它。

目标需systemd为PID1、可由其管理的cgroup v2、pidfd和原native bundle构建条件；固定Node22.23.3位于/opt/node22/bin/node，应用uid998及B2槽位白名单要按已有原身份政策核验。只读清单不证明root管理权、隔离有效或退出通过。工作进程保持非root与Chromium sandbox，原应用不获得通用系统管理权限。

不导入AWS或模型凭据、真实账号/cookie、业务数据库或旧任务。使用合成空页面/本地echo端点，无公网监听。验收目标必须和生产分开，任何后续创建和管理动作只指向可核对归属的自有目标。

## 已准备的只读入口

[linux-capability-probe.py](../reports/evidence/controlled-exit-local-20261120/linux-capability-probe.py) 不接收目标/命令/路径参数，只读取当前平台、PID1、cgroup v2可见性和只对本进程开关pidfd，不发信号、不连网络、不创建资源。当前Darwin实际运行正确报告缺Linux能力；Linux分支尚未实际运行。输出exitProofAccepted始终false，不得当放行凭据。

## 先测平台契约

1. 在已归属的隔离目标记录候选、系统版本、原manager和工具身份；能力缺失即留证，不改主机来临时绕过。
2. 只创建唯一nonce绑定的自有最小测试单元，在工作开始前持原unit/job/cgroup对象与pidfd；记录如何封闭后续派发。
3. 先订阅完成信号再请求同一原job停止，测量cgroup.events、原目录/事件FD、InvocationID和unit生命周期前后变化；job ACK不是完成，not-found和0 InvocationID不补造成功。
4. 验证停止期间fork、setsid后代、leader先退、延迟退出和原manager漂移；结果未知不重发启动/停止，不恢复未知资源的槽位。
5. 基于实测契约补原root停止与终态生产者，再接Node本组IO收口和一次性消费；只解除本组不确定性。
6. 最后跑真实B2五单元/两组、固定UID/GID、文件视图、不可迁出、Chromium沙箱和退出/清理；局部本地回归不代替这一层。

## 清理与失败

清理只持本次原始创建归属和原生引用，不能扫描名称/端口/PID就认领其他资源。失败或失去原对象时保留journal、cgroup/任务/槽位占位及回执，不用清计数求绿。不会执行全局Docker reset、清理其他容器或批量systemd操作。

[实施计划](../superpowers/plans/2026-11-20-controlled-browser-exit-proof.md)中Task1是已修复的关闭前置条件；Task2原生生产者和Task3实际Linux验收继续未完成。本材料不构成安装、付费、合并或上线许可。

## Windows 实查补充（2026-11-21）

已远程只读核实 WSL 2.6.3、Ubuntu 22.04.1/WSL 2、Linux 6.6.87.2 和可见的 cgroup v2。进入已有 Ubuntu 执行查询会启动该发行版；未安装、改配置或重启。systemd 249 已安装，但 PID 1 为 init(Ubuntu)，systemctl 报 offline，/etc/wsl.conf 不存在；gcc/make/busctl/node 的 PATH 查询也未解析出路径。因此当前环境尚不能做原系统管理器的五单元退出证明。

下一步建议经单独授权准备 Holaday-ExitLab 独立发行版，再测 systemd/cgroup 原对象契约。不能把 WSL 的版本、可见 controller 或 systemd 安装包直接计为物理退出通过。详见[本次实查与范围](../reports/2026-11-21-controlled-browser-exit-wsl.md)。
