import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const privacy = await readFile(
  new URL('../../apps/holaday-landing/privacy.html', import.meta.url),
  'utf8',
);
const terms = await readFile(
  new URL('../../apps/holaday-landing/terms.html', import.meta.url),
  'utf8',
);

test('public landing privacy page states implemented data boundaries', () => {
  for (const required of [
    '最后更新：2026 年 8 月 25 日',
    '不可逆单向哈希',
    '不是服务器删除期限',
    '真实 Cookie 值',
    '登录扩展后自动同步',
    '服务器连接成功',
    '约每 30 分钟',
    '固定同步域名清单',
    'Cookie 名称、值、域名、路径',
    '当前没有逐站点开关',
    '退出 HOLA DAY 登录、停用或卸载扩展',
    'Apify',
    '网页地址与检索条件',
    'Zapier',
    '任务指令和任务标识',
    '跨平台自动化',
    '跨任务 AI 记忆',
    '任务指令与结果摘要',
    '后续相关任务',
    '偏好可能长期保留',
    '逐条删除或清空全部',
    '合伙人 KYC 与账本',
    '银行账户或银行卡指纹',
    '认证服务商与参考号',
    '提现金额、状态与风险评分',
    '邀请关系与奖励',
    'HOLA Credit 与 API Units 账本',
    '实名审核、账务、反欺诈、税务和争议',
    '外部实名认证、银行、支付或出款服务商',
    '今日能量星座资料',
    '姓名、精确生日、可选出生时间与地点、星座及浏览器时区',
    '当前浏览器的 localStorage',
    '提交给 HOLA DAY 星座接口',
    'DivineAPI 仅接收星座、日期或周期、语言及时区',
    '“我的能量”中选择“清除资料”',
    '反馈与支持',
    '您主动提交的自由文本',
    '账号邮箱、账号标识、User-Agent 与可选的关联任务标识',
    '启用 Resend 时转发给 Resend',
    '否则可能进入服务日志',
    '处理反馈、故障、安全和争议所需',
    '外部通知渠道',
    'webhook 地址和模板',
    '通知标题、正文、状态',
    '最多 60 字的定时任务意图',
    '企业微信、飞书、钉钉或自定义 webhook',
    '修改或删除渠道配置',
    'privacy@holaday.ai',
    '不会自动扣款',
  ]) {
    assert.match(privacy, new RegExp(required), `missing truthful privacy copy: ${required}`);
  }
});

test('public landing privacy table keeps mobile labels in accessible HTML', () => {
  assert.doesNotMatch(privacy, /\.data-table thead \{ display: none; \}/);
  assert.match(privacy, /class="mobile-cell-label">具体内容与用途<\/span>/);
  assert.match(privacy, /class="mobile-cell-label">保存标准或控制<\/span>/);
  const tbody = privacy.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const rowCount = tbody.match(/<tr>/g)?.length ?? 0;
  assert.ok(rowCount > 0, 'privacy table must contain data rows');
  assert.equal(
    tbody.match(/class="mobile-cell-label">具体内容与用途<\/span>/g)?.length ?? 0,
    rowCount,
    'each mobile data row must expose its content label in HTML',
  );
  assert.equal(
    tbody.match(/class="mobile-cell-label">保存标准或控制<\/span>/g)?.length ?? 0,
    rowCount,
    'each mobile data row must expose its retention label in HTML',
  );
});

test('public legal pages do not contact Google Fonts on every visit', () => {
  for (const [name, page] of [
    ['privacy', privacy],
    ['terms', terms],
  ]) {
    assert.doesNotMatch(page, /fonts\.googleapis\.com|fonts\.gstatic\.com/, `${name} loads Google Fonts`);
  }
});

test('public landing privacy page excludes unsupported promises', () => {
  for (const forbidden of [
    '密码（加密存储）',
    '账号注销后 30 日内删除',
    '任务内容与产出文件：默认 24 小时后自动清理',
    '系统日志：90 天',
    '使用本服务即视为同意相关第三方处理',
    '继续使用本服务即视为接受更新后的政策',
    '您授权的白名单网站',
    '由您授权的网站 Cookie',
  ]) {
    assert.doesNotMatch(privacy, new RegExp(forbidden), `unsupported privacy copy: ${forbidden}`);
  }
});

test('public landing terms match the implemented manual-renewal boundary', () => {
  assert.match(terms, /每次付款只购买所选周期/);
  assert.match(terms, /手动续费/);
  assert.match(terms, /不会自动扣款/);
  assert.doesNotMatch(terms, /月度续费如需取消/);
  assert.doesNotMatch(terms, /适用法律：新加坡/);
  assert.doesNotMatch(terms, /新加坡国际仲裁中心/);
});
