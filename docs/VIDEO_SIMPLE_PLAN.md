# 视频生成（指令 #4）· 原方案（简化定型）· 方案 + 可达性

> **形态：** 对话式 AI 辅助「图文配音」短视频。**去三依赖**：不克隆声音 / 不出镜 / 不换口型 → **不需要用户任何素材，可独立端到端验收**。
> **定型：** BOSS 2026-06-15（与「升级方案」彻底切开，后者存档 Phase 2）。
> **代码：** worktree `/Users/yaleiqi/holaday-video` branch `claude/video-ae1d05`（未 merge/未部署，全 flag-gated 默认 off）。
> **部署铁律照旧：** prod = `musing-keller`，部署前实读 live HEAD（preflight）。

---

## 一、管线

```
用户文案 → ① AI 优化(忠于原意,分段+画面描述)
        → ② Qwen 预设音色 TTS(qwen3-tts-flash + Cherry,无克隆)
        → ③ AI 画面  ┌ 默认: 万相文生图 n=1 + Ken Burns 缓动(便宜)
                     └ 可选: 视频画面(整条统一)
        → ④ 字幕(SRT,以音频时长为基准)
        → ⑤ FFmpeg 竖屏 1080×1920 合成(+水印 合规 +BGM)
```

**没有：** 换口型 / 真人出镜底版 / 声音克隆 / onboarding。每段 = 旁白音(预设) + 画面(图/视频) + 定长 clip。

## 二、可达性矩阵（2026-06-15 Vultr 新加坡实测，别假设）

| 能力 | 模型 | 状态 | 实测 | 计费 |
|------|------|------|------|------|
| 预设音色 | `qwen3-tts-flash` + voice `Cherry`(默认) | ✅ | 215KB WAV / 46字 / **1.2s** | 按字符,~分 |
| 图片画面（默认） | `wan2.2-t2i-flash`（**n=1** 控成本） | ✅ | 6.4s / **$0.025/张** | 便宜 |
| 视频画面·标准（默认视频源） | `wan2.1-t2v-turbo` | ✅ | 2.64MB / **~91.6s** SUCCEEDED | ~$0.036/s |
| 视频画面·高质量（opt-in） | **Veo** `veo-3.0-fast-generate-001` | ✅ access 有 | 9:16 4s / **~32s** / 644KB | **$0.10/s (720p)** / $0.12 (1080p) |

> Veo gotchas（文档写错）：`durationSeconds` 是**数字**(非字符串)、无 `numberOfVideos`、`aspectRatio:'9:16'` 原生竖屏。Veo access 确有(非 403)。

## 三、画面「图片 vs 视频」选择 + 成本（manus 式透明，BOSS 拍板）

| 档 | 画面源 | 成本/条(~30s) | 默认 |
|----|------|------|------|
| 图片版 | 万相文生图 + Ken Burns | **~¥1–1.5** | ✅ 默认 |
| 视频版·标准 | 万相文生视频 | **~¥8** | 视频选项默认 |
| 视频版·高质量 | Veo veo-3-fast 720p | **~¥17**（~2× 万相） | 单列「高质量」档,**用户知情选,不默认烧 Veo** |

- 选择**整条统一**（不每段各选）。默认音色 **Cherry**（BOSS 听 5 个中文音色选定）。

## 四、runner 架构（已实现 + 单测）

复用既有件，新增简化路径。`apps/orchestrator/src/agent/video/`：
- **复用**：`wanxiang-client`(t2i/t2v)、`qwen-voice-clone-client.synthesizeSpeech`(预设音色=传 voice 名)、`video-pipeline.runVideoPipeline`(全段 'broll' → 不走 lipSync)、`video-compose`、`timeline`、`video-http`。
- **新增**：`veo-client`(generateVeoVideo)、`video-script.optimizeUserScript`(忠实优化用户草稿)、`ffmpeg-exec.renderImageKenBurns`(图→zoompan)/`renderVideoClip`(视频 loop-trim 到音频时长)、`video-lane-simple.runSimpleVideoCreation`(整条编排,image 默认/video 可选 wanxiang·veo)。
- **flag**：`VIDEO_CREATION_ENABLED`(默认 off)+ allowlist。**tasks.ts 后台协程 gate 待接**（高风险共享文件,单独评审）。
- 全套测试绿（含 veo/optimize/Ken Burns/简化 lane）。

## 五、合规

- 文案忠于用户原意、不杜撰、不模仿他人（optimizeUserScript 系统提示硬约束）。
- 成品**强制水印**（`buildComposeCommand` 默认加 `HOLA DAY · AI 合成`）。
- 简化路径无真人声音/肖像 → 无声纹/肖像盗用面。

## 六、升级方案存档（Phase 2，现在不做）

side panel 独立视频任务界面,向导式：文案 → 上传本人音频(克隆) → 上传本人出镜底版 → 真人 IP 视频（fal 换口型 + Qwen 克隆）。**已建的 `fal-lipsync-client` / `qwen enrollVoice` / `video-lane` lipSync 路径 = Phase 2 现成基建,保留别删。** 等原方案上线后再推敲交互草图。

## 七、端到端冒烟（连通性，2026-06-15 实测）

image 模式跑通 = 六步串接 + Ken Burns + Cherry 配音 + 字幕 + 水印 + 竖屏 1080×1920 出真 MP4，**不需 BOSS 任何素材**。
- **用户草稿** → AI 优化为 **5 段** → Cherry 合成 5 段 → 万相 t2i **n=1** 出 5 张真图 → Ken Burns 5 clip → 字幕+水印 → 合成。
- **成片：h264+aac，1080×1920，26.47s，5.23MB**；时间轴 26.4s ≈ 成片 26.47s（**零漂移**——图片 Ken Burns clip 精确锁音频时长，不像换口型有漂移）。
- **~91s（image 模式比换口型快很多）**，~¥1.5/条。11 产物全 OSS→R2。
- 这是**连通性冒烟**(水管+画面真),非「视频功能验收完成」。真验收 = BOSS 看 `~/Downloads/holaday-video-smoke.mp4` 观感拍板。测试素材已清(Mac 留成片供验收)。
