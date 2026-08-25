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
    '反馈与支持',
    '您主动提交的自由文本',
    '账号邮箱、账号标识、User-Agent 与可选的关联任务标识',
    '启用 Resend 时转发给 Resend',
    '否则可能进入服务日志',
    '处理反馈、故障、安全和争议所需',
    'privacy@holaday.ai',
    '不会自动扣款',
  ]) {
    assert.match(privacy, new RegExp(required), `missing truthful privacy copy: ${required}`);
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
