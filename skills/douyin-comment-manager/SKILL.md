---
slug: douyin-comment-manager
name: 抖音商家评论管理
version: 0.1.0
description: 在抖音商家后台（已登录）按时间 / 评分筛选未回评论，生成回复草稿，分批确认后代发。
occupationTag: ecommerce-ops
entryUrls:
  - https://compass.jinritemai.com/
  - https://fxg.jinritemai.com/
  - https://jinritemai.com/
riskFloor: low
hints:
  - "用户已在 Chrome 登录商家号；HOLA DAY 不做授权层。未登录 → awaiting_user 提示登录。"
  - "写动作（回评 / 置顶 / 删除 / 屏蔽）按 batch_size=5 分组，每批 awaiting_user 弹预览卡让用户 Confirm / Skip / Cancel。"
  - "回复草稿由 commander 生成：每条草稿包含 label（买家昵称/评分摘要）和 preview（回复文本），注入 step.result.data.batch.items。"
  - "intent 若明确说只回差评 / 3 星以下 / 过去 24 小时等筛选条件，plan 前置一步 extract + 过滤。"
  - "默认不回内容包含退款、违禁、医疗、金融、投诉官方等敏感词的评论——这些 commander 打 meta.escalate=true，popup 卡片底部标红。"
  - "每次执行前 screenshot 评论区首屏存 S3（审计用），key 写入 task_events.payload.screenshot_key。"
caveats:
  - "评论区 DOM 频繁改版，selector 走 role → text → css 三层兜底，W2 Driver 层兜 self-heal。"
  - "回复框是懒加载 + 富文本编辑器（contenteditable），不是 textarea；driver 走 kind=type 的兼容路径。"
  - "单日同一买家最多回复 1 次（抖音风控），Skill 必须跟踪本次批次内已回复的买家 ID，避免同一会话二次回复。"
  - "置顶有数量上限（近期是 3 条），Skill 不做置顶超限处理，遇上限直接 skip 并记事件。"
  - "任何可能被买家截图发到社交媒体的文本（营销话术、承诺全额退款、下单免运费等）必须以草稿形式进入 awaiting_user，不在 Skill 里硬编码。"
  - "禁止删除差评、屏蔽差评、引导好评（好评返现等促销诱导）——commander system prompt 已拒；Skill 的 caveats 再提醒一层。"
allowedOrigins:
  - "*.jinritemai.com"
  - "*.snssdk.com"
  - "*.douyin.com"
---

# Skill: 抖音商家评论管理（douyin-comment-manager）

## 典型用户意图

> "把昨天 3 星以下的未回评论都回一下。"
> "过去 24 小时差评里提到物流的，先单独给我一份清单；其他的按默认话术回复。"
> "最近 50 条好评里挑 3 条置顶。"

commander 解析时提取：**时间窗**、**评分筛选**、**主题筛选（物流/质量/客服）**、**回复策略（默认话术 / 逐条定制 / 仅置顶）**。

## 登录态检测

同 `douyin-compass-export`：第一步 goto 后若被重定向到登录页，awaiting_user 提示"请在 Chrome 登录抖音商家号"。不存任何凭证。

## 高层规划模板（commander 参考）

1. `goto` 商家后台评论中心（`https://fxg.jinritemai.com/ffa/mshop/comment/list` 或路由同义）
2. `wait` 列表首屏加载
3. `screenshot` 首屏存 S3（审计）
4. `click` 时间筛选 → 按 intent 选窗口
5. `click` 评分筛选 → 按 intent（"3 星以下" / "全部"）
6. `extract` 当前页评论列表（买家ID / 评分 / 内容 / 时间 / 是否已回）
7. `scroll` + `extract` 直到凑够目标数量（上限 50）
8. commander 本地过滤 + **生成回复草稿**（每条 `{commentId, rating, snippet, draft}`）
9. 按 `batch_size=5` 切批。循环：
   - client 发 `awaiting_user` + `data.batch = {batchIndex, batchTotal, items, summary}`
   - 用户 Confirm → commander re-dispatch 这批的"实际回复"步骤（Confirm 之后 driver 逐条 click 评论 → type 草稿 → click 发送 → 验证）
   - Skip → 这批跳过，继续下一批
   - Cancel → 全任务 cancelled
10. 置顶（可选，intent 指定时）：同样分批走 awaiting_user，每批 3 条以内（避开抖音置顶上限）
11. 末步 `extract` 审计汇总（已回复 N 条 / skip M 条 / 失败 K 条 + 每条的 commentId）

