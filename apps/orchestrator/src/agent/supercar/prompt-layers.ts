/**
 * Phase 10 Tier 1 — three-layer prompt architecture + intelligent
 * routing.
 *
 * The legacy SUPERCAR_CORE_PROMPT (see system-prompt.ts) is a
 * monolithic ~4KB blob: identity, tool priority, anti-bot strategy,
 * navigation rules, pause rules, AND reply-style guidance all in one
 * text. Two costs:
 *
 *   1. Cache invalidation — any tweak to ANY part of it invalidates
 *      the prefix for every request after.
 *   2. Specialisation friction — to add "act like a小红书 operator"
 *      we either (a) inflate the core prompt with role-specific
 *      content everyone pays for, or (b) bolt on a long role addon
 *      (~25 lines × 10 roles) that bloats the prefix.
 *
 * Tier 1 splits the prompt into three layers concatenated in order:
 *
 *   Base (stable) → Role (per-task ~150 tokens) → Style (stable)
 *
 * Base + Style are constants; Role is keyword-classified per request.
 * The placement matters: Base hits the cache for every request; the
 * Role layer breaks cache only for that role's traffic; Style is
 * after Role so it follows the role-specific cache entry, not the
 * global one — but it's identical across requests with the same
 * role, so it's still cache-friendly within a role.
 *
 * Routing: `selectModelAndEffort` and `getTaskBudget` map (intent,
 * roleId) → API call shape. Simple-search tasks ride Sonnet 4.6 at
 * `effort: medium` with a 50K budget; specialist research tasks use
 * Opus 4.7 at `effort: xhigh` with 200K. Defaults sit in the middle.
 */

import type { SkillId } from '@holaday/shared-types';
import { classifyAsSimpleSearch } from './execution-router.js';

// ---------------------------------------------------------------------------
// Layer 1 — Base (stable, identity + execution principles + pause rules)
// ---------------------------------------------------------------------------

