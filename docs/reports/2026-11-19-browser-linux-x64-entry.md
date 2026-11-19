# Linux x86_64 模拟环境关闭启动验证

当前候选运行时在本机 Docker 的 linux/amd64 环境中完成真实入口验证。宿主为 arm64，CPU 由 Rosetta 模拟；这不是生产宿主或真实服务验收。[机器记录](evidence/browser-linux-x64-entry-20261119.json)

## 固定材料

- 源码使用真实浅克隆提交 `01d388dd`，1827 项运行时输入与当前候选 `81d1948e` 一致；本轮产品代码未改。
- Node 22.23.3 Linux x64 归档 SHA256 为 `df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`，与此前已验签清单一致。实际客体 Node 可执行文件 SHA256 为 `fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`，与归档成员逐字节摘要一致。
- 官方 Ubuntu 22.04 索引固定为 `ubuntu@sha256:9abcaffc92a5279fff3a6a41635c0800ea33e528425fb389658806476e7defde`，显式选择 amd64。pnpm 10.33.0 文件来自既有 QA 镜像，并实际以 x64 Node 核对版本。
- 系统工具链单独缓存为本机 QA 镜像；不含应用源码、用户Docker登录配置、浏览器资料或真实凭据，不是待发布后端镜像。

最终 App 运行从创建到删除始终 `network none`，768 MiB、禁交换、半核、128 PID。pnpm 按原锁文件离线安装生产依赖，448 个包复用缓存、下载 0，安装脚本未运行。候选代码和 Node 文件由 root 持有，运行用户为 UID 998。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| 实际 Node／平台 | v22.23.3／linux／x64 |
| 原生模块 | Argon2 合成哈希正反验证、sharp 单像素 PNG 通过 |
| 应用入口 | 真实 `start-orchestrator-production.sh`，同进程 `node --import tsx .../src/index.ts` |
| 监听归属 | HTTP 31011／WS 31012 均归属同一应用 PID |
| 健康／业务请求 | 200／503，未开放业务入口 |
| 原生维护 status | 新 boot，closed、idle、无需 reconciliation |
| 关闭 | SIGTERM 后应用退出 0；writer lock、control socket、HTTP 监听均清理，journal closed |
| 资源与清理 | OOM／OOM kill 0；自有运行容器已删除并取得同 ID 不存在回执 |

模拟器下 `/proc/<pid>/exe` 是 `/run/rosetta/rosetta`。夹具检查实际命令行、root 持有的官方客体 Node 哈希及同 PID socket；没有将内核执行路径改写成 Node。记录明确保留 `kernelNodePathNative=false` 和 `nativeProductionProcessIdentityAcceptance=false`，生产原生进程身份与受保护现场绑定仍须实际核实。

## 保留的失败和限制

初次公开镜像拉取停在本任务的 Docker 凭据助手阶段；核实两个进程身份后结束本次拉取，临时空配置在同一本机 daemon 成功取得公开镜像，用户 Docker 登录配置未改。多平台索引的默认 inspect 不给出架构，平台成员 ID 又不能直接用作本机运行引用；均在 App 启动前拒绝，随后按实际 Docker 接口绑定不可变索引与 amd64 成员。

另一次准备运行因 Ubuntu 基础镜像缺少 Node PATH 而在启动前停止；修正并固化工具链后不再重复系统包准备。一轮 App 检查已启动，但原夹具将 Rosetta 内核路径误要求为 Node 路径，因此失败并保留回执，应用正常退出；按实际模拟环境修正夹具、增加客体二进制摘要校验后再次通过。上述均未修改产品源码，也未抹去原失败。

本例没有连接可用数据库／Redis，没有启用 Vault、加载真实 AWS 身份或提交真实站点任务；模型／KMS 调用、生产写入、原件与新表导出均为 0。数据库、真实服务、账号连续性、物理输入及实际费用证据继续分别验收。既有 25 次模型账本不变，追加额度未获准。PR361 保持草稿，不合并、不部署。
