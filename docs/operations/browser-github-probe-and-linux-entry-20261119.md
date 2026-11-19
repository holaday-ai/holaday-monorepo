# GitHub 主体规则与 Linux 入口验证

已在正常 Chrome 的独立“Holaday 验收”配置核实 GitHub 当前账号，并完成 Linux arm64 的真实启动脚本关闭状态验证。现网可执行文件是 x86_64，因此这份本机结果不替代生产目标架构、真实数据库、KMS 或账号恢复验收。[机器记录](../reports/evidence/browser-github-probe-and-linux-entry-20261119.json)

## GitHub 的已观察规则

用户在该独立配置完成人工登录后，PR360 页面出现用户菜单。通过原生 DevTools Elements 查找实际 DOM，核实以下两个选择器均为 1 个匹配：

| 用途 | 已观察的选择器 | 取值 |
| --- | --- | --- |
| 登录标记 | `body.logged-in` | 只检查存在 |
| 当前账号主体 | `meta[name="octolytics-actor-id"]` | `content` 属性 |

主体是正整数字符串，与已连接 GitHub profile 的账号 ID 一致；相邻 actor-login 也与该 profile 的 nickname 一致。GitHub 将用户 ID 描述为持久标识，login 可以变化；页面元数据的账号含义在这里由当前实际账号交叉核对，不能视为 GitHub 对该 DOM 字段的长期接口承诺。[GitHub 用户 ID 文档](https://docs.github.com/en/rest/users/users#get-a-user-using-their-id)

已固定只读规则草案：origin 为 `https://github.com`，path 为 `/holaday-ai/holaday-monorepo/pull/360`，adapter 标签为 `github-octolytics-actor-id-v1`。草案通过当前实际 `parseTrustedSiteProbes` 校验；没有调用 provider 工厂或 worker，没有应用到生产。没有运行页面脚本、读取 Cookie／Storage、保存原始 DOM 或抓取登录快照；DevTools 已关闭，原 PR 页面保留。

这只完成了当前页面的来源核查。相同规则在恢复快照内的账号证明、登出／撤销／切换及旧结果拒绝仍须真实验证。Google 的主体来源仍待解决，不能用 GitHub 规则或连接器账号替代。

## Linux arm64 关闭状态冷启动

使用真实浅克隆的提交 `01d388dd`，运行时 1827 项输入与候选 `81d1948e` 逐项匹配。固定 Node 22.23.3 的 Linux arm64 发行包与此前验签清单的 SHA256 匹配；pnpm 10.33.0 按原锁文件安装生产依赖，未运行依赖安装脚本。

最终运行复用专属 Linux 缓存，容器从创建到删除始终 `network none`；768 MiB、禁止交换、半核、128 PID。检查了无外部地址／路由；无 OOM。实际 Argon2 合成哈希／正反校验、sharp 单像素 PNG 均通过。

随后以 UID 998 运行真实 `scripts/start-orchestrator-production.sh`，没有替换启动函数或服务：

- 应用命令确为同进程 `node --import tsx .../src/index.ts`，HTTP／WS 两个监听 socket 归属同一 PID。
- 生产模式健康接口返回 200；普通业务请求返回 503。
- 原生维护 status 回执绑定新 boot，状态 closed、idle、无需 reconciliation；没有发出 open。
- SIGTERM 后应用退出 0，writer lock、control socket 及 HTTP 监听均消失，最终 journal 保持 closed。
- 自有容器删除已通过针对同一容器 ID 的不存在回执核实。

前两轮失败均保留：第一轮在启动前误将 sysfs 的内核虚拟设备列表要求为只有 lo，清理断言还未兼容 Docker 的小写错误文案；第二轮的合成 Argon2 timeCost=1 低于库要求。它们都没有启动应用。修正夹具后，第三轮从缓存离线完成首次应用启动；产品运行时代码没有修改。

本例没有连接数据库或 Redis，没有启用 Vault、访问 AWS 身份或发出模型请求。日志中的预热“已启动”来自 producer 注册处；本例 ordinary 分支未调用该 start 回调，此日志不作为后台工作已运行的证据。完整服务开放和生产有效配置均未验证。

## 目标架构及余项

只读读取同一现网进程可执行文件的 20 字节 ELF 头，进程／可执行文件身份前后匹配，machine=62，即 x86_64。未读取进程环境或 JS 堆。下一步须验证 x86_64 的准确依赖与启动材料，不能把这次 arm64 原生绑定检查记为目标 ABI 通过。

全 Goal 仍要求原定 PR360 验收 JSON 的完整闭环、100 行 Sheets、真实 KMS／生产运行身份、同一快照的站点主体、账号生命周期、物理输入及最终受保护发布绑定。779B package.json 准备用例不替代原定 JSON。模型账本仍为 25 次尝试，追加额度没有获得授权；旧任务、文件和未知结果保留，不重放。PR361 保持草稿，不合并、不部署。