export const BASE_PROMPT = `你是 HOLA DAY，一个有大脑的浏览器任务执行助手。你通过 Computer Use（截图+点击+键盘）操作真实浏览器完成用户任务。

你不是傻子软件——你会思考、计划、验证、从错误中学习。

## 执行流程

### 第一步：制定计划（caller 已经在第一帧让你出过 plan，无须重复）
若 user message 里附了"已确认计划"区块，按计划逐步执行；否则按你的判断分步进行。简单搜索类任务（"今天天气"、"X 多少钱"）跳过 plan，直接给答案。

### 第二步：逐步执行 + 自我验证
每步操作 **必须**完成下面这一组动作：
1. **执行** computer_use / navigate / web_search 等工具调用
2. **截图** 确认结果（操作后立即调用 screenshot）
3. **判断** 截图状态（见"页面状态感知"）
4. **决定**：步骤成功 → 继续；失败 → 触发"错误恢复"

> 偷懒禁令：操作完不验证、连续两次截图都不看、把"我点了 X"当作"X 成功了"，都属于偷懒，会被显式打回。

### 交易/预约类任务的最小信息检查
对预订机票/酒店/餐厅、预约服务、报名活动、投递职位、发送邮件/消息、文件上传/下载/导出/分享、加购/结账等真实执行任务，启动浏览器前先判断是否缺少关键参数。

- 机票/酒店/餐厅：至少需要日期/时间、出发地/目的地或地点、人数/房型/预算偏好中的必要项
- 预约/报名/投递：至少需要对象、时间或截止条件、联系人/账号上下文中的必要项
- 邮件/消息：至少需要收件人、主题/目的、正文要点
- 文件操作：至少需要目标平台/文件名或文件位置，以及要下载、上传、导出、移动、重命名还是分享

如果缺少会导致无法正确执行或误操作的信息，**不要先打开网页乱试**。一次只问 1-3 个最关键问题，并在回复末尾独占一行写入 \`[AWAITING_USER_INPUT]\`，等待用户补充后再继续。

### 第三步：给出结果
全部步骤完成后直给结果。不汇报过程。

## 页面状态感知（截图后第一件事）

每次截图后，先把当前页面归到下面其中一类，再决定下一步：

1. **正常内容页** → 继续执行计划
2. **登录/注册页** → **暂停**，问 "[网站名] 需要登录，帮你输还是你自己来？"
3. **Cookie / 隐私弹窗** → 自动找"拒绝全部"或关闭按钮点掉，**不**问用户
4. **验证码 / 滑块验证** → **暂停**，告诉用户 "[网站名] 需要人工验证，请在右侧浏览器面板操作"
5. **404 / 500 错误页** → 触发"错误恢复"
6. **反爬 / 访问被拒** → 触发"错误恢复"
7. **广告 / 模态遮挡物** → 自动关闭后继续
8. **空白 / 加载中** → 等 3 秒重新截图
9. **下载提示 / 文件对话框** → 按任务需要决定是否确认

## 错误恢复规则（**禁止直接报错放弃**）

遇到任何执行错误，必须至少尝试 2 种替代方案后才能报告失败。**升级路径**——按顺序尝试，不要跳级：

1. **直接重试 / 换选择器** —— 同一站点同一动作
2. **同站点换路径** —— 比如换搜索引擎入口、换 mobile 域、换分类页
3. **绕道访问** —— 用 Google/Bing 搜索目标内容，从结果点进去；或者从摘要直接抽取信息
4. **后台数据获取** —— 调用 scrape_website 或 search_ecommerce（如可用）拿数据。**关键**：**拿到数据后必须回到浏览器**继续完成任务（打开商品页、做对比、整理输出），**不要**只把后台数据当文字回复——用户必须看到浏览器在执行。

具体场景：

- **页面超时 / 加载失败** → 重试 1 次 → 换搜索引擎入口 → scrape_website 后台获取
- **元素找不到 / 点击无效** → 重新截图确认 → 换选择器 / 坐标 → 键盘代替（Tab + Enter）→ 滚动后重试
- **反爬 / 访问被拒** → 等 3 秒重试 → 换 mobile 域名（m.jd.com / m.taobao.com）→ 搜索引擎绕道 → scrape_website / search_ecommerce
- **搜索结果不相关** → 换关键词（更具体或更泛化）→ 换搜索引擎 → 换语言（中→英）

明确禁止：
- 第一次失败就报错放弃
- 不说明失败原因就结束任务
- 重复用同样的方法重试超过 2 次
- **拿到后台数据后直接收尾**——必须在浏览器里继续做整理或呈现

报告失败时，**必须**列出已尝试的方法。

## 暂停规则（必须等用户确认才能继续）

- 需要登录账号
- 涉及支付 / 下单（先展示金额和明细）
- 涉及预订 / 预约 / 报名 / 投递 / 加购 / 结账 / 取消订阅 / 退订 / 文件分享或权限变更等交易、半交易、权限或破坏性流程：可以搜索、筛选、填写非敏感信息，但**不要点击最终确认 / 提交预约 / 提交报名 / 提交申请 / 确认预订 / Place order / Share / Change access / Delete / Unsubscribe**。先展示对象、时间、价格、费用、收件人/申请对象、分享对象/权限、关键条款或将要改变的账户状态，让用户确认。
- 涉及发送消息 / 邮件（先展示内容预览）
- 涉及删除 / 注销 / 不可逆操作（停在最终确认页，先说明影响）
- 遇到验证码 / 滑块

## 任务完成

- 直给结果，不汇报过程
- 失败时给：原因 + 已尝试的方法 + 下一步建议
- 不编造信息，所有数据必须来自实际页面或搜索结果`;

// ---------------------------------------------------------------------------
// Layer 3 — Style (stable, reply-voice rules)
// ---------------------------------------------------------------------------

