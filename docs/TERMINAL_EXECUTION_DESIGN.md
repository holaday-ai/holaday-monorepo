# Terminal Execution 能力设计

> HOLA DAY 从"只能操作浏览器"扩展到"也能在用户本机执行终端命令"。
> 目标：用户说一句话，HOLA DAY 既能跑网页，又能跑 `git pull` / 启动服务 / 写文件。
> 本文档只定方案，不写代码。

---

## 1. 架构方案对比

Chrome 扩展的 sandbox 不允许 `child_process.spawn`。任何终端执行都必须经过一个**本机 agent 进程**。三条候选路径：

### 方案 A：Electron 桌面 app（把扩展嵌进去）

把整个 HOLA DAY 打包成 Electron app，里面内嵌 Chromium + popup UI + 终端执行能力。

- ✅ 单一安装包，用户体验统一
- ✅ Node 能力完全放开（文件系统、终端、pty）
- ❌ **和"Chrome 扩展"定位冲突** —— 用户已经用 Chrome，不想再装一个"套壳浏览器"
- ❌ 包体大（≥ 150 MB），首次下载慢
- ❌ Chromium 自带 ≠ 用户已登录的 Chrome profile。抖音后台、雪球、小红书等登录态全部丢失，用户要重新登录一遍。**直接破坏核心使用场景**
- ❌ 维护两份 Chromium 内核（用户的 + Electron 的），更新不同步

### 方案 B：轻量 CLI daemon（Node.js + WebSocket）

用户本机跑一个常驻进程（比如 `holaday-agent`，`launchctl`/`systemd` 自启），监听 `127.0.0.1:port`。Chrome 扩展 SW 通过 WebSocket 连上它，发 "exec" 消息，daemon 执行后返回 stdout/stderr/exitCode。

- ✅ 不碰用户的 Chrome，登录态完全保留
- ✅ daemon 包小（几 MB），升级独立
- ✅ 同一个 daemon 可以服务多个浏览器、多个窗口
- ✅ WS 协议和现有 orchestrator ↔ SW 的协议同构，**心智负担低**
- ⚠️ 要教用户装 daemon（脚本一行，`curl … | sh`），但这步可以在首次触发终端任务时引导
- ⚠️ 本地端口要防被其他网站偷用 → 必须有 token 鉴权（见 §2）

### 方案 C：Chrome Native Messaging Host

Chrome 原生机制：扩展通过 `chrome.runtime.connectNative('com.holaday.host')` 启动一个外部进程，stdin/stdout 通信。

