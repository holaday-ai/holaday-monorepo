# 固定 Xvfb 单次启动事务（9d-2n）

基线：2a4ff4e3，codex/qwen-safe-drain。使用 executing-plans、TDD、原 review_qwen_negation 只读独立审查及完成前验证。单主实现，重任务串行，不开 Docker/浏览器/安装；10GB预算。旧生产窗口过期，本轮仅本地代码与合成平台边界测试，不推送、PR、合并、部署。原禁止业务模块不变。

## 目标与边界

将真实 ResourceJournal 的 prepare→fsync dispatch→固定 manager StartTransientUnit→fsync accepted→读回同 unit InvocationID→fsync observed 串成完整单次事务。公开入口仅 launch_xvfb(journal, manager, CreateRequest)，只接受同一 LaunchRegistration/pin 的 Xvfb 请求；不接受任意命令、路径、环境或成功字典。运行 socket 仍拒绝所有资源命令，本轮不接应用或启用平台。

- journal 锁和原 FD 贯穿平台调用；manager 使用原认证 GUID 与原 unique owner，不使用可漂移服务名为写目的地。同一事务共享原5秒接纳期限；实际 OS 阻塞不承诺硬实时。同步 close/重入永久封闭，FD 延迟到在途 finally 释放，collector 派发前检查双方仍有效。
- 固定单位名 holaday-pool-xvfb-<journal生成resource>.service，模式 fail，不替换同名单位；只有未派发 prepared 可调用。先持久 unit/manager GUID/owner 绑定，再调用一次。超时、失联、未知、任何后续写失败均保留原记录，不重发、不停止未知资源、不标终态。旧 dispatch 格式可读取但不可升级为新成功。
- 固定 /usr/bin/Xvfb 纳入可信工具 SHA 清单；使用 inspect_installation 取得已批准专用工作 UID/GID，不接客户端身份。固定 display=100+slot，1280x800x24，禁止 -ac/shell/TCP。固定 root 预置 /etc/holaday-pool-broker/xauthority/slot-N.auth，root0600、父链不可非root写、非链接/ACL/capability，只核对元数据与1..65536大小，不读取或生成内容。通过 systemd249 LoadCredential a(ss) 交付，ExecStart a(sasb) 引用 ${CREDENTIALS_DIRECTORY}/xauthority。
- 模板固定 Type=exec、Restart=no、KillMode=control-group、RemainAfterExit=true、无能力/无提权/禁止cgroup委派、PrivateTmp/PrivateNetwork/PrivateDevices、ProtectSystem=strict、ProtectHome=yes、stdout/stderr=null、MemoryMax=256MiB、TasksMax=128、停止超时5秒。Linux 启动及命名空间/认证实际有效性尚未验证；其他角色共享通信、跨资源隔离和终止证据仍是后续门禁，不宣称浏览器可用。
- accepted 仅证明类型化 job 对象路径已收到；observed 仅为 GetUnit 路径、Unit.Id 与两次一致的非零16字节 InvocationID 观察，原 manager 仍匹配。不是 job 完成、ready、running、组退出或可复用 slot。公开结果只返回 state 与 groupExitProven=false；身份只在root私有日志，不输出。snapshot 的 dispatching 继续表示所有非 prepared 未解决记录。

## 完整可审查单元

- [x] 原 reviewer 核查固定模板和事务设计；必要改正后实现。
- [x] 先写行为 RED：实际文件/fsync/flock与真实 registration/journal/manager控制流；只替换外部 busctl/socket/Linux元数据边界。验证成功路径、精确argv与无secret读取、派发前日志已落盘。
- [x] 实现新增 xvfb_launch.py、journal严格新事件重放、manager私有有界作用域；更新可信模块/工具精确名单。
- [x] 反例：非Xvfb/跨登记、fsync失败不派发、回复丢失不重试、accepted写失败、错类型/对象/零或变化InvocationID、同名已有/manager漂移、close重入、工具变更或凭据软链接、重新打开不重复。全套旧测试不可退化。
- [x] 原reviewer独立审查修复、最终串行全套Python/AST/JSON/diff。提交及QA/自动化的实际结果记于QA最新节点。

## 平台语义依据

[systemd249 execute](https://raw.githubusercontent.com/systemd/systemd/v249/src/core/dbus-execute.c) 的 transient ExecStart 接收 a(sasb)，LoadCredential 接收 a(ss)；[执行配置](https://raw.githubusercontent.com/systemd/systemd/v249/man/systemd.exec.xml) 支持 ${CREDENTIALS_DIRECTORY}。 [Unit 属性](https://raw.githubusercontent.com/systemd/systemd/v249/src/core/dbus-unit.c) 定义 InvocationID 为 ay。源码兼容性核查不是 Linux 实测；native-build-manifest 继续 unverified。

## 本地结果（2026-09-11 20:20 JST）

- 最终296/296通过（6.219秒），其中15项Xvfb事务测试；31 Python AST、2 JSON、diff通过。初始7项缺模块RED（10失败含子例），新增可信名单1失败/3错误后GREEN。实际文件/flock/fsync与manager控制流不模拟成功；外部平台仅合成，未启动busctl、Xvfb、Linux服务或浏览器。
- 第二次InvocationID的布尔值可冒充整数1，反例RED后改为两次独立严格字节数组/非零校验。独立审查Important：最后collector时钟/文件边界撤销registration/pin仍可能Popen；先把断言移到生产调用之外，真实记录两项错误派发RED，再增加原生登记检查+最后时钟后的轻量撤销/原pin/候选检查，读写collector都沿用原截止期限。最终原reviewer无Critical/Important/必修Minor，未代跑测试。
- root预置认证文件只查路径/元数据与大小，测试证明成功路径未读取内容；这不验证cookie正确、凭据跨同UID资源隔离或完整X11可用性。固定模板尚待真实Linux系统验证。没有job完成、ready、running、组退出、终态、slot复用或凭据/目录清理声明。
- 下一完整单元：针对持久dispatch/accepted/observed未知记录实现同一原manager/原unit/InvocationID的只读恢复对账，不重派；把manager换代、未取得InvocationID和实例替换明确保留未知。随后固定其他角色及其可信通信、job/停止/组退出组合证据、Node/服务接线、Linux与维护发布门禁；不开放当前运行通道，不部署部分组件。