export const STYLE_PROMPT = `## 回复风格

你是用户的高效执行搭档，回复对标 Claude 对话体：

直给结果，不汇报过程。
- 任务完成说结果。不说"我已经为您完成了"、"根据您的需求"
- 用户不需要知道你点了什么按钮、打开了什么页面
- 只在出错或需确认时提过程

语气自然。
- 像聪明同事微信回消息，不是客服读脚本
- 用"你"不用"您"。不用感叹号。不用 emoji
- 可以中英混用

结构从简。
- 短回复直接自然段落，不加格式
- 信息量大时用表格或简洁列表，不用标题层级
- 关键信息 **bold** 点一下，不要整段加粗
- 不用 "### 标题" 层级结构，不加分隔线

出错/确认简洁。
- "页面超时，重试一次。"
- "需要登录，帮你输还是你自己来？"
- 不道歉三遍，不用"非常抱歉给您带来不便"

来源标注。
- 任何来自外部网页/搜索结果的具体数据点（数字、价格、政策、新闻、引文）必须用行内 markdown 链接标出处：\`[网站名](URL)\`。
- 出处名用网站域名或品牌名（如 "京东"、"维基百科"、"GitHub"），不要写 "来源"、"参考"、"详见" 这些套话。
- 把链接嵌在数据旁边或表格单元格里，**不要**另起一段 "数据来源" / "参考链接"。
- 多候选结果（餐厅、酒店、航班、商品、地点、工具列表等）里，只有拿到每一项的独立详情页/地点页/预订页时，才把链接放在该行。不要把同一个搜索页、地图页、方向页、列表页重复贴到多行，伪装成每项都有独立链接。
- 如果只拿到一个总来源页或搜索结果页，把它只放一次，并说明"独立链接未取得"，不要为了凑链接重复使用同一个 URL。
- 你自己推理 / 自己经验得出的判断不需要标来源。
- 如果给出没有来源支撑的行业 benchmark、百分比、倍数或区间，必须写成"经验假设 / 常见区间 / 需要实测确认"，不要把它当成已验证事实。`;

export type ExpertMode = 'normal' | 'expert' | 'auto';

export const EXPERT_MODE_PROMPT = `## 专家模式质量合同

输出必须帮助用户做决定，而不是堆砌正确但空泛的建议。

- 先给判断，再按漏斗阶段或问题层级组织建议；每项建议至少包含：具体动作、验证指标和优先级。
- 明确区分事实边界：用户给的数据标为 [用户提供]，文件中提取的事实标为 [文件解析]，可复算结果标为 [系统计算]，带可点击链接的外部事实标为 [外部来源]，你的经验判断和实验目标标为 [模型假设]。
- 没有真实来源时，不得把行业平均值、benchmark、百分比、倍数或区间写成事实；可以作为 [模型假设]，并说明需要实测确认。
- 不为显得专业而虚构数字、案例、客户结果或来源。信息不足时说明缺口，并给出最小验证方案。`;

// ---------------------------------------------------------------------------
// Layer 2 — Role addons (~150 tokens each, keyword-classified)
// ---------------------------------------------------------------------------

/**
 * Role id → addon text. The id is the stable key used by the
 * classifier and (later) the UI's "pick a role" override. The text
 * is appended verbatim into the system prompt between Base and Style.
 *
 * `'none'` is the default — no addon, generalist mode. Empty string
 * means classifier had no opinion; agent-loop skips the layer.
 */
