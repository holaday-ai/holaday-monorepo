import type { UiSkill, UiSkillSelection } from '@/types/task';

export type SkillCategory = UiSkill['category'];

export interface SkillGroup<TSkill extends Pick<UiSkill, 'category'>> {
  readonly category: SkillCategory;
  readonly items: readonly TSkill[];
}

export const SKILL_CATEGORY_ORDER: readonly SkillCategory[] = ['内容运营', '分析决策', '管理协作'];

export interface SkillToggleSnapshot {
  readonly enabled: boolean;
}

export interface SkillLoadErrorCopy {
  readonly title: string;
  readonly body: string;
}

export interface SkillLimitBannerCopy {
  readonly title: string;
  readonly body: string;
}

export interface SkillTaskDraft {
  readonly skillId: string;
  readonly skillName: string;
  readonly skillSource: 'manual' | 'suggested';
  readonly prompt: string;
}

export type SkillStartDecision = 'start' | 'enable-and-start' | 'blocked';

export interface SkillIntentMatch<TSkill extends UiSkill = UiSkill> {
  readonly skill: TSkill;
  readonly score: number;
}

export interface SkillIntentMatchResult<TSkill extends UiSkill = UiSkill> {
  readonly confidence: 'strong' | 'low';
  readonly matches: readonly SkillIntentMatch<TSkill>[];
}

const SHOWCASE_SKILL_IDS = [
  'data-report-insight',
  'social-media-strategy',
  'contract-risk-review',
] as const;

const NON_SPECIFIC_INTENT_TERMS = new Set([
  '分析',
  '评估',
  '判断',
  '处理',
  '查看',
  '比较',
  '对比',
  '总结',
  '建议',
  '方案',
  '计划',
  '风险',
  '市场',
  '数据',
  '内容',
  '异常',
  '项目',
  '产品',
]);

const CAPABILITY_TASK_EVIDENCE: Readonly<Record<string, RegExp>> = {
  'douyin-live-ops':
    /(?:直播|视频|内容|脚本|投流|流量|广告|涨粉|播放|运营|复盘|数据|发布|剪辑)/,
  'xiaohongshu-seeding-ops':
    /(?:笔记|种草|内容|选题|发布|投薯条|投流|流量|运营|标题|封面|互动|数据)/,
  'wechat-article-ops':
    /(?:文章|推文|长文|选题|排版|标题|阅读量|内容|运营|发布|撰写|改写|摘要)/,
  'social-media-strategy':
    /(?:社媒|社交媒体|全平台|内容|矩阵|定位|发布|节奏|运营|复盘|数据|受众|品牌|策略)/,
  'image-prompt-reverse':
    /(?:图片|图像|照片|画面|参考图|提示词|prompt|反推|风格|构图|光线|材质|负面词|主体特征|肖像)/,
  'a-share-market-briefing':
    /(?:股票|个股|a股|行情|股市|大盘|涨跌|异动|行业|风险|走势|成交|买入|卖出)/,
  'contract-risk-review': /(?:合同|条款|协议|签约|谈判|甲方|乙方|法务|审查)/,
  'market-competitor-insight':
    /(?:竞品|市场|洞察|调研|swot|机会点|定位|规模|趋势|差异化)/,
  'data-report-insight':
    /(?:数据|报表|表格|kpi|归因|指标|图表|周报|复购率|相关性|相关关系|因果)/,
  'product-plan-drafting': /(?:产品|需求|prd|方案|原型|功能|用户|验收|mvp)/,
  'project-delivery-management': /(?:项目|推进|里程碑|排期|任务|进度|延期|负责人|依赖)/,
  'resume-search-screening':
    /(?:简历|招聘|候选人|人才|面试|jd|岗位|职位|筛选|过滤|录用)/,
  'performance-review-design': /(?:绩效|考核|kpi|okr|评估|制度|评分|指标|权重)/,
};

const STOCK_DECISION_CONFLICTS: readonly RegExp[] = [
  /荐股/,
  /(?:帮我|替我|给我|请|直接)?(?:推荐|选|挑)(?:出|一下)?(?:一只|几只|一些)?(?:股票|个股|a股)/,
  /(?:买|卖|选|挑)(?:哪只|哪些)(?:股票|个股|a股)/,
  /(?:股票|个股|a股).{0,5}(?:能不能|可不可以|要不要|该不该|是否|值不值得).{0,3}(?:买|卖|买入|卖出)/,
  /(?:能不能|可不可以|要不要|该不该|是否|值不值得).{0,3}(?:买|卖|买入|卖出).{0,5}(?:股票|个股|a股)/,
  /(?:股票|个股|a股).{0,4}值得买/,
  /(?:股票|个股|a股).{0,6}(?:是否|值不值得|值得|适不适合|适合|可不可以|能不能).{0,4}投资/,
  /(?:是否|值不值得|值得|适不适合|可不可以|能不能).{0,4}投资.{0,8}(?:股票|个股|a股)/,
  /^(?:建议|推荐)(?:我)?(?:投资|买入|持有).{0,12}(?:股票|个股|a股)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|立即|马上|执行|决定|去)?(?:买入|卖出|买|卖|下单|清仓|建仓|加仓|减仓)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|立即|马上|执行|决定|去)?交易(?:这只|那只|该只|某只)?(?:股票|个股|a股)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|立即|马上|执行|决定|去|做|进行)?交易(?!的?(?:量|数据|记录|明细|统计|分析|信号|复盘|历史|原因|逻辑|影响|风险|趋势|回测|研究))/,
  /(?:执行|进行)(?:股票|个股|a股)?交易(?!的?(?:量|数据|记录|明细|统计|分析|信号|复盘|历史|原因|逻辑|影响|风险|趋势|回测|研究))/,
  /把.{0,8}(?:股票|个股|a股).{0,4}(?:买入|卖出|买下|购买|购入|卖掉|抛掉|抛售|出掉|下单|清仓|建仓|加仓|减仓)/,
  /(?:帮我|替我|给我|代我|为我).{0,6}(?:炒|炒作).{0,4}(?:股票|个股|a股)/,
  /^(?:买入|卖出|买|卖|下单)(?:这只|那只|该只|某只|一只|几只|一些)?(?:股票|个股|a股)/,
  /^(?:买入|买进|购入|购买|卖出|卖掉|抛掉|抛售|买|卖|下单).{1,12}(?:股票|个股|a股)(?!的?(?:历史|交易记录|收益|走势|表现|数据|复盘|分析))/,
  /^(?:清仓|加仓|减仓|建仓|卖掉|抛掉|抛售|购买|购入|买进|交易)(?:这只|那只|该只|某只|一只|几只|一些)?(?:股票|个股|a股)/,
  /^下单(?:买入|卖出|买|卖)?(?:这只|那只|该只|某只|一只|几只|一些)?(?:股票|个股|a股)/,
  /(?:分析完后|解释完后|研究完后|看完后|然后|之后|再|最后)(?:直接|立即|马上)?(?:买入|卖出|买|卖|下单|清仓|建仓|加仓|减仓)(?:这只|那只|该只|某只|一只|几只|一些)?(?:股票|个股|a股)/,
  /(?:股票|个股|a股).{0,4}(?:买入|卖出|买下|卖掉|下单|清仓|建仓|加仓|减仓)$/,
  /(?:买入|卖出|投资)(?:建议|意见|结论)/,
];

