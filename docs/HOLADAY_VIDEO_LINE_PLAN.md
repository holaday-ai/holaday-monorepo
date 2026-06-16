# HOLA DAY 视频线 · 全盘任务计划

> 范围:**只覆盖视频线**(通用视频 + Phase 2 三类型独立界面 + 决策血泪 + 风险)。
> A股 / Phase 0 / 模板等已收口,A股 step2 等 backlog 见 memory + 旧交接文档,本文不重复。
> 这份文档的目的:任何新 session / CC 读完,能**不靠重新讲就接上视频线**,且不再把已踩过的坑重踩。

---

## 0. 一句话总状态

视频功能正在从「对话式 AI 自动生成」**重构为「side panel 独立三类型界面」**(普通 / IP人物 / 宠物)。所有视频代码**仍停在 video 分支、未 push、`VIDEO_CREATION_ENABLED=OFF`、未部署、对线上用户零生效**。Phase 2 分三期落地,**全弄好再一起上线**(BOSS 定的节奏)。

- 活动分支:`claude/video-ae1d05`
- 视频分支最新 commit:`72cf16f`(范围2 keyText+松绑+关联性)——**注意 keyText 已决定撤回**(见 §2)
- 关键 commit 链:`77c2afe`(merge musing)→ `3636748`(入口 hunk)→ `8293ece`(前端 video_quote 卡)→ `72cf16f`(范围2)
- 生产线 = `musing-keller`(A股 step1 全链已收口);PROD LIVE REF 以 repo `docs/SESSION_STATUS.md` 顶部为准,**部署前 deploy-preflight 实读 live HEAD,且把 merge 引入的 tasks.ts +102 纳入比对**

---

## 1. 视频线全景(已做 / 在哪 / 状态)

### 1.1 通用视频(文生 / AI 自动生成画面)
- 后端 `runSimpleVideoCreation`(`agent/video/`):**已 e2e 验通**(出片/字幕不溢出/水印不乱码/aac 音轨)。
- 入口:分类器自动识别"做视频"强信号 → 两段式(Phase1 报价 awaiting_user 卡 → Phase2 `confirmVideo` 用户确认后才烧 Veo)。
- money-safety:`consumeVideoConfirm` 原子抢占防双扣(**真 MySQL 验过**:顺序 1/0、并发 winners=1);Veo 严格在抢占成功后。
- 默认档:**Veo 3.1 Fast**(手部抽帧验过,明显好过被否的 Lite extra-arm)。图源:nano banana(`gemini-3.1-flash-image`),静态、去 KenBurns。
- **结论:作为"低价值 / 随手做"的兜底保留**,不删。Phase 2 的"普通视频"类型直接复用它。

### 1.2 A 重新定位(关键结论,Phase 2 的由来)
- 多轮验证(Veo + HappyHorse 都试过)证明:**纯文生视频对"产品操作类带货"做不到"可直接用"**。根因是结构性天花板,不是某个模型问题:
  - **手部**:手-物-手特写(涂防晒等)AI 反复出多指/第三手,解剖约束压不住。
  - **产品**:带货命根子是把产品拍清楚,但 AI 画产品文字必乱码;禁产品又生成无意义怪物体(网兜怪画面)。
- 即:**种草/带货 = 需要产品+手 = AI 最烂两件事 + 我们两条约束禁的**。
- **决策:停止在通用文生上为带货打磨;高价值/精准任务转 Phase 2 独立界面。** 通用文生留给"非产品操作类"(氛围/观点/科普/风景)作兜底。

### 1.3 范围2 keyText 字卡(已决定撤回)
- `72cf16f` 实现了 keyText 信息点字卡(magenta ASS 叠层,编译期隔离不进画面 prompt)。
- 实测**负分**:字卡复读字幕("紫外线爆表"重复底部字幕)、该浮的规格(SPF50)反而漏标。
- **决策:撤回**。第一期落码时回滚 / 不启用(`72cf16f` 含此代码,属待清理)。将来真要字卡是配合非产品类重新设计、且不靠 LLM 瞎标。

---

## 2. Phase 2 · side panel 独立三类型界面(主计划)

### 形态(BOSS 已过形态稿)
- side panel 加「视频任务」入口 → 独立界面。
- 顶部三类型 tab:**普通视频 / IP人物视频 / 宠物视频**,切 tab 换下方输入区。
- 组件:prompt 输入 / 模型选择 / 风格选择 / 尺寸(竖9:16·横16:9·方1:1)/ 画质(1080P·720P)/ 时长(8s·6s)/ 价格预览(实时)/ 生成历史(复用 `tasks.list` filter `lane='video_creation'`)。
- 设计走 **HOLA DAY 自己的 magenta(`#E50B6B`)**,不照抄 Leonardo(BOSS 给的 Leonardo 截图只参考"界面要承载哪些控件")。
- 报价/确认复用已验的 video_quote 两段式 + `confirmVideo`(防双扣),不重造。

### 三类型 = 三条底层管线(界面统一,后端不同)