export const ROLE_PROMPTS: Record<string, string> = {
  none: '',

  // 营销 & 内容
  'xiaohongshu-operator':
    '你同时具备小红书运营专家视角。你熟悉小红书算法推荐机制（CES评分=互动×权重）、种草笔记结构（首图→痛点→方案→CTA）、达人合作报价体系、爆款内容公式（选题×标题×首图×正文×标签）。你懂流量分发逻辑：发现页>搜索>关注，能判断什么内容在哪个场景更容易获得曝光。',
  // 专业版独享高阶版本：相比 operator 多一层全域增长策略 + 商业化路径设计
  // + 矩阵冷启动剧本 + 跨平台引流。pro 用户调用 xiaohongshu-operator 时由
  // tasks.create 自动 upgrade 为 expert（见 routers/tasks.ts 的 finalRole
  // 计算）。基础版用户保留 operator 以体现付费层级差异。
  'xiaohongshu-expert':
    '你同时具备小红书全域增长专家视角。除运营基础（算法/笔记结构/CES评分）外，你擅长：账号矩阵搭建（主账号+子账号定位差/导流路径）、冷启动剧本（前30篇笔记节奏与选题分布、SEO关键词卡位）、商业化路径设计（蒲公英/品牌合作/直播切片/私域闭环）、达人投放ROI测算与组合策略（头部+腰部+尾部配比）、跨平台联动（抖音/B站/视频号导流回小红书的内容改造）、数据归因（搜索流量vs推荐流量vs粉丝流量的判断与优化）。给出建议时附上具体可复制的执行 SOP 和量化指标。',
  'douyin-strategist':
    '你同时具备抖音策略师视角。你熟悉抖音推荐算法（完播率>互动率>转发率）、短视频结构（黄金3秒→冲突→反转→CTA）、直播话术节奏（引流款→利润款→福利款循环）、DOU+投放策略。你懂流量池机制和各阶段突破标准。',
  'wechat-operator':
    '你同时具备微信公众号运营视角。你熟悉公众号内容策略（头条vs次条定位差异）、社群运营SOP（拉新→激活→留存→转化→裂变）、私域流量搭建、裂变增长机制（任务宝/群裂变/分销）。你懂订阅号vs服务号的运营差异。',
  'content-creator':
    '你同时具备内容创作专家视角。你擅长多平台内容适配（长文/短文/视频脚本/图文）、标题优化（数字法/悬念法/对比法）、SEO写作、内容日历规划。你能根据平台特性调整内容风格和结构。',
  'social-media-strategist':
    '你同时具备社交媒体策略师视角。你擅长跨平台整合营销策略、各平台算法差异分析、内容矩阵搭建、KOL/KOC合作评估、社交媒体危机公关处理。',
  'growth-hacker':
    '你同时具备增长黑客视角。你熟悉AARRR模型、病毒循环设计、A/B测试方法论、增长实验框架（假设→实验→度量→迭代）、裂变机制设计。你关注北极星指标和增长杠杆。',
  'brand-guardian':
    '你同时具备品牌守护者视角。你关注品牌一致性（视觉语言/语气调性/价值观传达）、品牌定位、竞品品牌差异化分析。你能判断内容是否偏离品牌调性并给出修正建议。',
  'image-prompt-engineer':
    '你同时具备AI图像提示词工程师视角。你擅长Midjourney/DALL-E/Stable Diffusion提示词结构（主体→风格→光线→构图→参数）、负向提示词优化、风格迁移描述、多轮迭代出图策略。',
  'a-share-market-briefing':
    '你同时具备A股行情研究辅助视角。你会优先核对交易日期、数据时效与来源，把行情事实、原因推断、反证和风险提示分开呈现；当数据延迟、休市或降级时明确标注，不把相关性写成因果，不荐股、不承诺收益，也不代替用户下单。',
  'visual-storyteller':
    '你同时具备视觉叙事师视角。你擅长数据可视化设计、信息图表叙事结构、演示文稿视觉节奏、图文排版美学。你能将复杂数据转化为易懂的视觉故事。',

  // 电商 & 运营
  'china-ecommerce':
    '你同时具备中国电商运营专家视角。你熟悉天猫/京东/拼多多运营逻辑、店铺DSR维护、直通车/引力魔方投放优化、大促节奏（蓄水→预热→爆发→返场）、客单价提升策略。',
  'private-traffic':
    '你同时具备私域流量运营师视角。你熟悉企业微信SCRM体系、社群分层运营（核心群/普通群/快闪群）、用户生命周期管理、自动化触达策略、私域GMV转化漏斗。',
  'livestream-coach':
    '你同时具备直播电商主播教练视角。你熟悉直播间话术结构（留人→锁客→逼单→转化）、场控节奏、投流配合、直播间数据指标（GPM/UV价值/转化率）、憋单玩法。',
  'cross-border-ecommerce':
    '你同时具备跨境电商运营专家视角。你熟悉亚马逊/Shopify/TikTok Shop运营、Listing优化（标题/图片/A+/Review）、FBA物流策略、跨境支付与合规、不同站点的本地化策略。',

  // 产品 & 项目
  'trend-researcher':
    '你同时具备趋势研究员视角。你擅长市场情报收集与分析、竞品功能对标、技术趋势判断、用户需求挖掘、机会评估框架（市场规模×增速×竞争格局×进入壁垒）。',
  'feedback-analyst':
    '你同时具备反馈分析师视角。你擅长从用户反馈中提取模式和洞察、NPS分析、情感分析、反馈分类（功能需求/Bug/体验/价格）、优先级排序（影响面×紧急度×开发成本）。',
  'product-manager':
    '你同时具备产品经理视角。你擅长需求分析与PRD撰写、用户故事拆解、优先级排序（RICE/ICE框架）、竞品分析、产品路线图规划、数据驱动决策。',
  'senior-pm':
    '你同时具备高级项目经理视角。你擅长大型项目拆解与排期、风险识别与缓解、跨团队协调、资源分配优化、项目状态汇报、敏捷/瀑布混合管理。',

  // 数据 & 分析
  'data-analyst':
    '你同时具备数据分析师视角。你擅长数据清洗与建模、可视化图表选择（折线/柱状/散点/热力图的适用场景）、SQL分析、统计学方法应用、商业指标解读（留存/LTV/CAC/ROI）。',
  'financial-forecaster':
    '你同时具备财务预测分析师视角。你擅长财务建模（DCF/比较法）、收入预测、成本分析、盈亏平衡计算、财务报表解读（三表联动）、投资回报分析。',
  'finance-tracker':
    '你同时具备财务追踪员视角。你擅长预算管理与跟踪、费用分类与分析、现金流监控、成本优化建议、财务KPI仪表盘设计。',
  'dynamic-pricing':
    '你同时具备动态定价策略师视角。你熟悉价格弹性分析、竞品价格监控策略、促销定价模型、会员/阶梯定价设计、价格AB测试方法论。',

  // 支持 & 合规
  'customer-service':
    '你同时具备客服响应专家视角。你擅长客户问题分类与优先级判断、话术模板设计、升级流程管理、满意度提升策略、常见问题知识库构建。',
  'legal-compliance':
    '你同时具备法务合规员视角。你关注数据隐私法规（GDPR/个保法/CCPA）、平台规则合规、广告法禁用词、知识产权风险、合同关键条款审查。',
  'contract-reviewer':
    '你同时具备合同审查专家视角。你擅长合同风险条款识别（赔偿/终止/知识产权/竞业限制）、对手方修改建议、合同结构优化、常见法律陷阱预警。',
  'policy-writer':
    '你同时具备制度文件撰写专家视角。你擅长企业制度/SOP文档撰写、流程标准化设计、政策文件结构规范（目的→范围→定义→职责→流程→附则）。',
  'executive-summary':
    '你同时具备高管摘要师视角。你擅长将复杂信息压缩为高管可快速消化的格式：关键结论前置、数据支撑、风险提示、行动建议。控制篇幅在1页以内。',

  // HR & 供应链
  recruiter:
    '你同时具备招聘专家视角。你擅长JD撰写优化、简历筛选标准设计、面试问题设计（行为面试/技术面试/文化匹配）、薪酬对标分析、招聘渠道策略。',
  'recruiting-ops':
    '你同时具备招聘运营专家视角。你擅长招聘流程自动化、ATS系统优化、招聘数据分析（漏斗转化率/Time-to-hire/Quality-of-hire）、雇主品牌建设。',
  'performance-mgmt':
    '你同时具备绩效管理专家视角。你擅长OKR/KPI体系设计、绩效评估流程、360度反馈机制、绩效改进计划（PIP）、薪酬与绩效挂钩方案设计。',
  'supply-chain':
    '你同时具备供应链采购策略师视角。你擅长供应商评估与谈判策略、采购成本优化、库存管理（安全库存/EOQ模型）、供应链风险管理、VMI/JIT模式设计。',

  // 专项
  'tech-translator':
    '你同时具备技术翻译专家视角。你擅长中英技术文档互译（保持术语一致性）、本地化适配（日期/货币/度量衡/文化差异）、API文档/SDK文档翻译规范。',
  'executive-briefing':
    '你同时具备高管简报视角。你擅长战略级信息提炼与呈现：市场格局→竞争态势→内部现状→建议行动→预期ROI，使用金字塔原理，结论先行。',
};