const HIRING_DECISION_EXPLANATION = /(?:分析|解释|说明|复盘|研究).{0,10}(?:为什么|为何|原因|依据|逻辑)/;
const HIRING_DISCRIMINATION_AUDIT =
  /^(?:分析|解释|说明|复盘|研究|检查|审查|评估|识别).{0,40}(?:为什么|为何|原因|是否|有无|存在|做法|要求|规则|政策).{0,20}(?:歧视|合规|风险|问题|不招|只招|筛选|筛掉|过滤|过滤掉)/;
const HIRING_DISCRIMINATION_ACTION_RISK_AUDIT =
  /^(?:分析|解释|说明|复盘|研究|检查|审查|评估|识别).{0,40}(?:只招|只录用|筛掉|过滤掉|排除|淘汰|拒绝).{0,24}(?:歧视|合规|风险|问题|后果)/;

const SPECIFIC_ETHNICITY_TERM =
  '(?:(?:汉|回|蒙古|藏|维吾尔|苗|彝|壮|布依|朝鲜|满|侗|瑶|白|土家|哈尼|哈萨克|傣|黎|傈僳|佤|畲|高山|拉祜|水|东乡|纳西|景颇|柯尔克孜|土|达斡尔|仫佬|羌|布朗|撒拉|毛南|仡佬|锡伯|阿昌|普米|塔吉克|怒|乌孜别克|俄罗斯|鄂温克|德昂|保安|裕固|京|塔塔尔|独龙|鄂伦春|赫哲|门巴|珞巴|基诺)族)';
const SPECIFIC_RACIAL_IDENTITY_TERM =
  '(?:黑人|白人|亚裔|非裔|拉丁裔|阿拉伯裔|欧洲裔|黄种人|黑种人|白种人|棕色人种|棕种人)';
const SPECIFIC_RELIGIOUS_IDENTITY_TERM =
  '(?:基督徒|穆斯林|佛教徒|道教徒|天主教徒|东正教徒|新教徒|圣公会教徒|摩门教徒|耶和华见证人|伊斯兰教徒|犹太教徒|印度教徒|锡克教徒|巴哈伊教徒|神道教徒|耆那教徒|萨满教徒|无神论者)';
const SPECIFIC_NATIONALITY_TERM =
  '(?:(?:[一-龥]{1,5}国|日本|俄罗斯|加拿大|澳大利亚|新加坡|印度|巴西|墨西哥|阿根廷|意大利|西班牙|葡萄牙|荷兰|比利时|瑞士|瑞典|挪威|丹麦|芬兰|波兰|乌克兰|希腊|埃及)(?:籍|人)|(?:日|俄|美|英|法|德|韩)籍)';
const SENSITIVE_IDENTITY_TERM =
  `(?:性别|性取向|同性恋|异性恋|双性恋|无性恋|年龄|\\d{1,3}岁(?:以下|以上|以内|以外)?|民族|${SPECIFIC_ETHNICITY_TERM}|种族|${SPECIFIC_RACIAL_IDENTITY_TERM}|宗教|${SPECIFIC_RELIGIOUS_IDENTITY_TERM}|残障|残疾|婚姻|婚育|孕育|怀孕|户籍|籍贯|出生地|国籍|${SPECIFIC_NATIONALITY_TERM}|政治面貌|健康状况|疾病|男性|女性|男士|女士|男(?=候选人|人才|简历|员工|人员|生|$)|女(?=候选人|人才|简历|员工|人员|生|$)|孕妇|已婚|未婚)`;

const HIRING_ANTI_DISCRIMINATION = new RegExp(
  `^(?:请)?(?:不要|禁止|不得|避免|防止)(?:再)?(?:基于|按照|根据|按|依据|以).{0,4}${SENSITIVE_IDENTITY_TERM}.{0,8}(?:筛选|过滤|招聘|招|找|选择|选|挑|排序|排名|分组|淘汰|拒绝|录用)(?:候选人|人才|简历)?(?:并)?(?:检查|分析|说明|识别|评估)?(?:合规|歧视|风险|问题)?$`,
);
const HIRING_DIRECT_ANTI_DISCRIMINATION = new RegExp(
  `^(?:请)?(?:不要|禁止|不得|避免|防止)(?:再)?(?:筛选|过滤(?:掉)?)${SENSITIVE_IDENTITY_TERM}(?:候选人|人才|简历)?(?:并)?(?:检查|分析|说明|识别|评估)?(?:合规|歧视|风险|问题)?$`,
);