| 类型 | 用户输入 | 底层 | 就绪度 |
|------|---------|------|--------|
| 普通视频 | prompt + 参数 | 文生 `runSimpleVideoCreation`(已验) | **现成可复用** |
| 宠物视频 | 宠物照片 + prompt | 图生 i2v(HappyHorse i2v / 万相 i2v) | **轻接入**(同 key 同端点已探测通) |
| IP人物视频 | 文案 + 声音 + 人物视频 | fal 换口型 + Qwen 声音克隆 | **重接入**(适配器已做,缺编排) |

### 三期落地顺序(BOSS 认可)

**第一期(进行中):界面骨架 + 普通视频接通**
- 范围:side panel 视频界面 + 三类型 tab 全摆出,**只接通"普通"**;IP人物/宠物 tab 占位("即将上线",不接后端、不报错)。
- 唯一动后端结构处:**尺寸参数化**——`compose` 写死的 `DEFAULT_WIDTH/HEIGHT` 改入参(竖/横/方),veo aspectRatio 透传;模型档/质量(720/1080)/时长(6/8)入参透传。
- 模型选项接 `happyhorse`(lane 加 `videoSource='happyhorse'`,同 key 同端点改 model,verify-A 已用 overrides 跑通)。
- 风格 = optimize 系统提示加风格词引导,无新参数。
- keyText 本期不启用(已撤回)。
- **不烧 Veo**(本期是界面+接线);不 push / 不部署 / flag OFF。

**第二期:宠物视频(图生 i2v · 轻接入)**
- i2v 模型:**HappyHorse i2v(`happyhorse-1.0-i2v`)或 万相 i2v(`wan2.2-i2v-flash`)**,二者**同 intl key、同 dashscope-intl 端点**已探测通;**不必接 Hailuo**(重)。万相 i2v 可能更便宜(待控制台核价)。
- 宠物照片上传:复用现有图片上传链路(jpg/png/webp,cap 5/10MB),i2v 需图片 public URL → R2 presigned GET。
- 计价:`时长 × i2v 单价`(HappyHorse 1080P ≈ ¥1.6/s,待控制台核)。
- 宠物是**低解剖风险主体**(无手指/产品文字),用户给照片锁主体,正是 i2v 能 hold 的场景。**i2v 真实质量仍要烧片验**(BOSS 人眼),别信榜单。

**第三期:IP人物视频(真人换口型 · 重接入,单独立项)**
- **本质 = 真人 IP**:用户上传**本人正脸出镜视频**(底版)+ **本人音频**(克隆声音)+ 文案 → fal 换口型 + Qwen 配克隆音 → 真人口播片。**画面是用户实拍真人,AI 只动嘴型+配音,不凭空生成人/手** → 绕开 §1.2 那堵墙。
- **适配器已做(之前 session 完成,不重做)**:
  - fal 换口型 `fal-lipsync-client.ts`(`fal-ai/latentsync`,submit→poll,验过 COMPLETED);入参 `videoUrl`+`audioUrl`(public https,mp4/mov/webm);~$0.20/条≤40s,~2min/clip。
  - Qwen 声音克隆 `qwen-voice-clone-client.ts`(`qwen-voice-enrollment` base64 内联音频→voice_id **免费**;`qwen3-tts-vc` 合成按字符计费,验过)。
  - R2 两阶段上传(`MEDIA_ACCEPTED` 含 mp4/mov + wav/mp3/m4a,**200MB cap**,presigned PUT)。
- **缺口(为何"重")**:① onboarding 流程(怎么传/存 `qwen_voice_id`/`base_video_file_id`,目前只加了列)② 单句换口型时间轴编排(`lipSyncSegment` 没接进 lane)③ **真人正脸底版质量实测**(latentsync 对录屏/非正脸失败率高 → 必须真人正脸口播底版;**这条要烧钱实测,是真风险点**)。
- 素材复用:BOSS 选 **"默认复用上次、可重传"**。
- 计价最复杂:fal `$0.20/clip × 句数` + Qwen 合成字符 + 底版处理,单独口径。

---

## 3. 关键决策 & 血泪(防新 session 踩)