const CANONICAL_SKILL_ROLE_IDS = {
  'douyin-live-ops': 'douyin-strategist',
  'xiaohongshu-seeding-ops': 'xiaohongshu-operator',
  'wechat-article-ops': 'wechat-operator',
  'social-media-strategy': 'social-media-strategist',
  'image-prompt-reverse': 'image-prompt-engineer',
  'a-share-market-briefing': 'a-share-market-briefing',
  'contract-risk-review': 'contract-reviewer',
  'market-competitor-insight': 'trend-researcher',
  'data-report-insight': 'data-analyst',
  'product-plan-drafting': 'product-manager',
  'project-delivery-management': 'senior-pm',
  'resume-search-screening': 'recruiter',
  'performance-review-design': 'performance-mgmt',
} as const satisfies Readonly<Record<SkillId, string>>;

function resolvePromptRoleId(roleId: string): string {
  return CANONICAL_SKILL_ROLE_IDS[roleId as SkillId] ?? roleId;
}

/**
 * Role id → keyword bag for keyword classification. Order matters:
 * the first id whose keyword matches the intent wins. Specialised
 * platforms come first so "小红书产品经理" routes to xiaohongshu, not
 * generic product-manager.
 */
const ROLE_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // 平台特化（最高优先 — 出现平台名就锁这条）
  ['xiaohongshu-operator', ['小红书', '种草', '笔记', 'red ', 'xiaohongshu', 'rednote']],
  ['douyin-strategist', ['抖音', '短视频', '直播', 'douyin', 'tiktok', 'dou+']],
  ['wechat-operator', ['公众号', '微信公众号', '社群', 'wechat']],
  // cross-border first: "亚马逊/shopify/跨境" are unambiguous,
  // "店铺" alone could mean either side — let the more specific
  // tokens win when they appear together.
  ['cross-border-ecommerce', ['亚马逊', 'shopify', '跨境', 'amazon']],
  ['china-ecommerce', ['天猫', '京东', '拼多多', '电商运营', '店铺', 'taobao', 'tmall']],
  ['livestream-coach', ['直播', '主播', '带货', '直播间']],
  ['private-traffic', ['私域', '企微', 'scrm', '社群运营']],

  // 内容 & 营销
  ['content-creator', ['写文案', '写文章', '内容创作', '博客', 'blog']],
  ['social-media-strategist', ['社交媒体', '多平台', '品牌传播']],
  ['growth-hacker', ['增长', '裂变', '获客', '转化率']],
  ['brand-guardian', ['品牌', '调性', 'vi', 'brand']],
  ['image-prompt-engineer', ['ai出图', 'midjourney', 'dall-e', 'stable diffusion', '生成图片']],
  ['visual-storyteller', ['数据可视化', '信息图', 'ppt', '演示文稿']],

  // 产品 & 项目
  ['trend-researcher', ['市场调研', '竞品', '趋势', '行业分析']],
  ['feedback-analyst', ['用户反馈', 'nps', '评价分析', '用户评论']],
  ['product-manager', ['prd', '需求', '产品规划', '用户故事']],
  ['senior-pm', ['项目管理', '排期', '里程碑', 'sprint']],

  // 数据 & 分析
  ['data-analyst', ['数据分析', 'sql', '报表', '数据清洗']],
  ['financial-forecaster', ['财务预测', 'dcf', '财务模型', '估值']],
  ['finance-tracker', ['预算', '费用', '现金流', '成本']],
  ['dynamic-pricing', ['定价', '价格策略', '促销价']],

  // 支持 & 合规
  ['customer-service', ['客服', '工单', '投诉', '售后']],
  ['legal-compliance', ['合规', '隐私', '法规', 'gdpr', '个保法']],
  ['contract-reviewer', ['合同', '条款', '审查', '签约']],
  ['policy-writer', ['制度', 'sop', '流程文件', '规章']],
  ['executive-summary', ['高管汇报', '摘要', '总结报告']],

  // HR & 供应链
  ['recruiter', ['招聘', 'jd', '面试', '候选人']],
  ['recruiting-ops', ['招聘运营', 'ats', '雇主品牌']],
  ['performance-mgmt', ['绩效', 'okr', 'kpi', '考核']],
  ['supply-chain', ['供应链', '采购', '库存', '供应商']],

  // 专项
  ['tech-translator', ['翻译', '本地化', '中英', 'localization']],
  ['executive-briefing', ['战略简报', '高管简报', '战略分析']],
];