const HIRING_DISCRIMINATION_CONFLICTS: readonly RegExp[] = [
  new RegExp(
    `(?:基于|按照|根据|按|依据|以).{0,4}${SENSITIVE_IDENTITY_TERM}.{0,8}(?:筛选|过滤|招聘|招|找|选择|选|挑|排序|排名|分组|淘汰|拒绝|录用)`,
  ),
  new RegExp(`(?:只招|只要|仅限|只选|只筛选|仅筛选).{0,6}${SENSITIVE_IDENTITY_TERM}`),
  new RegExp(`(?:只录用|仅录用).{0,6}${SENSITIVE_IDENTITY_TERM}`),
  new RegExp(
    `(?:筛选|过滤|挑选|选择|录用|招聘|招|找).{0,4}${SENSITIVE_IDENTITY_TERM}`,
  ),
  new RegExp(
    `(?:筛掉|过滤掉|排除|拒绝|淘汰|不招|不录用|不要)(?:招聘|录用|选择|筛选|要)?${SENSITIVE_IDENTITY_TERM}`,
  ),
  new RegExp(`优先(?:考虑|面试|邀约|招聘|录用|选择|筛选|推荐)?${SENSITIVE_IDENTITY_TERM}`),
  new RegExp(
    `${SENSITIVE_IDENTITY_TERM}(?:候选人|人才|简历)?.{0,4}(?:优先(?:招聘|录用|选择|筛选)?|筛掉|过滤掉|不要|排除|拒绝|淘汰|不招|不录用)`,
  ),
];

const HIRING_MIXED_DISCRIMINATION_ACTION = new RegExp(
  `(?:然后|之后|再|完成后|检查后|分析后|规则后).{0,10}(?:只招|只要|仅限|只选|只筛选|仅筛选|只录用|筛选|过滤|挑选|选择|录用|招聘|优先考虑).{0,6}${SENSITIVE_IDENTITY_TERM}`,
);

const CONTENT_EXECUTION_SKILL_IDS = new Set([
  'douyin-live-ops',
  'xiaohongshu-seeding-ops',
  'wechat-article-ops',
  'social-media-strategy',
]);

const CONTENT_UNAMBIGUOUS_EXECUTION_CONFLICTS: readonly RegExp[] = [
  /(?:并|然后|再|之后|后)(?:仍然|仍|还|继续|一键|直接|自动|马上|立即)?(?:发布|发表|上线|上传|推送|发到|发至|发出去)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我|自动)(?:直接|自动|马上|立即|去)?(?:发布|发表|上线|上传|发到|发至)/,
  /(?:帮我|替我|给我|请|代我|为我)(?:把|将)?.{0,24}(?:发布出去|发出去|发到|发至|发表|上线|上传到?|推送)/,
  /^(?:把|将).{0,24}(?:发布出去|发出去|发到|发至|发表|上线|上传到?|推送)/,
  /^(?:发一下|推送)(?:这篇|这条|该篇|该条|内容|文章|笔记|视频)/,
  /^(?:一键|直接|立即|马上|自动)?推送(?:这篇|这条|该篇|该条|内容|文章|笔记|视频)/,
  /(?:在|到).{0,10}(?:上|平台)(?:发布|发表|上线|上传)/,
  /(?:写好|改好|准备好|完成)(?:之后|后|然后)(?:直接|自动)?(?:发布|发表|上线|上传|发到|发至)/,
  /^(?:投流|投放广告|投广告|买量|投放)(?:这篇|这条|该篇|该条|内容|文章|笔记|视频|抖音|小红书)/,
  /^(?:把|将).{0,20}(?:投流|投放.{0,6}广告|投广告|买量|投薯条)/,
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我|自动)(?:直接|自动|马上|立即|去)?(?:投流|投放.{0,6}广告|投广告|买量)/,
  /(?:给|替).{0,16}(?:投流|投放.{0,6}广告|投广告|买量|投薯条)/,
  /帮(?:这篇|这条|该篇|该条|内容|文章|笔记|视频|账号|品牌).{0,8}(?:投流|投放.{0,6}广告|投广告|买量|投薯条)/,
];

const CONTENT_LEADING_EXECUTION =
  /^(?:一键|直接|立即|马上|自动)?(?:发布|发表|上线|上传)(?:全平台)?(?:这篇|这条|该篇|该条|内容|文章|笔记|视频)/;
const CONTENT_LEADING_PLANNING =
  /^(?:发布内容|发布).{0,8}(?:怎么|如何)(?:规划|计划|安排)|^发布节奏.{0,8}(?:规划|计划|安排)/;
const CONTENT_PROMISE_VERB = /(?:保证|承诺|确保|保底)/g;
const CONTENT_OUTCOME = /(?:销量|流量|涨粉|转化|播放量|爆款|热门|热搜)/;
const CONTENT_PROMISE_NEGATION =
  /(?:(?:无法|不能|难以|不应|不要|无需|不可能|不再)(?:百分百|百分之百|100|完全|绝对|真正|一定|有效)?|不)$/;
const CONTENT_PROMISE_DOUBLE_NEGATION =
  /(?:不得|不能|不会|不可|不是|并非|不应|无需|不要|不一定|未必)不$/;
const CONTENT_PROMISE_POST_NEGATION = /^(?:不了|不到|不住|不能(?!(?:低于|少于)))/;

