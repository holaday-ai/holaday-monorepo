# Goal3：双端代表任务验收（进行中）

本报告记录实际测量与修复，不表示第三阶段或整批发布完成。基线为 Goal2 的 `4b6ea022`，有限批次计划在 `docs/superpowers/plans/2026-11-17-browser-assistant-representative-acceptance.md`。

## M1：公开页面真实模型测量与日期条件修复

| 任务 | 云端 | Chrome 插件 |
| --- | --- | --- |
| 第一张表筛出 Due ≥ 51，列姓名、金额、人数与合计 | 通过，3 次实际模型调用；Frank Bach 51、Jason Doe 100，2 人、合计151，与当前 DOM 一致。答案末尾对派生合计和姓名顺序作了保守的“未核实”附注，记录为交付体验问题 | 通过，3 次实际模型调用；同样交付2人、合计151，普通标签页活动状态和原输入保持 |
| Customer name=Session QA，只填不提交并截图；没有日期控件时说明 | 修复后通过，5 次实际模型调用；值保持、截图工具成功、实际 date 控件0、POST 0；无需用户介入 | **未通过**，2 次实际模型调用；实际已填写、未提交，普通标签页保持；模型如实报告选中会话没有截图/文件生成工具，未假称完成。截图能力仍需补齐 |

公开站点分别为 `https://the-internet.herokuapp.com/tables` 和 `https://httpbin.org/forms/post`。表格预期由运行时实际第一张表 DOM 独立产生；不把预设模型答案当预期。截图证据区分产品截图工具回执与测试程序留证，不能用测试截图替代用户任务交付。

### 首批问题及归因

- `goal3-public-batch-01`：云端表格通过；云端表单已有成功填值和截图回执，完成门禁却把“如果没有日期控件，请如实说明”当作必须填写日期，要求继续查找，随后页面离开已填表单。最初测试的最终字段查询超时，未冻结 runner 最终 outcome；保留原始模型/动作记录，不事后补造该状态。
- Chrome 首批两项在模型前取消，实际模型调用0。测试装配把合成页面放在工作台认证来源上，触发正常登出；还使用了未由插件签发的 selectionId。修正为不同的 localhost/127.0.0.1 来源并通过真实 `tabs` 协议取得选择回执。原生 open/close、控制状态和进程退出已验证，未放宽产品所有权规则。
- 日期反例先在 `fix24.test.ts` 观察 RED，再增加 `asksToFillDateControl`，仅移除“缺失时说明”条件中的日期动作要求。独立、明确的填写日期要求仍保留；旧公开兼容用例改为明确请求日期控件，继续核对诚实部分交付。
- `goal3-public-batch-02`：只重测云端表单和两项 Chrome，2项通过、1项因截图缺口诚实失败。没有重跑已通过的云端表格。Chrome 截图是已确认方案中的任务目标能力，接续修复，不把该项改小后计通过。

### 当前验证与证据边界

- 202 项相关回归、10 项日期条件分类（已包含于202项）及捕获真实反例的回归通过；定向类型2048MB、静态检查通过。
- 修复后路由74项、拦截24项通过。明确日期请求的真实公开表单兼容通过，实际模型批次默认关闭时4项均跳过。
- Node22.23.3、Chromium147.0.7727.15。Chrome 是实际产品 background/selected 协议和原生浏览器；WS主机与认证为本机 fixture。云端使用真实 managed executor。生产默认JWT/SQL认证和实例恢复证据沿用未改模块的 Goal1/2 冻结版本，不把本次 fixture 认证当作生产认证验收。
- 候选为全新 QA profile 中的 unpacked `HOLA DAY · Local QA` 0.0.3，仅授权 localhost、127.0.0.1、httpbin和the-internet。未核实用户已安装版或商店渠道一致；该 QA manifest 不作为正式交付包。
- 普通标签页活动状态及输入保持已在两项实际 Chrome 模型任务核对；这不等于物理 OS 输入测试。两个批次原生进程均退出，0 POST，无真实账号或生产开关改动。
- 模型为实际国际千问 `qwen3.8-max`，复用既有 provider 配置，凭据只在测试子进程内存中使用。远端目录只读核对的默认 browser 模型也为该型号；读取的部署配置 rollout 为 off、启用列表不含 browser，未将配置文件快照当作运行进程状态。

证据根目录：`/Users/yaleiqi/.holaday-recovery/tasks/browser-assistant-next`。首批在 `goal3-public-batch-01`，修复后批次在 `goal3-public-batch-02`，原生选择会话在 `goal3-native-open-selected`。M1提交、源码冻结和检查日志由 `goal3-M1-validation.json` 记录。

### 模型费用记录

两个批次共21次实际模型调用和21次HTTP请求，保存每次 token usage、HTTP状态、请求标识与耗时。实际 provider 账单未查询，不能记作0或记作已结算。按核对时的 [官方 qwen3.8-max 价格](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-8-max)，未计缓存和活动折扣的 token 标价估算合计约0.33美元。分项在各批次 `cost-estimate.json`，汇总在 `goal3-M1-costs.json`，与实际扣费分列。

## 下一步与未执行项

1. 补齐 Chrome 任务目标绑定的截图能力：复用已有驱动截图实现，不能调用当前活动页截图冒充任务页截图；保留原 owner/origin、终态、人工输入与晚到结果保护，截图失败不能宣称完成。
2. 只复测受影响的 Chrome 表单与截图边界，补必要相关检查，不展开大矩阵。
3. 完成每端一条受控文件闭环及页面变化/人工介入/取消/恢复的证据对照；实际文件字节、统计、归属、网站接收与历史重新读取分别核对。
4. 汇总所有阶段证据、自审并冻结 Goal3；之后才进入 Goal4 候选/迁移状态/回滚/PR准备。KMS、可信真实站点适配器、真实账号及物理输入仍不得记为已验。

本批尚未合并、部署或执行正式全量检查。
