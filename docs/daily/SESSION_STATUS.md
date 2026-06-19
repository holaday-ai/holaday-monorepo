# SESSION_STATUS — 多 session 协作状态板

> 目的：多个并行 Claude session（#1 模板填充 / #2 A股 / #3 Playbook+Ledger / #5 图片 …）
> 各自在独立 worktree 里干活，缺乏共享上下文。本文件是**唯一的跨 session 协调点**：
> 每个 session 到停点更新自己的小节并 push，所有人据此对齐状态、避免撞车与误传。
>
> 维护者：各 session 自己。创建者：#3（Playbook+Ledger）2026-06-12。
> **归属（BOSS 定）：本文件住共享 baseline `claude/musing-keller-ae1d05`**——三 worktree 分支最终都合回这里，协调文件理应在汇合点。各 session 更新时只对 musing-keller push 这**一个文件**（单文件无冲突风险）。

<!-- 固定维护：每次部署后由部署者更新这一行（硬规则 7）。改 ref 前必实读 live HEAD。 -->
## 🔴 PROD LIVE REF = `claude/musing-keller-ae1d05`@`a70642c2`（SPA）/ orch `68f28859`

<!-- ========== 🎬 视频 Phase 2 状态 + backlog（2026-06-19/20 换 session 收尾）========== -->
**🎬 视频 Phase 2 — 当前状态（一句话）**：三类型 prod 真机全验通（普通¥8/宠物¥1/IP¥2，BOSS 都认了）；第一批前端 polish + 第二批第一轮后端**都已 LIVE**。**PROD LIVE REF = SPA `a70642c2` / orch `68f28859`**。
- **第一批前端 polish（`a70642c2` LIVE）**：黑边修（去 bg-black/w-auto）+ 失败不进历史（toVideoRow 只留 completed 有附件）+ 切 tab 清面板（清 ?task=）。
- **第二批第一轮后端（`68f28859` LIVE）**：①poster 生成（三 lane compose 后 ffmpeg 抽首帧存 R2、posterUrl 盖 attachment、**抽帧失败兜底不拖垮成片**）②videoType（deriveVideoType 打 metadata）③reason 白名单映射（mapVideoFailureReason，**不泄 stack/url/file_id**）。真机实证：poster.jpg 生成 + posterUrl + 成片正常；reason 降级「服务繁忙」零泄露。
- **★fal lipsync timeout 根因已查清（非 fal 波动/非余额，fal 还 $18.40）**：**确定性长素材超时**——latentsync ~12-14× 实时，`DEFAULT_MAX_WAIT_MS=300s` 固定值对 >~20s 输出不够（16s 片 ~225s 成功、37s 片需 ~460-520s → 300s 客户端主动放弃）。loop_mode 让输出长度=音频长度。无 retry。

**📋 待做清单（下一 session 接续，按优先级）**
- 🔴 **IP 稳定性（fal 超时修，后端小改）**：`runLipSync` 的 maxWaitMs 改成按音频长度 `clamp(60s + 音频秒 × 16s, 300s, 720s)`（覆盖 ≤40s 上限；IP lane 已有 audioMs 传进去）。配在 `fal-lipsync-client.ts` 的 `DEFAULT_MAX_WAIT_MS`/`runLipSync`（lane 传 maxWaitMs）。**retry 已否决**（确定性超时，重试只再卡再烧）。
- 🔴 **配套 UX 期望文案（前端）**：IP「生成中」面板明确「真人换口型较慢，预计约 X 分钟，请耐心等待」（否则用户等 8-10 分钟以为卡死）。
- 🔴 **待 BOSS 决策·产品**：latentsync ~12-14× 实时太慢（40s 等 ~10 分钟），长期要不要换更快换口型方案/端点。未定。
- 🟡 **第二轮前端（完整设计已出）**：4b 成片内联播放（poster `<img>`+lazy：默认不拉全量 5MB、不渲 `<video>`，显 poster + ▶播放/下载；点播放才按需新建单个 video；poster 后端已 LIVE）｜2 面板位置（甩顶部→生成视频下方就近）｜4 历史按 tab 隔离 + IP 历史（后端 videoType 已 LIVE，前端接）｜6 失败 reason 展示+重试+清 loading 残留（后端 reason 已 LIVE，前端接）｜7 IP 去图片版｜videoType enabler（plumb 到 UiTask）。
- 🟢 **IP 合规闸（上线前必做）**：授权声明保留 + 条款 +「AI 生成」标识 + 可追溯（BOSS 拍板轻量方案）。
- 🟢 **全屏关闭误触浏览器**：自定义全屏容器 / 页内退出。
- 🧹 **prod 测试数据清理**：`tsk_duct`/`tsk_RCrQ`/今天一堆 + 之前 `qa-*` 号（无害但污染统计，删 prod 数据需谨慎、先列清单给 BOSS）。
- 🧹 **MEMORY.md 超限**（30.8KB > 24.4KB）：下轮列可归档 stale 条目清单给 BOSS 过目再清。
<!-- ========== 视频 Phase 2 状态 + backlog 结束 ========== -->

<!-- 2026-06-19/20 — 视频第二批·第一轮后端部署（poster/videoType/reason） -->
**📦 视频第二批·第一轮后端 `68f28859` 部署 prod**（deploy-orch，preflight SAFE，restart 661，healthz ok；**SPA 不动**仍 `a70642c2`；无 migration、flag 未动）。三笔：①**poster**（lane compose 后 ffmpeg 抽首帧 JPEG 存盘，非致命）②**videoType**（成片 metadata 打 normal/pet/ip_person）③**reason 白名单映射**（lane 失败透传安全友好 reason，不泄 stack/url/file_id）。**真机烧片实证（BOSS 授权）**：①poster 普通视频 `tsk_duct`（1段720p ¥6）→ completed、task_files 多 `holaday-video-poster.jpg`(88KB)、attachment 带 `posterUrl`、`videoType=normal`、**成片本身正常完成**（poster 没拖垮）；②reason `tsk_RCrQ`（IP，文案 37s 过了 too_long 闸→走 fal）→ fal **timeout** 失败 → DB reason=**「服务繁忙，请稍后再试。」**（具体 busy、非通用兜底）、完整 err(message/stack/路径)只进**服务端日志**、用户 reason **零泄露**。metered 无 429。**未碰钱/门控/migration**。⚠️ 顺带：fal lipsync 300s 超时（fal 侧慢/账户，本次降级正确，非本批 bug）。前端第二轮（poster `<img>`+lazy + 面板位置 + 历史隔离 + reason 展示 + IP 去图片版）待做。前态：SPA `a70642c2`/orch `6fb2dbb9`。