const SKILL_BOUNDARY_CONFLICTS: Readonly<Record<string, readonly RegExp[]>> = {
  'image-prompt-reverse': [
    /(?:保证|承诺|确保).{0,24}(?:完全复现|完全还原|一模一样|百分百一致|100一致)/,
    /(?:未授权|没有授权|未经授权|未经许可|没有许可|无授权).{0,16}(?:直接|拿去)?(?:商用|商业使用|用于商业)/,
    /(?:商用|商业使用|用于商业).{0,16}(?:但|却|而|同时)?(?:未授权|没有授权|未经授权|未经许可|没有许可|无授权)/,
  ],
  'contract-risk-review': [
    /(?:出具|提供|给出).{0,6}(?:正式)?法律意见/,
    /(?:代替|替代).{0,6}(?:律师|法律顾问).{0,6}(?:判断|决定|意见|签字|审核)/,
    /(?:当成|视为|作为|等同于).{0,8}(?:律师)?(?:正式)?(?:法律)?意见/,
  ],
  'market-competitor-insight': [
    /(?:无法核实|未核实|没有核实|未经核实).{0,16}(?:直接)?(?:写成|当成|视为|作为).{0,4}(?:事实|结论)/,
    /(?:无法核实|没法验证|无法验证|未核实|未经核实).{0,18}(?:不要|无需|不用|不必).{0,6}(?:标注|注明|说明).{0,4}(?:待确认|推断|未核实)/,
  ],
  'data-report-insight': [
    /(?:相关性|相关关系).{0,16}(?:直接)?(?:写成|当成|视为|认定为|解释(?:为|成)|表述(?:为|成)|描述(?:为|成)|说成|归结(?:为|成)|归因(?:为|成)).{0,4}(?:因果|因果关系|因果结论)/,
    /(?:相关性|相关关系).{0,12}直接(?:证明|得出).{0,4}(?:因果|因果关系|因果结论)/,
    /(?:相关性|相关关系).{0,12}(?:断定|认定|确定).{0,4}(?:因果|因果关系|因果结论)/,
  ],
  'product-plan-drafting': [
    /(?:自动|替我|代我|直接).{0,8}(?:批准|通过).{0,10}(?:需求|方案)/,
    /(?:替|代替).{0,8}(?:研发|技术团队).{0,8}(?:确认|评估|决定).{0,12}(?:技术)?可行/,
    /(?:产品|需求|方案).{0,12}(?:后|然后|再).{0,8}(?:替我|代我|直接)?(?:拍板|批准|通过)/,
    /(?:直接|自动)(?:认定|确认|决定).{0,12}(?:产品|需求|方案).{0,8}(?:技术)?可行/,
    /(?:产品|功能|这个)?.{0,8}(?:需求|方案).{0,8}(?:盖章|拍板)(?:通过|放行)/,
  ],
  'project-delivery-management': [
    /(?:未经授权|自动|替我|代我).{0,10}(?:指派|分配|修改).{0,14}(?:项目|任务|负责人)/,
    /(?:未经授权|自动|替我|代我).{0,10}(?:把|将)?.{0,14}(?:项目|任务|负责人).{0,8}(?:指派|分配|修改|改成|改为)/,
    /(?:替|代替).{0,8}(?:团队|负责人|项目组).{0,8}(?:承诺|确认|决定).{0,12}(?:最终)?(?:排期|截止时间|交付时间)/,
    /(?:替我|代我|为我).{0,8}(?:向客户|对客户)?.{0,6}承诺.{0,12}(?:项目)?.{0,6}(?:最终)?(?:排期|截止时间|交付时间)/,
  ],
  'performance-review-design': [
    /(?:替我|代我|自动|直接).{0,8}(?:做|作出|给出)?(?:绩效|考核|hr|管理)?(?:决定|决策|结论)/,
    /(?:根据|按照|按|依据).{0,6}(?:绩效|考核).{0,10}(?:直接|自动)(?:决定|执行).{0,8}(?:涨薪|降薪|辞退|解雇|晋升|降职|奖金|薪酬)/,
    /(?:绩效|考核).{0,12}(?:后|然后|再).{0,6}(?:直接)?(?:决定|执行).{0,8}(?:涨薪|降薪|辞退|解雇|晋升|降职|奖金|薪酬)/,
    /(?:根据|按照|按|依据).{0,6}(?:绩效|考核).{0,10}(?:给|让).{0,4}(?:员工|人员)?.{0,4}(?:涨薪|降薪|辞退|解雇|晋升|降职|奖金|薪酬)/,
    /(?:根据|按照|按|依据).{0,6}(?:绩效|考核).{0,10}(?:辞退|解雇|晋升|降职|涨薪|降薪|发放奖金).{0,4}(?:员工|人员)?/,
    /(?:绩效|考核).{0,12}(?:后|然后|再).{0,8}(?:把|将)?.{0,4}(?:员工|人员).{0,4}(?:开了|辞退|解雇)/,
  ],
};