1. **IP人物 = 真人换口型,≠ 图生视频。** (Claude 本人在对话中跑偏过一次:被 Hailuo/i2v 带着误判 Phase2 是图生/换模型。)Phase2 核心是"用户的真脸真声",不是换一个文生模型。
2. **fal latentsync + Qwen3-TTS-VC 适配器已接已验**(之前 session 做的),第三期直接接、不重做。
3. **真人底版必须正脸口播**;录屏/非正脸换口型质量差(memory 血泪)。onboarding 要兜住引导。
4. **不要用 AKOOL**(数字人/换脸/TTS)——那是 OrangeBench 小程序遗留,跟现在 fal+Qwen 路线不是一套,别混。
5. **Veo 配额 = 50 RPM / 10 并发 / project 级**(非 key 级,多开 key 无用)。视频是长任务(~90s生成+轮询)。→ **视频功能天然只能低并发、异步排队上线,不可能人人随点随出**;正好配 allowlist 灰度。放量前要养 Tier(Tier2=$250+30天,Tier3=$1000+),提额走 Cloud Console 工单、审批 2-5 工作日 → **有 lead time,别等放量当天才查**。连续烧多条会撞 RPM/并发(非日额度),隔分钟级冷却即可。
6. **HappyHorse 同 intl key 同 dashscope-intl 端点已验**:t2v=`happyhorse-1.0-t2v`,i2v=`happyhorse-1.0-i2v`,改 model 字段即可调、无需单独开通。单价 720P 0.9 / 1080P 1.6 元/s(官方文章口径,**以百炼控制台为准**)。
7. **多尺寸**:已定**关键词触发口径**(用户说"横屏/方形"→分类器抽尺寸,没说默认竖屏),**限 1080p、不碰 4K**(避计费翻倍 + quoteVideo 不用大改)。三档:竖1080×1920/横1920×1080/方1080×1080。**字幕/水印/KenBurns 要按尺寸出三套布局,每档出样片人眼验**。作通用视频上线后的扩展,不在 Phase2 三期内。
8. **一致性(统一主体)**:更后单独立项。HappyHorse 参考图生视频(≤9张参考图)可能解掉之前判的"大工程",待评估。
9. **负向 prompt 在 Veo 上压不住**(prompt 写"不出现产品"仍冒出白瓶)→ 别指望负向兜底,靠正向构图 + 题材选择。
10. **AI 画字必乱码** → 想要的文字一律走可控叠加层(ASS/drawtext 字体渲染,不乱码),AI 只画场景不画字。"画面不能有任何文字"那条一刀切是过度修复,已收窄为"只禁 AI 画产品标签/瓶身乱码特写"。

---

## 4. 关键技术坐标(供 CC)

- 后端 lane:`runSimpleVideoCreation`(`agent/video/`);入参 `SimpleVideoOptions{visualMode, videoSource, veoDurationSeconds(默8), veoResolution(默1080p)}`。
- `compose`:`DEFAULT_WIDTH/HEIGHT` **写死竖屏 1080×1920**(第一期要参数化)。
- tasks.ts:video Phase1 fork(出 awaiting_user `video_quote` 卡,零 Veo)+ 独立 `confirmVideo` mutation(Veo 严格在 `consumeVideoConfirm` 抢占后);**现有 image/a-share/template fork 与 reply 零改动**。
- 报价 `quoteVideo`:`段数 × 8s × VEO_USD_PER_SEC × 7.3`(动态段数,价表+汇率硬编码带 TODO)。
- `fire-and-poll` 铁律:Veo/HappyHorse `predictLongRunning`/异步 submit→poll,绝不同步 await。
- R2 两阶段上传:`MEDIA_ACCEPTED`(mp4/mov/wav/mp3/m4a),200MB cap,presigned PUT。
- flag `VIDEO_CREATION_ENABLED` 默认 OFF;`VIDEO_CREATION_ALLOWLIST`(env.ts 已声明)。
- 生成历史:`tasks.list` filter `lane='video_creation'`,不必单独视图。

---

## 5. 验收纪律 & 铁律(继承,不可破)

- **机器验 CC 做;成片观感/手部/字幕 = BOSS + Claude 人眼。** CC 自报"成片好看/解剖完美"**不采信**(已多次把脏判干净)。Claude 用 ffmpeg 抽帧逐帧陪验。
- **花钱 gated**:每次烧 Veo/视频/克隆,BOSS 明确批数量才烧,Claude 不自作主张连烧。
- **改库 migration gated**:技能 seed、onboarding 字段等任何写库,BOSS 单独确认。
- **部署 gated**:deploy-preflight 实读 live HEAD;部署 = 单独一步、BOSS 点头;部署后 Claude 走 holaday.ai 真实产品路径复验。
- **去churn**:动 tasks.ts 等共享文件只手工最小新增、禁 `biome --write` 整文件;keyText 类隔离用编译期类型锁死。
- **隔离测试**:逻辑隔离(prod 库 + eval 专用 user + `origin='eval'` + 验完物理删)或纯 lane 零 DB;不碰 prod 真实数据、prod flag 保持 OFF。
- **儿童安全 / 合规**:A股守"客观聚合+状态判断、不给买卖建议";视频不涉,但创作内容守通用安全。

---

## 6. 当前卡点 / 下一步

- **下一步 = 发第一期指令**(界面骨架 + 普通视频接通,指令已拟)。CC 落码后 Claude 核:tasks.ts 没碰旧逻辑 / 尺寸参数化对 / 全套零回归 / 前端构建+eslint react-hooks 过;前端形态 BOSS 人眼。
- 第一期不烧 Veo、不上线。三期全接完 → 统一灰度 → BOSS-gated 部署。
- keyText 撤回属第一期附带清理项。

---

## 7. 视频相关 backlog(不在 Phase2 三期内)

- 多尺寸(关键词触发,限1080p,三套布局)——通用视频上线后扩展。
- 一致性 / 统一主体——更后单独立项(HappyHorse 参考图可能解)。
- TickFlow 数据源查证(A股相关,与视频无关,低优先)。
- A股 step2(资金连续性/行业个股对位)——A股线,待 BOSS 节奏。