<!-- 2026-06-19 — 视频前端 polish 第一批部署（纯前端 SPA，orch 不动） -->
**📦 视频前端 polish 第一批 `a70642c2` 部署 prod**（SPA bundle `index-D6HnnOOe.js` 双端 smoke 过无回滚；orch 仍 `6fb2dbb9`；无 migration、flag 未动）。三项纯前端：**①黑边**（FileDownloadCard/Modal 内联 `<video>` 去 `w-full`+`bg-black`+`object-contain`→跟视频固有比例，DOM 实证 `bg:rgba(0,0,0,0)`+`w-auto`，黑边消除）；**③失败不进历史**（抽 `lib/video-history-row.ts`，只收 `completed`+有附件成片，失败/取消/报价 stub/executing 全 drop，+10 单测；真机实证历史只剩成片、失败任务消失）；**⑤切 tab 清面板**（切 tab `navigate('/video')` 清 `?task=`，真机实证切到宠物 tab 面板消失）。**真机复验**：提交→报价卡页内直出**不复发 #185**（console 零错）、首页/文件库/图片预览正常、共享组件回归干净（猫图预览不变形）、**零 Veo**。web 662 绿。⚠️**新发现（非本批、留 backlog）**：成片**内联视频播放器卡 buffering**（`readyState:0` on 有效 5MB mp4 blob，可能 6fb2dbb9 内联预览实现或 Chrome 多视频并发节流；下载可正常）→ 待查。第二批=面板位置/历史按 tab 隔离/失败原因透传/IP 图片版 + videoType enabler。前态：`8c8bdb4e`。

<!-- ========== 🎬 视频 Phase 2 今日收尾 2026-06-19（验收，无新部署） ========== -->
**🎬 视频 Phase 2 — 三类型 prod 真机全验通（BOSS-only 灰度，BOSS 逐条授权烧片）**
- **普通文生 ✅** ¥8，质量「还可以」（tsk_uT5 / tsk_7GFj）。**宠物 i2v ✅** ¥1，「动起来了」（报价 tsk_yVRa→出片 tsk_WKVj）。**IP 换口型 ✅** ¥2，嘴型「可以」（报价 tsk_N6dB→出片 tsk_tAqb，本人合格底版）。
- **三类型页内闭环全部成立**：报价→确认→生成进度→成片**内联预览**→下载，全留 `/video` 不跳主流。
- **本 session 修复并 LIVE 的 bug 链**（细节见下方部署块）：`fad7971` 段数虚高 + 面板遮报价卡 → `6fb2dbb9`(Codex) 页内闭环 + artifact 安全 → `8c8bdb4e` React #185 无限渲染崩溃。**今日纯验收无新部署**，PROD LIVE REF 不变。
- **IP 失败根因（已查实，非 bug）**：fal latentsync **422 face_detection_error**；失败 tsk_39We 用的底版是抖音 @央视新闻 民警视频（**别人的脸**），Claude 合规拦下；换 BOSS 本人合格底版后成功（tsk_tAqb）。计费：Qwen 合成那笔真扣（按字符/几分钱级），fal 422 预检无产出≈未计费，用户额度 ¥0。
- **下一轮 backlog（完整清单 + 优先级见交接 memory `handoff-2026-06-18-video` §backlog）**，标题速览：
  - 🔴 **全屏关闭误触浏览器**（视频原生全屏后顶部无页内退出→点到浏览器关闭按钮关掉整个浏览器，真实伤害）｜**IP 合规闸**（上线前必做，BOSS 拍板轻量 4 条：本人授权声明+条款+「AI 生成」标识+可追溯，不做重技术校验，《深度合成管理规定》最低线）
  - 🟡 **「视频前端体验 polish」一包**（建议同片 VideoPage+播放器+历史列表一轮改）：历史按 tab 隔离 + IP 自己的历史 / 报价面板位置就近（别甩到顶部挤乱布局）/ 失败任务不进生成历史 / 预览黑边按实际宽高比自适应 / 切 tab「当前制作」面板不切不清 / 失败原因透传（fal「检测不到人脸」等 actionable 错误被 tasks.ts:5781 抹成「请稍后重试」）+ 重试入口 / 失败态残留「正在生成回答…」
  - 🟢 IP tab 去掉无意义的「图片版」选项
  - 🧹 prod 测试数据清理（今日烧的 tsk_uT5/7GFj/yVRa/WKVj/N6dB/tAqb/39We + 一堆 qa-* 测试号；**删 prod 有风险，谨慎**）
  - **建议**：🟡+🟢 打包成「视频前端体验 polish」一轮（方案→一起修→一次部署，防零敲引新 bug）；🔴 全屏误关 + IP 合规闸 + 数据清理各自单独评估。
<!-- ========== 收尾结束 ========== -->