const SKILL_BOUNDARY_SAFE_MENTIONS: Readonly<Record<string, readonly RegExp[]>> = {
  'image-prompt-reverse': [
    /^(?:分析|说明|解释|检查|审查|评估)?(?:为什么)?(?:不|不能|无法|难以|不应|不要|无需|不可能).{0,20}(?:保证|承诺|确保).{0,24}(?:复现|还原|一模一样|一致)/,
    /^(?:分析|检查|审查|评估).{0,30}(?:保证|承诺|确保).{0,24}(?:复现|还原|一模一样|一致).{0,12}(?:风险|问题|后果|是否可行)/,
  ],
  'contract-risk-review': [
    /^(?:分析|说明|解释|检查|审查|评估).{0,30}(?:不能|无法|不构成|不应).{0,8}(?:替代|代替|作为).{0,8}(?:律师|法律意见)/,
    /^(?:分析|检查|审查|评估).{0,24}(?:出具|提供|给出).{0,8}(?:正式)?法律意见.{0,16}(?:是否超出|风险|合规|边界|范围|问题)/,
  ],
  'market-competitor-insight': [
    /^(?:分析|说明|解释|检查|审查|评估).{0,36}(?:是否|有没有|有无).{0,12}(?:写成|当成|标注|核实|验证)/,
  ],
  'data-report-insight': [
    /^(?:分析|说明|解释|检查|审查|评估).{0,30}(?:不能|无法|不足以|不应).{0,8}(?:直接)?(?:证明|认定|断定|得出|解释(?:为|成)|表述(?:为|成)|描述(?:为|成)|说成|归结(?:为|成)|归因(?:为|成)).{0,6}(?:因果|因果关系|因果结论)/,
  ],
  'product-plan-drafting': [
    /^(?:分析|说明|解释|检查|审查|评估).{0,30}(?:为什么)?(?:不能|无法|不应|不要).{0,8}(?:自动|替我|代我|直接)?(?:批准|通过|确认|认定|拍板)/,
    /^(?:分析|检查|审查|评估).{0,24}(?:自动|替我|代我|直接)?(?:批准|通过|确认|认定|拍板).{0,18}(?:为什么|风险|合规|边界|问题|后果)/,
  ],
  'project-delivery-management': [
    /^(?:分析|说明|解释|检查|审查|评估).{0,30}(?:为什么)?(?:不能|无法|不应|不要).{0,10}(?:替|代替|自动|未经授权).{0,20}(?:承诺|指派|分配|修改)/,
  ],
  'performance-review-design': [
    /^(?:分析|说明|解释|检查|审查|评估).{0,30}(?:为什么)?(?:不能|无法|不应|不要).{0,14}(?:根据|按照)?.{0,8}(?:绩效|考核).{0,12}(?:决定|执行|涨薪|降薪|辞退|晋升)/,
    /^(?:分析|检查|审查|评估).{0,24}(?:根据|按照)?.{0,8}(?:绩效|考核).{0,12}(?:直接)?(?:决定|执行|涨薪|降薪|辞退|晋升).{0,16}(?:风险|合规|边界|问题|后果)/,
  ],
};

const HIRING_DIRECT_DECISION_CONFLICTS: readonly RegExp[] = [
  /(?:帮我|替我|给我|请|直接|立即|马上|代我|为我)(?:直接|最终|马上|立即|决定|选择)?(?:录用|淘汰|拒绝)/,
  /(?:帮我|替我|给我|请|直接|代我|为我)(?:直接|最终)?(?:选择|选|挑)(?:一位|一个|几位|一些)?(?:候选人|人才).{0,4}(?:录用|淘汰|拒绝)/,
  /(?:帮我|替我|给我|请|代我|为我)(?:做|给出|作出)?(?:录用|招聘|用人)?(?:决定|决策|结论)/,
  /^(?:决定|决策).{0,4}(?:是否|要不要|该不该|能否)?(?:录用|淘汰|拒绝)/,
  /(?:再|然后|之后|最后)(?:决定|决策).{0,4}(?:是否|要不要|该不该|能否)?(?:录用|淘汰|拒绝)/,
  /(?:选出|选择|挑出).{0,3}(?:最终录用|录用|最终)(?:人选|候选人|人才)/,
  /^(?:录用|淘汰|拒绝)(?:这份|该份|一份|这些|这位|该位|这个|该|哪个|哪些)?(?:简历|候选人|人才)/,
  /(?:并|然后|之后|再|最后)(?:直接|最终|马上|立即)?(?:录用|淘汰|拒绝)/,
];

const HIRING_DECISION_CONFLICTS: readonly RegExp[] = [
  /(?:录用|淘汰|拒绝)(?:这份|该份|一份|这些|这位|该位|这个|该|哪个|哪些)?(?:简历|候选人|人才)/,
  /(?:简历|候选人|人才)(?:是否|要不要|该不该|应不应该|能否)(?:录用|淘汰|拒绝)/,
];

const CONNECTOR_LABELS: Readonly<Record<string, string>> = {
  browser: '浏览器',
  douyin: '抖音',
  xiaohongshu: '小红书',
  'wechat-official-account': '微信公众号',
  'image-understanding': '图片理解',
  'image-generation': '图片生成',
  'a-share-market-data': 'A 股行情数据',
  'document-parser': '文档解析',
  'web-search': '网页搜索',
  spreadsheet: '表格',
  database: '数据库',
  'recruiting-sites': '招聘网站',
};

const DEFAULT_SKILL_BOUNDARY = '执行前请确认输入材料、授权范围和最终用途。';

const PLAN_LABELS: Record<string, string> = {
  free: '体验版',
  basic: '基础版',
  pro: '专业版',
};

export function skillPlanLabel(planId: string): string {
  return PLAN_LABELS[planId] ?? '当前套餐';
}

export function groupSkillsByCategory<TSkill extends Pick<UiSkill, 'category'>>(
  skills: readonly TSkill[],
): readonly SkillGroup<TSkill>[] {
  const grouped = new Map<SkillCategory, TSkill[]>();
  for (const skill of skills) {
    const items = grouped.get(skill.category) ?? [];
    items.push(skill);
    grouped.set(skill.category, items);
  }

  return SKILL_CATEGORY_ORDER.map((category) => ({
    category,
    items: grouped.get(category) ?? [],
  })).filter((group) => group.items.length > 0);
}

