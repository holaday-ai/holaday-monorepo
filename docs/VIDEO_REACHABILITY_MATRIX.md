# 视频生成（指令 #4）· 可达性矩阵 + 落地路径建议

> **阶段：** Phase 1 = 只读可达性验证（简报/④同款铁律：先验通，再决策）。
> **本轮性质：** 零部署、零实现码、纯只读 SSH 探测 + 官方文档查证。
> **最后更新：** 2026-06-13
> **基准：** PROD LIVE REF `claude/musing-keller-ae1d05`@`1ba76bb`（restart 638；权威 ref 见 merge worktree `docs/daily/SESSION_STATUS.md` 顶部）。
> **方案原文：** `~/Downloads/1.0-HOLADAY/HOLADAY_VIDEO_GENERATION_PLAN.md`（不在 clone 内）。
> **证据来源：** ① 2026-06-13 从 Vultr `207.148.70.106` 实跑只读 curl 探测；② 阿里云/fal.ai 官方文档（文末引用）；③ 仓库代码实读。

---

## 〇、一句话结论

四个组件的**基础设施网络层全部打通**（Vultr 新加坡 → 各端点实测延迟良好，**无任何端点不通**），方案不需要为“调不通”翻案。真正卡点是三件**写操作**：(1) BOSS 开户 + 配 key；(2) 上传链路改造；(3) onboarding migration。唯一“换方案”发生在**功能层而非网络层**：CosyVoice 克隆在新加坡区被官方禁用 → **已拍板改用 Qwen3-TTS-VC**。

---

## 一、可达性主矩阵（每格可执行结论）

| # | 组件 | 网络（Vultr SG 实测） | Key | **可执行结论** |
|---|------|--------------------|-----|--------------|
| ② | **声音克隆 → Qwen3-TTS-VC**（DashScope-intl，新加坡区） | intl(SG) **48ms** ✅ | **在** ✅ | 🟢 **网络通 + key 在 + 端点可达**。已拍板 Qwen3-TTS-VC（`qwen-voice-enrollment`+`qwen3-tts-vc-2026-01-22`，新加坡区支持克隆+base64）。同账号 DASHSCOPE key 已在 intl 认证（万相 200 出图即证）。**真克隆待 onboarding 实测**（需用户语音样本）。 |
| ④ | **fal.ai LatentSync 换口型** | submit RTT **696ms** ✅ | **在** ✅ | 🟢 **网络通 + key 在 + 真调用绿（2026-06-13 充值后实测）**。一条换口型（fal 样例）：submit 200/RTT 696ms，**端到端 112.5s**（~45s 排队 + ~67s 处理 → 扩散模型 ~2min/条，**必须 fire-and-poll/webhook，绝不同步阻塞**）；产物真实 mp4 1.8MB。**$0.20/条封顶（≤40s）口径成立**（API 不内联返费，精确扣费见 dashboard/billing）；输入须公网（R2 presigned 已备）。 |
| ③ | **通义万相 B-roll**（DashScope-intl，新加坡区） | intl(SG) create **149ms** ✅ | **在** ✅ | 🟢 **网络通 + key 在 + 真调用绿（2026-06-13 实测）**。`wan2.2-t2i-flash` 一张 512²：端到端 **6.4s**，`usage.image_count=1` = **$0.025/张实测确认**（仅 SUCCEEDED 计费）；产物 PNG 存 OSS-SGP，**24h TTL**（须即转 R2）。无需 CN 中转。 |
| — | **视频上传链路** `/api/files/upload` | n/a（代码实读） | n/a | 🔴 **阻塞（需改造）**。`mp4/mov/wav/m4a` 被白名单拒（415）；上限 **10MB（pro）/5MB（basic）/0（free）**，底版视频远超；multer **memoryStorage** 整文件进内存。**R2 presigned 已具备**；onboarding 需新 migration。 |

**图例：** 🟢网络通+key在+已验 ｜ 🔴阻塞/需改造。**三外部组件 🟢全绿**；上传链路 🔴 待 Phase 1 改造。无 🟥“网络不通/换方案”格。

> **2026-06-13 真调用实测（各跑一次，累计花费 ≈ ¥1.6）：** ③万相 ✅（create 149ms / 端到端 6.4s / $0.025/张, image_count=1）。④fal ✅充值后（submit 696ms / 端到端 **112.5s** / **$0.20/条 ≤40s floor**，产物 mp4 1.8MB；扩散模型 ~2min/条 → 须 fire-and-poll，绝不同步阻塞）。②Qwen 端点+key 通，真克隆待 onboarding。**DASHSCOPE 116 长度 = ✅正常**（出图成功证实非粘错）。**三外部组件矩阵全绿**；仅上传链路待 Phase 1 改造。

---

## 二、实测数据（Vultr 新加坡 egress，2026-06-13）

- **Vultr egress = Singapore**（`207.148.70.106`，AS20473 The Constant Company，ap-southeast-1，Asia/Singapore）。
- **网络可达性 + warm TTFB（×3 稳态）：**

  | 端点 | 位置 | TTFB(warm) | HTTP | 备注 |
  |------|------|-----------|------|------|
  | `dashscope-intl.aliyuncs.com` | Singapore（ap-southeast-1 NLB） | **~45–53ms** | 401 | 同区，极快（万相 + Qwen-TTS-VC 在此） |
  | `dashscope.aliyuncs.com`（CN） | Beijing | ~390–470ms | 401 | 可达（本方案已不用 CN 区） |
  | `queue.fal.run` | US（GCP） | ~680ms | 404 | 异步队列，不在同步路径，可接受 |
  | `v3.fal.media` | CDN | ~560ms | 404 | fal 输出/存储 |

  > 注：dashscope-intl **首次冷 DNS 有过 5s 卡顿**（resolver/AAAA 超时），warm 后 A/AAAA 均 0.00s。非阻塞；落地时本地 resolver 预热即可消除首调 5s。