## 风险标注（重点）

- 分两档：
  - **读**（extract / scroll / screenshot / 评分筛选）：`risk: 'low'`。
  - **写**（发送回复 / 置顶 / 删除 / 屏蔽）：`risk: 'high'`，每批强制 awaiting_user。
- 删除差评 / 屏蔽差评：**Skill 层禁止**。commander 若生成此类步骤，SafetyFilter（W3）也会截断；Skill manifest 的 caveats 作为显式约束。
- 同一批确认后由 driver 顺序逐条执行；若第 k 条失败（例如买家已删评论 / 网络错误），step.result 带 `error` 回上来触发 MAX_STEP_RETRIES 重试；两次都失败走 `paused(retries_exhausted)`，不自动 skip（避免用户以为都回好了）。

## Selector 要点

| 目标 | role 优先 | text 备选 | css 兜底 |
|---|---|---|---|
| 评论列表 tab | `tab` name="评论" | "评论管理" / "评论中心" | `[data-tab="comments"]` |
| 时间筛选 | `button` name="时间" | "近 7 天" / "昨日" | `[data-testid="date-picker"]` |
| 评分筛选 | `combobox` / `listbox` | "评分" | `.filter-rating select` |
| 单条评论行 | `row` / `listitem` | — | `.comment-list .comment-item` |
| 未回标签 | — | "未回复" | `.comment-item .badge-unreplied` |
| 回复按钮 | `button` name="回复" | "回复" | `.comment-item .btn-reply` |
| 回复编辑器（contenteditable） | `textbox` | — | `.reply-editor [contenteditable="true"]` |
| 发送按钮 | `button` name="发送" | "发送" | `.reply-editor .btn-send` |
| 置顶按钮 | `button` name="置顶" | "置顶" | `.comment-item .btn-top` |

W2 Day 4-5 真接入 Playwright-CRX 后这些 selector 会抽成 `selectors.json`。

## 输出 schema（commander 内部约定）

每批 awaiting_user 的 `data.batch`：

```json
{
  "batchIndex": 1,
  "batchTotal": 4,
  "summary": "批次 2/4：3 星及以下，共 5 条未回复",
  "items": [
    {
      "label": "@买家昵称 · ★1 · 2 小时前",
      "preview": "商品发霉了，非常失望！\n—\n回复草稿：非常抱歉给您带来困扰，请私信告知订单号…",
      "meta": {
        "commentId": "c_xxx",
        "rating": 1,
        "theme": "quality",
        "escalate": false
      }
    }
  ]
}
```

meta.escalate=true 的评论（敏感词命中）在 popup 预览卡底部单独标红，用户可以 Skip 批量+单独处理那几条。

最终任务结果：
```json
{
  "window": { "from": "...", "to": "..." },
  "processed": 18,
  "replied": 15,
  "skipped": 3,
  "failed": 0,
  "escalated": [ { "commentId": "...", "reason": "敏感词：退款" } ],
  "auditScreenshots": ["s3://holaday-artifacts/..."]
}
```

## 已知限制（Phase 0）

- 不支持 @提及特定员工、不写私聊消息、不做跨账号切换。
- 置顶一次最多 3 条；若用户要求更多，commander 应返回"置顶上限 3"的 awaiting_user 让用户确认只做前 3。
- 回复草稿是 commander 生成的模板 + 针对性微调；Phase 0 不做"每条都用独立 LLM 调用生成"（成本考量）——W3 可加一次 commander 调用把 draft 精细化。
- 不做"差评申诉"相关流程（Phase 1 单独出 skill）。

## 合规红线

- **禁止诱导好评**：回复话术不许出现 "好评返现"、"5 星有礼"、"评价截图送券"。
- **禁止伪造身份**：不自称"XX 官方客服"等超出店铺身份的称谓；statement 里保持"我是 <店铺名> 客服"。
- **不自动删除差评**。manifest caveats + commander system prompt 双保险。
- **买家信息不外泄**：`extracted` 后的 commentId 可以在任务结果里作为审计凭证，但买家手机号 / 姓名 / 收货地址等字段一律丢弃不持久化。

## 参考

- 战略 Pivot 2026-04-21：抖音电商首发。
- `douyin-compass-export`：同域 allowed_origins，同登录态检测模式，只读场景。
- 批量 confirm 设计见 W2 Day 2 daily + `server.batch_confirm_required` 协议。
- PoC §6.1 A 路径：Playwright-CRX 的 click/type/extract 足够覆盖。