export function skillPageSummary(options: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly totalCount: number;
  readonly enabledCount: number;
  readonly cap: number;
  readonly planId: string;
}): string {
  if (options.loading) return '任务选项加载中…';
  if (options.error) return '任务选项暂时无法加载';
  if (options.totalCount === 0) return '暂无可开始的任务';
  if (options.cap <= 0) {
    return `${skillPlanLabel(options.planId)}可查看任务示例`;
  }
  if (options.cap > 0) {
    if (options.enabledCount > options.cap) {
      return `已保留 ${options.enabledCount} 项常用能力 · ${skillPlanLabel(options.planId)}上限 ${options.cap}`;
    }
    return `常用能力 ${options.enabledCount} / ${options.cap} · ${skillPlanLabel(options.planId)}`;
  }
  return `已加载 ${options.totalCount} 项任务 · ${skillPlanLabel(options.planId)}`;
}

export function skillLoadErrorCopy(message: string | null | undefined): SkillLoadErrorCopy {
  const body =
    typeof message === 'string' && message.trim()
      ? message.trim()
      : '请稍后重试，或刷新页面后再打开能力中心。';
  return {
    title: '任务选项暂时无法加载',
    body,
  };
}

export function skillLimitMessage(options: {
  readonly cap: number;
  readonly planId: string;
}): string {
  if (options.cap <= 0) return '当前套餐暂不支持开始此任务';
  if (options.planId === 'pro') return `当前套餐的常用能力已满（${options.cap} 项）`;
  return `常用能力已满（${options.cap} 项）· 可先移除一项或升级套餐`;
}

export function skillLimitBannerCopy(options: {
  readonly cap: number;
  readonly enabledCount: number;
  readonly planId: string;
}): SkillLimitBannerCopy {
  if (options.cap <= 0) {
    return {
      title: '当前套餐可查看任务示例',
      body: '升级到基础版后即可选择并开始任务；专业版可使用全部 13 类任务。',
    };
  }
  if (options.enabledCount > options.cap) {
    return {
      title: `当前已保留 ${options.enabledCount} 项常用能力`,
      body: `${skillPlanLabel(options.planId)}最多保留 ${options.cap} 项。现有任务仍可使用；移除后才能添加新的常用能力。`,
    };
  }
  return {
    title: `常用能力已满（${options.cap} 项）`,
    body:
      options.planId === 'pro'
        ? '当前套餐支持的能力已全部加入常用。'
        : '开始其他任务前，可先移除一项常用能力，或升级套餐。',
  };
}

export function skillCardBadge(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
  readonly cap?: number;
}): string {
  if (options.pending) return '保存中…';
  if (!options.enabled && options.limitBlocked && (options.cap ?? 1) <= 0) return '暂不可用';
  if (!options.enabled && options.limitBlocked) return '已达上限';
  return options.enabled ? '常用' : '加入常用';
}

export function skillCardUsageHint(options: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly limitBlocked?: boolean;
  readonly cap?: number;
}): string {
  if (options.pending) return '正在保存';
  if (options.enabled && (options.cap ?? 1) <= 0) {
    return '当前套餐暂不可使用';
  }
  if (!options.enabled && options.limitBlocked && (options.cap ?? 1) <= 0) {
    return '当前套餐暂不可使用';
  }
  if (!options.enabled && options.limitBlocked) return '先移除一项常用能力';
  return options.enabled ? '已加入常用' : '可加入常用';
}

export function skillTaskDraft(
  skill: Pick<UiSkill, 'id' | 'name' | 'description'>,
  starterPrompt?: string,
  skillSource: SkillTaskDraft['skillSource'] = 'manual',
): SkillTaskDraft {
  const id = safeSkillText(skill.id);
  const name = safeSkillText(skill.name) || '技能';
  const prompt = safeSkillText(starterPrompt);
  return {
    skillId: id,
    skillName: name,
    skillSource,
    prompt:
      skillSource === 'suggested'
        ? prompt
        : prompt
          ? `@${name} ${prompt}`
          : `@${name} `,
  };
}

export function skillSelectionFromTaskDraft(draft: {
  readonly skillId?: unknown;
  readonly skillName?: unknown;
  readonly skillSource?: unknown;
} | null): UiSkillSelection | null {
  if (!draft || (draft.skillSource !== undefined && draft.skillSource !== 'manual')) return null;
  const skillId = typeof draft.skillId === 'string' ? draft.skillId.trim() : '';
  const skillName = typeof draft.skillName === 'string' ? draft.skillName.trim() : '';
  if (!skillId || !skillName) return null;
  return { skillId, skillName, skillSource: 'manual' };
}

export function skillStartDecision(options: {
  readonly enabled: boolean;
  readonly enabledCount: number;
  readonly cap: number;
}): SkillStartDecision {
  if (options.enabled) return 'start';
  if (options.cap <= 0 || options.enabledCount >= options.cap) return 'blocked';
  return 'enable-and-start';
}

export function pickCapabilityShowcase<TSkill extends { readonly id: string }>(
  skills: readonly TSkill[],
): readonly TSkill[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const selected: TSkill[] = [];
  for (const id of SHOWCASE_SKILL_IDS) {
    const skill = byId.get(id);
    if (skill) selected.push(skill);
  }
  for (const skill of skills) {
    if (selected.length >= SHOWCASE_SKILL_IDS.length) break;
    if (!selected.some((item) => item.id === skill.id)) selected.push(skill);
  }
  return selected;
}