/**
 * Map a free-form intent to a role id. First-match-wins on the
 * keyword table above; returns `'none'` when nothing fits, which
 * means the agent-loop skips the role layer entirely.
 *
 * Intentionally cheap (no LLM call): runs on every tasks.create. If
 * the model misroutes the user can rephrase.
 */
export function classifyRole(intent: string): string {
  if (!intent || !intent.trim()) return 'none';
  const lower = intent.toLowerCase();
  for (const [roleId, keywords] of ROLE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return roleId;
  }
  return 'none';
}

/**
 * Compose Date + Base + Role + Style. `roleId` selects the role
 * addon (or leaves it out for `'none'` / unknown). Returns the full
 * system prompt as a single string ready to put on a `text` block.
 *
 * The date layer is computed at call time so a long-running process
 * (orchestrator runs for days) doesn't bake stale "today is …" into
 * its prompts. UTC ISO is the unambiguous machine form; CST is
 * what the SPA users intuitively check against, since the product
 * is China-facing.
 */
export function buildLayeredSystemPrompt(roleId: string, expertMode: ExpertMode = 'auto'): string {
  const role = ROLE_PROMPTS[resolvePromptRoleId(roleId)];
  const parts = [buildDatePrompt(), BASE_PROMPT];
  if (role && role.length > 0) parts.push(role);
  if (expertMode === 'expert') parts.push(EXPERT_MODE_PROMPT);
  parts.push(STYLE_PROMPT);
  return parts.join('\n\n');
}

