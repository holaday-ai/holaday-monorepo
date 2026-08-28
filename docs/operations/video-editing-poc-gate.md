# “继续剪辑” POC 与生产启用门槛

## 当前结论

- SDK 选择：IMG.LY CE.SDK Web，固定由 `VideoEditorAdapter` 适配，业务代码不得直接依赖供应商 API。
- POC：允许在本地或隔离测试环境使用官方 evaluation mode；评估输出含水印，不得作为用户成片交付。
- 生产：`VIDEO_EDITING_ENABLED=false`。在本清单全部有负责人、有证据并通过预检前，不得打开。
- 备选：若商业条款或浏览器/编解码器基线不满足，再单独评估 Twick；不得在运行时静默降级到另一供应商。

## 官方能力与条款基线（2026-08-28 核对）

- CE.SDK 提供 30 天完整功能试用；正式价格需按平台、组件和能力询价：<https://img.ly/pricing/>。
- Web 视频编辑器支持时间线、裁剪、字幕、音频和浏览器端 MP4 导出：<https://support.img.ly/how-to-get-started-with-the-video-editor-in-ce-sdk>。
- 官方支持客户端导出或交给自有服务端渲染，并提供 React/Vite 集成：<https://img.ly/products/video-sdk/>。
- 当前锁定依赖：`@cesdk/cesdk-js@1.81.1`。升级必须重新跑浏览器、编解码器与导出矩阵。

## 商务/授权门槛

| 项目 | 必须得到的书面结果 | 状态 |
| --- | --- | --- |
| 商业合同负责人 | Holaday 内部负责人姓名与供应商联系人 | 未完成 |
| 授权主机名 | `holaday.ai`、`hd-app.orangebench.tech`、明确的 staging 主机名 | 未完成 |
| 白标范围 | UI、导出文件、水印与归属标识全部可移除 | 未完成 |
| 平台范围 | Web 客户端；若启用 Node Renderer，必须另列服务端平台 | 未完成 |
| 计价口径 | 月/年费用、导出量口径、超量费、AI 插件与底层模型费 | 未完成 |
| 取消/续费 | 月度提前一周、年度提前一个月规则与自动续费条款复核 | 未完成 |
| 数据传输 | 许可证校验、聚合导出计数、媒体与个人数据是否离开 Holaday | 未完成 |
| SLA/支持 | 响应时限、浏览器升级与安全修复支持 | 未完成 |
| OEM/转售 | Holaday 面向终端用户的嵌入式使用是否覆盖 | 未完成 |

许可证值不得写进此文档、Git、PR、日志、截图或测试夹具。Web SDK 若要求浏览器可见的域名绑定许可证，需由 IMG.LY 书面确认其为可公开客户端材料；任何 API/管理密钥仍只在服务端保存。

## 技术启用门槛

1. `VIDEO_EDITING_ENABLED=true` 只在明确的 canary 环境启用。
2. `VIDEO_EDITING_ALLOWLIST` 初次启用必须非空，且只含合成测试账号。
3. `VIDEO_EDITING_PROVIDER=cesdk`；未知值必须启动失败。
4. 正式许可证存在性只报告布尔值/长度，不打印内容。
5. 生产与 staging 主机名都在许可证授权范围内。
6. Chrome/Edge/Safari/Firefox 最新稳定版完成解码、预览、裁剪、字幕、9:16、导出验证。
7. H.264/AAC、MP4/MOV/WebM 输入矩阵有真实文件证据；不支持时显示明确降级，不假装成功。
8. 200MB 上传上限、时长上限、输出保留与 R2/本地存储路径通过端到端验证。
9. 所有项目、版本、报价、恢复、导出与下载均通过跨用户拒绝测试。
10. 免费编辑不扣费；付费场景重生成仅使用服务端报价，过期/重放/基础版本变化全部拒绝。
11. 健康检查、错误率、导出失败率与退款路径可观察，回滚负责人明确。

发布前运行 `pnpm test:video-editing-preflight`。功能关闭时它只返回
`production_disabled_pending_commercial_license`，不会探测或输出许可证、白名单内容；只有准备打开
canary 时，才会要求书面授权主机名、非空白名单、0051/0052 生产数据库验证和两个健康端点全部通过。

## 回滚

1. 将 `VIDEO_EDITING_ENABLED=false`。
2. 重启 Orchestrator；验证能力接口返回 disabled。
3. SPA 中所有 `继续剪辑` 入口随能力关闭而消失；原 `/video`、历史、下载与生成不受影响。
4. 不删除项目、版本或输出文件；保留用户已有结果与审计记录。
5. 验证 `https://holaday.ai/api/healthz` 与 `https://hd-app.orangebench.tech/api/healthz` 均为 200/status ok。

## 明确不触碰

- DivineAPI Translator 与其 OpenAI Key。
- 现有视频生成供应商密钥与配额。
- 主工作区未提交文件。