export function matchSkillsForIntent<TSkill extends UiSkill>(
  skills: readonly TSkill[],
  intent: string,
): SkillIntentMatchResult<TSkill> {
  const normalizedIntent = normalizeMatchText(intent);
  const boundaryIntent = normalizeBoundaryText(intent);
  const intentPairs = characterPairs(normalizedIntent);
  const skillDocuments = skills.map((skill) => normalizeSkillIntentDocument(skill));
  const scoredSkills = skills.map((skill, index) => {
    const evidence = scoreSkillIntent(skill, normalizedIntent, intentPairs);
    const specificExactScore = [...evidence.exactBonuses].reduce(
      (sum, [term, value]) =>
        sum +
        (!NON_SPECIFIC_INTENT_TERMS.has(term) &&
        skillDocuments.filter((document) => document.includes(term)).length === 1
          ? value
          : 0),
      0,
    );
    return {
      skill,
      score: evidence.pairScore + specificExactScore,
      index,
    };
  });
  const matches = scoredSkills
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ skill, score }) => ({ skill, score }));
  const topScore = matches[0]?.score ?? 0;
  const secondScore = matches[1]?.score ?? 0;
  const boundaryConflict = matches.some((match) =>
    intentViolatesSkillBoundary(match.skill.id, boundaryIntent),
  );
  const capabilityEvidence = hasRequiredCapabilityTaskEvidence(
    matches[0]?.skill.id,
    normalizedIntent,
  );
  const confidence =
    !boundaryConflict &&
    capabilityEvidence &&
    normalizedIntent.length >= 2 &&
    topScore >= 9 &&
    topScore - secondScore >= 4
      ? 'strong'
      : 'low';
  const selectableMatches =
    confidence === 'strong'
      ? matches.filter(
          (match) => !intentViolatesSkillBoundary(match.skill.id, boundaryIntent),
        )
      : matches;
  return { confidence, matches: selectableMatches };
}

function hasRequiredCapabilityTaskEvidence(
  skillId: string | undefined,
  normalizedIntent: string,
): boolean {
  if (!skillId) return false;
  return CAPABILITY_TASK_EVIDENCE[skillId]?.test(normalizedIntent) ?? false;
}

function intentViolatesSkillBoundary(skillId: string, normalizedIntent: string): boolean {
  if (CONTENT_EXECUTION_SKILL_IDS.has(skillId)) {
    return (
      contentExecutionConflict(normalizedIntent) || hasUnnegatedContentPromise(normalizedIntent)
    );
  }
  if (skillId === 'a-share-market-briefing') {
    return STOCK_DECISION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent));
  }
  if (skillId === 'resume-search-screening') {
    if (HIRING_DIRECT_DECISION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent))) {
      return true;
    }
    if (
      HIRING_MIXED_DISCRIMINATION_ACTION.test(normalizedIntent) ||
      hasUnexemptedHiringDiscrimination(normalizedIntent)
    ) {
      return true;
    }
    if (HIRING_DECISION_EXPLANATION.test(normalizedIntent)) return false;
    return HIRING_DECISION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent));
  }
  return hasUnexemptedBoundaryConflict(skillId, normalizedIntent);
}

function hasUnexemptedBoundaryConflict(skillId: string, normalizedIntent: string): boolean {
  const conflicts = SKILL_BOUNDARY_CONFLICTS[skillId] ?? [];
  if (!conflicts.some((pattern) => pattern.test(normalizedIntent))) return false;
  const safeMentions = SKILL_BOUNDARY_SAFE_MENTIONS[skillId] ?? [];
  if (!safeMentions.some((pattern) => pattern.test(normalizedIntent))) return true;

  const clauses = splitBoundaryClauses(normalizedIntent);
  if (clauses.length <= 1) return false;
  return clauses.some(
    (clause) =>
      conflicts.some((pattern) => pattern.test(clause)) &&
      !safeMentions.some((pattern) => pattern.test(clause)),
  );
}

function hasUnexemptedHiringDiscrimination(normalizedIntent: string): boolean {
  if (!HIRING_DISCRIMINATION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent))) {
    return false;
  }
  const safeMention =
    HIRING_ANTI_DISCRIMINATION.test(normalizedIntent) ||
    HIRING_DIRECT_ANTI_DISCRIMINATION.test(normalizedIntent) ||
    HIRING_DISCRIMINATION_AUDIT.test(normalizedIntent) ||
    HIRING_DISCRIMINATION_ACTION_RISK_AUDIT.test(normalizedIntent);
  if (!safeMention) return true;

  const clauses = splitBoundaryClauses(normalizedIntent);
  if (clauses.length <= 1) return false;
  return clauses.some(
    (clause) =>
      HIRING_DISCRIMINATION_CONFLICTS.some((pattern) => pattern.test(clause)) &&
      !HIRING_ANTI_DISCRIMINATION.test(clause) &&
      !HIRING_DIRECT_ANTI_DISCRIMINATION.test(clause) &&
      !HIRING_DISCRIMINATION_AUDIT.test(clause) &&
      !HIRING_DISCRIMINATION_ACTION_RISK_AUDIT.test(clause),
  );
}

function splitBoundaryClauses(normalizedIntent: string): string[] {
  return normalizedIntent
    .split(
      /(?:然后|之后|随后|同时|并且|但是|但|再|并(?=(?:把|将|为我|帮我|替我|直接|自动|未经|没有|未|出具|提供|给出|代替|替代|相关性|相关关系|保证|承诺|确保|保底|批准|通过|认定|确认|决定|指派|分配|修改|涨薪|加薪|晋升|降级|辞退|解雇|淘汰|拒绝|录用|只招|只要|仅限|只选|只筛选|仅筛选|筛选|筛掉|过滤|排除|不招|不录用|优先考虑|发布|发表|上线|上传|推送|投流|投放|买量|交易|买入|卖出))|(?:完成|检查|分析|规则|看完|审完|写好|改好|准备好|评估)后)|[，,；;。.!！？?]+/,
    )
    .filter(Boolean);
}

function contentExecutionConflict(normalizedIntent: string): boolean {
  if (
    CONTENT_UNAMBIGUOUS_EXECUTION_CONFLICTS.some((pattern) => pattern.test(normalizedIntent))
  ) {
    return true;
  }
  return (
    CONTENT_LEADING_EXECUTION.test(normalizedIntent) &&
    !CONTENT_LEADING_PLANNING.test(normalizedIntent)
  );
}

