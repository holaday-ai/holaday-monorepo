# 真实站点账号主体接线核查

本次核查已有接线与已授权验收窗口，没有修改登录、探针、云配置或生产数据。账号保存、恢复和切换尚未通过。[机器记录](../reports/evidence/browser-site-identity-review-20261119.json)

后续[Google 协议源码核查](browser-google-subject-protocol-review-20261119.md)已确认 ListAccounts 的原生 POST／二进制账号列表语义，不能直接用作现有探针或当前表格账号证明。下文模型额度及 Linux 未验记录是当时状态；当前上限 41 已用完，Linux 当前候选的模拟关闭启动已补齐，真实模型耗时与账号验收仍未完成。

## 已确认的实现边界

`production-runtime.ts` 的 `subject.adapter` 是配置标签，不会选择或执行 Google／GitHub 身份解析器。`worker.ts` 在候选快照创建的上下文内导航到服务端配置的同源路径，再用主页面 `page.locator` 读取恰好一个元素的文本或属性；它没有框架查找、账号菜单操作或 OAuth 身份请求。找不到唯一主体时，只返回 connected，不签发 identityProof。

既有证明仍绑定用户、授权版本、origin、快照版本及状态摘要。此次没有改用邮件地址、显示名、账号槽位或头像作为稳定主体。Google 明确要求以稳定的 `sub` 标识账号，邮件地址可能变化；GitHub 用户名也可以更改。[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)、[GitHub 用户名变更](https://docs.github.com/en/account-and-profile/concepts/username-changes)

## 已有 Google OAuth 可以复用的事实

生产进程身份及其监听 socket 前后匹配；健康接口和纯查询 `auth.loginOptions` 均返回 200，Google 登录已配置。仅返回配置存在与否，没有返回或保存凭据值。

只读取 `/auth/google` 的第一跳 302、禁止跟随重定向，并将公开 client_id 的摘要与 Google Cloud 中既有的 **HOLA DAY Web** 客户端比较，结果一致。没有兑换授权码、请求 token／userinfo、调用回调或创建真实用户。检查端口时读取了服务端进程环境；原始收据中过宽的“未读或返回 secret”字段已保留并另附更正，不能据此声称从未读取进程环境。

在独立“Holaday 验收”配置中，只读查看了该既有客户端，观察到登记的两个回调：

- `https://holaday.ai/api/auth/google/callback`
- `https://hd-app.orangebench.tech/api/auth/google/callback`

没有观察到已登记的本机回调，没有创建客户端、下载／揭示密钥、保存配置或扩大权限。第二个域名的环境隔离没有核实，不能直接当作测试后端使用。既有回调代码会交换 token、读取 userinfo.sub 并登录／注册用户，此次没有为调查触发它。

## 实际浏览器观察与限制

在 Google 合成表的原生页面打开账号菜单，并用 DevTools Elements 检查实际显示名称元素。该元素位于 `name="account"` 的框架内，所检查 DOM 分支未得到可验证的稳定账号主体；没有运行页面脚本、解码内部数据或读取 Cookie／Storage。显示名称存在不代表当前探针能签发正确的账号连续性证明。

另一次基于 Chromium 代码中 ListAccounts 路径的直接页面访问返回 400，未得到身份载荷，未尝试变体或伪造请求头。Chromium 使用该内部协议不证明它适合作为本项目的受支持探针。[Chromium GAIA URL 定义](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/google_apis/gaia/gaia_urls.cc)

诊断页面与 DevTools 已关闭，独立配置回到 Fresh100 合成表。没有再次导出原表或新表，没有提交模型任务。本次只核查 Google 相关来源，GitHub 的实际稳定主体仍待核实。

## 后续接线要求

先验证所选站点提供的稳定主体及其与**同一候选快照、当前账号**的对应关系，再固定只读探针。连接器账号或 Holaday 自身登录账号不能替代被恢复网站的账号证明。现有 OAuth 客户端可避免凭空要求新建资源，但不能绕过回调登记、来源和账号绑定检查。没有这份证据前，保留拒绝签发证明的行为。

同时核对了启动契约：`start-orchestrator-production.sh` 使用同进程 `node --import tsx src/index.ts`；两个 workspace 包的运行时导出仍指向 TypeScript 源码。因此后端 ZIP／`node dist/index.js` 不能独立代表生产启动方式。Linux 上准确 workspace、锁文件、原生依赖及已审核加载器的完整入口冷启动仍待验证，本次没有把文件存在或构建通过计为启动成功。

现有 25 次模型尝试额度已用完，追加 16 次仍待答复；本次新增模型调用 0。AWS 固定测试包原授权保持，恢复登录后先核对已执行标记。PR361 保持草稿，不合并、不部署。
