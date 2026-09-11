# root私有监听与单次启动授权消耗（9d-2j）

继承已批准9d-2b和first-exec设计，基线ad07f653。本单元细化已要求的私有listener与跨broker重启拒绝重放，不新增系统管理权限、不开放应用或浏览器。主uid998、B浏览器身份、PM2与同PID链不变；Linux和发布门禁仍独立。

## 授权来源与有限职责

`/etc/holaday-pool-broker/launch-authorization.json`是未来受信维护执行器发布的一次性本地授权，不是应用请求。root:root0600/nlink1、无ACL/capability、所有祖先不可被非root修改；严格JSON最多1024字节，仅含version=1、candidate40、epoch32、not_before_ms、expires_at_ms。编号小写非零hex，时间整数不接受bool，窗口最多60秒；匹配当前受信candidate、当前墙钟位于窗口内才可消费。窗口开始后的运行期限使用单调时钟并反复核对墙钟，不能靠时钟倒退续期。

本单元**不签发**该文件，也不从“root文件存在”推断旧业务已排空。未来维护执行器必须先满足旧boot/资源/首次维护等全部门禁，才可产生全新授权；该生产者未接线，故目前入口不能激活。没有文件就是拒绝，不默认生成、补齐或创建测试授权。不得从用户HTTP、argv/env或调用方字典接收授权数据。

单一固定`/var/lib/holaday-pool-broker/launch-consumed.json`为永久消耗标记。读取有效授权后，用O_CREAT|O_EXCL|O_NOFOLLOW创建root:root0600文件，写入固定version/epoch/candidate，完整短写处理并fsync文件、fsync父目录后才允许bind/listen。已存在、空/部分写、权限异常、任何写/同步/close不明都拒绝，不删除、不覆盖、不重试。更换epoch、重建Python对象或broker重启不能绕过此固定标记。

当前没有重置/自动删除标记API。将来旧boot与持久资源已被可信对账的维护流程需要单独的精确消费/交接实现，不能通过本listener解除。这个保守限制可能降低重启可用性，但不允许将未知旧账伪装成新授权；它不是最终发布完成声明。

## 监听、登记与所有权

只有Linux全root、单线程、最小PATH/LANG环境、受审candidate安装身份才允许`RootLaunchListener.open(candidate)`。不得从应用可写脚本/加载路径作为root导入本模块；独立broker服务的第一解释器/安装入口仍须后续完整接线，当前不增加公开CLI或systemd启动配置。

授权必须在创建监听socket前已持久消耗。唯一地址`/run/holaday-pool-broker/register.sock`，root:root0600，父目录root:root0700。使用AF_UNIX/SOCK_SEQPACKET/CLOEXEC，在bind/listen/accept前启用SO_PASSCRED；监听backlog=1。原路径若已存在则拒绝，不unlink未知旧socket，也不复用其他listener。创建后记录路径dev/ino，按同一受信父目录复核owner/type/mode；不将socket FD的sockfs inode与路径inode混比。

`accept_once()`最多一次accept，接受后的socket由既有真实`LaunchRegistration(candidate, installation.app_gid).receive(channel, window=window)`消费并持有原pidfd，逐消息root凭据及candidate/boot/gid核验继续保留。window必须为同一个真实私有LaunchWindow，不接受网络数据或成功callback。receive自有5秒上限受剩余授权期限约束，且在IO前后、pin前后、ACK紧前/后与全部清理后重查窗口墙钟和单调时钟；不能只在listener外层检查，不能在授权最后一刻accept后额外获得5秒。默认无窗口调用仍维持原5秒。本检查是派发前后边界，不宣称把墙钟读取和sendmsg变成原子操作；ACK仍不是业务开放。

监听器在接受后关闭，不接受第二个连接；正常返回只表示root登记ACK已完成、待启动注册对象被保留。对象仍只能close撤销，不新增ready、create、开放业务或任意PID获取接口。后续运行通道再承接这个同一注册对象，不能复制身份字符串重建授权。

启动登记期间任何异常、到期或同步close重入都永久撤销本listener和登记对象；已接管的socket/FD准确关闭一次，close不重试。accept超时为min(5秒,授权剩余)，receive另有不超过授权截止的5秒上限。close请求若与阻塞accept竞争，只能等待该有界调用返回；不得无限阻塞。期限是启动授权而非登记成功后的业务租约，本单元不提供成功后的自动到期定时器。监听路径仅在验证为本实例创建的dev/ino且仍符合root/type/mode时才unlink；无法证明则保留并报告失败，不误删替换对象。消耗标记永不清理。ACK丢失不重发、不返还授权、不杀未知业务进程。

上下文与窗口检查本身也可能同步重入close，因此调用返回后必须再次检查撤销和同一对象；交付channel前先捕获有效receiver。检查通过不等于可以忽略此后撤销；ACK只保留既有派发前后校验语义，不宣称信号与系统调用之间原子化。

## 对比与选择

- 只在内存标记attempted：broker重启即可复用，拒绝。
- 依赖可反复读取的授权JSON或复用既有ACK：不是一次消耗，拒绝。
- 当前选择固定持久O_EXCL标记＋受限单次listener；先保证跨对象/重启不能复用，维护签发/精确清理和资源对账继续保持独立门禁。

## 验证边界

TDD覆盖缺文件/坏schema/重复键/窗口/候选/链接/owner/ACL、现存消耗标记、短写/同步失败/close错误、先消耗后listen、PASSCRED时机、只accept一次、错peer/ACK/过期/同步撤销、路径替换不得删除及实际LaunchRegistration/PinnedApplication消费。使用合成文件/凭据和系统调用边界；不得运行实际root、创建生产授权或声明Linux通过。

复验所有broker测试、Python AST、diff与独立审查后按完整本地单元提交；未完成producer/运行通道/资源/平台/首次维护及发布门禁，不push/合并/部署部分组件。内存约10GB，单主＋原reviewer，所有重任务串行，不安装/Docker/浏览器/生产访问。