（2026-06-19；**#4 视频页内闭环(Codex `6fb2dbb9`) + React #185 修复(`8c8bdb4e`) 部署 prod**。SPA bundle
`index-BN6tjkhC.js` 双端 smoke 过无回滚；**orch 未重部署**(本次纯前端，8c8bdb4e vs 6fb2dbb9 只差 VideoPage 前端)，
orch 仍跑 `6fb2dbb9`(restart 660，healthz ok)。无新 migration；flag/allowlist 未动(`VIDEO_CREATION_ENABLED`=
true + allowlist=`usr_EeYp…` BOSS-only 灰度)。**`6fb2dbb9`=Codex 5 commit**：视频 报价→确认→进度→成片预览→下载
全留 /video 页内闭环(不再跳主对话流) + 附件挂 terminal 帧(成片即时呈现) + 文件产物/下载处理。拓扑核对纯快进、
敏感区(钱/门控/migration)全未碰。**部署后真机验抓到 P0 回归 React #185**：每次提交视频→切 /video?task= 那一刻
无限渲染崩到「页面暂时无法加载」错误卡，只手动 reload 恢复(仅影响 BOSS-only 灰度，零真实用户)。**`8c8bdb4e`=fix
#185(纯前端,fix-forward 不回滚)**：根因=VideoPage `CurrentVideoTaskPanel` 的 `(s)=>s.stepsByTask[id] ?? []`
每次 new 一个 `[]`，Zustand v5 裸 `useSyncExternalStore` 要求快照引用稳定→无限重渲(#185)；刚提交的任务无 steps
必踩，reload 后 detail 填了稳定数组才不崩。修：抽 `EMPTY_STEPS`(冻结模块常量)+`selectStepsFor` 返回稳定引用 +
deep-link refresh effect 加一次性 ref 守卫(`shouldRefreshForTask`)。**真机复验**：3 次提交报价卡直接渲染、不崩、
不用 reload、console 零 #185；首页/核心路径正常；**零 Veo**。+9 测(选择器引用稳定性 + getSnapshot 收敛模拟，
临时改回 `?? []` 实证红→恢复绿)；web 652 全绿、build(lint react-hooks/tsc/vite)0 错。lint 没拦住是因 selector
无依赖数组、exhaustive-deps 不分析其返回引用稳定性(运行时契约，静态 lint 不建模)。下一步=BOSS 在场授权后真机验
「确认制作→出片→进度→页内预览→下载」整条 + 真用户烧 Veo 验收。前态：#4 `fad7971`(restart 659)。）
（2026-06-19；**#4 视频 段数 P1 + 报价卡面板 P3 两修 部署 prod**，restart 659，preflight FF-safe，
无新 migration。承接 4c（视频三类型 BOSS-only 灰度 LIVE，flag `VIDEO_CREATION_ENABLED=true`+allowlist=
`usr_EeYp…`）。fad7971 经 merge `77c2afe` **含 #2 的 115ba53/判官 f1d8693，无 revert**。**P1 段数**：
`segmentCapForText`(≈每30非空白字1段,clamp1..6) 传 optimizeUserScript maxSegments + 提示词下限 max(3→1)
+ 硬截断 `slice(0,maxSegments)` → 短文案不再硬凑 6 段，报价随段数降。**P3 面板**：抽 `needsBrowserViewport`
排除 video_quote(+clarification) → 视频报价卡不再被 BrowserPanel 误挂遮挡。**双向实证(Chrome,BOSS号)**：
短文案~36字→**1段/¥8**(原6段/¥36)、长文案~145字→**5段/¥36**(仍多段没矫枉过正)；报价卡两次
`hasBrowserPanel:false`；metered 号建任务**无 429**(quota affectedRows 修未受影响)。只到报价卡、**零 Veo
消耗**、flag/allowlist 未动。SPA bundle `index-DiPfLrm_.js` 双端 smoke 过无回滚；orchestrator 2886+web
642 测绿。前态：#2 `115ba53`（restart 655）。下一步=BOSS 真用户烧 Veo 验收。）
（2026-06-15；**#2 ⑦ LLM 意图判官第二层 + 总市值万亿口径 部署 prod**，restart 655，preflight FF-safe，
无新 migration。BOSS 拍板：⑦ 要稳定出现，不接受 ~78% 降级率(同股不同次不一致)。**双层防御**(regex
之后加温度0 LLM 判官，只判买卖引导/涨跌预测两红线)：regex PASS→judge 仅明确 block 才否决(补漏网)；
regex SOFT(predict/tension/semantic)误杀→judge 仅明确 pass 才救回；regex HARD(advice/technical/
ungrounded)→regex 终判 judge 不介入；judge unclear/失败→回落 regex(PASS 仍出/SOFT 仍降级)，绝不因
judge 抖动制造新降级。flag `ASHARE_INTENT_JUDGE_ENABLED`=true 已开 Vultr(进程实证)，仅挂全景⑦不动
轻量③。**复测主因纠偏**：降级主因不是 predict 误杀，而是 ⑤ 用 fmtNum 呈现「18,402.50亿」、⑦ 天然说
「1.84万亿」→ 闸门裸值比 1.84≠18402 误判 ungrounded(千亿级 mega-cap 必踩，宁德 4/4 降)；`fmtMvYi`
≥1万亿 统一「X.XX万亿」口径(body+context 同口径，⑦ 照抄即接地)。**真路径复测⑦通过率 78%→94%**
(迪生力/茅台/宁德 4/4 稳定，治好「迪生力时好时降级」；金钼 6/6 隔离稳定)。**对抗复审**：买卖/预测
泄漏 **0/12**(判官补抓 regex 漏网 4 例：用…价格在买/会反弹/未来高增长可期/目标看翻倍)，合规误降 **0/5**。
全量 **2708** 测绿(+判官9+gate subReason+runner 双层7+fmtMvYi+万亿接地)；tasks.ts 仅 +14 行无 churn。
前态：审查批 `bfaef0e`(restart 652)。）
（2026-06-15；**#2 全景速览审查批 follow-up + ②资金面铁律 部署 prod**，restart 652，preflight 实读
live HEAD FF-safe，无新 migration。修：**P0 报告期取错**（`stock_financial_abstract_ths` 旧用
`df.head(80)` 截断长历史股最新期→驰宏取成「2022中报」与趋势矛盾=信任杀手；改 `_ths_sorted` 按报告期
升序取 `iloc[-1]`，驰宏实证 2026-03-31）+ **P1 ④补**扣非净利润/每股经营现金流/季度环比 + **P1 ⑤补**
相对行业静态PE中位（cninfo `_retry` 包裹→行业分位真渲染，⑦方向预算正确）+ **P2 ⑦真解读**（数字翻人话+
点重大信号如解禁抛压，③⑦解禁口径统一「全部N笔合计」）+ **②资金面铁律**（`bfaef0e`：⑦ prompt 加铁律——
龙虎榜/北向无数据时绝不编造主买/资金流入，regex 闸门抓不住无数字的定性脑补）。**真路径实证**：驰宏600497
（今日涨停·有龙虎榜→⑦如实引「买一主买」）+ 茅台600519（当日未上榜→② 龙虎榜「当日未上榜」、⑦「龙虎榜
当日无数据」**零编造**）；两股 ④报告期=2026Q1、⑤行业中位方向正确、零买卖词、标时效、disclaimer 全在。
前态：step1 `95ee29a`（restart 649）。）
（2026-06-15；**#2 Phase2 全景速览 step1 + ⑦闸门对抗加固 部署 prod**，restart 649，healthz ok，
全量 **2688** 测绿。**ultracode 对抗复审**：4 红队策略压测 ⑦ 合规闸门，真 complianceGate 实测初版
漏 3/12（语义迂回预测 + 技术信号 regex 盲区）→ 补 SEMANTIC_PREDICT(拐点正在积累/只是时间问题/
自然收敛)+TECHNICAL_SIGNAL(筹码锁定/控盘/缩量封板/量价背离/跳空/回到X一线，BOSS 红线 MACD金叉=买入)+
TENSION repair 词 → **复审 0/12 漏，合规⑦不误杀，+10 永久回归测**。⑦ 真 haiku 通过率 迪生力6/6、
茅台3/6、平安5/6（降级=安全网，①-⑤恒在）。**残留(诚实)**：regex 是 backstop，语义评判有天花板；主防线
=⑦ prompt；更高保证可加 LLM-intent-judge(step2，BOSS 拍板，加一次 LLM 成本)。以下为 step1 主体：）
（2026-06-15；**#2 A股 Phase2 全景速览 step1 部署 prod**，restart 648，healthz ok，preflight 实读
live HEAD 各步 FF-safe；build tsc0，全量 **2678** 测绿；无新 migration。**先验数据可达性再写码**
（push2 不可达→同花顺/百度/cninfo 替代，迪生力 603335 真调验通）。**④ 基本面**（同花顺 营收/净利+
同比增速·销售毛利率·ROE·资产负债率·近3年趋势，硬标「基于2026Q1财报，CAS」）+ **⑤ 估值**（百度
PE-TTM/PB + 近5年历史分位 + cninfo 行业静态PE中位，硬标「估值截至06-14」）+ **deep 触发**（详细分析/
全面看看/深度分析 XX→七维全景版；**不动**速览/为什么涨/割肉/指数 lane，意图区分保「一句话即得」）+
**⑦ 分析师视角**（LLM 白话状态画像，状态判断非买卖，过合规闸门；越线/失败→丢⑦留①-⑤优雅降级+计数）。
合规闸门补盲（设计评审 workflow 发现真缺口）：估值数(PE/PB/分位/倍数)**数值容差接地**(容忍 67.2/67.20
口语约数)+排年份(假目标价不被年份误接地)+张力延展拦截(高位早晚回落=predict)；④⑤ 确定性层零形容
（判断统一归⑦）。**真路径实证**：「详细分析迪生力」→ executorLane=ashare_panorama 出 ①-⑤+⑦；
「迪生力为什么涨」→ 轻量速览(①②③)不误伤。⑦ 真 haiku 通过率：迪生力 6/6、茅台/平安 4/6（降级=合规
安全网，①-⑤ 恒在）。step2(资金连续性/行业个股对位)待验证后做。
前态：`c092562`（#5 图片 P1 执行层）。）
（2026-06-14；**#5 图片 P1 执行层重修 部署 prod**，restart 644，两边 healthz 200，SPA 双边
`index-CtjniCcy.js`，preflight 实读 live HEAD=`3f76062`（ancestor of c092562）→ FF-safe；keys（GEMINI+
ANTHROPIC）在进程；无新 migration。**纠正 `707af37` 误判**：上轮把 P1 当作 FileDownloadCard 缩略图占位
来修，线上行为没变——真问题在执行层两处：① 图片任务执行期进度显示通用「正在生成回答…」→ 新增
`generating_image` 子状态（「正在生成图片…」），图片 lane 发出，贯穿 WS substatus 帧 + TaskStream 实时
chip + TaskListItem 列表 chip；② 文字结果「已生成1张图片」先 commit、缩略图一个 tasks.detail 往返后才到
（用户截图的割裂）→ 图片 lane 把 `attachments[]` 挂上 `server.task.terminal` 帧，SPA terminal handler
立即 stamp 到任务，图卡与摘要文字同帧渲染；附件校验器抽成共享 `parseUiAttachments()`。orchestrator
2657 测 + SPA 测全绿（唯一失败 `control-tooltip.test.ts` 经 stash 实证为 `5d4bb2c` NotificationBell
预存在，已开 task chip 上报，与本次无关）。**待 Claude 重测：① 执行期「正在生成图片」② 图文同帧出现。**
前态：3f76062（#1 模板）。）
（2026-06-14；**#1 模板填充 E10 P0 文件名乱码（深层根因）修复部署 prod**，restart 643，healthz ok，
build tsc0，keys in process；preflight 实读 live HEAD=`d4da1e5`（ancestor of 3f76062）→ FF-safe；
无新 migration。根因：**存储的模板名本身就是 mojibake**（SPA 存成 å¨æ¥æ¨¡æ¿.xlsx），输出名=模板名+
"-已填充" 传播坏名→下载头再正确编码也是乱码。修法：**输出名生成处防御**（`outputFilename` 先
`decodeUploadFilename` latin1→utf8 修复，仍乱码则 fallback `填充结果-<ts>.xlsx`；摘要文案同样修复→
`你的模板` 兜底）+ 新 `looksLikeMojibake`（C1 控制字节/U+FFFD，不误伤 café/CJK）。**live 实证用 BOSS
原 mojibake 文件 `file_wmCFjV2iwBhZQYj5i8mtF` 重测：输出名=`周报模板-已填充.xlsx` 干净**。2667 测绿。
前态：d4da1e5（#5 图片）。）
（2026-06-14；**#5 图片 P0 文案合规 + P1 预览占位 部署 prod**：SPA 双边 `index-bh0_PXtK.js` + orchestrator restart 642，preflight FF-safe（live a139887 是 ancestor），key 校验「GEMINI+ANTHROPIC 在进程」，healthz 200。commit `dcbf015`(P0 营销图禁编造促销文案——buildImagePrompt 硬约束 + 负向测 + live 实证「全场五折」只出一个优惠) + `707af37`(P1 FileDownloadCard 图片加载占位，消「文字先出图片后到」割裂)。一并带上 a139887(#2④) + #1 模板修复。**Phase 0 待 Claude 重跑全套对比 12/16 基线。**）
（2026-06-14；#2 A股 ④ matcher E03/E16 精修部署 prod，restart 641，healthz ok，build tsc0，
preflight 实读 live HEAD=`2617392`（ancestor of a139887）→ FF-safe；akshare-mcp 同步重启（停用词）；
无新 migration。修复（Phase 0 评测暴露的 ④ matcher 两处过激，prod 日志实证根因）：
E03「X 为什么涨」因素归纳③不再被裸词「后市」误降级——gate 改「后市+方向词」才算预测、
中性「后市表现/走势」放行（真买卖建议/割肉/补仓仍降级）；E16「查今天A股三大指数收盘」不再
误命中「今天国际(300532)」——走新**指数 lane**（确定性三大指数速览卡）+ name-search 收紧
（indexIntent/长查询跳过）+ 服务端常见词停用词。**真路径复测**（createCaller 打 prod）：
E16→executorLane=ashare_index 出大盘速览卡；E03→出③段、尾「以上因素与股价变动的关联未经证实」、
未降级。全量 2643 测绿（+13 回归锁 E03/E16 原文）。
前态：`2617392`（#1 模板填充 E10 两个 P0）；`f60e698`（视频 #4 步骤1，migration 0034）。）