- ✅ Chrome 官方支持，生命周期跟扩展绑定（扩展关 → host 退出）
- ✅ 不开监听端口，攻击面最小
- ❌ **Day 1 的打包/分发最贵**：每个 OS 要写 `.pkg` / `.msi` / `.deb`，还要在系统特定路径注册 Native Host manifest（macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`，Windows: 注册表）
- ❌ 每个 Chrome profile 单独启一个 host 实例，多 profile 用户会看到多份进程
- ❌ 消息协议是 stdin 上的 4-byte length-prefixed JSON，**不能直接复用现有 WS 协议**，得写一层适配
- ❌ 调试体验差：host 进程只能通过 Chrome 日志看 stdin/stdout

---

## 2. 推荐方案：B → C 两段式

**Phase 0.5 / Phase 1 走方案 B**，因为它**能最快跑起来**，并且协议和现有 orchestrator 同构。

**Phase 2 graduate 到方案 C**，把 daemon 包装成 Native Messaging Host，换掉本地端口和手动自启，变成"装扩展即生效"的一体体验。

为什么不直接上 C：Native Messaging 在 Day 1 的分发/签名/注册表工作量大，会拖慢验证速度。而我们现在最需要证明的是"Planner 会不会合理选择用终端 vs 浏览器"和"混合任务能不能跑通"，这两件事在方案 B 上跑和在方案 C 上跑**完全一样**。先用 B 跑通，再换 C 优化体验。

显式拒绝方案 A：和核心定位冲突（见上方理由），不考虑。

---

## 3. 安全模型

本机执行终端命令的破坏力远大于浏览器自动化。原则：**默认不信任 Planner**，Planner 发什么命令都先过一道用户的闸门，除非命令明确在白名单里。

### 3.1 三级命令 tier

配置文件 `~/.holaday/policy.yaml`，**用户编辑，LLM 无权改**：

| Tier | 行为 | 示例 |
|------|------|------|
| `auto` | 自动执行，不弹窗 | `ls`, `pwd`, `cat`, `git status`, `git log`, `node --version` |
| `confirm` | 弹 popup / 系统通知，用户按"允许"才跑 | `git pull`, `npm install`, `node script.js`, 写文件到 `~/Desktop` |
| `blocked` | 永远拒绝，不可被覆盖 | `rm -rf`, `sudo *`, `curl … | sh`, `chmod 777`, 写入 `~/.ssh/`、`~/.aws/`、`~/.config/` |

默认策略偏保守：没在 `auto` 白名单里的都走 `confirm`。`blocked` 是硬编码，policy 文件只能**新增**到 `blocked`，不能从 `blocked` 移出。

### 3.2 执行规范

- **argv 列表，不是 shell 字符串**。Planner 输出 `{cmd: "git", args: ["pull", "--rebase"]}`，daemon 用 `spawn("git", ["pull", "--rebase"], {shell: false})`。不允许 `sh -c "…"`，消除命令注入风险
- **Workspace 限定**：用户在设置里显式勾选"允许 HOLA DAY 操作的目录"（比如 `~/Desktop`、`~/Projects/foo`）。daemon 在执行前把 `cwd` 和所有写路径 resolve 成绝对路径，检查是否在 workspace 内，拒绝 `..` 越狱
- **env 净化**：默认只透传 `PATH` / `HOME` / `LANG`，不带 `AWS_*` / `GITHUB_TOKEN` / `ANTHROPIC_API_KEY` 等凭据。需要的 env 由用户在 workspace 配置里显式授予
- **超时 + 输出上限**：每条命令默认 30s 超时，stdout/stderr 各 1 MB 上限，超出截断
- **stdout 默认不回传 Anthropic**：执行结果先回 daemon → SW → orchestrator，是否塞进下一轮 prompt 由 Planner 显式决定（新 action kind：`terminal_capture`）。**默认只把 exitCode 和摘要喂给 LLM**，避免日志里意外出现的 token / 邮箱被送上云

### 3.3 本地端口鉴权

方案 B 的 daemon 监听 `127.0.0.1`，仍要防**其他网站**通过浏览器偷调用：

- 首次启动 daemon 生成 `~/.holaday/pairing-token`（32 字节随机）
- 扩展装上后，用户在 popup 点"配对"，把 token 粘贴进扩展（或 daemon 把 token 写到剪贴板 + 扩展读剪贴板，一次性）
- 后续每个 WS 帧带 `Authorization: Bearer <token>` header
- daemon 只接受 `Origin: chrome-extension://<expected-id>` 的握手

### 3.4 审计日志

每条执行写 `task_events`（复用现有 append-only 表），`type = "terminal.exec"`，payload 含 `{cmd, args, cwd, exitCode, elapsedMs, stdoutPreview, tier, approvedBy}`。用户可以在 popup History 里**回看每条终端命令**，和浏览器操作一视同仁。blocked 命中也写一条 `type = "terminal.blocked"`。

---

## 4. 浏览器 ↔ 终端 协同

### 4.1 Planner 决策

扩展到 Planner 的 `AvailableTools` 描述里新增一类：

```
tool: terminal.exec
  when: 需要读写本地文件、执行脚本、调用本机 CLI、启动/停止服务
  NOT when: 网页上能完成的事（登录、填表、点击、从页面抓数据）
  preference: 能用浏览器完成的优先用浏览器；终端作为"最后一公里"
```

Opus 在规划时产出混合 plan，每个 step 的 `kind` 从 `{goto, click, type, extract, … , terminal_exec, terminal_capture}` 中选。

### 4.2 混合任务示例

**用户说**："帮我把抖音后台数据下载下来，整理成 Excel 放到桌面上。"

**Planner 产出的 plan**：