- **Key 存在性**（PRESENT/ABSENT，**未读取任何值/内容**）：所有视频相关 key **全部 ABSENT**（`DASHSCOPE*` / `QWEN` / `BAILIAN` / `WANX` / `FAL*`）；仅 `GEMINI_API_KEY`（#5 图片）、`STORAGE_PROVIDER`、`R2_*` PRESENT。

- **未验证、明确待补的两格**：fal.ai 与通义万相的**真实最小调用延迟 + 计费**——因 key 缺无法执行；待 BOSS 开户配 key 后补测。

---

## 三、关键决策与方案修正

### ★ 决策（BOSS 2026-06-13 拍板）：声音克隆改用 Qwen3-TTS-VC
- **原因**：DashScope **国际（新加坡）部署官方明文**——`cosyvoice-v3-plus/-flash`「**不支持 voice cloning 或 voice design**」，CosyVoice 克隆**仅北京区**。方案原写的「新加坡 + cosyvoice-v3-plus + 克隆」跑不通。
- **采纳**：Qwen3-TTS-VC（注册 `qwen-voice-enrollment` + 合成 `qwen3-tts-vc-2026-01-22`）——克隆在 `dashscope-intl`（新加坡）**被支持**，且**接受 base64 data URI**（server-only 部署免公网托管用户音频，隐私更优）。
- **弃用**：CosyVoice 北京区账号方案（需大陆实名/企业验证，京 key 与 intl key 互不通用）——**不再考虑**。
- 注：合成需复核 qwen-tts 每字单价（CosyVoice 口径 ~$0.13–0.29/万字，声纹注册免费）。

### 对方案原文的其它修正（落地前必改）
| 项 | 方案原值 | 查证后 |
|----|---------|--------|
| 换口型价 | ~$0.10/5s | `fal-ai/latentsync` **$0.20/条封顶（≤40s）**，>40s $0.005/s；高质量 `fal-ai/sync-lipsync/v2/pro` $5/min |
| B-roll model id | “通义万相”（无 id） | 钉版本 id：图 `wan2.2-t2i-flash`/`wan2.5-t2i-preview`；视频 `wan2.1-t2v-turbo`/`wan2.5-t2v-preview`（裸 `wanx`/`wanx-v1` 不可用/已弃） |
| 外部 API 输入 | 未提 | fal + CosyVoice 类**须公网 URL**（R2 `getSignedUrl` presigned 已备）；Qwen-TTS-VC 收 base64 免此 |
| 万相输出 | 未提 | 结果 URL **24h TTL**，须 `X-DashScope-Async: enable` 异步 create→poll→**即存 R2**；仅 SUCCEEDED 计费 |

---

## 四、三件待办（矩阵转绿的前置）

1. **开户 + 配 key**（BOSS 实名+绑卡，**不在 CC 范围**）—— 进度：
   - ✅ **DashScope-intl 新加坡区 key**：已开户、已配进 Vultr `.env`（CC 写入，PRESENT 确认，未重启），**万相真调用 200 出图验证 key 有效**。可跑万相 + Qwen3-TTS-VC。
   - ✅ **fal.ai key**：已开户、充值、配进 `.env`、**真调用绿**（submit 696ms / 端到端 112.5s / $0.20 ≤40s floor，产物 mp4 1.8MB）。
   - ✅ 三外部组件全部实测通过；下一步 = 上传链路改造 + onboarding migration（Phase 1 实现，待拍板进场）。

2. **【Phase 1 实现，矩阵全绿后】上传链路改造**：
   - 白名单加 `video/mp4`·`video/quicktime`·`audio/wav`·`audio/mpeg`·`audio/m4a`（含 SPA `accept`）。
   - 上限自 10MB 提至 ~200MB 级；改 **直传 R2 presigned-PUT**，绕开 multer memoryStorage 内存上限。

3. **【Phase 1 实现，矩阵全绿后】onboarding migration**：
   - `users` 加 `qwen_voice_id`（克隆音色 id）+ 底版视频引用列（现仅 `avatar_url`）。

> 第 2、3 项现**不动**；待 BOSS 配 key、两格补测、矩阵全绿后进 Phase 1 实现。

---

## 五、引用（官方文档）

- CosyVoice/Qwen-TTS-VC 克隆与地域：
  `alibabacloud.com/help/en/model-studio/cosyvoice-clone-design-api`、`/qwen-tts-voice-cloning`、`/regions/`
- 通义万相 图/视频 API + 定价：
  `alibabacloud.com/help/en/model-studio/text-to-image-v2-api-reference`、`/text-to-video-api-reference`、`/model-pricing`
- fal.ai LatentSync/队列/鉴权：
  `fal.ai/models/fal-ai/latentsync/api`、`fal.ai/docs/model-endpoints/queue`、`fal.ai/docs/reference/platform-apis/authentication`
- 仓库代码：`apps/orchestrator/src/files/file-service.ts`（白名单/上限）、`.../storage-provider.ts`（R2 presigned）、`apps/orchestrator/src/http.ts`（上传路由）、`apps/web-workbench/src/components/InputArea.tsx`（SPA accept）。