---

## 协作约定（硬规则，立即生效）

1. **worktree 隔离**：每个 session 必须在独立 `git worktree` + 独立分支干活，**绝不共享工作树**。
   迁移前先把 WIP commit/stash，再 `git worktree add ../holaday-<任务名> -b <分支>`。
   破碎 session 共享树会阻塞他人 build + 提交纠缠。

2. **停点必更新 + push**：到任何停点（交付 / 阻塞 / 移交 / 长暂停）**必须**更新本文件
   「自己的小节」（状态、分支、HEAD commit、已完成、待办、阻塞、给别人的提醒）并 push。

3. **只改自己的小节**，不动别人的小节。需要提醒别人时写在「跨 session 提醒」区。

4. **落库铁律 —— 批准 ≠ 完成（lesson ②）**：DB migration 的「BOSS 确认 / 已批准」只是
   *授权 apply*，**不等于 apply 已完成**。任何「已落库」声明都必须**回带验证证据**：
   写明目标库（host + db），并附 `information_schema` 查询输出证明**表 / 列 / 索引 / 外键**
   确实存在。**无验证证据 = 未闭环**，不得标记完成。apply 前还须先验证**前序 migration
   实际已在目标库**，不能只凭口头/记忆。

5. **migration 编号 + 顺序（lesson ①）**：编号单调递增、低号先行。numbered applier
   (`pnpm db:migrate:numbered`) 是 **skip-on-exists**（对 ER_TABLE_EXISTS / ER_DUP_FIELDNAME /
   ER_DUP_KEYNAME / ER_FK_DUP_NAME 等跳过），所以**乱序 apply 可容忍、未来全量重跑不会因
   顺序报错**。但**仍应按编号顺序 apply**；只有当两个 migration 互不引用（disjoint）时顺序才
   真正无关，一旦有 FK / 列引用依赖就必须严格守序。