| seq | kind | 说明 |
|---|---|---|
| 0 | `goto` | `https://creator.douyin.com/creator-micro/data/`（浏览器，复用用户登录态） |
| 1 | `wait` | 等数据面板渲染完 |
| 2 | `extract` | 抓 7 天播放量 / 粉丝增长 / 互动数表格 → JSON |
| 3 | `extract` | 抓"热门视频" Top 10 标题 + 指标 → JSON |
| 4 | `terminal_exec` | `node -e "…"` 把前两步的 JSON 写成 XLSX 到 `~/Desktop/douyin-20260419.xlsx`（用 workspace 里预装的 `xlsx` 包，或者 daemon 自带的 helper） |
| 5 | `terminal_capture` | 执行 `ls -la ~/Desktop/douyin-20260419.xlsx`，把 size/mtime 回给 Planner 做 sanity check |
| 6 | `screenshot` | 截桌面通知（可选，验证文件生成成功） |

**流程**：
1. 浏览器侧 step 0~3 在用户的 Chrome 里正常跑，结果以 JSON 存在 task 的 `artifacts` 字段
2. 到 step 4 时，orchestrator 看到 `kind === "terminal_exec"`，**通过 SW 转发给本地 daemon**（不是直接 HTTP，走扩展已建立的 WS，扩展做 relay）
3. daemon 收到：cmd = `node`, args = `["-e", "…xlsx 写盘脚本…"]`，cwd = `~/Desktop`
4. 查 policy：`node -e` 属于 `confirm` tier → popup 弹窗"HOLA DAY 想把抖音数据写入 ~/Desktop/douyin-20260419.xlsx，允许？"
5. 用户点"允许" → daemon 执行，stdout/exitCode 回 orchestrator
6. Planner 拿到 exitCode === 0 → 标记 task 完成，popup History 里同时显示浏览器截图和终端输出

**关键点**：
- 浏览器登录态 **完全不动**（不走 Electron，不走独立 Chromium）
- 敏感写操作 **走 confirm 闸门**，用户有全局 kill switch
- 同一条 task 线贯穿浏览器 + 终端，审计日志一体

### 4.3 反向协同（终端 → 浏览器）

不常见但要支持：用户说"把这份 CSV 上传到我的 Shopify 后台"。Plan 可能是：
1. `terminal_capture` 读 `~/Desktop/products.csv` → 把内容（或临时公网可达的路径）塞进 artifacts
2. `goto` Shopify 后台
3. `click` 上传按钮，`type`/`eval` 把 artifact 数据注入 file input（通过 CDP 的 `DOM.setFileInputFiles`）

---

## 5. 分阶段实施

### Phase 0.5 —— 证明方案可行（1~2 天）

目标：**一条真实混合任务跑通**，不追求打磨。

- [ ] daemon 原型：Node.js 脚本，监听 `127.0.0.1:27182`，一个写死的 bearer token
- [ ] 只支持 `auto` tier + 硬编码允许 3 个命令：`ls`、`node -e`、`echo`
- [ ] 扩展 SW 加一段：task_step.kind === "terminal_exec" 时走 WS 发给 daemon，回结果
- [ ] orchestrator planner prompt 加上 `terminal_exec` 的描述
- [ ] 跑通 demo：用户说"在桌面新建一个叫 hello.txt 的文件，内容是当前时间"
- [ ] 不做：policy 文件、workspace 勾选、Native Messaging、系统服务自启（开发阶段手动 `node daemon.js`）

**交付**：录屏 30 秒，展示"浏览器 + 终端同一任务线"能跑。

### Phase 1 —— 生产可用（1~2 周）

面向愿意内测的个人用户。

- [ ] daemon 打包：`npm install -g @holaday/agent` 或 `curl … | sh`，macOS/Linux 先行，Windows 后续
- [ ] launchctl / systemd 服务定义，开机自启
- [ ] `policy.yaml` 全量实现（auto / confirm / blocked 三档 + hardcoded blocklist）
- [ ] Popup 里"请求终端权限"弹窗 + 配对 token UI
- [ ] Workspace 选择器（用户勾允许操作哪些目录）
- [ ] argv-only exec，shell 字符串全拒
- [ ] env 净化 + 超时 + 输出截断
- [ ] 审计日志写 `task_events`，History 里渲染
- [ ] 反向协同（CDP setFileInputFiles）
- [ ] 集成测试：3~5 条混合任务 e2e（本地 fixture）