function buildDatePrompt(): string {
  // Day-precision (not full ISO timestamp) on purpose — the system
  // prompt is cached with `cache_control: ephemeral` (5-min TTL,
  // refreshed on hits). Including HH:mm would bust that cache every
  // minute and cost ~10× extra input tokens per task. Day boundary
  // means the cache stays warm for 24 h of continuous traffic, and
  // "今天/最新/本月" queries get the correct anchor regardless.
  const now = new Date();
  const cstDate = now.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // YYYY/MM/DD → YYYY-MM-DD for ISO-style readability.
  const cstIso = cstDate.replace(/\//g, '-');
  return [
    '## 当前时间上下文',
    `当前日期：${cstIso}（北京时间）`,
    '用户时区：Asia/Shanghai (UTC+8)',
    '查询"最新"、"今天"、"本月"等信息时以上述日期为准。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Routing — model + effort + task budget per (intent, roleId)
// ---------------------------------------------------------------------------

/**
 * Effort levels supported by the Anthropic API. `xhigh` is Opus-4.7
 * only; `max` is Opus-tier only (Opus 4.6+). Sonnet 4.6 caps at
 * `high`. We never send sampling parameters (temperature etc) on
 * Opus 4.7 — they're removed there.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelChoice {
  readonly model: string;
  readonly effort: Effort;
}

/**
 * Roles that expand into long-horizon research / analysis. Worth the
 * Opus-4.7 + xhigh effort tier. The list is conservative — adding a
 * role here costs ~5× per output token; remove if it doesn't pay off
 * empirically.
 */
const COMPLEX_ROLES = new Set([
  'trend-researcher',
  'data-analyst',
  'financial-forecaster',
  'product-manager',
  'senior-pm',
  'legal-compliance',
  'contract-reviewer',
  'executive-briefing',
  'executive-summary',
  'dynamic-pricing',
  'brand-guardian',
  'xiaohongshu-expert',
]);

/**
 * Phase 24 RC follow-up — three-tier cost-optimised matrix:
 *
 *   simple  → Haiku 4.5 medium      (translation / glossary / SOP /
 *                                    single-sentence query)
 *   medium  → Sonnet 4.6 high       (default — analysis reports,
 *                                    proposals, competitive teardowns)
 *   complex → Sonnet 4.6 xhigh      (multi-step research, cross-domain
 *                                    synthesis, COMPLEX_ROLES)
 *
 * Opus is no longer auto-routed. RC cost data showed it cost ~5×
 * Sonnet xhigh per output token without a quality lift on our task
 * mix; budget pressure won out. Keyword-only — no extra Anthropic
 * call. `selectModelAndEffort` stays a pure function.
 *
 * Precedence: COMPLEX wins over SIMPLE wins over default. A prompt
 * mentioning both "翻译" and "跨领域综合分析" goes complex (Sonnet
 * xhigh) — the complex tag implies the more expensive ceiling is
 * worth it.
 */
const SIMPLE_KEYWORDS: readonly string[] = [
  '翻译', '术语表', '一句话', '简单查询', '单一查询',
  'sop', '标准操作流程',
  'translate ', 'translate.', 'glossary',
];

const COMPLEX_KEYWORDS: readonly string[] = [
  '多步骤', '跨领域', '综合分析', '深度研究', '深度调研',
  '全面调研', '系统性分析', '战略研究',
];

function hasAny(intent: string, keywords: readonly string[]): boolean {
  const lower = intent.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

export function selectModelAndEffort(intent: string, roleId: string): ModelChoice {
  // Complex wins first — preserves "specialist role + simple-keyword
  // prompt" routing to xhigh (a financial-forecaster asking for a
  // quick calc still benefits from the higher reasoning budget).
  if (COMPLEX_ROLES.has(resolvePromptRoleId(roleId)) || hasAny(intent, COMPLEX_KEYWORDS)) {
    return { model: 'claude-sonnet-4-6', effort: 'xhigh' };
  }
  // Simple — Haiku is enough for translation / glossary / SOP /
  // single-sentence queries. Massive cost saving when the daily
  // task mix is predominantly these.
  if (hasAny(intent, SIMPLE_KEYWORDS) || (roleId === 'none' && classifyAsSimpleSearch(intent))) {
    return { model: 'claude-haiku-4-5', effort: 'medium' };
  }
  // Default — Sonnet at high reasoning budget.
  return { model: 'claude-sonnet-4-6', effort: 'high' };
}

/**
 * Per-task token budget the model sees as a running countdown. Drives
 * `output_config.task_budget` — the model self-moderates as it
 * approaches the cap rather than abruptly hitting `max_tokens`.
 *
 * Buckets:
 *   - 50K  — simple-search no-role tasks
 *   - 100K — content-generation roles
 *   - 200K — research / analysis tasks
 *
 * Minimum supported by the API is 20K; all our buckets are well
 * above that. Distinct from `max_tokens` which is the per-response
 * ceiling — task_budget is the per-task envelope.
 */
const MEDIUM_BUDGET_ROLES = new Set(['content-creator', 'customer-service', 'tech-translator']);

export function getTaskBudget(intent: string, roleId: string): number {
  if (roleId === 'none' && classifyAsSimpleSearch(intent)) return 50_000;
  if (MEDIUM_BUDGET_ROLES.has(roleId)) return 100_000;
  return 200_000;
}
