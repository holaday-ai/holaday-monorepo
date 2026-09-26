# 首次切换：已核对的站点配置样本

三个 `.conf` 是 2026-09-26 只读采集后逐份检查的 HOLADAY 站点源文件，保留原始字节，以便验证真实的 URI 重写、双栈监听、TLS 转发、静态资源与回调例外。仅含配置和公开主机名/IP/服务器路径，不包含私钥、证书内容、Cookie、环境变量或访问令牌。完整 nginx 采集、其他应用配置和数据库原始证据仍在忽略的私密 QA 目录，不纳入本目录。

| 文件 | SHA256 |
| --- | --- |
| holaday.conf | c2372d3ed03847c794e3e49501ee5890a12e9c2c876b95dfadeeee585340897f |
| hd-app.orangebench.tech.conf | 65973c9afc53c484ce7e2becbe013de3622adeb6d77723a29cefd1ef6dfcec4c |
| hd-pay.orangebench.tech.conf | ffe595e8fc106be4fc4148bc054e348dcc05d59c773efe30e7b090bdad590261 |

`describeCutoverSite` 只接受这些摘要；变更后须重新审查，不能传新摘要绕过。不把这些有限适配扩展成通用 nginx 解析器。

## 可复现验证

在已有本地镜像上执行（源码绝对路径按当前 checkout 填写）：

```sh
docker run --rm --network none \
  --mount type=bind,src=/ABSOLUTE/CHECKOUT/scripts,dst=/source,readonly \
  holaday-first-cutover-task3:qa \
  /opt/node22/bin/node /source/fixtures/browser-site-fence-linux.mjs
```

先对各原配置执行真实 `nginx -t`。合并转发测试仅调整容器内监听端口及边缘上游到 loopback；TLS 使用临时自签证书和测试 SSL include，应用服务为本地 HTTP 测试后端。测试核验两阶段 503/no-store、IPv4/IPv6、链式 TLS 验证、原始请求体/查询参数/签名头透传、精确回调和结算桥接、静态页面、未知 Host、WebSocket 新连接、reload 后生效及原文恢复。

**不证明**支付方验签或补偿、已有 WebSocket 清空、生产者/内部直连已停、生产主机完整入口覆盖，亦不证明实际进程处于对应版本；这些非 HTTP 事实在本 fixture 中是明确的模拟输入。生产 IO 必须另行采集，不得复用模拟零值。

文件层已接入 `createCutoverIngressFiles` 的真实默认 fs：容器内重建 root 启用链接 → root 配置链接 → UID501/GID50 的 release 文件；两阶段只把启用链接切换到 root 私密配置，源文件内容、inode 和归属不变。原配置备份及含绑定信息的原链接清单保存为0600，窗口/归属/源配置/链接/备份漂移会拒绝切换；恢复重新核验并还原原始链接文本，不覆盖 release 文件。原文件、备份和失败现场均保留，无自动重试/回滚。

测试仍使用模拟的批准清单、操作锁与阶段读取，以及上一段列出的非 HTTP 输入。生产主 host 尚未完成全部接线，必须另行读取受保护批准/阶段、分类完整源 inventory、持有实际互斥并观察 reload/探针。检查与 rename 不是操作系统级条件事务，不能声称抵抗恶意 root 或允许并发部署；host 必须排除其他部署写入。