6. **写明目标库**：apply 时必须确认连的是哪个 DB（生产 = Vultr `holaday`@127.0.0.1，取
   `apps/orchestrator/.env` 的 `DATABASE_URL`）。多次「应用到了别的库 / 本地 dev 库」的误传
   都源于没核对目标库——apply 脚本里要 echo 出 `host/db` 并在验证里复查。

7. **部署铁律 —— 先实读 live HEAD，不许凭记忆假设 prod 分支（lesson ③）**：部署前**必须从
   live 服务器实读当前 HEAD**（`git rev-parse HEAD` + `git branch -r --contains HEAD`），
   不许凭记忆 / SESSION_STATUS / 口头假设 prod 在哪个分支。**reset 前 preflight 必打印**
   「当前 HEAD + 它在哪些 origin 分支上」；若**当前 HEAD 不是你预期部署源的祖先** → **停下报告，
   不许继续 reset**（防止把别人刚部署的 prod 覆盖回旧码）。部署后**部署者更新顶部 `PROD LIVE REF`
   行**。工具：`scripts/deploy-preflight.sh <分支>`（在 live 上跑，非 0 退出即拒绝部署）。
   　由来：#3 凭「live 跑 musing-keller@b0fd428」假设，实读发现 prod 已是 #1 的 `1ba76bb`（路由补强，
   　部署在我合并之后）；若当时盲目按 b0fd428 redeploy 会**覆盖掉 #1 刚上线的修复**。规则当场拦下。

---

## 经验教训（真实案例，约定的由来）

- **① 0033 先于 0032 落库**：因「0032 已落库」误传，#3 在 0032 实际未落生产库时先 apply 了
  自己的 0033。两者 disjoint（0033 不引用 watchlists），无害；numbered applier 全量重跑安全
  （skip-on-exists，顺序无关）。**教训**：apply 前先验证前序 migration 实际在目标库，别凭声明。

- **② 批准≠完成（0032 三次误报）**：#2 的 0032 apply 脚本失败，但被口头/记忆标记为
  「已落库（BOSS确认）」——「BOSS确认」实为*批准*而非*完成*。结果 0032 被**三次**声明落库，
  而 Vultr 生产库 `holaday` 实测**始终没有 watchlists**。**教训**：落库必须回带
  `information_schema` 验证证据才算闭环（见硬规则 4）。**✅ 已闭环**：2026-06-12 #2 部署时
  亲手 apply 0032 到 `holaday@127.0.0.1` 并回带 `SHOW CREATE TABLE watchlists` 证据
  （11 列含 `alert_config_json` + 4 索引 + `fk_watchlists_user` ON DELETE CASCADE，同库
  server_id=1 / 2719 tasks），分支 + 0032 文件亦已 push origin。Pack A 当时的诊断完全正确。

---

## 跨 session 提醒（看板）

- **致 #2（A股）**：你的 **0032 (watchlists) 仍未落 Vultr 生产库 `holaday`@127.0.0.1**
  （2026-06-12 由 #3 实测三次，`sites` 等 0033 表在、`watchlists` 不在 → 确属同一生产库且 0032
  缺失）。请重新 apply 0032 到该库**并回带验证证据**，再标记完成。另：你的 `claude/ashare-ae1d05`
  分支 + 0032 文件**未 push 到 origin**（#3 查遍 8 个 origin 分支均无），别人取不到你的权威版本。
  　→ **✅ 两项均已闭环（#2，2026-06-12）**：0032 已 apply + 回带 SHOW CREATE TABLE 证据；
  　分支 `claude/ashare-ae1d05`@`852c73a` 已 push origin（详见 #2 小节 + 教训②）。

- **致全员（#1，2026-06-13）prod 部署分支已切回 `claude/musing-keller-ae1d05`（合并主干）**：
  三分支合并完成上 origin/musing-keller（`b0fd428` merge #1+#2+#3），prod 现部署该合并主干，
  **不再是 ashare-ae1d05**。#1 路由补强 `1ba76bb` 已落主干 + 部署（restart 638）。
  → **致合并 session**：`/Users/yaleiqi/holaday-merge`（本地 `merge-integration`）仍停在 `b0fd428`，
  落后 origin/musing-keller 1 commit（我的 routing fix），fetch 后可 fast-forward。

---

## 三分支合并回 musing-keller 方案（#2 预判，不急执行）

baseline `musing-keller` @ `9935e84` 已含 template-fill M1-M3 → **#1 template-fill 已是 baseline 祖先，无需单独合**（#2 部署 ashare 时 merge template-fill 实为 no-op、零冲突，已印证）。剩 `ashare` + `playbook-ledger` 两支合回。