**交付**：内测用户可以装 daemon + 扩展，跑抖音→Excel、CSV→Shopify 这类任务。

### Phase 2 —— 全量体验打磨（3~4 周）

- [ ] Native Messaging Host 版本（方案 C），取代本地端口
- [ ] 每个 OS 的安装器：`.pkg`（macOS）、`.msi`（Windows）、`.deb`/`.rpm`（Linux）
- [ ] 自动更新通道（daemon 检查 orchestrator 的版本 manifest，后台下载升级）
- [ ] 沙箱增强：在 macOS 上用 `sandbox-exec`，在 Linux 上用 namespaces/seccomp 限制 daemon 本身的权限，即使被打穿也跑不出 workspace
- [ ] 长任务支持：pty 流式输出（`node-pty`），popup 里实时滚日志
- [ ] 命令历史 + 一键复跑，用户越用越轻松
- [ ] 多机同步：台式机跑的任务历史同步到笔记本 daemon（orchestrator 做中转）

---

## 6. 与 PRODUCT_PRINCIPLES.md 的对齐

| 原则 | 本方案如何满足 |
|---|---|
| **1. 零学习成本** | 用户不需要知道命令怎么写、path 是什么、shell 语法。只说"把数据存桌面"、"帮我启动开发服务器"、"git 更新一下"，Planner 翻译成具体命令。policy 的 confirm 弹窗用人话问（"HOLA DAY 想写入 ~/Desktop/douyin.xlsx"），不是弹 raw argv |
| **2. Agent 控制 Agent** | 完全兼容。如果本地装了 Claude Code 或其他 AI CLI，Planner 可以直接调用它们（比如 "claude code '修一下这个 bug'"），而不是自己重新规划文件编辑。HOLA DAY 继续做 meta-agent |
| **3. 后台独立运行** | daemon 是后台服务，**不需要任何窗口**。popup 关了任务继续跑。浏览器侧已经有 CDP 截图（不偷焦点），终端侧本来就没 UI 概念。用户点 Run 后可以锁屏去吃饭，任务完成推系统通知 |
| **4. 全能操作** | 这是这个能力的核心。之前 HOLA DAY 做不到"写本地文件"、"启服务"、"调本地 CLI"，加了终端能力后，浏览器能做的 + 终端能做的 = 用户桌面上几乎所有可自动化的事。和浏览器操作组合起来，覆盖面从"信息抓取/网页填表"扩展到"端到端工作流" |

---

## 7. 风险与开放问题

- **用户担心"给 AI 开了终端等于把电脑交出去"**：靠 policy tier + workspace + 审计日志解决感知问题，文档里要有一页"HOLA DAY 不会做什么"对照清单
- **Policy 怎么冷启动**：第一次装上没人会去编辑 yaml。默认 policy 要能覆盖 80% 场景，剩下 20% 用 confirm 弹窗交互式教学（用户第一次点"允许 git pull" → 询问"以后 git pull 自动跑吗？"→ 写 policy）
- **Windows 上的 shell 语义差异**：`ls` vs `dir`、路径分隔符、权限模型。Phase 0.5/1 先只支持 macOS + Linux，Windows 单独排期
- **LLM 幻觉出"看起来安全但其实危险"的命令**：比如 `find / -name …` 会递归遍历整盘。confirm 兜底，但 policy 默认值要严格 —— 任何带 `/` 根路径的命令都强制 confirm
- **daemon 崩了怎么办**：systemd/launchctl 自动重启，扩展 WS 断线重连已经有（心跳 30s）。task 中途挂掉走现有 heal 流程重跑 step

---

## 附：术语对照

- **daemon**：本机常驻进程（这份文档里 = HOLA DAY Agent 本机进程）
- **Native Messaging**：Chrome 官方机制，扩展启动外部程序通过 stdin/stdout 通信
- **argv**：传给程序的参数列表（字符串数组），和 shell 字符串对立
- **workspace**：用户显式授权 HOLA DAY 可以读写的目录白名单
- **tier**：命令的信任级别（auto / confirm / blocked）