function hasUnnegatedContentPromise(normalizedIntent: string): boolean {
  for (const match of normalizedIntent.matchAll(CONTENT_PROMISE_VERB)) {
    const prefix = normalizedIntent.slice(Math.max(0, match.index - 16), match.index);
    const clause = normalizedIntent
      .slice(match.index + match[0].length, match.index + match[0].length + 18)
      .split(/(?:但是|但|然而|然后|同时|并且|再|保证|承诺|确保)/, 1)[0];
    if (
      CONTENT_OUTCOME.test(clause) &&
      !hasNegatedContentPromisePrefix(prefix) &&
      !CONTENT_PROMISE_POST_NEGATION.test(clause)
    ) {
      return true;
    }
  }
  return false;
}

function hasNegatedContentPromisePrefix(prefix: string): boolean {
  return (
    CONTENT_PROMISE_NEGATION.test(prefix) && !CONTENT_PROMISE_DOUBLE_NEGATION.test(prefix)
  );
}

function scoreSkillIntent(
  skill: UiSkill,
  normalizedIntent: string,
  intentPairs: ReadonlySet<string>,
): {
  readonly pairScore: number;
  readonly exactBonuses: ReadonlyMap<string, number>;
} {
  if (!normalizedIntent) return { pairScore: 0, exactBonuses: new Map() };
  const weightedFields: ReadonlyArray<readonly [string, number, number]> = [
    [skill.name, 18, 6],
    ...skill.aliases.map((value) => [value, 14, 5] as const),
    [skill.description, 0, 3],
    ...skill.experience.starterPrompts.map((value) => [value, 0, 2] as const),
    ...skill.experience.requiredInputs.map((value) => [value, 0, 2] as const),
    ...skill.experience.deliverables.map((value) => [value, 0, 2] as const),
    [skill.experience.exampleSummary, 0, 2],
  ];
  const exactBonuses = new Map<string, number>();
  const pairWeights = new Map<string, number>();
  for (const [value, exactWeight, pairWeight] of weightedFields) {
    const normalizedValue = normalizeMatchText(value);
    if (normalizedValue.length < 2) continue;
    if (exactWeight > 0 && normalizedIntent.includes(normalizedValue)) {
      exactBonuses.set(
        normalizedValue,
        Math.max(exactBonuses.get(normalizedValue) ?? 0, exactWeight),
      );
    }
    for (const pair of characterPairs(normalizedValue)) {
      if (!intentPairs.has(pair)) continue;
      pairWeights.set(pair, Math.max(pairWeights.get(pair) ?? 0, pairWeight));
    }
  }
  return {
    pairScore: [...pairWeights.values()].reduce((sum, value) => sum + value, 0),
    exactBonuses,
  };
}

function normalizeSkillIntentDocument(skill: UiSkill): string {
  return [
    skill.name,
    ...skill.aliases,
    skill.description,
    ...skill.experience.starterPrompts,
    ...skill.experience.requiredInputs,
    ...skill.experience.deliverables,
    skill.experience.exampleSummary,
  ]
    .map(normalizeMatchText)
    .join('\n');
}

function normalizeMatchText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function normalizeBoundaryText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, '')
    .replace(/[\p{P}\p{S}]+$/gu, '');
}

function characterPairs(value: string): Set<string> {
  const pairs = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    pairs.add(value.slice(index, index + 2));
  }
  return pairs;
}

export function skillConnectorLabel(connectorId: string): string {
  const id = safeSkillText(connectorId);
  return CONNECTOR_LABELS[id] ?? id;
}

export function normalizeSkillRows(value: unknown): UiSkill[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    const skill = normalizeSkillRow(entry);
    if (!skill || seen.has(skill.id)) return [];
    seen.add(skill.id);
    return [skill];
  });
}

export function normalizeSkillToggleResponse(
  value: unknown,
  fallbackEnabled: boolean,
): SkillToggleSnapshot {
  if (!isRecord(value)) return { enabled: fallbackEnabled };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : fallbackEnabled,
  };
}

function normalizeSkillRow(value: unknown): UiSkill | null {
  if (!isRecord(value)) return null;
  const id = safeSkillText(value.id);
  if (!id) return null;
  const name = safeSkillText(value.name) || id;
  return {
    id,
    name,
    logoId: safeSkillText(value.logoId) || id,
    category: normalizeSkillCategory(value.category),
    description: safeSkillText(value.description) || '暂未提供说明',
    aliases: normalizeTextArray(value.aliases),
    maturity: normalizeSkillMaturity(value.maturity),
    connectors: normalizeTextArray(value.connectors),
    experience: normalizeSkillExperience(value.experience),
    enabled: value.enabled === true,
  };
}

function normalizeSkillExperience(value: unknown): UiSkill['experience'] {
  const experience = isRecord(value) ? value : {};
  return {
    starterPrompts: normalizeTextArray(experience.starterPrompts).slice(0, 3),
    requiredInputs: normalizeTextArray(experience.requiredInputs),
    deliverables: normalizeTextArray(experience.deliverables),
    boundary: safeSkillText(experience.boundary) || DEFAULT_SKILL_BOUNDARY,
    exampleSummary: safeSkillText(experience.exampleSummary) || '暂无示例说明',
  };
}

function normalizeSkillCategory(value: unknown): SkillCategory {
  return value === '内容运营' || value === '分析决策' || value === '管理协作' ? value : '内容运营';
}

function normalizeSkillMaturity(value: unknown): UiSkill['maturity'] {
  return value === 'workflow' || value === 'connected' || value === 'template' ? value : 'template';
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = safeSkillText(item);
    return text ? [text] : [];
  });
}

function safeSkillText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
