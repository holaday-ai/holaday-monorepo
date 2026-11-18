# Browser Vault：AWS KMS 接线与验收

当前授权是准备代码、配置和最小权限方案，不包含创建账号、密钥、IAM 权限或收费资源，也不包含上线。以下模板不能直接当成已批准的生产配置。

## 服务端配置

示例见 [环境片段](examples/browser-vault-aws-kms.env.example)。只填写区域、完整 key ARN、专用命名 profile、可信站点规则；密码、Access Key 和 Cookie 不进入环境片段、仓库或聊天。三个 Vault 开关维持 false，真实资源及站点验证后再单独决定启用。

启动工厂仅在 `BROWSER_SESSION_IMPORT_V2`、`BROWSER_PROFILE_PERSIST_V1` 或 `BROWSER_HOME_PROFILE_V1` 启用时解析接线。启用后缺少供应商、区域、key ARN、profile 或可信站点会拒绝启动。监听入口开放前调用 DescribeKey，确认每个允许 key 的 ARN、Enabled、ENCRYPT_DECRYPT、SYMMETRIC_DEFAULT；失败不回落到测试密钥。

SDK 使用显式区域 HTTPS KMS 端点、单次尝试和 5 秒操作期限。专用 profile 通过 AWS SDK `fromIni` 读取已有的共享配置；选择的 profile 可以引用已有角色/SSO 配置。不要改全局 `AWS_PROFILE`、S3/R2 凭据或现网配置来完成本轮准备。profile 所需配置文件必须由实际服务 OS 用户可读；本机控制台登录不等于生产运行身份已经可用。

`BROWSER_VAULT_KMS_DECRYPT_KEY_ARNS` 可选，最多 4 个旧 key，同区域/分区；仅旧密文解封使用。新封装始终使用当前 key。使用完整 `...:key/...` ARN，不接受可重新指向的 alias。轮换后保留旧 key 的解密能力，直到所有旧密文完成验证与迁移；禁用/删除 key 不属于普通回滚。

## 最小权限模板

[IAM 模板](examples/browser-vault-aws-kms-iam.json) 只列当前 key 的 Encrypt、Decrypt 和 DescribeKey。`REPLACE_CURRENT_KEY_ARN` 是故意无效的占位符，必须替换成已确认资源后再审查；本轮不提交到 AWS。资源的 key policy 也必须允许所选运行身份，只有 identity policy 不能证明可用。不要授予 `kms:*`、建钥、授权管理或删除权限。

如果确有旧 key，另加只针对这些 ARN 的 Decrypt 和 DescribeKey；Decrypt 使用与当前模板相同的 context/algorithm 条件，旧 key 不加 Encrypt。不要为了测试权限扩大到所有 key。DescribeKey 单独一条，不附加只适用于加解密请求的 context 条件。

KMS 仅处理 32 字节随机 DEK。远端 context 为 `application=holaday-browser-vault` 加 `aadSha256`，绑定与本地 AES-GCM 完全相同的 owner、origin、grant、purpose、version 和可选 access。真实账号、网址、Cookie 和明文会话不进入 KMS context；AWS 会记录 context，不能把它当成秘密字段。

## 真实资源验收顺序

1. 用户登录已有 AWS 账号；只读确定可复用的区域、完整 ARN、对称密钥状态和预期运行身份。没有资源就记录缺项，不自动创建或购买。
2. 在隔离验收环境，由用户管理现有专用 profile。记录非秘密的资源引用与身份来源，凭据不进证据文件。使用候选的 Node 22.23.3、锁文件和匹配的构建产物。
3. 先对实际 `AwsKmsKeyProvider.assertReady()` 做 DescribeKey 验证。生产启动路径的错误配置/权限拒绝仍需在隔离实例验证，不能对现网做故障注入。
4. 获准调用后，进程 A 使用实际 `seal` 和真实 provider 封装固定的合成内容，文件以 0600、独占创建保存；只写 Envelope 与合成 context，不保存 DEK、凭据或真实账号。进程 A 正常退出。
5. 独立进程 B、新 provider 和同一已确认身份读取文件并 `unseal`，逐字段核对合成内容。记录两次独立进程与候选 SHA。这才是跨进程解封证据，内存内 mock 往返不算。
6. 依次核对错误 owner/origin/grant/purpose/version/access、未声明旧 key、被篡改密文均拒绝，之后再次正常解封确认可用。拒绝结果只证明拒绝边界；需要指定 AWS 拒绝原因时另看授权的服务审计记录，不能由统一错误文本猜测原因。
7. 以真实已授权的不同身份验证权限拒绝；没有第二身份时保留未验，不修改 IAM 或假造另一 profile。SDK transport/credential 失败不能冒充身份隔离通过。
8. 真实站点主体核对后，才进行云端保存、重建、到期、撤销、换账号和迟到保存验收。登录和验证码由用户操作，不复制日常 Chrome profile。

实际加解密调用可能计费；本轮只准备，不执行上述收费验收。AWS 官方标准客户密钥基础标价为每把每月 1 美元，调用另计；复用已有 key 与新建 key 的费用不同，以账号实际账单为准。免费账号计划可用于验证，官方支持服务包含 KMS，但计划会在6个月或额度耗尽时结束；长期依赖的正式密钥在接线前需确认持续可用的账号方案，不能把免费API额度当成密钥永久免费。

## 可信站点规则

`BROWSER_VAULT_TRUSTED_PROBES_JSON` 是服务端 JSON 数组，每项为 `{origin,path,selector,subject:{selector,attribute?,adapter}}`。只接受精确公共 HTTPS origin、同 origin 的规范路径、唯一 origin、非空主体规则；最多 16 站点。不从客户端或网页接受配置。

`selector` 用于登录证据；`subject.selector` 必须恰好命中一个账号主体。当前 worker 读取属性或文本并绑定适配器版本，不会自动抽取邮箱、点击菜单或跨 iframe 读取。因此，Google Sheets 账号按钮里含显示名的本地化标签不能直接宣称是稳定账号主体；当前 IAB 中看到的登录状态也不能替代候选浏览器恢复验收。GitHub 公开 PR 可读同样不证明账号已登录。未实测的规则不写进生产配置。

## 回滚与观察

运行失败时先保留任务及未知结果，不重放导出或写操作。关闭入口/清理灰度名单与服务重启依照经批准的维护流程执行；本轮不执行。保留 Vault 表、v2 密文、旧 key 解密引用、文件以及加性迁移。退回不支持新封装的代码之前关闭对应入口，不把解码失败声明成账号恢复。

服务关闭时停止新工作、排空现有任务并关闭 provider；未完成的 SDK 请求会被中止，迟到解封明文清零。清理异常保留失败状态，不把后一次 close 当成清理成功的证据。

## 官方依据

- [Node SDK 凭据](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)
- [Encrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Encrypt.html) / [Decrypt](https://docs.aws.amazon.com/kms/latest/APIReference/API_Decrypt.html)
- [Encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html) / [KMS 条件键](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-kms.html)
- [AWS KMS 定价](https://aws.amazon.com/kms/pricing/)
- [免费计划支持服务](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html) / [账号计划与到期](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