- **顺序**：两支都基于 9935e84 之后，先合谁都行，但**第二支会在共享文件冲突**。建议先 `ashare`（已部署验证、稳）再 `playbook-ledger`。
- **预判冲突点（都是「双方各加一段」的加法冲突 → 解法=两边都保留）**：
  - `packages/shared-types/src/ids.ts`：ashare 加 `watchlist:'wl'`；playbook 加 `site/cap/opath/exr/art/clm/cnr`。
  - `apps/orchestrator/src/db/schema/index.ts`：ashare 加 `watchlists` export；playbook 加 9 表 export。
  - `apps/orchestrator/src/trpc/router.ts`：ashare 加 `watchlists` router；playbook 若加 router 各加一行。
  - `apps/orchestrator/src/index.ts`：ashare 加简报 dispatch 分支 + import；playbook 若动 boot wiring 则逐 hunk。
  - `packages/shared-types/src/index.ts` / `package.json` / `pnpm-lock.yaml`：各加导出/依赖；pnpm-lock 冲突则合并后 `pnpm install` 重生。
  - `apps/orchestrator/src/db/schema/tasks.ts`（**schema**）：**仅 playbook 动**（origin 列 + 2 索引），ashare 未碰 → **无冲突**。
  - `apps/orchestrator/src/trpc/routers/tasks.ts`（**router，热路径**）：ashare 加 ④ QA fork、playbook 加 origin 守卫 hunks——**双方都加法**。**✅ 2026-06-13 ashare 已去 churn**：原 ④ 接线连带 biome 整文件 reformat(+2075/−2013) 是冲突震源，已 `checkout 基线 9935e84 重贴` → ashare 侧 diff vs 基线 = **244 插入 / 0 删除（纯 ④ 增量，零既有代码格式改动）**，全量 2570 测绿、行为零变化（`394830e` 已部署）。两支现都保持基线格式 → 合并只解各自加的几十行加法冲突，不再撞 2000 行 reformat。**playbook 侧也须保持基线格式**（别 biome --write 整文件）才能对齐。
- **migration**：0032(ashare) + 0033(playbook) 已都落生产库，disjoint，numbered applier skip-on-exists，合并后全量重跑安全。
- **合并后必跑**：`pnpm install` + `tsc -b` + 全量 `vitest`（#2 实测 2449 测基线）必须绿才推 baseline。

---

## 各 session 小节

