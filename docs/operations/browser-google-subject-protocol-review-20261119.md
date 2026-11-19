# Google 账号主体协议核查补充

本次仅查官方文档、Chromium 源码和已有探针代码，没有访问登录账号接口或修改运行时。结论是：**ListAccounts 不能通过现有配置直接作为 Sheets 当前账号证明**。这排除了一个不适用的接线方向，尚未完成 Google 身份或恢复验收。[机器记录](../reports/evidence/browser-google-subject-protocol-review-20261119.json)

## 来源确认了什么

Chromium 的 `StartListAccounts` 使用带凭据的表单 POST、特定 Origin 头及非空请求体；原生网络层还设置内部请求的 Cookie 隔离上下文。先前直接页面访问的 400 与该请求不同，不能据此诊断登录失效。[请求实现](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/google_apis/gaia/gaia_auth_fetcher.cc)

所查 URL 带 `laf=b64bin`；解析器先解码 Base64，再解析 protobuf，取账号标识和会话状态。首项表示 Cookie 列表的主账号，解析器没有读取当前 Sheets 文档或当前标签页选择的账号。[URL 定义](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/google_apis/gaia/gaia_urls.cc)、[解析器](https://chromium.googlesource.com/chromium/src/+/refs/heads/lkgr/google_apis/gaia/gaia_auth_util.cc)

Google 官方允许多账号同时登录和切换，默认账号不总是用户想使用的账号。因此“Cookie 主账号等于当前表格账号”缺少证据；这是由协议语义和多账号行为得出的本项目判断。[Google 多账号说明](https://support.google.com/accounts/answer/1721977?hl=en)

Google OIDC 的稳定标识是经过验证的 `sub`，不是邮箱；回调必须匹配登记地址。得到 Holaday 登录身份，也仍需证明它与同一候选快照中的站点当前账号相符。[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)

上述源码来自不同的可移动分支，观察到的文件 blob 已逐项记录；没有声称属于同一构建，或等于验收 Chrome 的准确源码版本。源码核查说明协议语义，不是实际服务可用性证明。

## 对本项目的决定

现有 worker 只在配置的同源路径读取主页面唯一元素；`subject.adapter` 仅为标签。它不具备跨来源账号请求、protobuf 解析、OAuth 回调或当前表格账号解析能力。仅换配置名、选择列表第一项、填写邮箱，均不能补齐这些能力。

保留缺少稳定主体时不签发 identityProof 的行为。未新增 ListAccounts 请求、伪造请求头、读取 Cookie、创建 OAuth 客户端、修改回调或触发生产登录写入。接线前仍需取得可核实的同快照当前站点主体来源；若采用 OIDC，则另行落实隔离回调和当前账号绑定，不能直接调用现有生产回调。

运行候选仍为 `bbcf442204e860aff2caceb41fa867a7e6cdfdcd`，1832 项输入未变。本次不重复构建或已通过的用例。真实模型耗时、KMS、账号生命周期、物理输入及生产有效配置继续未验；PR361 保持草稿，未合并、未上线。