### #1 — 模板填充 (template-fill)
- worktree：`/Users/yaleiqi/holaday-template-fill`　branch：`claude/template-fill-ae1d05`
- 状态：**收口待命 + 路由补强已上线**。M1+M2 docx + M3 xlsx 引擎 + e2e 已 commit；`9935e84` 在 baseline；`TEMPLATE_FILL_ENABLED=true` 已开。
- **2026-06-13 fileIds-aware soft 路由（既有设计缺口，非回归）**：template_fill 路由原纯靠 intent 关键词、无视 fileIds，「把…填入周报模板缺的留空」漏命中 strict pattern → 当通用任务跑。修法：传文件 AND fill动词(填/录入/补全) AND 模板/空白名词 ⇒ 强制 template_fill；合取+文件兜底挡住普通带附件任务（总结/翻译/分析不升级）。改 `intent-classifier.ts`（`matchTemplateFillSoft`/`ClassifyOpts.hasFileAttachment`/cacheKey 折标志）+ `tasks.ts`（classify 调用传 `hasFileAttachment`，**共享文件加法 hunk，远离 ④ fork**）。
- **落 3 分支同改动**：template-fill `c16f8a0`、ashare `123cceb`、**musing-keller(合并主干)`1ba76bb`←prod**。84 classifier + 1556 agent 测绿、tsc0；Vultr 真实证 ①原句+docx→template_fill、②总结这份文档+docx→generate（详 `qa-artifacts/route-fix-20260613/phase-summary.md`）。
- **2026-06-13 Phase 0 评测 E10 两个 P0 修复已部署 prod（`2617392`，restart 640）**：①**xlsx 多行循环**（{#x}…{/x} 跨行）原被 skip→任务数据全丢，改 **exceljs block-duplication**（snapshot body→splice→restamp 样式/行高；纯标记行=分隔符丢弃，内联标记保留；异常模板 try/catch 降级不崩）；「诚实降级」不再替代功能。②**下载 CJK 文件名**：`http.ts` 下载路由改用 `contentDispositionAttachment`（RFC6266 `filename*=UTF-8` + ASCII `filename=` fallback，永不 latin1 乱码）。回归：xlsx 引擎多行/样式/空数据 + runner/e2e 由「skip」翻「expanded」+ `contentDispositionAttachment` round-trip。全量 **2638 测绿、tsc0**。**E10 live 复测**：3 行任务全到、status=completed、下载名正确。改了共享 `http.ts`/`file-service.ts`（加法）。

### #2 — A股数据层 (ashare)
- worktree：`/Users/yaleiqi/holaday-ashare`　branch：`claude/ashare-ae1d05` @ `394830e`（**已 push origin** ✓，含 ④ widen + 简报 v2 + tasks.ts 去 churn）
- 状态（2026-06-12 **②③简报全链 + 内容三优化 + ④即时问答 M1+M2 全部署**；④ 在 BOSS-only 灰度）：
  - **②③**：`watchlists` 表 + tRPC CRUD（幂等增删）；确定性盘前/盘后简报渲染器（每行源+时间戳+固定免责，**不预测不荐股**）+ dev/prod 双模。
  - **§6 数据层**：⚠️ **push2.eastmoney 从 Vultr 不可达**（RemoteDisconnected，非瞬时；交接「Vultr 可达」前提作废）→ quote/kline/A股指数/港股指数全改 **sina**（实测可达）。北向净买额 2024-08 停披露(恒 0.0)→整行省略。龙虎榜接 akshare 自带「解读」列。详见 worktree `apps/akshare-mcp/README` 已知限制节。
  - **§6c**：`akshare-mcp` 加薄 FastAPI `http_server.py`（仅 127.0.0.1:8848，pm2 `akshare-mcp-http` autorestart，`/healthz`）+ orchestrator `HttpAkshareClient` HTTP 直取（10s 超时 + 段级降级）；简报接口 TTL≥600s 投递窗口去重；scheduled-runner dispatch 分支接简报（单用户失败仅重试本任务 + 连续 3 次降级 inbox 错误）。
  - **部署**：orchestrator `ae6c2b6→852c73a`（healthz ok）+ `deploy-akshare-mcp.sh`（venv+pm2+smoke）。
  - **✅ 0032 已落 Vultr 生产库 `holaday`@127.0.0.1**（部署时亲手 apply，回带 `SHOW CREATE TABLE watchlists`：11 列含 `alert_config_json` + 4 索引 + `fk_watchlists_user` ON DELETE CASCADE；同库 server_id=1 / 2719 tasks）。
  - **给 BOSS(usr id1, admin) 开通每日简报**（2 条 scheduled_tasks 盘前 08:30 / 盘后 15:30 SH daily；种自选股 600519/300750/000001）+ 手动触发真数据简报投 inbox（龙虎榜盘前触发无数据→优雅降级，15:30 真发有）。
  - **简报验收三修（`5d4bb2c`，已部署，无新 migration）**：
    - **P0 简报正文可读**：`NotificationBell` 通知点击改为弹**全文渲染弹窗**（ReactMarkdown+remarkGfm+sanitizeForRender，portal 到 body，Esc/遮罩/× 关闭，锁滚动），不再跳日历；带定时任务的通知保留「在定时任务中查看」二级入口。`notifications.list` 本就全文下发（message=text），纯前端改。SPA 已部署双边 `index-CF4EaBpl.js`（Aliyun+Vultr smoke 双绿）。
    - **P1 星期时区**：`dateHeader` 改正午 UTC + `getUTCDay`，锁死 06-12=周五（+5 单测）。已在投递正文实证：`2026-06-12（周五）`。
    - **P1 非交易日不投递**：`akshare-mcp` 接 `tool_trade_date_hist_sina` 出 `/trading-day/{date}`（Vultr 实测：周五 true / 周六 false，源 `akshare:tool_trade_date_hist_sina`）；`briefing-dispatch` 交易日判定（日历优先，失败退周末兜底）；非交易日返回 `skipped+reason`，scheduled-runner 记 `last_run_status='skipped'`。
    - **重触发**：盘前(id43)+盘后(id45) 已投 BOSS inbox（真数据，周五，多段；盘后 id45 大盘速览=上证4038.02/深证15049.18/创业板3852.83）。**注**：盘后首条 id44 因冷缓存 sina 指数 spot >10s 触发 10s 超时→大盘速览段优雅降级「数据暂不可用」；重触发(暖缓存)的 id45 已正常。
    - **测试**：orchestrator 73（scheduled-runner 24 含新 skip 契约）+ SPA 15 全绿；tsc/biome/eslint clean。
  - **内容三优化 + 预热 + S2（`0bff4bc`+`69c9d9f`，已部署，无新 migration；SPA `index-ifyg-YSv.js`）**：
    - **异常非泄漏**：`HttpAkshareClient` 注入 logger（原始异常/后端 error envelope 进日志）；渲染器统一 `unavailableLine` → 用户**只见「数据暂不可用」**（dev 留原文）。两个「空=异常」根因 adapter 兜底：龙虎榜 `stock_lhb_detail_em` 当日未发布(NoneType 取下标) + 公告 `stock_zh_a_disclosure_report_cninfo` 窗口内无数据(KeyError 选列) → 捕获返空集非 error。Vultr 实证：龙虎榜 20260612→count0 无 err、公告 000001/300750 空窗口→count0 无 err。
    - **公告按日期过滤 + 裸 URL**：cninfo 不传范围返历史默认页(2023 旧公告!)；service 盘前取近 24h(昨→今)、盘后取当日，endpoint+client 透传 start/end_date(cache 按 args 分键)。无公告整段收敛「今日/近24小时无新公告」。裸 URL：公告链接含空格(`...Time=2026-06-12 20:50:29`)断链 → `safeLinkUrl` encodeURI。实证盘前/盘后公告段=600519 真 06-12 公告、空股静默省略、无降级。
    - **龙虎榜移盘前（BOSS 拍板=b 移盘前回顾）**：当日榜单收盘后晚间披露、15:30 盘后取不到 → 从盘后移除，改在次日盘前「上一交易日龙虎榜回顾」段，service 按交易日历解析上一交易日（周末本地跳+日历校验）。实证盘前 id49 含「回顾（2026-06-11（周四））」。
    - **冷缓存预热（BOSS 拍板=预热，10s 规格不动）**：新增 `prewarm-scheduler`，08:25/15:25 北京（简报前 5min）用长超时(30s)客户端把 `/index/us·hk·cn` 各调一遍填 akshare-mcp 缓存(TTL 600s)。boot 启动日志已确认。
    - **S2 设置开关**：`NotificationsSection` 加「每日 A股简报」toggle → `watchlists.briefingStatus/enable/disableDailyBriefing`。
    - **测试**：orchestrator a-share 46 + scheduled-runner 24（+prewarm 3 / +renderer 新增 6）全绿；tsc/biome/eslint + SPA tsc/lint clean。重触发盘前 id49 / 盘后 id50 投 BOSS inbox（真数据、周五、无泄漏）。
  - **✅ 冷缓存 follow-up 已闭环**（预热方案落地）。
  - **④ 即时问答 M1+M2 已交付上线（`483622d`，BOSS-only 灰度）**：Skill Router 首场景（方案 `docs/PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md` APPROVED + 通用模式 `docs/SKILL_ROUTER_PATTERN.md` markdown=WHAT/TS=HOW，后 11 技能照办）。
    - **M1** 接地事实卡（无 LLM，①盘面②同期已披露，逐条溯源）+ 抽 `ashare-format.ts` 共享底座。**M2** 合规闸门（advice/predict/ungrounded 越线降级纯数据 + **打日志计数**，21 对抗测长期保留）+ LLM③ runner（③段尾钉「以上因素与股价变动的关联未经证实」）+ token 上限保护。
    - **短名 name-search**：⚠️ `stock_info_a_code_name` 从 Vultr **不可达** → sina `stock_zh_a_spot`（5526，日级缓存 + 开盘前 prewarm `warmSymbolTable` 刷新 + 非阻塞自愈）。
    - **接线**：`tasks.ts` a-share-qa lane（镜像 template-fill，无 agent loop / 背景 async / persist+broadcast）。双门 `ASHARE_QA_ENABLED`(默认 OFF) + `ASHARE_QA_ALLOWLIST`(CSV)。**灰度 env 已开**（restart 623 进程内 flag 实证），符号表 warm(5526)。
    - **真 LLM 实测**：带 roleId='a-share-analyst' 诱导提问（该买吗/割肉/目标价/抄底）→ haiku **全自合规**（无建议/预测）→ 闸门没触发=最好安全结果；闸门降级由对抗单测确定性兜底。**待 BOSS 产品内实测，过了才 widen flag**。
    - **⚠️ 已知限制（BOSS 拍板 v1 不兜）**：裸短名问句（未选技能 + 无术语/代码）不命中 → 落通用路径；唯一通路 = 选 a-share-analyst 技能(roleId)。
  - **测试**：a-share 92 + 全量 2510 全绿。**注**：`tasks.ts` ④ lane 与 #1 template-fill fix（`4e4c6c4` 别人 push 进本支）rebase 无冲突已并。
  - **待**：盘前公告窗口「近 24h」按日历日，周一不回溯上周五=次要已知限制。
  - **④ widen 全量上线（`feada2a`，已部署 restart 631→633）**：清空 Vultr `.env` `ASHARE_QA_ALLOWLIST=`（保 `ASHARE_QA_ENABLED=true`）→ 全量用户可用（进程内 /proc/environ 实证 ENABLED=true、ALLOWLIST 空，经多次 redeploy 仍在）。BOSS Claude UI 复测 4/4 过后批准。同批携 #1 守卫 `f8437c1`(executionMode 防 ④ fork 劫持 template_fill/image/browser 专用道) + 2 P2(事实卡公告 safeLinkUrl、③ 空解读打日志)。
  - **简报 v2 已部署生产（`162824a`，无新 migration）**：BOSS「盘后加三段 + 易读性四原则」批次。
    - **盘后**段序 速读→大盘速览→市场温度计→板块主线→自选股表→公告；顶部**今日速读**一行（沪指/涨跌家数/涨停炸板率/主力净流/主线）；**市场温度计**（涨停X(昨Y)·最高N连板·跌停·炸板率 + 涨跌家数·两市成交额·主力净流入，行内一句话）；**板块主线**（同花顺行业涨跌前5+领涨股龙头）；盘前龙虎榜回顾段加**昨日涨停回顾**（上一交易日涨停梯队/活跃行业）。四原则：固定段序 / 表格只留自选股 / prod 来源短标减噪 / **长度锁写进单测（盘后正文内容≤600字）**；纯指标无周期定性标签（合规哨兵）。
    - **数据层（逐个先验 Vultr 可达性，push2 教训）**：可达 substitutes `stock_zt_pool_em(date)`/`_dtgc_em`/`_zbgc_em` + `stock_board_industry_summary_ths`(同花顺，一调给板块+涨跌家数+净流入) + 综指 spot 两市成交额；`get_market_pulse(date,prev?)`/`get_zt_pool_summary(date)` 单行聚合逐源容错。**⛔ 2 名指 _em 接口 push2 死** → 改 ths；**❌ 2 指标无可达源故不出**（成交额环比% / 自选股主力净占比列，同北向停披露红线）。详见 [[reference_ashare_vultr_data]] 2026-06-13 UPDATE。
    - **Vultr 全链真渲染实证**（盘前+盘后 pin Friday 跑真 `HttpAkshareClient`→真数据 markdown）：涨停89(昨69)/最高4连板/炸板率41.1%/净流入-141亿/两市3.21万亿/板块工业金属+5.28%(新威凌)；昨日涨停回顾 69家·活跃化学制品8·半导体8。
    - **测试**：a-share 120（+10：长度锁/段序/温度计/板块/合规哨兵/降级/昨日涨停回顾）+ 全量 **2570** 全绿；tsc/biome clean。**周六非交易日 skip**，周一 BOSS scheduled id43/id45 自动产 v2 真投递。
  - **v2 收尾两调整 + tasks.ts 去 churn（`f698f4b`+`394830e`，已部署 restart 634）**：
    - 无源指标（成交额环比% / 自选股净占比列）BOSS 拍板**接受不出**，按北向同款红线，不引新数据商依赖。
    - 板块主线 涨跌前5→**前3**（正文更短；data 层留前5，展示 slice(0,3)）。
    - **tasks.ts 去 churn（合并前置·重点，BOSS 指令）**：详见上「三分支合并方案」router tasks.ts 条 — checkout 基线 9935e84 重贴 ④ 真实改动，2176 churn → **244 插入/0 删除纯增量**，全量 2570 测绿、行为零变化。后续合并/回滚从「解2000行热路径」变「解几十行」。

### #3 — Playbook + Evidence Ledger（本约定创建者）
- worktree：`/Users/yaleiqi/holaday-playbook-ledger`　branch：`claude/playbook-ledger-ae1d05`（已 push `0f644e4`）
- 状态（2026-06-12 **Pack A+B 完成，本次合并并入 musing-keller**）：
  - **Pack A**：tasks.origin 列 + 9 表 schema + migration `0033` + R2 helper + 4 repository
    + TaskOrigin 常量 + §5.6 origin='user' 读取守卫。**`0033` 已落 Vultr 生产库并验证**（9 表 +
    origin 列 varchar32/NOT NULL/default 'user' + 2 索引 + 外键全对 + 2719 tasks 无损）。
  - **Pack B**：终态 hook `writeLedgerToDb`（3 处 persistExecution 后、disposeExecution 前）镜像
    内存 EvidenceLedger → `evidence_artifacts`+`claims`+`claim_evidence_links`（+ R2 bundle 独占）；
    `LedgerRepository` 读 API skeleton（未接 verifier，逻辑零改）；任务删除分流 §4.9；retention reaper
    nightly cron（gated `RETENTION_REAPER_ENABLED` 默认 off）。全程 flag `LEDGER_DB_WRITE`（默认 off）。
    **无新 migration**（用 0033 表）。
  - **合并**：本次 #3→musing 只 SESSION_STATUS 冲突（代码全 clean）；落地后翻 `LEDGER_DB_WRITE=on`
    跑真任务积累 Ledger 数据（Phase 0 评测受益）。
  - eval origin 标记 defer 到 Pack C（explorer/canary，等指令）。

### #5 — 图片生成 (image)
- 状态：← owner 更新

### #4 — 视频生成 (video)
- **状态：管线就绪，等真人正脸出镜底版做端到端验收。** worktree `/Users/yaleiqi/holaday-video` branch `claude/video-ae1d05`（**未 merge / 未部署**，全 flag-gated 默认 off）。
- **进度**：步骤1 上传链路（presigned-PUT + media 白名单 + 200MB + migration `0034` users.qwen_voice_id/base_video_file_id）**已部署 prod**（曾 `f60e698`，现 prod 已被其他 session 推进到 `c092562`，video 列与代码仍在）。步骤2 三适配器（Wanxiang/fal/Qwen3-TTS-VC）+ 真调证据全绿。步骤3 编排 **3a→3e-2 全 done + 单测**（env/时间轴对齐/runner/FFmpeg竖屏合成/脚本生成/ffmpeg子进程/video-lane），全套 2704 绿。
- **2026-06-15 全管线连通性冒烟通过**（≠验收）：脚本直跑真 `runVideoCreation`，6 步串通，真出 1080×1920 h264+aac MP4 27.5s/4.3MB，OSS→R2 全落。录屏底版换口型废、不计验收。测试素材+克隆音色已清。
- **未做（刻意暂停）**：3e-3 接 `tasks.ts` 后台协程 gate + onboarding（高风险共享文件改动，等 BOSS 录真底版 + 过目 hunk 再接）。**不动 tasks.ts。**
- **BACKLOG（验收前必修）**：lip-sync clip 比其音频短 ~0.11s/段（冒烟 28.16s 时间轴 vs 27.478s 成片，~0.68s 漂移）→ `lipSyncSegment` 用 ffmpeg `-t`/`apad` 把 fal 输出 trim/pad 到精确音频时长，锁死音视字三轨。
- 详见 memory `project_phase1_video_impl_2026-06-13`。
